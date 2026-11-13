// O funil em números e colunas, a partir dos negócios já filtrados pela consulta do painel.
// Puro, sem Firestore: a rota GET /api/admin/painel?funil=1 o calcula (fase 4 do
// docs/plano-paginacao-admin.md). Saiu do useMemo de src/app/admin/funil.tsx.
import { campanhaDe, mensal, ORIGENS, prazoDe, type Crm, type Estagio, type MotivoPerda, type Origem } from "@/lib/crm-tipos";
import type { Espaco } from "@/lib/painel-tipos";

export const COLUNAS = ["novo", "oferta", "negociando", "fechado"] as const satisfies readonly Estagio[];
export type Coluna = (typeof COLUNAS)[number];
// "Novo" tem a planilha inteira (mil e tantos): a coluna mostra poucos, e a fila se trabalha na Lista
export const NOVOS_POR_VEZ = 6;
export const NOVOS_MAX = 600;
export const PERIODOS = { mes: "Este mês", "30": "Últimos 30 dias", "90": "Últimos 90 dias", tudo: "Desde o início" } as const;
export type Periodo = keyof typeof PERIODOS;
export const ehPeriodo = (s: string): s is Periodo => Object.hasOwn(PERIODOS, s);

export const origemDe = (c: Crm | undefined): Origem => c?.origem ?? "importado";

