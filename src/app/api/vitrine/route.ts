import { NextResponse } from "next/server";
import { adminDb } from "@/lib/admin";
import { desativados } from "@/lib/crm";
import vitrine from "../../../../public/_vitrine.json";

// A folha de contato do /login (os 30 da VITRINE da landing), sem quem saiu do ar ou
// pediu remoção, e quantos sites estão no ar. Sem resposta da lista de fechados, segue
// a lista inteira.
export const revalidate = 300;

export async function GET() {
  const [lista, contagem] = await Promise.all([
    desativados(adminDb).catch(() => [] as string[]),
    adminDb.collection("tenants").count().get().then((c) => c.data().count).catch(() => 0),
  ]);
  const fora = new Set(lista);
  return NextResponse.json({ sites: vitrine.filter((v) => !fora.has(v.slug)), total: Math.max(0, contagem - fora.size) }, {
    headers: { "cache-control": "public, max-age=300, stale-while-revalidate=3600" },
  });
}
