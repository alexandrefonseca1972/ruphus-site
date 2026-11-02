import assert from "node:assert/strict";
import { campanhaDe, ESTAGIOS, MOTIVOS_PERDA, ORIGENS, prazoDe, PRECO_PADRAO, type Crm, type Estagio, type MotivoPerda, type Origem } from "@/lib/crm-tipos";
import { ajustarFunil, COLUNAS, inicioDoDia, NOVOS_POR_VEZ, PERIODOS, resumoDoFunil, type Periodo } from "@/lib/funil-consulta";
import type { Espaco } from "@/lib/painel-tipos";

// O funil saiu do useMemo de src/app/admin/funil.tsx (fase 4 do docs/plano-paginacao-admin.md).
// `antigo` é aquele código, copiado como estava; tem de dar igual em 300 bases sorteadas.

const mensal = (c: Crm | undefined) => c?.mensalCents ?? PRECO_PADRAO.mensalCents;
const origemDe = (c: Crm | undefined): Origem => c?.origem ?? "importado";
const inicioAntigo = (p: Periodo, hoje: Date) => {
  if (p === "tudo") return "";
  if (p === "mes") return new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString();
  return new Date(hoje.getTime() - Number(p) * 86_400_000).toISOString();
};
function antigo(espacos: Espaco[], crm: Record<string, Crm>, periodo: Periodo, agora: Date, hoje: string, novos: number) {
  const inicio = inicioAntigo(periodo, agora);
  const no = (iso: string | null) => !!iso && (!inicio || iso >= inicio);
  const de = (e: Estagio) => espacos.filter((x) => (crm[x.slug]?.estagio ?? "novo") === e);
  const fechados = de("fechado");
  const perdidos = de("perdido");
  const vendas = periodo === "tudo" ? fechados : fechados.filter((x) => no(crm[x.slug]?.fechadoEm ?? null));
  const perdas = perdidos.filter((x) => (periodo === "tudo" ? true : no(crm[x.slug]?.perdidoEm ?? null)));
  const dias = vendas.flatMap((x) => {
    const c = crm[x.slug];
    return c?.entrouEm && c.fechadoEm ? [(Date.parse(c.fechadoEm) - Date.parse(c.entrouEm)) / 86_400_000] : [];
  });
  const motivos = new Map<MotivoPerda, number>();
  for (const x of perdas) {
    const m = crm[x.slug]?.motivoPerda;
    if (m) motivos.set(m, (motivos.get(m) ?? 0) + 1);
  }
  const origens = (Object.keys(ORIGENS) as Origem[]).map((o) => {
    const deles = espacos.filter((x) => origemDe(crm[x.slug]) === o);
    const ok = deles.filter((x) => crm[x.slug]?.estagio === "fechado").length;
    return { o, contatos: deles.length, fechados: ok };
  });
  const porCampanha = new Map<string, { cadastros: number; fechados: number }>();
  for (const x of espacos) {
    const nome = campanhaDe(crm[x.slug]?.utm);
    if (!nome) continue;
    const c = porCampanha.get(nome) ?? { cadastros: 0, fechados: 0 };
    c.cadastros++;
    if (crm[x.slug]?.estagio === "fechado") c.fechados++;
    porCampanha.set(nome, c);
  }
  const ordem = (e: Estagio) => COLUNAS.indexOf(e as (typeof COLUNAS)[number]);
  const chegaram = (i: number) => espacos.filter((x) => ordem(crm[x.slug]?.estagio ?? "novo") >= i).length;
  const coluna = (e: (typeof COLUNAS)[number]) => {
    const todos = [...de(e)].sort(
      (a, b) =>
        (crm[a.slug]?.proximaData ?? "9999").localeCompare(crm[b.slug]?.proximaData ?? "9999") ||
        (e === "novo" ? 0 : a.nome.localeCompare(b.nome, "pt-BR")),
    );
    return { total: todos.length, somaCents: todos.reduce((s, x) => s + mensal(crm[x.slug]), 0), cartoes: e === "novo" ? todos.slice(0, novos) : todos };
  };
  return {
    colunas: Object.fromEntries(COLUNAS.map((e) => [e, coluna(e)])),
    perdidos: perdidos.length,
    receita: fechados.reduce((s, x) => s + mensal(crm[x.slug]), 0),
    fechadosTotal: fechados.length,
    negociacao: [...de("oferta"), ...de("negociando")].reduce((s, x) => s + mensal(crm[x.slug]), 0),
    emNegociacao: de("oferta").length + de("negociando").length,
    vendas: vendas.length,
    perdas: perdas.length,
    dias: dias.length ? Math.round(dias.reduce((a, b) => a + b, 0) / dias.length) : null,
    atrasadas: espacos.filter((x) => prazoDe(crm[x.slug], hoje) === "atrasada").length,
    motivos: [...motivos].sort((a, b) => b[1] - a[1]),
    origens,
    campanhas: [...porCampanha].sort((a, b) => b[1].cadastros - a[1].cadastros),
    chegaram: COLUNAS.map((_, i) => chegaram(i)),
  };
}

// fuso: meia-noite local em UTC
assert.equal(inicioDoDia("2026-11-01", "America/Sao_Paulo"), "2026-11-01T03:00:00.000Z");
assert.equal(inicioDoDia("2026-11-01", "America/Manaus"), "2026-11-01T04:00:00.000Z");
assert.equal(inicioDoDia("2026-11-01", "Asia/Tokyo"), "2026-10-31T15:00:00.000Z");
assert.equal(inicioDoDia("2026-03-08", "America/New_York"), "2026-03-08T05:00:00.000Z", "dia da troca de horário começa no horário de inverno");
assert.equal(inicioDoDia("2026-11-01"), new Date(2026, 10, 1).toISOString(), "sem fuso, o da máquina");

