import { createHmac, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { adminDb } from "@/lib/admin";
import { espelharStatusDaInstancia, lerConexao, processarComandoAgendamento, registrarMensagemRecebida, tenantDaInstancia } from "@/lib/whatsapp.server";

// Onde o atendys avisa o que acontece nas instâncias: mensagem recebida do
// cliente final, mudança de estado da conexão e status de envio. Cada webhook é
// assinado com HMAC-SHA256 em x-atendys-signature usando o segredo do tenant
// (gravado no doc do negócio ao conectar — rotaciona a cada reconexão).
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

  let evento: Evento;
  try {
    evento = JSON.parse(bruto) as Evento;
  } catch {
    return responder(400, { error: "JSON inválido." });
  }
  if (typeof evento.instance !== "string" || !evento.instance) {
    return responder(400, { error: "Evento sem instância." });
  }

  // o segredo é por tenant: localiza o negócio antes de verificar a assinatura
  const slug = await tenantDaInstancia(adminDb, evento.instance);
  if (!slug) return responder(200, { ok: true }); // instância órfã — ack rápido
  const conexao = await lerConexao(adminDb, slug);
  const segredo = conexao?.atendysWebhookSecret;
  if (!segredo) return responder(401, { error: "Tenant sem segredo de webhook." });

  const esperado = createHmac("sha256", segredo).update(bruto, "utf8").digest("hex");
  const recebida = Buffer.from(assinatura, "utf8");
  const calculada = Buffer.from(esperado, "utf8");
  if (recebida.length !== calculada.length || !timingSafeEqual(recebida, calculada)) {
    return responder(401, { error: "Assinatura inválida." });
  }

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
    await espelharStatusDaInstancia(adminDb, slug, { status: evento.status });
  }
  // message.status (acked/entregue/lida) ainda não tem espelho no ruphus —
  // a caixa de entrada e o polling cobrem o fluxo atual. Ack rápido em 200.

  return responder(200, { ok: true });
}

export async function GET() {
  return responder(405, { error: "Método não permitido." });
}
