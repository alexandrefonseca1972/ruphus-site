import assert from "node:assert/strict";
import { alertas } from "@/lib/alertas";
import { ESTAGIOS, mensalidadeDe, prazoDe, PRECO_PADRAO, type Crm, type Estagio } from "@/lib/crm-tipos";
import { celular, consultar, contarFilas, diaLocal, local, semAcento, visaoDe, VISOES, type ResultadoPainel } from "@/lib/painel-consulta";
import { ORDENS, SEM_FILTROS, type Espaco, type Filtros } from "@/lib/painel-tipos";

// A consulta do painel (src/lib/painel-consulta.ts) substitui o cálculo que vivia no
// /admin. Três partes: regras uma a uma, paridade com o cálculo antigo em bases
// sorteadas, e o teto de tempo que o servidor vai precisar (docs/plano-paginacao-admin.md).

const VAZIO: Crm = {
  estagio: "novo", entradaCents: null, mensalCents: null, caixaCents: null, fechadoEm: null, proximaAcao: null, proximaData: null, publicado: true, notas: 0,
  donoNome: null, donoPapel: null, donoWhatsapp: null, donoEmail: null, outrosContatos: [], motivoPerda: null, detalhePerda: null,
  origem: null, indicadoPor: null, entrouEm: null, perdidoEm: null, ultimoContatoEm: null, fixadoAte: null, utm: null,
  toques: 0, respondeuEm: null, naoContatarEm: null, propostaVistaEm: null,
};
const espaco = (slug: string, e: Partial<Espaco> = {}): Espaco => ({
  slug, nome: slug, telefone: null, nicho: "Barbearia", cidade: "Belém", uf: "PA", nota: null, avaliacoes: null, acessos: 1, limiteStaff: 2, caixa: true, ...e,
});
const HOJE = "2026-11-01";
const f = (x: Partial<Filtros> = {}): Filtros => ({ ...SEM_FILTROS, ...x });
const slugs = (r: ResultadoPainel) => r.lista.map((e) => e.slug);

// ─── regras ────────────────────────────────────────────────────────────────

