import { adminDb } from "@/lib/admin";
import { indiceDoPainel } from "@/lib/painel-indice.server";
import { responderPainel } from "@/lib/painel-rota.server";

export async function GET(req: Request) {
  return responderPainel(req, { db: adminDb, indice: indiceDoPainel(adminDb) });
}
