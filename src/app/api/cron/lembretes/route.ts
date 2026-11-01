import type { NextRequest } from "next/server";
import { adminDb } from "@/lib/admin";
import { enviarLembretesDoDia } from "@/lib/lembretes-whatsapp.server";
import { expirarSinais } from "@/lib/sinal.server";

// Lembretes de horário pelo WhatsApp do salão (vercel.json: a cada 10 min). A Vercel
// chama com "Authorization: Bearer $CRON_SECRET"; sem o segredo, ninguém dispara.
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || request.headers.get("authorization") !== `Bearer ${segredo}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  // sinal vencido primeiro: o horário liberado já não recebe lembrete
  const sinaisVencidos = await expirarSinais(adminDb).catch((e) => (console.error("[cron] expirar sinais", e), 0));
  return Response.json({ ok: true, sinaisVencidos, enviados: await enviarLembretesDoDia() });
}
