import type { NextRequest } from "next/server";
import { enviarLembretesDoDia } from "@/lib/lembretes-whatsapp.server";

// Lembretes de horário pelo WhatsApp do salão (vercel.json: a cada 10 min). A Vercel
// chama com "Authorization: Bearer $CRON_SECRET"; sem o segredo, ninguém dispara.
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || request.headers.get("authorization") !== `Bearer ${segredo}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json({ ok: true, enviados: await enviarLembretesDoDia() });
}
