import { after, NextResponse } from "next/server";
import { enviarTexto, OPTIN_DONO, versaoDaAssinatura, type CabecalhosWebhook } from "@/lib/atendys";
import { adminDb } from "@/lib/admin";
import { atualizarEnvio } from "@/lib/consumo.server";
import { atualizarParada, avisarFalhaDeEnvio, lerIndice, NAO_SAI_A_TEMPO } from "@/lib/mensagens-paradas.server";
import { codigoDoAgendamento, executarComandoPendente, idDoComando, registrarMensagemRecebida } from "@/lib/whatsapp.server";
import { confirmarDono, conexaoOficial, instanciaPlataforma, lerBotao, negocioDoComando, negociosDoDono, responderForaDoFluxo, segredoPlataforma, usaCanalOficial } from "@/lib/canal-oficial.server";
import { acaoDoCliente, pedidoDesatualizado } from "@/lib/botoes-whatsapp.server";

// Onde o atendys avisa o que acontece no número da plataforma (canal oficial): mensagem recebida
// (comando ou botão do dono, botão ou resposta do cliente) e status de envio. Cada webhook é
// assinado com o segredo do tenant da plataforma (config/atendys-plataforma).
// v2 (anti-replay): x-atendys-timestamp + x-atendys-signature-v2 sobre "${timestamp}.${corpo}",
// janela de ±300 s. Exigida desde 2026-11-09: só x-atendys-signature (v1) leva 401.
//
// Contrato (packages/shared do atendys):
//   x-atendys-event: message.received | instance.status | message.status
//   message.received: { instance, messageId, phone, type: "text"|"media", text? }
//   message.status:   { messageId, phone, status, errorCode?, errorMessage?, retryAt? } — sem instância:
//     o negócio sai do índice mensagensWhatsapp (as paradas na cota e os envios vigiados)

type Evento = {
  event?: string;
  instance?: string;
  messageId?: string;
  phone?: string;
  type?: string;
  text?: string;
  status?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  retryAt?: string | null;
  at?: string;
  /** botão tocado (API oficial): id definido por nós ao enviar */
  reply?: { id?: string; title?: string };
};

// os estados do atendys que o painel acompanha; qualquer outro texto não é gravado
const STATUS_MENSAGEM = new Set(["queued", "awaiting_manual", "manual_started", "sent", "delivered", "read", "failed", "cancelled"]);

function responder(status: number, corpo: unknown) {
  return NextResponse.json(corpo, { status });
}