{
  const base = [
    espaco("ana-barbearia", { nome: "Ana Barbearia", telefone: "5591988887777" }),
    espaco("jose-salao", { nome: "José Salão", nicho: "Cabeleireiro", cidade: "São José", uf: "SC" }),
    espaco("sem-cidade", { nome: "Sem Cidade", cidade: null, uf: null }),
    espaco("cliente", { nome: "Cliente Dentro", acessos: 2, caixa: true }),
  ];
  const crm: Record<string, Crm> = {
    "ana-barbearia": { ...VAZIO, estagio: "negociando", proximaData: "2026-10-30", mensalCents: 9000 },
    "jose-salao": { ...VAZIO, proximaData: HOJE, publicado: false, ultimoContatoEm: "2026-11-01T15:00:00.000Z" },
    cliente: { ...VAZIO, estagio: "fechado", mensalCents: 8990, caixaCents: 1990, fixadoAte: "2026-11-05" },
  };
  const ctx = { crm, hoje: HOJE, fuso: "America/Sao_Paulo" };

  // busca sem acento, por nome, cidade e telefone
  assert.deepEqual(slugs(consultar(base, f({ busca: "jose" }), ctx)), ["jose-salao"]);
  assert.deepEqual(slugs(consultar(base, f({ busca: "  SÃO JOSÉ " }), ctx)), ["jose-salao"]);
  assert.deepEqual(slugs(consultar(base, f({ busca: "98888" }), ctx)), ["ana-barbearia"]);

  // cada filtro sozinho
  assert.deepEqual(slugs(consultar(base, f({ uf: "SC" }), ctx)), ["jose-salao"]);
  assert.deepEqual(slugs(consultar(base, f({ cidade: "São José/SC" }), ctx)), ["jose-salao"]);
  assert.deepEqual(slugs(consultar(base, f({ nicho: "Cabeleireiro" }), ctx)), ["jose-salao"]);
  assert.deepEqual(slugs(consultar(base, f({ situacao: "ativo" }), ctx)), ["cliente"]);
  assert.equal(consultar(base, f({ situacao: "pendente" }), ctx).lista.length, 3);
  assert.deepEqual(slugs(consultar(base, f({ estagio: "negociando" }), ctx)), ["ana-barbearia"]);
  assert.equal(consultar(base, f({ estagio: "novo" }), ctx).lista.length, 2, "sem CRM conta como novo");
  assert.deepEqual(slugs(consultar(base, f({ prazo: "atrasada" }), ctx)), ["ana-barbearia"]);
  assert.deepEqual(slugs(consultar(base, f({ prazo: "hoje" }), ctx)), ["jose-salao"]);
  assert.deepEqual(slugs(consultar(base, f({ fora: true }), ctx)), ["jose-salao"]);
  assert.deepEqual(slugs(consultar(base, f({ caixa: true }), ctx)), ["cliente", "ana-barbearia", "jose-salao", "sem-cidade"]);
  assert.deepEqual(slugs(consultar(base, f({ contato: true }), ctx)), ["jose-salao"]);
  assert.deepEqual(slugs(consultar(base, f({ fixados: true }), ctx)), ["cliente"]);

  // o chip ignora a própria dimensão: com SC escolhido, o chip de PA ainda diz quantos há em PA
  const comSc = consultar(base, f({ uf: "SC" }), ctx);
  assert.deepEqual(comSc.ufs, [["PA", 2], ["SC", 1]], "quem não tem UF não vira chip");
  assert.deepEqual(comSc.cidades, [["São José/SC", 1]], "o chip de cidade respeita o filtro de UF");
  // e respeita os outros: com a busca ligada, o chip só conta quem passa na busca
  assert.deepEqual(consultar(base, f({ busca: "ana" }), ctx).nichos, [["Barbearia", 1]]);
  // "Tirar cidade" conta também quem não tem cidade
  assert.equal(consultar(base, f({ cidade: "Belém/PA" }), ctx).tirando.cidade, 4);

  const todos = consultar(base, f(), ctx);
  assert.deepEqual(todos.prazos, { atrasada: 1, hoje: 1, futura: 0 });
  assert.deepEqual(todos.estagios, { novo: 2, oferta: 0, negociando: 1, fechado: 1, perdido: 0 });
  assert.equal(todos.caixa, 4, "Caixa incluído em todos os negócios");
  assert.deepEqual(todos.visoes, { atrasados: 1, hoje: 1, falei: 1, fixados: 1, todos: 4, pendentes: 3, negociando: 1, foradoar: 1 });
  // o valor legado do Caixa não soma mais na mensalidade
  assert.deepEqual(todos.totais, { contratadoCents: 8990, negociacaoCents: 9000 });
  // a visão "Atrasados" ignora o filtro de prazo ligado, mas respeita a busca
  assert.equal(consultar(base, f({ prazo: "hoje", busca: "ana" }), ctx).visoes.atrasados, 1);
  assert.equal(consultar(base, f({ busca: "jose" }), ctx).visoes.atrasados, 0);

  // destacado no topo de qualquer ordem
  for (const ordem of ORDENS) assert.equal(consultar(base, f({ ordem }), ctx).lista[0].slug, "cliente", ordem);
  assert.deepEqual(slugs(consultar(base, f({ ordem: "nome" }), ctx)), ["cliente", "ana-barbearia", "jose-salao", "sem-cidade"]);
  assert.deepEqual(slugs(consultar(base, f({ ordem: "compromisso" }), ctx)).slice(1), ["ana-barbearia", "jose-salao", "sem-cidade"]);

  // alerta em foco filtra pelos slugs do alerta (negociando sem contato nenhum = parado)
  assert.deepEqual(slugs(consultar(base, f({ alerta: "parado" }), ctx)), ["ana-barbearia"]);
  // alerta que não está acontecendo não filtra nada, como antes
  assert.equal(consultar(base, f({ alerta: "sem_proxima" }), ctx).lista.length, 4);
  console.log("regras: ok");
}