/** Meia-noite do dia `dia` (AAAA-MM-DD) no fuso, como ISO em UTC. Sem fuso, o da máquina. */
export function inicioDoDia(dia: string, fuso?: string) {
  const [a, m, d] = dia.split("-").map(Number);
  if (!fuso) return new Date(a, m - 1, d).toISOString();
  const palpite = Date.UTC(a, m - 1, d);
  const formato = new Intl.DateTimeFormat("en-US", { timeZone: fuso, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
  const desvioEm = (t: number) => {
    const p = Object.fromEntries(formato.formatToParts(t).map((x) => [x.type, Number(x.value)]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - t;
  };
  // medido de novo na meia-noite local: num fuso que troca de horário entre ela e a meia-noite UTC,
  // o primeiro desvio é o do outro horário
  const primeiro = desvioEm(palpite);
  return new Date(palpite - desvioEm(palpite - primeiro)).toISOString();
}

/** Desde quando o período conta: "" é desde sempre. O mês é o do dia de quem olha. */
export const inicioDe = (p: Periodo, hoje: string, agora: number, fuso?: string) =>
  p === "tudo" ? "" : p === "mes" ? inicioDoDia(`${hoje.slice(0, 8)}01`, fuso) : new Date(agora - Number(p) * 86_400_000).toISOString();

export type ResumoDoFunil = {
  colunas: Record<Coluna, { total: number; somaCents: number; cartoes: Espaco[] }>;
  perdidos: number;
  receita: number;
  fechadosTotal: number;
  negociacao: number;
  emNegociacao: number;
  vendas: number;
  perdas: number;
  dias: number | null;
  atrasadas: number;
  motivos: [MotivoPerda, number][];
  origens: { o: Origem; contatos: number; fechados: number }[];
  campanhas: [string, { cadastros: number; fechados: number }][];
  /** quantos chegaram a cada coluna (estão nela ou adiante), na ordem de COLUNAS */
  chegaram: number[];
};

const colador = new Intl.Collator("pt-BR");

/** Quem tem data combinada vem antes; no resto, "Novo" fica na ordem da Lista (mais relevantes,
 *  por padrão): em ordem alfabética, a coluna abria com "1000 Patas". */
const ordemDaColuna = (e: Coluna, crm: Record<string, Crm>) => (a: Espaco, b: Espaco) =>
  (crm[a.slug]?.proximaData ?? "9999").localeCompare(crm[b.slug]?.proximaData ?? "9999") || (e === "novo" ? 0 : colador.compare(a.nome, b.nome));

/** `espacos` na ordem da lista (a coluna "Novo" a mantém); as outras vêm por data combinada e nome. */
export function resumoDoFunil(
  espacos: readonly Espaco[],
  crm: Record<string, Crm>,
  { periodo, hoje, agora, fuso, novos }: { periodo: Periodo; hoje: string; agora: number; fuso?: string; novos: number },
): ResumoDoFunil {
  const inicio = inicioDe(periodo, hoje, agora, fuso);
  const no = (iso: string | null) => !!iso && (!inicio || iso >= inicio);
  const estagioDe = (x: Espaco) => crm[x.slug]?.estagio ?? "novo";
  const por: Record<Estagio, Espaco[]> = { novo: [], oferta: [], negociando: [], fechado: [], perdido: [] };
  // estágio fora da lista (dado antigo) não entra em coluna nenhuma, como antes
  for (const x of espacos) por[estagioDe(x)]?.push(x);
  const fechados = por.fechado;
  const perdidos = por.perdido;
  // "desde o início" conta todo fechado, até os de antes de a data ser gravada
  const vendas = periodo === "tudo" ? fechados : fechados.filter((x) => no(crm[x.slug]?.fechadoEm ?? null));
  const perdas = periodo === "tudo" ? perdidos : perdidos.filter((x) => no(crm[x.slug]?.perdidoEm ?? null));
  const dias = vendas.flatMap((x) => {
    const c = crm[x.slug];
    return c?.entrouEm && c.fechadoEm ? [(Date.parse(c.fechadoEm) - Date.parse(c.entrouEm)) / 86_400_000] : [];
  });
  const motivos = new Map<MotivoPerda, number>();
  for (const x of perdas) {
    const m = crm[x.slug]?.motivoPerda;
    if (m) motivos.set(m, (motivos.get(m) ?? 0) + 1);
  }
  const origens = new Map<Origem, { contatos: number; fechados: number }>((Object.keys(ORIGENS) as Origem[]).map((o) => [o, { contatos: 0, fechados: 0 }]));
  // os anúncios: cada campanha, quantos negócios criou e quantos fecharam
  const porCampanha = new Map<string, { cadastros: number; fechados: number }>();
  let atrasadas = 0;
  for (const x of espacos) {
    const c = crm[x.slug];
    const fechou = c?.estagio === "fechado";
    const o = origens.get(origemDe(c));
    if (o) {
      o.contatos++;
      if (fechou) o.fechados++;
    }
    const nome = campanhaDe(c?.utm);
    if (nome) {
      const k = porCampanha.get(nome) ?? { cadastros: 0, fechados: 0 };
      k.cadastros++;
      if (fechou) k.fechados++;
      porCampanha.set(nome, k);
    }
    if (prazoDe(c, hoje) === "atrasada") atrasadas++;
  }
  const soma = (xs: Espaco[]) => xs.reduce((s, x) => s + mensal(crm[x.slug]), 0);
  const coluna = (e: Coluna) => {
    const todos = [...por[e]].sort(ordemDaColuna(e, crm));
    return { total: todos.length, somaCents: soma(todos), cartoes: e === "novo" ? todos.slice(0, novos) : todos };
  };
  const contagem = COLUNAS.map((e) => por[e].length);
  return {
    colunas: { novo: coluna("novo"), oferta: coluna("oferta"), negociando: coluna("negociando"), fechado: coluna("fechado") },
    perdidos: perdidos.length,
    receita: soma(fechados),
    fechadosTotal: fechados.length,
    negociacao: soma(por.oferta) + soma(por.negociando),
    emNegociacao: por.oferta.length + por.negociando.length,
    vendas: vendas.length,
    perdas: perdas.length,
    dias: dias.length ? Math.round(dias.reduce((a, b) => a + b, 0) / dias.length) : null,
    atrasadas,
    motivos: [...motivos].sort((a, b) => b[1] - a[1]),
    origens: [...origens].map(([o, v]) => ({ o, ...v })),
    campanhas: [...porCampanha].sort((a, b) => b[1].cadastros - a[1].cadastros),
    // perdido (fora de COLUNAS) não chega a nenhuma coluna, como antes
    chegaram: COLUNAS.map((_, i) => contagem.slice(i).reduce((a, b) => a + b, 0)),
  };
}

/** O resumo do servidor com os negócios que mudaram de estágio nesta tela levados, na hora, para a
 *  coluna do estágio local (o arrastar não pode esperar a ida e volta). Os números do período
 *  esperam a próxima resposta. `local` troca cada cartão pela cópia local, como na Lista. */
export function ajustarFunil(
  r: ResumoDoFunil,
  crm: Record<string, Crm>,
  { alterados, local: copia, novos }: { alterados: ReadonlySet<string>; local: (slug: string) => Espaco | undefined; novos: number },
): ResumoDoFunil {
  const colunas = { ...r.colunas };
  let perdidos = r.perdidos;
  const movidos: [Espaco, Estagio][] = [];
  for (const e of COLUNAS) {
    const c = { ...colunas[e], cartoes: [] as Espaco[] };
    for (const x of r.colunas[e].cartoes) {
      const local = crm[x.slug]?.estagio ?? "novo";
      if (alterados.has(x.slug) && local !== e) {
        c.total--;
        c.somaCents -= mensal(crm[x.slug]);
        movidos.push([copia(x.slug) ?? x, local]);
      } else c.cartoes.push(copia(x.slug) ?? x);
    }
    colunas[e] = c;
  }
  for (const [x, e] of movidos) {
    if (e === "perdido") {
      perdidos++;
      continue;
    }
    if (!Object.hasOwn(colunas, e)) continue;
    const c = colunas[e as Coluna];
    c.total++;
    c.somaCents += mensal(crm[x.slug]);
    c.cartoes = e === "novo" ? [x, ...c.cartoes].slice(0, novos) : [...c.cartoes, x].sort(ordemDaColuna(e as Coluna, crm));
  }
  return { ...r, colunas, perdidos };
}

/** A linha de números do funil: dos últimos 7 dias, quantos receberam mensagem, quantos
 *  responderam e quantos fecharam. O último contato basta: quem foi contatado na semana tem o
 *  último contato nela. */
export type NumerosDaSemana = { contatados: number; responderam: number; fecharam: number };
export function numerosDaSemana(espacos: readonly Espaco[], crm: Record<string, Crm>, agora: number): NumerosDaSemana {
  const desde = new Date(agora - 7 * 86_400_000).toISOString();
  const na = (iso: string | null | undefined) => !!iso && iso >= desde;
  const n: NumerosDaSemana = { contatados: 0, responderam: 0, fecharam: 0 };
  for (const x of espacos) {
    const c = crm[x.slug];
    if (na(c?.ultimoContatoEm)) n.contatados++;
    if (na(c?.respondeuEm)) n.responderam++;
    if (c?.estagio === "fechado" && na(c.fechadoEm)) n.fecharam++;
  }
  return n;
}

/** Uma linha da tabela por variante (F1): contagens; a tela tira as porcentagens sobre `confirmados`. */
export type LinhaVariante = { varianteId: string; confirmados: number; humanas: number; optouts: number; visitas: number; avancaram: number };
/** Os negócios com primeiro contato confirmado, agrupados pela variante: quantos responderam (gente,
 *  não saudação automática), pediram PARE, abriram o site e passaram de "novo" (oferta adiante). */
export function porVariante(espacos: readonly Espaco[], crm: Record<string, Crm>): LinhaVariante[] {
  const m = new Map<string, LinhaVariante>();
  for (const x of espacos) {
    const c = crm[x.slug];
    if (!c?.varianteId) continue;
    let l = m.get(c.varianteId);
    if (!l) m.set(c.varianteId, (l = { varianteId: c.varianteId, confirmados: 0, humanas: 0, optouts: 0, visitas: 0, avancaram: 0 }));
    l.confirmados++;
    if (c.respondeuEm) l.humanas++;
    if (c.naoContatarEm) l.optouts++;
    if (c.siteVistoEm) l.visitas++;
    if (c.estagio === "oferta" || c.estagio === "negociando" || c.estagio === "fechado") l.avancaram++;
  }
  return [...m.values()].sort((a, b) => a.varianteId.localeCompare(b.varianteId));
}
