import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { adminDb } from "@/lib/admin";
import { PAGINAS_DEMO } from "@/lib/demo";
import { restaurarDemo } from "@/lib/demo.server";

// Restauração diária da demonstração, de madrugada (vercel.json: 06:00 UTC = 03:00 em
// Brasília): as datas de exemplo andam com o calendário e o teste da véspera some. A
// Vercel chama com "Authorization: Bearer $CRON_SECRET"; sem o segredo, ninguém restaura.
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || request.headers.get("authorization") !== `Bearer ${segredo}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const r = await restaurarDemo(adminDb, { adminUid: "cron" });
  for (const p of PAGINAS_DEMO) revalidatePath(p);
  return Response.json({ ok: true, agendamentos: r.agendamentos });
}