// "falei hoje" é o dia de quem olha: 23h30 de 31/10 em Manaus já é 01/11 em São Paulo
{
  const iso = "2026-11-01T03:30:00.000Z";
  assert.equal(diaLocal(iso, "America/Sao_Paulo"), "2026-11-01");
  assert.equal(diaLocal(iso, "America/Manaus"), "2026-10-31");
  const base = [espaco("a")];
  const crm = { a: { ...VAZIO, ultimoContatoEm: iso } };
  assert.equal(consultar(base, f({ contato: true }), { crm, hoje: "2026-11-01", fuso: "America/Sao_Paulo" }).lista.length, 1);
  assert.equal(consultar(base, f({ contato: true }), { crm, hoje: "2026-11-01", fuso: "America/Manaus" }).lista.length, 0);
  // o formatador reaproveitado dá o mesmo dia que o toLocaleDateString do cálculo antigo
  for (let h = 0; h < 72; h++) {
    const instante = new Date(Date.UTC(2026, 9, 30, h, 17)).toISOString();
    for (const fuso of ["America/Sao_Paulo", "America/Manaus", "America/Noronha", "America/Rio_Branco"]) {
      assert.equal(diaLocal(instante, fuso), new Date(instante).toLocaleDateString("sv-SE", { timeZone: fuso }), `${instante} ${fuso}`);
    }
    assert.equal(diaLocal(instante), new Date(instante).toLocaleDateString("sv-SE"), "sem fuso, o da máquina");
  }
  assert.equal(diaLocal("não é data"), "", "texto inválido vira vazio em vez de 'Invalid Date'");
  assert.equal(diaLocal(null), "");
  // virada do dia: compromisso de ontem é atrasado, de hoje é hoje
  assert.equal(prazoDe({ proximaData: "2026-10-31" }, HOJE), "atrasada");
  console.log("fuso e virada do dia: ok");
}

