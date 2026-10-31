// A vitrine que o /login mostra no desktop sai da VITRINE da página /sobre (os sites
// do gerador que abrem a busca), para não haver duas listas de sites para manter.
//
//   npm run vitrine            # regrava public/_vitrine.json
//   npm run vitrine -- --check # falha se o arquivo estiver desatualizado
//
// Rode depois de mudar a VITRINE em public/sobre/index.html.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const QUANTOS = 30; // 6 colunas x 5 linhas: cobre 1440x900 de folha de contato

const raiz = resolve(import.meta.dirname, "..");
const destino = resolve(raiz, "public/_vitrine.json");

const html = readFileSync(resolve(raiz, "public/sobre/index.html"), "utf8");
// [\s\S] em vez da flag /s: o tsconfig do projeto mira antes de es2018
const bruto = html.match(/const VITRINE = (\[[\s\S]*?\n\]);/);
assert.ok(bruto, "VITRINE não encontrada em public/sobre/index.html");

type Entrada = { s: string; n: string; d: string; t: string };
// a VITRINE é JS com chaves sem aspas: vira JSON pondo aspas nelas e tirando a vírgula final
const json = bruto[1].replace(/([{,]\s*)([a-z]+):/g, '$1"$2":').replace(/,(\s*\])/, "$1");
const catalogo = JSON.parse(json) as Entrada[];
assert.equal(catalogo.length, QUANTOS, `a VITRINE tem ${catalogo.length} sites, a folha de contato pede ${QUANTOS}`);

const vitrine = catalogo.map((e) => ({
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
