import { NextResponse, type NextRequest } from "next/server";
import { adminDb } from "@/lib/admin";
import { mapaDominios } from "@/lib/dominio.server";

// O proxy consulta este mapa (domínio próprio → site) para servir o site do cliente no
// domínio dele. Mesma porta da lista de fechados: com DESATIVADOS_TOKEN, só o proxy lê.
export const revalidate = 30;

export async function GET(request: NextRequest) {
  const segredo = process.env.DESATIVADOS_TOKEN;
  if (!segredo && process.env.VERCEL_ENV === "production") return new NextResponse("nao encontrado", { status: 404 });
  if (segredo && request.headers.get("x-ruphus") !== segredo) return new NextResponse("nao encontrado", { status: 404 });
  const mapa = await mapaDominios(adminDb).catch(() => ({ hosts: {}, porSlug: {} }));
  return NextResponse.json(mapa, {
    headers: { "cache-control": segredo ? "private, max-age=30" : "public, max-age=30, stale-while-revalidate=300" },
  });
}
