// Uma vez (15/11/2026): celular gravado sem o 9º dígito em tenants.site.phone ganha o 9
// (canonicalBrMobile) e os sites duplicados que isso revela são apagados (tenant, crm e fotos).
// Fixo (assinante começando em 2-5) fica como está.
//
//   npx tsx --conditions=react-server --env-file=.env.local scripts/telefone-com-9.mts            # prévia
//   npx tsx --conditions=react-server --env-file=.env.local scripts/telefone-com-9.mts --aplicar  # backup + aplica
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DocumentReference } from "firebase-admin/firestore";
import { adminBucket, adminDb } from "@/lib/admin";
import { PREFIXO } from "@/lib/site-arquivo";
import { canonicalBrMobile, soDigitosComDDI } from "@/lib/telefone";

// mesmo número, mesmo endereço ou nome: fica o de mais avaliações e com o 9
const APAGAR = ["le-blanc-studio-spa", "beleza-arte"];
const aplicar = process.argv.includes("--aplicar");

const tenants = await adminDb.collection("tenants").select("site.phone").get();
const corrigir = tenants.docs
  .filter((d) => !APAGAR.includes(d.id))
  .map((d) => ({ slug: d.id, de: String(d.get("site.phone") ?? "") }))
  .map((t) => ({ ...t, para: canonicalBrMobile(t.de) }))
  .filter((t) => t.de && t.para !== t.de);

// depois de corrigir, nenhum celular pode sobrar repetido com e sem o 9
const vistos = new Map<string, string[]>();
for (const d of tenants.docs) {
  if (APAGAR.includes(d.id)) continue;
  const t = soDigitosComDDI(String(d.get("site.phone") ?? ""));
  if (t) vistos.set(t, [...(vistos.get(t) ?? []), `${d.id} (${d.get("site.phone")})`]);
}
// repetido idêntico já antes (não vem da correção) só aparece no aviso; o que a correção juntaria para
const corrigidos = new Set(corrigir.map((t) => t.slug));
const repetidos = [...vistos].filter(([, s]) => s.length > 1);
for (const [t, s] of repetidos) console.log(`aviso: mesmo telefone ${t}: ${s.join(", ")}`);
if (repetidos.some(([, s]) => s.some((x) => corrigidos.has(x.split(" ")[0])))) process.exit(1);

console.log(`${corrigir.length} telefones ganham o 9:`);
for (const t of corrigir) console.log(`  ${t.slug}: ${t.de} → ${t.para}`);
console.log(`apagar: ${APAGAR.join(", ")}`);
if (!aplicar) process.exit(0);

async function copia(ref: DocumentReference): Promise<unknown> {
  const doc = await ref.get();
  const subs = await ref.listCollections();
  const filhos = Object.fromEntries(
    await Promise.all(subs.map(async (c) => [c.id, await Promise.all((await c.listDocuments()).map(async (r) => ({ id: r.id, ...(await copia(r) as object) })))])),
  );
  return { dados: doc.exists ? doc.data() : null, filhos };
}
const backup = resolve(import.meta.dirname, `../dblocal/backup-telefone-com-9-${Date.now()}.json`);
writeFileSync(backup, JSON.stringify({
  corrigir,
  apagados: await Promise.all(APAGAR.map(async (s) => ({ slug: s, tenant: await copia(adminDb.doc(`tenants/${s}`)), crm: await copia(adminDb.doc(`crm/${s}`)) }))),
}, null, 1));
console.log(`backup: ${backup}`);

for (let i = 0; i < corrigir.length; i += 400) {
  const lote = adminDb.batch();
  for (const t of corrigir.slice(i, i + 400)) lote.update(adminDb.doc(`tenants/${t.slug}`), { "site.phone": t.para });
  await lote.commit();
}
for (const s of APAGAR) {
  await adminDb.recursiveDelete(adminDb.doc(`crm/${s}`));
  await adminDb.recursiveDelete(adminDb.doc(`tenants/${s}`));
  await adminBucket().deleteFiles({ prefix: `${PREFIXO}/${s}/` });
}
console.log(`ok: ${corrigir.length} corrigidos, ${APAGAR.length} apagados`);
process.exit(0);
