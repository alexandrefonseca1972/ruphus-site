// Banco local (SQLite) com todos os negócios do sistema e o que foi gerado para cada um
// (tenant, site, bio, agenda, funil). Serve para comparar com listagens novas em .xlsx
// antes de gerar: o que já existe, o que parece duplicado e o que é novo.
//
//   npm run dblocal                          # baixa do Firestore e regrava dblocal/ruphus.sqlite
//   npm run dblocal -- comparar lista.xlsx   # grava dblocal/comparacao-lista.csv, linha a linha
//   npm run dblocal -- --self-check
//
// O banco é uma cópia: regravado inteiro a cada sincronização, nunca a fonte da verdade.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { lerPlanilha } from "@/lib/gerador";

const PASTA = resolve(import.meta.dirname, "../dblocal");
const ARQUIVO = resolve(PASTA, "ruphus.sqlite");

/** Sem acento, minúsculo, só letra e número: "Salão D'Paula" e "SALAO DPAULA" são o mesmo nome. */
const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

const COLUNAS = [
  "slug", "nome", "nome_norm", "telefone", "categoria", "nicho", "sub", "endereco", "bairro", "cidade", "cidade_norm", "uf",
  "instagram", "nota", "avaliacoes", "horario", "site_url", "bio_url", "agenda_url", "tipo", "no_ar", "estagio", "origem_crm",
  "ultimo_contato", "notas", "motivo_perda", "mensal_cents", "dono_whatsapp", "servicos", "criado_em", "sincronizado_em", "dados_json",
] as const;
type Linha = Record<(typeof COLUNAS)[number], string | number | null>;

function criarTabela(db: DatabaseSync) {
  db.exec(`DROP TABLE IF EXISTS negocios;
    CREATE TABLE negocios (slug TEXT PRIMARY KEY, ${COLUNAS.slice(1).map((c) => `${c} ${["nota", "avaliacoes", "no_ar", "notas", "mensal_cents"].includes(c) ? "NUMERIC" : "TEXT"}`).join(", ")});
    CREATE INDEX negocios_telefone ON negocios (telefone);
    CREATE INDEX negocios_nome ON negocios (nome_norm, cidade_norm);`);
}
const inserir = (db: DatabaseSync, l: Linha) =>
  db.prepare(`INSERT INTO negocios (${COLUNAS.join(", ")}) VALUES (${COLUNAS.map(() => "?").join(", ")})`).run(...COLUNAS.map((c) => l[c]));

type Existente = { slug: string; site_url: string; estagio: string; no_ar: number };
/** Telefone é quem identifica o negócio (como no gerador); nome e cidade iguais com outro
 *  número pode ser o mesmo negócio ou outra unidade: fica para alguém olhar. */
export function classificar(db: DatabaseSync, lead: { nome: string; telefone: string; cidade: string }) {
  const campos = "slug, site_url, estagio, no_ar";
  const porTelefone = db.prepare(`SELECT ${campos} FROM negocios WHERE telefone = ?`).get(lead.telefone) as Existente | undefined;
  if (porTelefone) return { situacao: "duplicado: mesmo telefone", existente: porTelefone };
  // planilha sem coluna de cidade: vale o nome sozinho, senão nada bateria
  const porNome = db.prepare(`SELECT ${campos} FROM negocios WHERE nome_norm = ? AND (? = '' OR cidade_norm = ?)`).get(norm(lead.nome), norm(lead.cidade), norm(lead.cidade)) as Existente | undefined;
  if (porNome) return { situacao: `conferir: mesmo nome${lead.cidade ? " e cidade" : ""}, outro telefone`, existente: porNome };
  return { situacao: "novo", existente: null };
}

if (process.argv.includes("--self-check")) {
  const db = new DatabaseSync(":memory:");
  criarTabela(db);
  const vazio = Object.fromEntries(COLUNAS.map((c) => [c, null])) as Linha;
  inserir(db, { ...vazio, slug: "salao-dpaula", nome: "Salão D'Paula", nome_norm: norm("Salão D'Paula"), telefone: "5591991508056", cidade_norm: norm("Belém"), site_url: "https://salao-dpaula.ruphus.site" });
  assert.equal(classificar(db, { nome: "Outro nome", telefone: "5591991508056", cidade: "Belém" }).situacao, "duplicado: mesmo telefone");
  assert.equal(classificar(db, { nome: "SALAO DPAULA", telefone: "5591988887777", cidade: "Belem" }).existente?.slug, "salao-dpaula");
  assert.equal(classificar(db, { nome: "SALAO DPAULA", telefone: "5591988887777", cidade: "Ananindeua" }).situacao, "novo", "mesmo nome em outra cidade é outro negócio");
  assert.equal(classificar(db, { nome: "SALAO DPAULA", telefone: "5591988887777", cidade: "" }).existente?.slug, "salao-dpaula", "sem cidade na planilha, o nome basta");
  console.log("dblocal: ok");
  process.exit(0);
}

mkdirSync(PASTA, { recursive: true });
const db = new DatabaseSync(ARQUIVO);

