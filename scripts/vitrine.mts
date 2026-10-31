// A vitrine que o /login mostra no desktop sai da VITRINE da página /sobre (os sites
// do gerador que abrem a busca), para não haver duas listas de sites para manter.
//
//   npm run vitrine                          # regrava public/_vitrine.json
//   npm run vitrine -- --miniaturas [base]   # e baixa as capas em miniatura (base: www)
//   npm run vitrine -- --check               # falha se o arquivo ou uma miniatura faltar
//
// Rode depois de mudar a VITRINE em public/sobre/index.html.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

const QUANTOS = 30; // 6 colunas x 5 linhas: cobre 1440x900 de folha de contato

const raiz = resolve(import.meta.dirname, "..");
const destino = resolve(raiz, "public/_vitrine.json");

const html = readFileSync(resolve(raiz, "public/sobre/index.html"), "utf8");
// [\s\S] em vez da flag /s: o tsconfig do projeto mira antes de es2018
const bruto = html.match(/const VITRINE = (\[[\s\S]*?\n\]);/);
assert.ok(bruto, "VITRINE não encontrada em public/sobre/index.html");

type Entrada = { s: string; n: string; d: string; t: string };
// a VITRINE é um literal JS (chaves sem aspas): avaliado sem acesso a nada, num contexto vazio
const catalogo = runInNewContext(bruto[1], {}) as Entrada[];
assert.equal(catalogo.length, QUANTOS, `a VITRINE tem ${catalogo.length} sites, a folha de contato pede ${QUANTOS}`);

// A grade mostra cada capa com 62 px de altura: a og.jpg (1200x630) baixada 30 vezes
// pesava 1,2 MB no /login. Vai uma miniatura de 260x150 em WebP, guardada no repositório
// ("marca" é endereço reservado, nenhum negócio o usa).
const MINI = "public/marca/vitrine";
const miniatura = (slug: string) => `/marca/vitrine/${slug}.webp`;

const vitrine = catalogo.map((e) => ({
  slug: e.s,
  nome: e.n,
  sobre: e.d,
  capa: miniatura(e.s),
}));

const i = process.argv.indexOf("--miniaturas");
if (i >= 0) {
  const base = process.argv[i + 1]?.startsWith("http") ? process.argv[i + 1] : "https://www.ruphus.site";
  mkdirSync(resolve(raiz, MINI), { recursive: true });
  for (const e of catalogo) {
    const r = await fetch(`${base}${e.t}`);
    assert.ok(r.ok, `capa de ${e.s} não veio (${r.status})`);
    const webp = await sharp(Buffer.from(await r.arrayBuffer())).resize(260, 150, { fit: "cover", position: "top" }).webp({ quality: 70 }).toBuffer();
    writeFileSync(resolve(raiz, `public${miniatura(e.s)}`), webp);
  }
  console.log(`vitrine: ${catalogo.length} miniaturas em ${MINI}`);
}

const texto = `${JSON.stringify(vitrine, null, 0)}\n`;

if (process.argv.includes("--check")) {
  const atual = readFileSync(destino, "utf8");
  assert.equal(atual, texto, "public/_vitrine.json está desatualizado: rode npm run vitrine");
  const faltam = vitrine.filter((v) => !existsSync(resolve(raiz, `public${v.capa}`))).map((v) => v.slug);
  assert.equal(faltam.length, 0, `faltam miniaturas (${faltam.join(", ")}): rode npm run vitrine -- --miniaturas`);
  console.log("vitrine: em dia");
} else {
  writeFileSync(destino, texto);
  console.log(`vitrine: ${vitrine.length} sites em public/_vitrine.json`);
}
