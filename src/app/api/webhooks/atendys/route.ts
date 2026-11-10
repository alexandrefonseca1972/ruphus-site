import { after, NextResponse } from "next/server";
import { enviarTexto, OPTIN_DONO, versaoDaAssinatura, type CabecalhosWebhook } from "@/lib/atendys";
import { adminDb } from "@/lib/admin";
import { DEMO } from "@/lib/demo";
import { atualizarParada, avisarFalhaDeEnvio, lerIndice, NAO_SAI_A_TEMPO } from "@/lib/mensagens-paradas.server";
import { avisarQueda, codigoDoAgendamento, espelharStatusDaInstancia, executarComandoPendente, idDoComando, lerConexao, lerConfigWhatsApp, registrarMensagemRecebida, tenantDaInstancia } from "@/lib/whatsapp.server";
import { conexaoOficial, instanciaPlataforma, lerBotao, negocioDoComando, negociosDoDono, segredoPlataforma, usaCanalOficial } from "@/lib/canal-oficial.server";
import { acaoDoCliente, pedidoDesatualizado } from "@/lib/botoes-whatsapp.server";

// Onde o atendys avisa o que acontece nas instâncias: mensagem recebida do
// cliente final, mudança de estado da conexão e status de envio. Cada webhook é
// assinado com HMAC-SHA256 em x-atendys-signature usando o segredo do tenant
// (gravado no doc privado do negócio ao conectar; só rotaciona quando falta).
// v2 (anti-replay): x-atendys-timestamp + x-atendys-signature-v2 sobre "${timestamp}.${corpo}",
// janela de ±300 s. Exigida desde 2026-11-09: só x-atendys-signature (v1) leva 401.
//
// Contrato (packages/shared do atendys):
//   x-atendys-event: message.received | instance.status | message.status
//   message.received: { instance, messageId, phone, type: "text"|"media", text? }
//   instance.status:  { instance, status: pending_qr|connected|disconnected }
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
const STATUS_MENSAGEM = new Set(["queued", "awaiting_manual", "manual_started", "sent", "delivered", "read", "failed"]);

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
    // envio comum (não parado na cota) só interessa quando falha: o resto é ack sem leituras
    if (indice.vigiada && !indice.parada && evento.status !== "failed" && !naoSai) return responder(200, { ok: true });
    // lerConfigWhatsApp, não lerConexao: o negócio pode ter desconectado (sem instanceId) depois do
    // envio, e a falha daquela mensagem ainda tem de chegar à gaveta
    const segredoDaMensagem = (await lerConfigWhatsApp(adminDb, slugDaMensagem))?.atendysWebhookSecret;
    // assinatura conferida antes de gravar qualquer coisa. Recusada, responde 200 como a desconhecida
    // (um 401 só aqui diria a quem não assina que esse id é de uma mensagem parada). A mensagem
    // parada pode ter saído pelo canal oficial: aí quem assina é o tenant da plataforma
    // (só para negócio do canal oficial: o segredo da plataforma não vale para os outros)
    const segredoOficial = (await usaCanalOficial(adminDb, slugDaMensagem)) ? await segredoPlataforma(adminDb) : null;
    const versao = (segredoDaMensagem ? versaoDaAssinatura(segredoDaMensagem, bruto, cab) : null) ?? (segredoOficial ? versaoDaAssinatura(segredoOficial, bruto, cab) : null);
    if (!versao) {
      console.warn(`[webhook atendys] message.status com assinatura inválida para ${slugDaMensagem}`);
      return responder(200, { ok: true });
    }
    console.log(`[webhook atendys] assinatura ${versao}: message.status de ${slugDaMensagem}`);
    const at = Date.parse(evento.at ?? "");
    await atualizarParada(slugDaMensagem, id!, String(evento.status), evento.retryAt === undefined ? undefined : (evento.retryAt ?? null), Number.isNaN(at) ? Date.now() : at, evento.errorCode);
    if (evento.status === "failed" || naoSai) await avisarFalhaDeEnvio(slugDaMensagem, id!, naoSai ? NAO_SAI_A_TEMPO : evento.errorCode);
    return responder(200, { ok: true });
  }
  if (typeof evento.instance !== "string" || !evento.instance) {
    return responder(400, { error: "Evento sem instância." });
  }

  // canal oficial: o número da plataforma atende vários negócios; o do dono diz qual
  if (evento.instance === instanciaPlataforma()) {
    const segredo = await segredoPlataforma(adminDb);
    if (!segredo) return recusar("Plataforma sem segredo de webhook.");
    const versao = versaoDaAssinatura(segredo, bruto, cab);
    if (!versao) return recusar("Assinatura inválida.", " na plataforma");
    if (evento.event !== "message.received" || evento.type !== "text" || !evento.phone) return responder(200, { ok: true });
    const botao = lerBotao(evento.reply?.id);
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
      // resposta de cliente ao número da plataforma: fica na caixa do atendys
      // ponytail: encaminhar à caixa do negócio pelo último agendamento do cliente
      console.log(`[webhook atendys] canal oficial: mensagem de quem não é dono (${evento.phone.slice(-4)})`);
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

  // o segredo é por tenant: localiza o negócio antes de verificar a assinatura
  const slug = await tenantDaInstancia(adminDb, evento.instance);
  if (!slug) {
    console.warn(`[webhook atendys] instância órfã ${JSON.stringify(evento.instance).slice(0, 80)} (${eventoHeader}): ack sem processar`);
    return responder(200, { ok: true }); // ack rápido
  }
  // a demonstração não tem WhatsApp (lerConexao devolve null): ack, para o atendys não repetir
  // cinco vezes cada evento de uma instância que ficou pareada de antes
  if (slug === DEMO) return responder(200, { ok: true });
  const conexao = await lerConexao(adminDb, slug);
  const segredo = conexao?.atendysWebhookSecret;
  if (!segredo) return recusar("Tenant sem segredo de webhook.", ` em ${slug}`);

  const versao = versaoDaAssinatura(segredo, bruto, cab);
  if (!versao) return recusar("Assinatura inválida.", ` em ${slug}`);
  console.log(`[webhook atendys] assinatura ${versao}: ${evento.event} de ${slug}`);

  if (evento.event === "message.received") {
    const data = evento.type === "text" ? { text: evento.text ?? "" } : null;
    const nova = await registrarMensagemRecebida(adminDb, slug, {
      phone: evento.phone,
      messageId: evento.messageId,
      data,
      timestamp: evento.at,
    }, data ? "salao" : undefined);
    console.log(`[atendys] mensagem de ${evento.phone ?? "?"} para ${slug}${nova ? "" : " (repetida)"}`);
    // O comando roda fora da resposta: o atendys espera 200 rápido e o envio da
    // confirmação pode levar mais que isso. Só mensagem NOVA dispara comando —
    // entrega repetida do mesmo messageId vira no-op.
    // o pendente fica gravado até processar: se cair aqui, o cron (lembretes) roda de novo
    if (nova && data && evento.messageId) {
      after(() =>
        executarComandoPendente(adminDb, idDoComando(slug, inboxId(evento.messageId!)))
          .then((r) => {
            if (r !== "ignorado") console.log(`[atendys] comando de agendamento em ${slug}: ${r}`);
          })
          .catch((e) => console.error("[atendys] comando de agendamento", e)),
      );
    }
  } else if (evento.event === "instance.status") {
    const { caiu } = await espelharStatusDaInstancia(adminDb, slug, { status: evento.status, at: evento.at });
    // o push vai depois do 200: serviço de push lento fazia o atendys esgotar o tempo e reentregar
    if (caiu) after(() => avisarQueda(adminDb, slug));
  }
  return responder(200, { ok: true });
}

export async function GET() {
  return responder(405, { error: "Método não permitido." });
}

// o mesmo id que registrarMensagemRecebida dá à mensagem na caixa de entrada
const inboxId = (messageId: string) => messageId.replace(/[^A-Za-z0-9_-]/g, "_");
