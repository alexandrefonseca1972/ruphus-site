import { NextResponse } from "next/server";
import { COMMIT } from "@/lib/versao";

// O que está no ar agora. O painel compara com o commit da página: diferente, é versão nova;
// sem resposta, caiu a conexão (ou o app está reiniciando num deploy).
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ commit: COMMIT }, { headers: { "cache-control": "no-store" } });
}
