#!/usr/bin/env -S npx tsx
/** Guarda no banco local o conteúdo das planilhas de prospecção (docs/*.xlsx).
 *
 * As planilhas são a listagem crua que vira site: ficavam só em docs/, fora do
 * git. Aqui cada linha vira registro na tabela `planilhas` do dblocal, com a
 * linha inteira em JSON (nada se perde ao apagar o .xlsx) e a situação que o
 * `npm run dblocal -- comparar` daria: novo, duplicado, a conferir ou fora.
 *
 * A tabela sobrevive à sincronização: `npm run dblocal` só regrava `negocios`.
 *
 *   npx tsx scripts/consolidar-planilhas.mts            # simula
 *   npx tsx scripts/consolidar-planilhas.mts --aplicar
 */
import { readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import lerAbas from "read-excel-file/node";
import { lerPlanilha } from "@/lib/gerador";
import { classificar } from "@/lib/dblocal";

const aplicar = process.argv.includes("--aplicar");
const PASTA = resolve(import.meta.dirname, "../docs");
const db = new DatabaseSync(resolve(import.meta.dirname, "../dblocal/ruphus.sqlite"));

db.exec(`CREATE TABLE IF NOT EXISTS planilhas (
  arquivo TEXT, aba TEXT, linha INTEGER, nome TEXT, telefone TEXT, categoria TEXT, endereco TEXT,
  bairro TEXT, cidade TEXT, uf TEXT, nota NUMERIC, avaliacoes NUMERIC, instagram TEXT, horario TEXT,
  situacao TEXT, slug_existente TEXT, dados_json TEXT, importado_em TEXT,
  PRIMARY KEY (arquivo, aba, linha));`);
const gravar = db.prepare(`INSERT OR REPLACE INTO planilhas
  (arquivo, aba, linha, nome, telefone, categoria, endereco, bairro, cidade, uf, nota, avaliacoes,
   instagram, horario, situacao, slug_existente, dados_json, importado_em)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

const agora = new Date().toISOString();
const arquivos = readdirSync(PASTA).filter((n) => n.toLowerCase().endsWith(".xlsx")).sort();
let total = 0;

for (const arquivo of arquivos) {
  const lidas = (await lerAbas(resolve(PASTA, arquivo))).map(({ sheet, data }) => ({ aba: sheet, linhas: data as unknown[][] }));
  // a linha crua, com o cabeçalho da aba: é o que sobra quando o .xlsx for apagado
  const cru = new Map<string, string>();
  for (const { aba, linhas } of lidas) {
    // o cabeçalho nem sempre é a primeira linha: há abas com título em cima (o
    // lerPlanilha procura nas cinco primeiras, aqui vale a mais preenchida delas)
    const topo = Math.max(0, linhas.slice(0, 5).findIndex((l) => l.filter((c) => String(c ?? "").trim()).length >= 3));
    const cabecalho = (linhas[topo] ?? []).map((c) => String(c ?? "").trim());
    linhas.forEach((linha, i) => {
      if (i <= topo || !linha.some((c) => String(c ?? "").trim())) return;
      cru.set(`${aba}\u0000${i + 1}`, JSON.stringify(Object.fromEntries(linha.map((c, j) => [cabecalho[j] || `col${j + 1}`, c ?? null]))));
    });
  }

  const { leads, erros, semTelefone } = lerPlanilha(lidas);
  // o que a leitura do gerador diria de cada linha; as que ela nem olha (abas de
  // notas, linhas vazias) entram assim mesmo, com a linha crua
  const situacoes = new Map<string, { nome: string; telefone: string; situacao: string; slug: string }>();
  for (const { aba, linha, lead } of leads) {
    const { situacao, existente } = classificar(db, lead);
    situacoes.set(`${aba}\u0000${linha}`, { nome: lead.nome, telefone: lead.telefone, situacao, slug: existente?.slug ?? "" });
  }
  for (const s of semTelefone) situacoes.set(`${s.aba}\u0000${s.linha}`, { nome: s.nome, telefone: "", situacao: `sem telefone: rede social ${s.redeSocial}`, slug: "" });
  for (const e of erros) situacoes.set(`${e.aba}\u0000${e.linha}`, { nome: "", telefone: "", situacao: `fora: ${e.motivo}`, slug: "" });
  const porLinha = new Map(leads.map(({ aba, linha, lead }) => [`${aba}\u0000${linha}`, lead]));

  console.log(`${arquivo}: ${cru.size} linhas (${lidas.length} aba(s))`);
  total += cru.size;
  if (!aplicar) continue;
  db.exec("BEGIN");
  for (const [chave, dados] of cru) {
    const [aba, texto] = chave.split("\u0000");
    const linha = Number(texto);
    const { nome = "", telefone = "", situacao = "fora: linha que a leitura não usa", slug = "" } = situacoes.get(chave) ?? {};
    const l = porLinha.get(chave);
    gravar.run(arquivo, aba, linha, nome || null, telefone || null, l?.categoria ?? null, l?.endereco ?? null,
      l?.bairro ?? null, l?.cidade ?? null, l?.uf ?? null, l?.nota ?? null, l?.avaliacoes ?? null,
      l?.instagram ?? null, l?.horario ?? null, situacao, slug || null, dados, agora);
  }
  db.exec("COMMIT");
}

console.log(`${arquivos.length} planilhas, ${total} linhas${aplicar ? " gravadas" : " (simulação, nada gravado)"}`);
if (aplicar) {
  const resumo = db.prepare(`SELECT CASE WHEN situacao LIKE 'novo%' THEN 'novo' WHEN situacao LIKE 'duplicado%' THEN 'duplicado'
      WHEN situacao LIKE 'conferir%' THEN 'conferir' WHEN situacao LIKE 'sem telefone%' THEN 'sem telefone'
      ELSE 'fora da leitura' END situacao, COUNT(*) n FROM planilhas GROUP BY 1 ORDER BY 2 DESC`).all() as { situacao: string; n: number }[];
  for (const r of resumo) console.log(`  ${r.n}\t${r.situacao}`);
}
