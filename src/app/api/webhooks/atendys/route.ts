import { after, NextResponse } from "next/server";
import { versaoDaAssinatura, type CabecalhosWebhook } from "@/lib/atendys";
import { adminDb } from "@/lib/admin";
import { DEMO } from "@/lib/demo";
import { atualizarParada, marcarFalhaVigiada, negocioDaMensagem } from "@/lib/mensagens-paradas.server";
import { avisar } from "@/lib/avisos.server";
import { avisarQueda, espelharStatusDaInstancia, executarComandoPendente, idDoComando, lerConexao, registrarErroNotificacao, registrarMensagemRecebida, tenantDaInstancia } from "@/lib/whatsapp.server";
import { instanciaPlataforma, negocioDoComando, negociosDoDono, segredoPlataforma, usaCanalOficial } from "@/lib/canal-oficial.server";

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
//     o negócio sai do índice mensagensWhatsapp (só as que pararam na cota estão lá)

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
    const slugDaMensagem = typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? await negocioDaMensagem(id) : null;
    if (!slugDaMensagem || !STATUS_MENSAGEM.has(String(evento.status))) return responder(200, { ok: true });
    const segredoDaMensagem = (await lerConexao(adminDb, slugDaMensagem))?.atendysWebhookSecret;
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
    if (evento.status === "failed") await avisarFalhaDeEnvio(slugDaMensagem, id!, evento.errorCode);
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
    const doDono = await negocioDoComando(adminDb, await negociosDoDono(adminDb, evento.phone), evento.text ?? "");
    if (!doDono) {
      // resposta de cliente ao número da plataforma: fica na caixa do atendys
      // ponytail: encaminhar à caixa do negócio pelo último agendamento do cliente
      console.log(`[webhook atendys] canal oficial: mensagem de quem não é dono (${evento.phone.slice(-4)})`);
      return responder(200, { ok: true });
    }
    const data = { text: evento.text ?? "" };
    const nova = await registrarMensagemRecebida(adminDb, doDono, { phone: evento.phone, messageId: evento.messageId, data, timestamp: evento.at }, "plataforma");
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

// por que um aviso aceito não chegou: frase para quem gere, nunca o texto técnico da Meta
function motivoDaFalha(codigo?: string | null) {
  if (codigo === "MESSAGE_EXPIRED") return "não saiu até o horário (fora do horário de envio ou limite do dia)";
  if (codigo === "META_131026") return "o número do cliente não recebe mensagens no WhatsApp";
  if (codigo === "TEMPLATE_REQUIRED" || codigo === "META_131047") return "fora da janela de 24 horas do WhatsApp";
  return "o WhatsApp recusou a entrega";
}

/** Aviso aceito pelo atendys que falhou depois (a Meta recusou ou venceu o prazo): o dono já ouviu
 *  "cliente avisado", então vai para a gaveta e para o celular de quem gere. Uma vez por mensagem. */
async function avisarFalhaDeEnvio(slug: string, id: string, codigo?: string | null) {
  try {
    const falha = await marcarFalhaVigiada(id);
    if (!falha) return;
    const texto = `Um aviso pelo WhatsApp não foi entregue: ${motivoDaFalha(codigo)}.${falha.resumo ? ` Mensagem: ${falha.resumo}` : ""}`;
    console.warn(`[webhook atendys] envio ${id} de ${slug} falhou (${codigo ?? "sem código"})`);
    await registrarErroNotificacao(adminDb, slug, { message: texto, at: Date.now() });
    await avisar(adminDb, slug, { title: "Aviso do WhatsApp não entregue", body: texto.slice(0, 180), url: `/${slug}`, tag: `falha-${id}` }, { soGestores: true });
  } catch (e) {
    console.error(`[webhook atendys] aviso da falha de ${id}`, e);
  }
}

// o mesmo id que registrarMensagemRecebida dá à mensagem na caixa de entrada
const inboxId = (messageId: string) => messageId.replace(/[^A-Za-z0-9_-]/g, "_");
