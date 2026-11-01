// Uma vez: grava site.maps (link da ficha no Maps) e gerado.categoria nos negócios gerados
// antes desses campos existirem, cruzando pelo telefone (8 últimos dígitos) com as coletas
// do Firestore e as fichas.jsonl locais (dblocal/pesquisa). Não sobrescreve o que já tem.
//
//   npm run backfill:maps              # prévia: quantos acharia
//   npm run backfill:maps -- --aplicar
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { adminDb } from "@/lib/admin";
import { fim8, type Ficha } from "@/lib/coleta";

const aplicar = process.argv.includes("--aplicar");
const achado = new Map<string, { maps: string; categoria: string }>();
const guardar = (tel: unknown, link: unknown, categoria: unknown) => {
  const k = fim8(tel);
  const maps = String(link ?? "").split("?")[0];
  if (k && /^https:\/\/www\.google\.com\/maps\/\S+$/.test(maps) && !achado.has(k)) achado.set(k, { maps: maps.slice(0, 500), categoria: String(categoria ?? "").slice(0, 80) });
};

for (const d of (await adminDb.collectionGroup("leads").get()).docs) {
  if (d.ref.parent.parent?.parent.id !== "coletas") continue;
  guardar(d.get("lead.telefone") ?? d.get("telefone"), d.get("link_maps"), d.get("lead.categoria") ?? d.get("categoria"));
}
const pesquisa = resolve(import.meta.dirname, "../dblocal/pesquisa");
for (const pasta of existsSync(pesquisa) ? readdirSync(pesquisa) : []) {
  const arq = resolve(pesquisa, pasta, "fichas.jsonl");
  if (!existsSync(arq)) continue;
  for (const l of readFileSync(arq, "utf8").split("\n")) {
    try {
      const f = JSON.parse(l) as Ficha;
      guardar(f.telefone, f.link_maps, f.categoria);
    } catch {}
  }
}
console.log(`${achado.size} telefones com link do Maps`);

const tenants = await adminDb.collection("tenants").select("site.phone", "site.maps", "gerado.categoria", "gerado.sub").get();
const mudar = tenants.docs.flatMap((t) => {
  const a = achado.get(fim8(t.get("site.phone")));
  if (!a || t.get("site.maps")) return [];
  // categoria só em site gerado: fábrica e conta sem site não têm o bloco gerado
  return [{ ref: t.ref, dados: { site: { maps: a.maps }, ...(t.get("gerado.sub") && !t.get("gerado.categoria") && a.categoria && { gerado: { categoria: a.categoria } }) } }];
});
console.log(`${mudar.length} de ${tenants.size} negócios ganham o link${aplicar ? "" : " (prévia: --aplicar grava)"}`);
if (aplicar) {
  for (let i = 0; i < mudar.length; i += 400) {
    const lote = adminDb.batch();
    mudar.slice(i, i + 400).forEach((m) => lote.set(m.ref, m.dados, { merge: true }));
    await lote.commit();
  }
  console.log("gravado");
}
process.exit(0);
