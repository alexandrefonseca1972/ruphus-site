import { NextResponse } from "next/server";
import { adminDb } from "@/lib/admin";
import { desativados } from "@/lib/crm";
import vitrine from "../../../../public/_vitrine.json";

// A folha de contato do /login (os 30 da VITRINE da landing), sem quem saiu do ar ou
// pediu remoção. Sem resposta da lista de fechados, segue a lista inteira.
export const revalidate = 300;

export async function GET() {
  const fora = new Set(await desativados(adminDb).catch(() => [] as string[]));
  return NextResponse.json(vitrine.filter((v) => !fora.has(v.slug)), {
    headers: { "cache-control": "public, max-age=300, stale-while-revalidate=3600" },
  });
}