// as três filas do topo: retornos (atrasados + hoje), primeiro contato, responderam
{
  const base = [
    espaco("atrasado", { telefone: "5591988887777" }),
    espaco("hoje", { telefone: "91988887777" }),
    espaco("virgem", { telefone: "(91) 98888-7777", nota: 4.9, avaliacoes: 300 }),
    espaco("virgem-fraco", { telefone: "5591988887777", nota: 4, avaliacoes: 3 }),
    espaco("fixo", { telefone: "559132221111" }),
    espaco("dono-celular", { telefone: "559132221111" }),
    espaco("sem-telefone"),
    espaco("parou", { telefone: "5591988887777" }),
    espaco("tocado", { telefone: "5591988887777" }),
    espaco("respondeu", { telefone: "5591988887777" }),
    espaco("negociando", { telefone: "5591988887777" }),
    espaco("fechou-respondido", { telefone: "5591988887777" }),
    espaco("outra-cidade", { telefone: "5548988887777", cidade: "São José", uf: "SC" }),
    // abordado antes de existir `toques` (05/11): só o último contato gravado
    espaco("antigo", { telefone: "5591988887777", nota: 5, avaliacoes: 900 }),
  ];
  const crm: Record<string, Crm> = {
    atrasado: { ...VAZIO, proximaData: "2026-10-30", toques: 1, ultimoContatoEm: "2026-10-27T12:00:00.000Z" },
    hoje: { ...VAZIO, proximaData: HOJE, toques: 1, ultimoContatoEm: "2026-11-01T13:00:00.000Z" },
    "dono-celular": { ...VAZIO, donoWhatsapp: "5591977776666" },
    parou: { ...VAZIO, naoContatarEm: "2026-10-20T12:00:00.000Z" },
    tocado: { ...VAZIO, toques: 1, proximaData: "2026-11-04" },
    respondeu: { ...VAZIO, respondeuEm: "2026-10-31T12:00:00.000Z", toques: 1 },
    negociando: { ...VAZIO, estagio: "negociando" },
    "fechou-respondido": { ...VAZIO, estagio: "fechado", respondeuEm: "2026-10-01T12:00:00.000Z" },
    antigo: { ...VAZIO, ultimoContatoEm: "2026-10-20T12:00:00.000Z" },
  };
  const ctx = { crm, hoje: HOJE, fuso: "America/Sao_Paulo" };

  assert.deepEqual(slugs(consultar(base, f({ fila: "retornos", ordem: "compromisso" }), ctx)), ["atrasado", "hoje"]);
  // relevância como em "Todos": nota com muitas avaliações primeiro; fixo e sem telefone ficam de fora
  assert.deepEqual(slugs(consultar(base, f({ fila: "primeiro" }), ctx)), ["virgem", "virgem-fraco", "dono-celular", "outra-cidade"]);
  assert.deepEqual(slugs(consultar(base, f({ fila: "responderam", ordem: "nome" }), ctx)), ["negociando", "respondeu"]);
  // a fila se soma aos outros filtros
  assert.deepEqual(slugs(consultar(base, f({ fila: "primeiro", uf: "SC" }), ctx)), ["outra-cidade"]);

  // a contagem das filas respeita lugar e busca, e ignora visão, alerta e a própria fila
  assert.ok(!slugs(consultar(base, f({ fila: "primeiro" }), ctx)).includes("antigo"), "contatado antes de `toques` não volta ao primeiro contato");
  assert.deepEqual(contarFilas(base, f(), ctx), { filas: { retornos: 2, primeiro: 4, responderam: 2 }, faleiHoje: 1 });
  assert.deepEqual(contarFilas(base, f({ fila: "retornos", prazo: "hoje", estagio: "fechado", contato: true }), ctx), { filas: { retornos: 2, primeiro: 4, responderam: 2 }, faleiHoje: 1 });
  // o contador do dia ignora todos os filtros: com cidade ou busca ligada, não muda
  assert.deepEqual(contarFilas(base, f({ uf: "SC" }), ctx), { filas: { retornos: 0, primeiro: 1, responderam: 0 }, faleiHoje: 1 });
  assert.equal(contarFilas(base, f({ cidade: "São José/SC" }), ctx).faleiHoje, 1);
  assert.equal(contarFilas(base, f({ busca: "zzz", caixa: true, fixados: true }), ctx).faleiHoje, 1);
  // "Falei hoje" (o contador do dia) não depende da fila escolhida
  assert.equal(consultar(base, f({ fila: "primeiro" }), ctx).visoes.falei, 1);
  assert.equal(consultar(base, f(), ctx).visoes.falei, 1);

  assert.ok(celular("5591988887777") && celular("91988887777") && celular("(91) 98888-7777"));
  assert.ok(!celular("559132221111") && !celular(null) && !celular("") && !celular("0091988887777"));
  console.log("filas: ok");
}

// visões são presets dos filtros
assert.equal(visaoDe({ ...SEM_FILTROS, prazo: "atrasada" })?.id, "atrasados");
assert.equal(visaoDe({ ...SEM_FILTROS, contato: true })?.id, "falei");
assert.equal(visaoDe({ ...SEM_FILTROS })?.id, "todos");
assert.equal(visaoDe({ ...SEM_FILTROS, prazo: "hoje", fora: true }), undefined, "combinação própria não é visão");
assert.equal(new Set(VISOES.map((v) => v.id)).size, VISOES.length);
console.log("visões: ok");

// ─── paridade com o cálculo antigo do /admin ────────────────────────────────

/** O cálculo como estava em src/app/admin/page.tsx antes da extração (main, 01/11/2026), com
 *  as próprias cópias dos auxiliares: mudar um deles no módulo novo não muda a referência.
 *  Única diferença: o fuso, que a tela antiga tirava da máquina e o servidor vai receber. */
