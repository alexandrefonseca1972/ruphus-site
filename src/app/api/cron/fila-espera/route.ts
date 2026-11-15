import { FieldValue } from "firebase-admin/firestore";
import type { NextRequest } from "next/server";
import { adminDb } from "@/lib/admin";
import { expirarAvisos, processarLiberacoes } from "@/lib/fila-espera.server";
import { segredoIgual } from "@/lib/segredo.server";

// Fila de espera (deploy/crontab.txt: a cada minuto). Primeiro libera as vagas dos cancelamentos novos,
// depois expira os avisos sem resposta. Um falhar não para o outro. Sem o CRON_SECRET, ninguém dispara.
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || !segredoIgual(request.headers.get("authorization"), `Bearer ${segredo}`)) {
    return new Response("Unauthorized", { status: 401 });
  }
  // uma execução por vez: a do minuto anterior ainda rodando faz esta sair sem trabalho
  // ponytail: a trava vence em 50 s; uma execução mais longa que isso pode rodar junto com a próxima
  const cron = adminDb.doc("config/cron");
  const agora = Date.now();
  const livre = await adminDb.runTransaction(async (tx) => {
    const ate = (await tx.get(cron)).get("esperaLease.ate") as number | undefined;
    if (ate && agora < ate) return false;
    tx.set(cron, { esperaLease: { ate: agora + 50_000 } }, { merge: true });
    return true;
  });
  if (!livre) return Response.json({ ok: true, ocupado: true });
  try {
    const liberacoes = await processarLiberacoes(adminDb).catch((e) => (console.error("[cron] fila de espera: liberações", e), { eventos: 0, avisos: 0 }));
    const expiracoes = await expirarAvisos(adminDb).catch((e) => (console.error("[cron] fila de espera: expirações", e), { expiradas: 0, avisos: 0 }));
    // o instrumentation confere esta marca a cada 10 min e avisa o admin se passar de 10 min
    await cron.set({ esperaUltimaExecucao: FieldValue.serverTimestamp() }, { merge: true });
    return Response.json({ ok: true, liberacoes, expiracoes });
  } finally {
    await cron.set({ esperaLease: FieldValue.delete() }, { merge: true });
  }
}
