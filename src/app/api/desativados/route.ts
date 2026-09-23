import { NextResponse, type NextRequest } from "next/server";
import { adminDb } from "@/lib/admin";
import { desativados } from "@/lib/crm";

// O proxy consulta esta lista para tirar um site do ar sem precisar de deploy.
// Quem está fora do ar costuma ser quem não pagou: com DESATIVADOS_TOKEN no
// ambiente, só o proxy lê. Sem a variável, segue aberta (ambiente local).
export const revalidate = 30;

export async function GET(request: NextRequest) {
  const segredo = process.env.DESATIVADOS_TOKEN;
  if (segredo && request.headers.get("x-ruphus") !== segredo) {
    return new NextResponse("nao encontrado", { status: 404 });
  }
  const slugs = await desativados(adminDb).catch(() => [] as string[]);
  return NextResponse.json(slugs, {
    headers: { "cache-control": segredo ? "private, max-age=30" : "public, max-age=30, stale-while-revalidate=300" },
  });
}