function antigo(espacos: Espaco[], x: Filtros, crm: Record<string, Crm>, dataDeHoje: string, fuso: string | undefined): Omit<ResultadoPainel, "avisos"> {
  const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const relevancia = (e: Espaco) => (e.nota ?? 0) * Math.log10((e.avaliacoes ?? 0) + 1);
  const local = (e: Espaco) => (e.cidade ? `${e.cidade}${e.uf ? `/${e.uf}` : ""}` : "");
  const emDestaque = (c: Crm | undefined, hoje: string) => !!c?.fixadoAte && c.fixadoAte >= hoje;
  const avisos = alertas(espacos, crm, dataDeHoje);
  const a = avisos.find((y) => y.id === x.alerta);
  const emFoco = a ? new Set(a.slugs) : null;
  const termo = semAcento(x.busca.trim());
  const diaDe = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("sv-SE", fuso ? { timeZone: fuso } : undefined) : "");
  const testes: Record<string, (e: Espaco) => boolean> = {
    busca: (e) => !termo || semAcento(`${e.nome} ${e.slug} ${e.cidade ?? ""} ${e.telefone ?? ""}`).includes(termo),
    uf: (e) => !x.uf || e.uf === x.uf,
    cidade: (e) => !x.cidade || local(e) === x.cidade,
    nicho: (e) => !x.nicho || e.nicho === x.nicho,
    situacao: (e) => !x.situacao || (x.situacao === "ativo" ? e.acessos > 1 : e.acessos <= 1),
    estagio: (e) => !x.estagio || (crm[e.slug]?.estagio ?? "novo") === x.estagio,
    prazo: (e) => !x.prazo || prazoDe(crm[e.slug], dataDeHoje) === x.prazo,
    fora: (e) => !x.fora || crm[e.slug]?.publicado === false,
    caixa: (e) => !x.caixa || e.caixa,
    contato: (e) => !x.contato || diaDe(crm[e.slug]?.ultimoContatoEm ?? null) === dataDeHoje,
    fixados: (e) => !x.fixados || emDestaque(crm[e.slug], dataDeHoje),
    alerta: (e) => !emFoco || emFoco.has(e.slug),
  };
  const passa = (e: Espaco, ...exceto: string[]) => Object.entries(testes).every(([nome, teste]) => exceto.includes(nome) || teste(e));
  const contar = (es: Espaco[], campo: (e: Espaco) => string) => {
    const m = new Map<string, number>();
    for (const e of es) {
      const v = campo(e);
      if (v) m.set(v, (m.get(v) ?? 0) + 1);
    }
    return [...m.entries()].sort((p, q) => q[1] - p[1]);
  };
  const por: Record<string, (p: Espaco, q: Espaco) => number> = {
    relevancia: (p, q) => relevancia(q) - relevancia(p) || p.nome.localeCompare(q.nome, "pt-BR"),
    nota: (p, q) => (q.nota ?? 0) - (p.nota ?? 0) || (q.avaliacoes ?? 0) - (p.avaliacoes ?? 0),
    avaliacoes: (p, q) => (q.avaliacoes ?? 0) - (p.avaliacoes ?? 0),
    nome: (p, q) => p.nome.localeCompare(q.nome, "pt-BR"),
    compromisso: (p, q) => (crm[p.slug]?.proximaData ?? "9999").localeCompare(crm[q.slug]?.proximaData ?? "9999") || p.nome.localeCompare(q.nome, "pt-BR"),
    contato: (p, q) => (crm[q.slug]?.ultimoContatoEm ?? "").localeCompare(crm[p.slug]?.ultimoContatoEm ?? "") || p.nome.localeCompare(q.nome, "pt-BR"),
  };
  const destaque = (e: Espaco) => (emDestaque(crm[e.slug], dataDeHoje) ? 0 : 1);
  const prazos = { atrasada: 0, hoje: 0, futura: 0 };
  for (const e of espacos.filter((y) => passa(y, "prazo"))) {
    const p = prazoDe(crm[e.slug], dataDeHoje);
    if (p) prazos[p] += 1;
  }
  const noFunil = espacos.filter((e) => passa(e, "estagio"));
  const visoes = Object.fromEntries(VISOES.map((v) => [v.id, espacos.filter(
    (e) =>
      passa(e, "prazo", "situacao", "estagio", "fora") &&
      (!v.prazo || prazoDe(crm[e.slug], dataDeHoje) === v.prazo) &&
      (!v.situacao || (v.situacao === "ativo" ? e.acessos > 1 : e.acessos <= 1)) &&
      (!v.estagio || (crm[e.slug]?.estagio ?? "novo") === v.estagio) &&
      (!v.fora || crm[e.slug]?.publicado === false) &&
      (!v.contato || diaDe(crm[e.slug]?.ultimoContatoEm ?? null) === dataDeHoje) &&
      (!v.fixados || emDestaque(crm[e.slug], dataDeHoje)),
  ).length])) as ResultadoPainel["visoes"];
  return {
    lista: [...espacos.filter((e) => passa(e))].sort((p, q) => destaque(p) - destaque(q) || por[x.ordem](p, q)),
    ufs: contar(espacos.filter((e) => passa(e, "uf")), (e) => e.uf ?? ""),
    cidades: contar(espacos.filter((e) => passa(e, "cidade")), local),
    nichos: contar(espacos.filter((e) => passa(e, "nicho")), (e) => e.nicho),
    estagios: Object.fromEntries(ESTAGIOS.map((s) => [s, noFunil.filter((y) => (crm[y.slug]?.estagio ?? "novo") === s).length])) as Record<Estagio, number>,
    prazos,
    caixa: espacos.filter((e) => e.caixa && passa(e, "caixa")).length,
    tirando: { cidade: espacos.filter((y) => passa(y, "cidade")).length, nicho: espacos.filter((y) => passa(y, "nicho")).length },
    visoes,
    totais: {
      contratadoCents: espacos.reduce((t, e) => t + (crm[e.slug]?.estagio === "fechado" ? mensalidadeDe(crm[e.slug]) : 0), 0),
      negociacaoCents: espacos.reduce((t, e) => t + (["oferta", "negociando"].includes(crm[e.slug]?.estagio ?? "novo") ? crm[e.slug]?.mensalCents ?? PRECO_PADRAO.mensalCents : 0), 0),
    },
  };
}

