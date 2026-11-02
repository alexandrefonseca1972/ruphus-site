import { adminDb } from "@/lib/admin";
import { criarIndice } from "@/lib/painel-indice.server";
import { responderPainel } from "@/lib/painel-rota.server";

// Um índice por processo, montado na primeira consulta (docs/plano-paginacao-admin.md, 3.1).
const indice = criarIndice(adminDb);

export async function GET(req: Request) {
  return responderPainel(req, { db: adminDb, indice });
}
