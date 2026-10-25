import { createHmac, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { adminDb } from "@/lib/admin";
import { espelharStatusDaInstancia, processarComandoAgendamento, registrarMensagemRecebida, tenantDaInstancia } from "@/lib/whatsapp.server";

// Onde o gateway WhatsApp (wtsfy) avisa o que acontece nas instâncias: mensagem
// recebida e mudança de estado da conexão. O corpo bruto viaja assinado com
// HMAC-SHA256 em x-wtsfy-signature, com o segredo compartilhado nos dois lados.

type Evento = {
  type?: string;
  instanceId?: string;
  phone?: string;
  messageId?: string;
  data?: unknown;
  timestamp?: string | number;
};

export async function POST(req: Request) {
  const bruto = await req.text();
  const assinatura = req.headers.get("x-wtsfy-signature");
  const segredo = process.env.WTSFY_WEBHOOK_SECRET;
  if (!segredo || !assinatura) return NextResponse.json({ error: "Assinatura ausente." }, { status: 401 });

  const esperado = createHmac("sha256", segredo).update(bruto, "utf8").digest("hex");
  const recebida = Buffer.from(assinatura, "utf8");
  const calculada = Buffer.from(esperado, "utf8");
  if (recebida.length !== calculada.length || !timingSafeEqual(recebida, calculada)) {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }

  let evento: Evento;
  try {
    evento = JSON.parse(bruto) as Evento;
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const slug = evento.instanceId ? await tenantDaInstancia(adminDb, evento.instanceId) : null;

  if (evento.type === "message.received") {
    if (slug) {
      const nova = await registrarMensagemRecebida(adminDb, slug, { phone: evento.phone, messageId: evento.messageId, data: evento.data ?? null, timestamp: evento.timestamp });
      console.log(`[wtsfy] mensagem de ${evento.phone ?? "?"} para ${slug}${nova ? "" : " (repetida)"}`);
      // O comando roda fora da resposta: o gateway espera 200 rápido (timeout de
      // 10s) e o envio da confirmação pode levar mais que isso. Só mensagem NOVA
      // dispara comando — entrega repetida do mesmo messageId vira no-op.
      if (nova) {
        after(() =>
          processarComandoAgendamento(adminDb, slug, { phone: evento.phone, data: evento.data })
            .then((r) => {
              if (r !== "ignorado") console.log(`[wtsfy] comando de agendamento em ${slug}: ${r}`);
            })
            .catch((e) => console.error("[wtsfy] comando de agendamento", e)),
        );
      }
    }
  } else if (evento.type === "instance.status") {
    if (slug) await espelharStatusDaInstancia(adminDb, slug, (evento.data ?? {}) as { status?: unknown; phone?: unknown; reason?: unknown });
  }

  // sem tenant vinculado à instância não há o que fazer — mas o gateway espera 200
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ error: "Método não permitido." }, { status: 405 });
}
