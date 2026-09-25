import { NextResponse } from "next/server";
import { adminDb } from "@/lib/admin";
import { desativados } from "@/lib/crm";
import { SUBS, type Sub } from "@/lib/gerador";

// A landing (/sobre) traz no HTML só os sites estáticos da fábrica; os do gerador
// nascem no banco e chegam por aqui, no mesmo formato ({s, n, d, t}) do catálogo dela,
// mais a cidade (c), que a landing soma às da fábrica.
// Uma hora de cache: são ~160 leituras por volta, e a landing já abre com a lista estática.
export const revalidate = 3600;

export async function GET() {
  const [snap, fora] = await Promise.all([
    adminDb.collection("tenants").where("gerado.sub", "!=", null).select("name", "site.city", "gerado.sub", "gerado.bairro").get(),
    desativados(adminDb).catch(() => [] as string[]),
  ]);
  const tirar = new Set(fora);
  const sites = snap.docs
    .filter((d) => !tirar.has(d.id))
    .map((d) => {
      const rotulo = SUBS[d.get("gerado.sub") as Sub]?.rotulo ?? "";
      const bairro = String(d.get("gerado.bairro") ?? "");
      return { s: d.id, n: String(d.get("name") ?? d.id), d: [rotulo, bairro].filter(Boolean).join(" · "), t: `/s/${d.id}/og.jpg`, c: String(d.get("site.city") ?? "") };
    });
  return NextResponse.json(sites, { headers: { "cache-control": "public, max-age=300, stale-while-revalidate=3600" } });
}