/** Sorteio com semente fixa (mulberry32): a mesma base a cada execução. */
function sorteio(semente: number) {
  let a = semente;
  const r = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const um = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  return { r, um, talvez: <T,>(p: number, v: () => T): T | null => (r() < p ? v() : null) };
}
const NOMES = ["Ana", "Ána", "José", "Jose", "Salão", "Barbearia", "Studio", "Ébano", "Zé", "Bella", "Bela", "Ômega", "nail", "Nail", "Espaço"];
// "pa" e "Pará": a UF do cadastro é texto livre, e o chip tem de filtrar o que estiver gravado
const CIDADES = [["Belém", "PA"], ["São José", "SC"], ["Brasília", "DF"], ["Macapá", "AP"], ["Belo Horizonte", "MG"], ["Sem UF", null], [null, null], ["Ananindeua", "pa"], ["Marabá", "Pará"]] as const;
const NICHOS = ["Barbearia", "Cabeleireiro", "Unhas", "Estética e beleza", "Pet shop", "Outros"];
const DIAS = ["2026-10-29", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-04"];

function base(semente: number, n: number) {
  const { r, um, talvez } = sorteio(semente);
  const espacos: Espaco[] = [];
  const crm: Record<string, Crm> = {};
  for (let i = 0; i < n; i++) {
    const [cidade, uf] = um(CIDADES);
    const slug = `n${i}`;
    espacos.push({
      slug, nome: `${um(NOMES)} ${um(NOMES)} ${Math.floor(r() * 50)}`, telefone: talvez(0.8, () => `55${Math.floor(r() * 1e11)}`), nicho: um(NICHOS),
      cidade, uf, nota: talvez(0.7, () => Math.round(r() * 50) / 10), avaliacoes: talvez(0.7, () => Math.floor(r() * 500)),
      // NaN de vez em quando: nem "ativo" nem "pendente", como no cálculo antigo
      acessos: r() < 0.03 ? Number.NaN : Math.floor(r() * 3), limiteStaff: 2, caixa: r() < 0.1,
    });
    if (r() < 0.4) crm[slug] = {
      // estágio fora da lista (dado antigo) de vez em quando
      ...VAZIO, estagio: r() < 0.03 ? ("ganho" as Estagio) : um(ESTAGIOS), publicado: r() > 0.1, proximaData: talvez(0.5, () => um(DIAS)), fixadoAte: talvez(0.1, () => um(DIAS)),
      ultimoContatoEm: talvez(0.4, () => new Date(Date.UTC(2026, 9, 30) + Math.floor(r() * 4 * 86_400_000)).toISOString()),
      mensalCents: talvez(0.5, () => Math.floor(r() * 20000)), caixaCents: talvez(0.3, () => Math.floor(r() * 3000)),
      entradaCents: talvez(0.3, () => Math.floor(r() * 50000)), fechadoEm: talvez(0.3, () => new Date(Date.UTC(2026, 9, 1) + Math.floor(r() * 30 * 86_400_000)).toISOString()),
    };
  }
  return { espacos, crm, um, r };
}

for (let semente = 1; semente <= 500; semente++) {
  const { espacos, crm, um, r } = base(semente, 60 + (semente % 7) * 30);
  const amostra = um(espacos);
  const filtros: Filtros = {
    busca: r() < 0.3 ? um([semAcento(amostra.nome.split(" ")[0]), amostra.nome.slice(0, 3).toUpperCase(), "  bel ", "zzz"]) : "",
    uf: r() < 0.3 ? um(["PA", "SC", "DF", "AP", "MG", "pa", "Pará"]) : "",
    cidade: r() < 0.2 ? local(amostra) : "",
    nicho: r() < 0.2 ? um(NICHOS) : "",
    situacao: r() < 0.2 ? um(["ativo", "pendente"] as const) : "",
    estagio: r() < 0.2 ? um(ESTAGIOS) : "",
    prazo: r() < 0.2 ? um(["atrasada", "hoje", "futura"] as const) : "",
    alerta: r() < 0.15 ? um(["sem_proxima", "parado", "implantacao", "destaque"] as const) : "",
    fora: r() < 0.1, caixa: r() < 0.1, contato: r() < 0.1, fixados: r() < 0.1,
    ordem: um(ORDENS),
  };
  // sem fuso é como a tela chama hoje (o da máquina)
  const fuso = um(["America/Sao_Paulo", "America/Manaus", "America/Noronha", undefined]);
  const hoje = um(DIAS);
  const { avisos, ...novo } = consultar(espacos, filtros, { crm, hoje, fuso });
  assert.deepEqual(avisos, alertas(espacos, crm, hoje), `avisos, semente ${semente}`);
  assert.deepEqual(novo, antigo(espacos, filtros, crm, hoje, fuso), `semente ${semente}: ${JSON.stringify(filtros)}`);
}
console.log("paridade com o cálculo antigo em 500 bases sorteadas: ok");

// ─── tempo ─────────────────────────────────────────────────────────────────

{
  const { espacos, crm } = base(42, 20_000);
  const ctx = { crm, hoje: "2026-11-01", fuso: "America/Sao_Paulo" };
  const medir = (x: Filtros) => {
    const tempos = Array.from({ length: 7 }, () => {
      const t = performance.now();
      consultar(espacos, x, ctx);
      return performance.now() - t;
    }).sort((p, q) => p - q);
    return tempos[3]; // mediana
  };
  // cache frio: lista nova (como depois de um setEspacos), sem posição por nome nem texto de busca guardados
  const nova = espacos.map((e) => ({ ...e }));
  const t0 = performance.now();
  consultar(nova, f({ busca: "salao", ordem: "nome" }), ctx);
  const frio = performance.now() - t0;
  const pesada = medir(f({ ordem: "nome" }));
  const busca = medir(f({ busca: "salao", ordem: "relevancia" }));
  console.log(`tempo com 20 mil negócios: ${pesada.toFixed(1)} ms (todos, por nome), ${busca.toFixed(1)} ms (busca), ${frio.toFixed(1)} ms (primeira, cache frio)`);
  // A meta no servidor é 50 ms por consulta com cache quente (plano, R4). Os tetos daqui
  // pegam regressão grande (o toLocaleDateString custava 431 ms) com folga para o CI, que
  // roda até 2× mais devagar que a máquina de desenvolvimento.
  assert.ok(pesada < 120, `consulta lenta demais: ${pesada.toFixed(1)} ms`);
  assert.ok(busca < 120, `busca lenta demais: ${busca.toFixed(1)} ms`);
  assert.ok(frio < 400, `primeira consulta lenta demais: ${frio.toFixed(1)} ms`);
}
