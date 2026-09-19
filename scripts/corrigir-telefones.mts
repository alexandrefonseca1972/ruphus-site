#!/usr/bin/env -S npx tsx
/** Põe no tenant o telefone do negócio, não o da Ruphus.
 *
 * O importador lia o JSON-LD, e nesses sites o "telephone" do JSON-LD é o
 * contato da proposta — o nosso. O número do negócio estava logo ali, no
 * link tel: e num segundo wa.me da própria página.
 *
 *   npx tsx --env-file=.env.local scripts/corrigir-telefones.mts            # simula
 *   npx tsx --env-file=.env.local scripts/corrigir-telefones.mts --aplicar
 */
import assert from "node:assert/strict";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const RUPHUS = "5511948680554";

/** Só dígitos com DDI, pelo tamanho — 55 também é DDD, então prefixo não decide. */
export function normalizar(bruto: string) {
  const d = bruto.replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d;
  // 15 dígitos = DDI dobrado na importação (55 + 5592…)
  if (d.length === 15 && d.startsWith("5555")) return d.slice(2);
  return "";
}

/** O telefone do negócio: o primeiro número da página que não seja o nosso. */
export function telefoneDoSite(html: string) {
  const achados = [...html.matchAll(/(?:wa\.me\/|href="tel:)([+\d\s()-]{10,20})/g)].map((m) => normalizar(m[1]));
  const contagem = new Map<string, number>();
  for (const n of achados) if (n && n !== RUPHUS) contagem.set(n, (contagem.get(n) ?? 0) + 1);
  return [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

if (process.argv.includes("--self-check")) {
  assert.equal(normalizar("(92) 98473-9695"), "5592984739695");
  assert.equal(normalizar("+55 98 99215-5703"), "5598992155703");
  assert.equal(normalizar("5532200000"), "555532200000", "DDD 55 não é DDI");
  assert.equal(normalizar("555592994890173"), "5592994890173", "DDI dobrado");
  assert.equal(normalizar("123"), "");
  assert.equal(telefoneDoSite('<a href="https://wa.me/5511948680554">nós</a><a href="tel:+5593991460711">'), "5593991460711");
  assert.equal(telefoneDoSite('<a href="https://wa.me/5511948680554">só o nosso</a>'), "", "sem o do negócio, não inventa");
  console.log("corrigir-telefones: ok");
  process.exit(0);
}

initializeApp({ credential: cert(JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS!, "utf8"))) });
const db = getFirestore();
const aplicar = process.argv.includes("--aplicar");
const SITES = join(import.meta.dirname, "../public/s");

let trocados = 0, semAchar = 0, jaOk = 0;
for (const t of (await db.collection("tenants").get()).docs) {
  const atual = String(t.get("site.phone") ?? "").replace(/\D/g, "");
  const suspeito = atual === RUPHUS || !normalizar(atual);
  if (!suspeito) { jaOk += 1; continue; }
  let html = "";
  try { html = readFileSync(join(SITES, t.id, "index.html"), "utf8"); } catch {}
  const novo = html ? telefoneDoSite(html) : normalizar(atual);
  if (!novo) {
    console.log(`  ? ${t.id}: ${atual || "(vazio)"} → nada encontrado, fica sem telefone`);
    if (aplicar) await t.ref.update({ "site.phone": null });
    semAchar += 1;
    continue;
  }
  console.log(`  ✓ ${t.id}: ${atual || "(vazio)"} → ${novo}`);
  if (aplicar) await t.ref.update({ "site.phone": novo });
  trocados += 1;
}
console.log(`\n${aplicar ? "corrigidos" : "seriam corrigidos"}: ${trocados} | sem telefone: ${semAchar} | já estavam certos: ${jaOk}`);