if (process.argv[2] === "comparar") {
  const planilha = process.argv[3];
  if (!planilha) throw new Error("Informe a planilha: npm run dblocal -- comparar lista.xlsx");
  const { default: lerAbas } = await import("read-excel-file/node");
  const abas = (await lerAbas(planilha)).map(({ sheet, data }) => ({ aba: sheet, linhas: data as unknown[][] }));
  const { leads, erros } = lerPlanilha(abas);
  const saida = [
    ...leads.map(({ aba, linha, lead }) => {
      const { situacao, existente } = classificar(db, lead);
      return [aba, linha, lead.nome, lead.telefone, lead.cidade, situacao, existente?.slug, existente?.site_url, existente?.estagio, existente && (existente.no_ar ? "no ar" : "fora do ar")];
    }),
    // o que o gerador recusaria de qualquer jeito (sem telefone, telefone inventado, repetido na planilha)
    ...erros.map((e) => [e.aba, e.linha, "", "", "", `fora: ${e.motivo}`]),
  ].sort((a, b) => String(a[0]).localeCompare(String(b[0])) || Number(a[1]) - Number(b[1]));
  const csv = [["aba", "linha", "nome", "telefone", "cidade", "situacao", "slug_existente", "site_existente", "estagio", "no_ar"], ...saida]
    .map((l) => l.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const destino = resolve(PASTA, `comparacao-${basename(planilha).replace(/\.[^.]+$/, "")}.csv`);
  writeFileSync(destino, `﻿${csv}\r\n`); // BOM: o Excel abre com acento certo
  const conta = (p: string) => saida.filter((l) => String(l[5]).startsWith(p)).length;
  console.log(`${saida.length} linhas — ${conta("novo")} novas, ${conta("duplicado")} duplicadas, ${conta("conferir")} a conferir, ${conta("fora")} fora na leitura\n${destino}`);
  process.exit(0);
}

// Sincronizar: três leituras (negócios, funil e serviços) e o banco é regravado inteiro
const { cert, initializeApp } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
initializeApp({ credential: cert(JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS!, "utf8"))) });
const fs = getFirestore();
const [tenants, crm, servicos] = await Promise.all([fs.collection("tenants").get(), fs.collection("crm").get(), fs.collectionGroup("services").select("name").get()]);
const funil = new Map(crm.docs.map((d) => [d.id, d.data()]));
const porNegocio = new Map<string, string[]>();
for (const s of servicos.docs) {
  const slug = s.ref.parent.parent?.id;
  if (slug) porNegocio.set(slug, [...(porNegocio.get(slug) ?? []), String(s.get("name") ?? s.id)]);
}
const data = (v: unknown) => (v as { toDate?: () => Date } | undefined)?.toDate?.().toISOString() ?? null;
const agora = new Date().toISOString();

db.exec("BEGIN");
criarTabela(db);
for (const t of tenants.docs) {
  const site = (t.get("site") ?? {}) as Record<string, unknown>;
  const gerado = t.get("gerado") as Record<string, unknown> | undefined;
  const c = funil.get(t.id) ?? {};
  const url = String(site.url ?? `https://${t.id}.ruphus.site`);
  const txt = (v: unknown) => (v == null || v === "" ? null : String(v));
  inserir(db, {
    slug: t.id, nome: txt(t.get("name")), nome_norm: norm(t.get("name")), telefone: txt(site.phone), categoria: txt(site.category),
    nicho: txt(gerado?.nicho), sub: txt(gerado?.sub), endereco: txt(site.address), bairro: txt(gerado?.bairro),
    cidade: txt(site.city), cidade_norm: norm(site.city), uf: txt(site.uf), instagram: txt(site.instagram),
    nota: (site.rating as number) ?? null, avaliacoes: (site.reviews as number) ?? null, horario: txt(gerado?.horario),
    site_url: url, bio_url: `${url}/bio`, agenda_url: `${url}/agendar`,
    // site da fábrica é arquivo no Storage; o gerado vem de planilha (prospeccao) ou do cadastro do dono
    tipo: gerado ? String(gerado.origem ?? "gerado") : "fabrica",
    no_ar: c.publicado === false ? 0 : 1, estagio: String(c.estagio ?? "novo"), origem_crm: txt(c.origem),
    ultimo_contato: data(c.ultimoContatoEm), notas: (c.notas as number) ?? 0, motivo_perda: txt(c.motivoPerda),
    mensal_cents: (c.mensalCents as number) ?? null, dono_whatsapp: txt(c.donoWhatsapp),
    servicos: porNegocio.get(t.id)?.join(" | ") ?? null, criado_em: data(t.get("createdAt")), sincronizado_em: agora,
    dados_json: JSON.stringify({ tenant: t.data(), crm: c }),
  });
}
db.exec("COMMIT");
const total = (db.prepare("SELECT COUNT(*) AS n FROM negocios").get() as { n: number }).n;
console.log(`${total} negócios em ${ARQUIVO}`);
process.exit(0);
