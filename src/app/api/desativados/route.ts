import { NextResponse, type NextRequest } from "next/server";
import { adminDb } from "@/lib/admin";
import { segredoIgual } from "@/lib/segredo.server";
import { desativados } from "@/lib/crm";

// O proxy consulta esta lista para tirar um site do ar sem precisar de deploy.
// Quem está fora do ar costuma ser quem não pagou: com DESATIVADOS_TOKEN no
// ambiente, só o proxy lê. Sem a variável, só fica aberta fora da produção.
export const revalidate = 30;

export async function GET(request: NextRequest) {
  const segredo = process.env.DESATIVADOS_TOKEN;
  if (!segredo && process.env.NODE_ENV === "production") return new NextResponse("nao encontrado", { status: 404 });
  if (segredo && !segredoIgual(request.headers.get("x-ruphus"), segredo)) {
    return new NextResponse("nao encontrado", { status: 404 });
  }
  try {
    return NextResponse.json(await desativados(adminDb), {
      headers: { "cache-control": segredo ? "private, max-age=30" : "public, max-age=30, stale-while-revalidate=300" },
    });
  } catch (e) {
    // 503, não lista vazia: o proxy só troca a lista com 200, e lista vazia poria no ar quem não pagou
    console.error("[desativados] lista", e);
    return new NextResponse("indisponivel", { status: 503, headers: { "cache-control": "no-store" } });
  }
}
