// Recorta a vitrine que o /login mostra no desktop a partir do catálogo que a
// página /sobre já carrega, para não haver duas listas de sites para manter.
//
//   npm run vitrine            # regrava public/_vitrine.json
//   npm run vitrine -- --check # falha se o arquivo estiver desatualizado
//
// Rode depois de sync:sites, quando o catálogo de /sobre mudar.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const QUANTOS = 30; // 6 colunas x 5 linhas: cobre 1440x900 de folha de contato

const raiz = resolve(import.meta.dirname, "..");
const destino = resolve(raiz, "public/_vitrine.json");

const html = readFileSync(resolve(raiz, "public/sobre/index.html"), "utf8");
// [\s\S] em vez da flag /s: o tsconfig do projeto mira antes de es2018
const bruto = html.match(/\[\{"s":[\s\S]*?\}\]/);
assert.ok(bruto, "catálogo não encontrado em public/sobre/index.html");

type Entrada = { s: string; n: string; d: string; t: string };
const catalogo = JSON.parse(bruto[0]) as Entrada[];
assert.ok(catalogo.length > QUANTOS, `catálogo tem só ${catalogo.length} sites`);

// Espalhado pelo catálogo inteiro, e não os 24 primeiros: assim a vitrine mostra
// nichos e cidades variados em vez de tudo que começa com "a".
const passo = Math.floor(catalogo.length / QUANTOS);
const vitrine = Array.from({ length: QUANTOS }, (_, i) => catalogo[i * passo]).map((e) => ({
  slug: e.s,
  nome: e.n,
  sobre: e.d,
  capa: e.t,
}));

const texto = `${JSON.stringify(vitrine, null, 0)}\n`;

if (process.argv.includes("--check")) {
  const atual = readFileSync(destino, "utf8");
  assert.equal(atual, texto, "public/_vitrine.json está desatualizado: rode npm run vitrine");
  console.log("vitrine: em dia");
} else {
  writeFileSync(destino, texto);
  console.log(`vitrine: ${vitrine.length} sites em public/_vitrine.json`);
}
