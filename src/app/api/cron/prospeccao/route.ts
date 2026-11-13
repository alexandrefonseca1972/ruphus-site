import type { NextRequest } from "next/server";
import { adminDb } from "@/lib/admin";
import { consumirUm } from "@/lib/prospeccao-fila.server";
import { segredoIgual } from "@/lib/segredo.server";

// Consumidor da fila da prospecção (F5; deploy/crontab.txt: a cada minuto). Um item por execução, só
// com config/prospeccao.ativo e dentro da janela. O cron da VPS chama com "Authorization: Bearer
// $CRON_SECRET"; sem o segredo, ninguém dispara.
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || !segredoIgual(request.headers.get("authorization"), `Bearer ${segredo}`)) {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json({ ok: true, resultado: await consumirUm(adminDb) });
}
