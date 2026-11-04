import { after, NextResponse } from "next/server";
import { assinaturaValida } from "@/lib/atendys";
import { adminDb } from "@/lib/admin";
import { DEMO } from "@/lib/demo";
import { avisarQueda, espelharStatusDaInstancia, lerConexao, processarComandoAgendamento, registrarMensagemRecebida, tenantDaInstancia } from "@/lib/whatsapp.server";

// Onde o atendys avisa o que acontece nas instâncias: mensagem recebida do
// cliente final, mudança de estado da conexão e status de envio. Cada webhook é
// assinado com HMAC-SHA256 em x-atendys-signature usando o segredo do tenant
// (gravado no doc privado do negócio ao conectar; só rotaciona quando falta).
//
// Contrato (packages/shared do atendys):
//   x-atendys-event: message.received | instance.status | message.status
//   message.received: { instance, messageId, phone, type: "text"|"media", text? }
//   instance.status:  { instance, status: pending_qr|connected|disconnected }
//   message.status:   { messageId, phone, status, errorCode?, errorMessage? }

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
  at?: string;
};

function responder(status: number, corpo: unknown) {
  return NextResponse.json(corpo, { status });
}

export async function POST(req: Request) {
  const bruto = await req.text();
  const eventoHeader = req.headers.get("x-atendys-event");
  const assinatura = req.headers.get("x-atendys-signature");
  if (!eventoHeader || !assinatura) return responder(401, { error: "Assinatura ausente." });
  // HMAC-SHA256 em hex tem 64 caracteres: o resto nem chega a ler o Firestore (cada POST
  // sem assinatura plausível custava uma consulta antes da recusa)
  if (!/^[0-9a-f]{64}$/i.test(assinatura)) return responder(401, { error: "Assinatura inválida." });

  let evento: Evento;
  try {
    evento = JSON.parse(bruto) as Evento;
  } catch {
    return responder(400, { error: "JSON inválido." });
  }
  // message.status (acked/entregue/lida) não traz instância e ainda não tem espelho no
  // ruphus: ack 200 sem verificar — responder 400 fazia o atendys repetir 5 vezes cada um
  if (evento.event === "message.status") return responder(200, { ok: true });
  if (typeof evento.instance !== "string" || !evento.instance) {
    return responder(400, { error: "Evento sem instância." });
  }

  // o segredo é por tenant: localiza o negócio antes de verificar a assinatura
  const slug = await tenantDaInstancia(adminDb, evento.instance);
  if (!slug) return responder(200, { ok: true }); // instância órfã — ack rápido
  // a demonstração não tem WhatsApp (lerConexao devolve null): ack, para o atendys não repetir
  // cinco vezes cada evento de uma instância que ficou pareada de antes
  if (slug === DEMO) return responder(200, { ok: true });
  const conexao = await lerConexao(adminDb, slug);
  const segredo = conexao?.atendysWebhookSecret;
  if (!segredo) return responder(401, { error: "Tenant sem segredo de webhook." });

  if (!assinaturaValida(segredo, bruto, assinatura)) return responder(401, { error: "Assinatura inválida." });

  if (evento.event === "message.received") {
    const data = evento.type === "text" ? { text: evento.text ?? "" } : null;
    const nova = await registrarMensagemRecebida(adminDb, slug, {
      phone: evento.phone,
      messageId: evento.messageId,
      data,
      timestamp: evento.at,
    });
    console.log(`[atendys] mensagem de ${evento.phone ?? "?"} para ${slug}${nova ? "" : " (repetida)"}`);
    // O comando roda fora da resposta: o atendys espera 200 rápido e o envio da
    // confirmação pode levar mais que isso. Só mensagem NOVA dispara comando —
    // entrega repetida do mesmo messageId vira no-op.
    if (nova && data) {
      after(() =>
        processarComandoAgendamento(adminDb, slug, { phone: evento.phone, data })
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