function sorteio(semente: number) {
  let a = semente;
  const r = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const um = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const talvez = <T,>(p: number, v: () => T): T | null => (r() < p ? v() : null);
  return { r, um, talvez };
}
const NOMES = ["Ana", "Ána", "José", "Salão", "Studio", "Ébano", "Zé", "Bella", "nail", "Nail"];
const DIAS = ["2026-10-29", "2026-10-31", "2026-11-01", "2026-11-02"];
const iso = (r: () => number) => new Date(Date.UTC(2026, 6, 1) + Math.floor(r() * 125 * 86_400_000)).toISOString();
const agora = new Date(2026, 10, 1, 15);
const hoje = "2026-11-01";
for (let semente = 1; semente <= 300; semente++) {
  const { r, um, talvez } = sorteio(semente);
  const espacos: Espaco[] = [];
  const crm: Record<string, Crm> = {};
  for (let i = 0; i < 40 + (semente % 9) * 20; i++) {
    const slug = `n${i}`;
    espacos.push({ slug, nome: `${um(NOMES)} ${Math.floor(r() * 30)}`, telefone: null, nicho: "Outros", cidade: null, uf: null, nota: null, avaliacoes: null, acessos: 1, limiteStaff: 2, caixa: false });
    if (r() < 0.6)
      crm[slug] = {
        estagio: r() < 0.03 ? ("ganho" as Estagio) : um(ESTAGIOS), entradaCents: null, mensalCents: talvez(0.5, () => Math.floor(r() * 20000)), caixaCents: null,
        fechadoEm: talvez(0.6, () => iso(r)), proximaAcao: null, proximaData: talvez(0.5, () => um(DIAS)), publicado: true, notas: 0,
        donoNome: null, donoPapel: null, donoWhatsapp: null, donoEmail: null, outrosContatos: [],
        motivoPerda: talvez(0.5, () => um(Object.keys(MOTIVOS_PERDA) as MotivoPerda[])), detalhePerda: null,
        origem: talvez(0.7, () => (r() < 0.05 ? ("velha" as Origem) : um(Object.keys(ORIGENS) as Origem[]))), indicadoPor: null,
        entrouEm: talvez(0.6, () => iso(r)), perdidoEm: talvez(0.6, () => iso(r)), ultimoContatoEm: null, fixadoAte: null,
        utm: talvez(0.2, () => ({ source: "meta", medium: "cpc", campaign: um(["verao", "Verão", "beleza"]), content: null, term: null })) as Crm["utm"],
      };
  }
  const periodo = um(Object.keys(PERIODOS) as Periodo[]);
  const novos = um([NOVOS_POR_VEZ, 12, 1000]);
  assert.deepEqual(resumoDoFunil(espacos, crm, { periodo, hoje, agora: agora.getTime(), novos }), antigo(espacos, crm, periodo, agora, hoje, novos), `semente ${semente}, ${periodo}`);
}

// arrastar: o cartão muda de coluna na hora, com o CRM local
{
  const e = (slug: string, nome: string): Espaco => ({ slug, nome, telefone: null, nicho: "Outros", cidade: null, uf: null, nota: null, avaliacoes: null, acessos: 1, limiteStaff: 2, caixa: false });
  const espacos = [e("a", "Ana"), e("b", "Bia"), e("c", "Caio")];
  const doServidor: Record<string, Crm> = { b: { estagio: "oferta", mensalCents: 1000 } as Crm };
  const r = resumoDoFunil(espacos, doServidor, { periodo: "tudo", hoje, agora: agora.getTime(), novos: 6 });
  const local: Record<string, Crm> = { a: { estagio: "oferta", mensalCents: 500 } as Crm, b: { estagio: "perdido", mensalCents: 1000 } as Crm };
  const copiaDeC = { ...espacos[2], nome: "Caio (local)" };
  const ajustado = ajustarFunil(r, local, { alterados: new Set(["a", "b"]), porSlug: new Map([["c", copiaDeC]]), novos: 6 });
  assert.deepEqual(ajustado.colunas.novo.cartoes.map((x) => x.nome), ["Caio (local)"], "a saiu de Novo; c é a cópia local");
  assert.deepEqual(ajustado.colunas.oferta.cartoes.map((x) => x.slug), ["a"], "a entrou em Oferta; b saiu");
  assert.deepEqual([ajustado.colunas.novo.total, ajustado.colunas.oferta.total, ajustado.colunas.oferta.somaCents, ajustado.perdidos], [1, 1, 500, 1]);
  assert.equal(r.colunas.oferta.cartoes[0].slug, "b", "o resumo do servidor não é alterado");
  assert.equal(ajustarFunil(r, local, { alterados: new Set(), porSlug: new Map(), novos: 6 }).colunas.oferta.cartoes[0].slug, "b", "sem alterados, igual ao servidor");
}

// 20 mil negócios: abaixo de 50 ms
{
  const espacos: Espaco[] = Array.from({ length: 20_000 }, (_, i) => ({ slug: `s${i}`, nome: `Negócio ${i}`, telefone: null, nicho: "Outros", cidade: null, uf: null, nota: null, avaliacoes: null, acessos: 1, limiteStaff: 2, caixa: false }));
  const crm: Record<string, Crm> = {};
  resumoDoFunil(espacos, crm, { periodo: "mes", hoje, agora: agora.getTime(), novos: 6 });
  const t = performance.now();
  resumoDoFunil(espacos, crm, { periodo: "mes", hoje, agora: agora.getTime(), novos: 6, fuso: "America/Sao_Paulo" });
  const ms = performance.now() - t;
  assert.ok(ms < 50, `funil com 20 mil: ${ms.toFixed(0)} ms`);
}

console.log("funil-consulta: ok");
