import type { NextRequest } from "next/server";
import { adminDb } from "@/lib/admin";
import { produzir } from "@/lib/prospeccao-fila.server";
import { segredoIgual } from "@/lib/segredo.server";

// Produtor da fila da prospecção (F5; deploy/crontab.txt: às 7h). Cria os itens do dia com create() e
// espalha os horários na janela; sem config/prospeccao.ativo, não cria nada. Mesmo segredo dos outros crons.
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || !segredoIgual(request.headers.get("authorization"), `Bearer ${segredo}`)) {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json({ ok: true, ...(await produzir(adminDb)) });
}