export async function POST(req: Request) {
  const bruto = await req.text();
  const eventoHeader = req.headers.get("x-atendys-event");
  const cab: CabecalhosWebhook = {
    v1: req.headers.get("x-atendys-signature"),
    v2: req.headers.get("x-atendys-signature-v2"),
    timestamp: req.headers.get("x-atendys-timestamp"),
  };
  const assinatura = cab.v2; // só a v2: a v1 sozinha é recusada como ausente (o log diz v1=sim)
  // toda recusa vai ao log com os cabeçalhos presentes e o desvio do timestamp: sem isso uma v2
  // quebrada do atendys ficava invisível no journalctl (e o item "exigir v2" depende desse log)
  const recusar = (motivo: string, onde = "") => {
    const desvio = cab.timestamp ? ` desvio=${Math.round(Date.now() / 1000 - Number(cab.timestamp))}s` : "";
    console.warn(`[webhook atendys] 401 ${motivo}${onde} (event=${eventoHeader ?? "-"} v1=${cab.v1 ? "sim" : "não"} v2=${cab.v2 ? "sim" : "não"}${desvio})`);
    return responder(401, { error: motivo });
  };
  if (!eventoHeader || !assinatura) return recusar("Assinatura ausente.");
  // HMAC-SHA256 em hex tem 64 caracteres: o resto nem chega a ler o Firestore (cada POST
  // sem assinatura plausível custava uma consulta antes da recusa)
  if (!/^[0-9a-f]{64}$/i.test(assinatura)) return recusar("Assinatura inválida.", " (formato)");

  let evento: Evento;
  try {
    evento = JSON.parse(bruto) as Evento;
  } catch {
    return responder(400, { error: "JSON inválido." });
  }
  // message.status não traz instância: o negócio vem do índice das mensagens que pararam na
  // cota. Fora dele (envio comum), ack 200 sem gravar nada — 400 fazia o atendys repetir 5 vezes
  if (evento.event === "message.status") {
    const id = evento.messageId;
    const indice = typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? await lerIndice(id) : null;
    if (!indice || !STATUS_MENSAGEM.has(String(evento.status))) return responder(200, { ok: true });
    const slugDaMensagem = indice.slug;
    // envio vigiado na fila para depois do prazo (horário silencioso, limite): já não serve, e o dono
    // ouviu "cliente avisado". Falha agora, não quando vencer na hora do atendimento
    const retry = Date.parse(evento.retryAt ?? "");
    const naoSai = evento.status === "queued" && indice.vigiada && indice.prazo !== null && retry >= indice.prazo;
    // envio comum (não parado na cota) interessa quando falha ou é cancelado (não saiu: estorna) e,
    // para o consumo, quando sai, é entregue ou lido: o resto (queued) é ack sem leituras
    if (indice.vigiada && !indice.parada && !["failed", "cancelled", "sent", "delivered", "read"].includes(String(evento.status)) && !naoSai) return responder(200, { ok: true });
    // assinatura conferida antes de gravar qualquer coisa. Recusada, responde 200 como a desconhecida
    // (um 401 só aqui diria a quem não assina que esse id é de uma mensagem parada). Todo envio
    // sai pelo tenant da plataforma: é ele quem assina (mesmo que o negócio tenha saído do canal
    // oficial depois do envio, a falha daquela mensagem ainda tem de chegar à gaveta)
    const segredo = await segredoPlataforma(adminDb);
    const versao = segredo ? versaoDaAssinatura(segredo, bruto, cab) : null;
    if (!versao) {
      console.warn(`[webhook atendys] message.status com assinatura inválida para ${slugDaMensagem}`);
      return responder(200, { ok: true });
    }
    console.log(`[webhook atendys] assinatura ${versao}: message.status de ${slugDaMensagem}`);
    const at = Date.parse(evento.at ?? "");
    await atualizarParada(slugDaMensagem, id!, String(evento.status), evento.retryAt === undefined ? undefined : (evento.retryAt ?? null), Number.isNaN(at) ? Date.now() : at, evento.errorCode);
    await atualizarEnvio(slugDaMensagem, id!, naoSai ? "failed" : String(evento.status), naoSai ? NAO_SAI_A_TEMPO : evento.errorCode, Number.isNaN(at) ? Date.now() : at);
    if (evento.status === "failed" || naoSai) await avisarFalhaDeEnvio(slugDaMensagem, id!, naoSai ? NAO_SAI_A_TEMPO : evento.errorCode);
    return responder(200, { ok: true });
  }
  if (typeof evento.instance !== "string" || !evento.instance) {
    return responder(400, { error: "Evento sem instância." });
  }

  // canal oficial: o número da plataforma atende vários negócios; o do dono diz qual
  if (evento.instance === (await instanciaPlataforma(adminDb))) {
    const segredo = await segredoPlataforma(adminDb);
    if (!segredo) return recusar("Plataforma sem segredo de webhook.");
    const versao = versaoDaAssinatura(segredo, bruto, cab);
    if (!versao) return recusar("Assinatura inválida.", " na plataforma");
    if (evento.event !== "message.received" || evento.type !== "text" || !evento.phone) return responder(200, { ok: true });
    const botao = lerBotao(evento.reply?.id);
    // "Sou eu" do dono que cadastrou o WhatsApp no painel: vale só do número cadastrado. A marca já
    // gravada é o dedupe das reentregas (a resposta sai uma vez)
    if (botao?.acao === "ok") {
      const r = botao.agendamento === "dono" ? await confirmarDono(adminDb, botao.slug, evento.phone) : "id inválido";
      if (typeof r === "string") {
        console.warn(`[webhook atendys] "Sou eu" de ${botao.slug} ignorado: ${r} (${evento.phone.slice(-4)})`);
        return responder(200, { ok: true });
      }
      const oficial = await conexaoOficial(adminDb, botao.slug).catch(() => null);
      const texto = `Pronto! Os pedidos de agendamento de *${r.negocio.replace(/\*/g, "")}* chegam neste número.`;
      if (oficial) after(() => enviarTexto(oficial, evento.phone!, texto, OPTIN_DONO, undefined, { resposta: true }).catch((e) => console.error("[atendys] resposta ao Sou eu", e)));
      return responder(200, { ok: true });
    }
    // botão do cliente (lembrete/lista de horários): a caixa de entrada é o dedupe das reentregas
    if (botao && botao.acao.startsWith("c")) {
      // id é dado de fora: só grava na caixa de um negócio do canal oficial (o resto confere acaoDoCliente)
      if (!(await usaCanalOficial(adminDb, botao.slug))) return responder(200, { ok: true });
      const nova = await registrarMensagemRecebida(adminDb, botao.slug, { phone: evento.phone, messageId: evento.messageId, data: { text: evento.text ?? "" }, timestamp: evento.at });
      // ponytail: sem pendente reprocessável (como o do dono); queda no meio perde o toque e o cliente toca de novo
      if (nova) after(() => acaoDoCliente(adminDb, botao, evento.phone!).then((r) => console.log(`[atendys] botão do cliente em ${botao.slug}: ${r}`)).catch((e) => console.error("[atendys] botão do cliente", e)));
      return responder(200, { ok: true });
    }
    // botão do dono (Confirmar/Recusar): vira o comando com o código longo do agendamento, só se
    // este número é mesmo o dono daquele negócio
    if (botao) {
      if (!(await negociosDoDono(adminDb, evento.phone)).includes(botao.slug)) {
        console.warn(`[webhook atendys] botão do dono de ${botao.slug} vindo de outro número (${evento.phone.slice(-4)})`);
        return responder(200, { ok: true });
      }
      // pedido de um horário que já mudou (o cliente remarcou): não confirma o horário novo às cegas.
      // A caixa de entrada é o dedupe: a reentrega do mesmo toque não repete o aviso
      if (await pedidoDesatualizado(adminDb, botao)) {
        console.log(`[webhook atendys] botão de pedido desatualizado em ${botao.slug}`);
        const nova = await registrarMensagemRecebida(adminDb, botao.slug, { phone: evento.phone, messageId: evento.messageId, data: { text: evento.text ?? "" }, timestamp: evento.at });
        const oficial = nova ? await conexaoOficial(adminDb, botao.slug).catch(() => null) : null;
        if (oficial) after(() => enviarTexto(oficial, evento.phone!, "Esse pedido mudou de horário (o cliente remarcou). Use o pedido mais recente ou o painel.", OPTIN_DONO, undefined, { resposta: true }).catch((e) => console.error("[atendys] aviso de pedido desatualizado", e)));
        return responder(200, { ok: true });
      }
      evento.text = `${botao.acao === "dc" ? "CONFIRMADO" : "RECUSAR"} ${codigoDoAgendamento(botao.agendamento, 12)}`;
    }
    const doDono = botao ? botao.slug : await negocioDoComando(adminDb, await negociosDoDono(adminDb, evento.phone), evento.text ?? "");
    if (!doDono) {
      // resposta de cliente ao número da plataforma: fica na caixa do atendys e o cliente ouve, uma vez
      // por dia, com quem falar (o negócio do último agendamento). Reentrega cai no limite de 24 h
      // ponytail: encaminhar à caixa do negócio pelo último agendamento do cliente
      console.log(`[webhook atendys] canal oficial: mensagem de quem não é dono (${evento.phone.slice(-4)})`);
      // "Confirmado" de cliente também recebe a orientação: comando só vale para o dono
      const texto = evento.text ?? "";
      after(() => responderForaDoFluxo(adminDb, evento.phone!, texto, evento.instance!));
      return responder(200, { ok: true });
    }
    const data = { text: evento.text ?? "" };
    // botão: o pendente leva o agendamento do pedido (só ele pode ser decidido) e, quando o id traz,
    // o horário, conferido de novo na transação. Pedido antigo vem sem horário
    const esperado = botao ? { agendamento: botao.agendamento, ...(botao.extra && { horario: botao.extra }) } : undefined;
    const nova = await registrarMensagemRecebida(adminDb, doDono, { phone: evento.phone, messageId: evento.messageId, data, timestamp: evento.at }, "plataforma", esperado);
    if (nova && evento.messageId) {
      after(() =>
        executarComandoPendente(adminDb, idDoComando(doDono, inboxId(evento.messageId!)))
          .then((r) => console.log(`[atendys] canal oficial: comando em ${doDono}: ${r}`))
          .catch((e) => console.error("[atendys] comando pelo canal oficial", e)),
      );
    }
    return responder(200, { ok: true });
  }

  // instância que não é a da plataforma: resto do número próprio por QR, que não existe mais.
  // Ack sem processar, para o atendys não repetir cinco vezes cada evento. Log uma vez por instância
  // por processo (debug): cada status de uma instância antiga não vira uma linha de aviso
  const inst = JSON.stringify(evento.instance).slice(0, 80);
  if (!instanciasVistas.has(inst) && instanciasVistas.size < 100) {
    instanciasVistas.add(inst);
    console.debug(`[webhook atendys] instância desconhecida ${inst} (${eventoHeader}): ack sem processar`);
  }
  return responder(200, { ok: true });
}

const instanciasVistas = new Set<string>();

export async function GET() {
  return responder(405, { error: "Método não permitido." });
}

// o mesmo id que registrarMensagemRecebida dá à mensagem na caixa de entrada
const inboxId = (messageId: string) => messageId.replace(/[^A-Za-z0-9_-]/g, "_");
