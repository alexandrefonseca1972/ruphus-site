// O funil em números e colunas, a partir dos negócios já filtrados pela consulta do painel.
// Puro, sem Firestore: a tela usa no ?modo=antigo e a rota GET /api/admin/painel?funil=1
// no resto (fase 4 do docs/plano-paginacao-admin.md). Saiu do useMemo de src/app/admin/funil.tsx.
import { campanhaDe, ORIGENS, prazoDe, PRECO_PADRAO, type Crm, type Estagio, type MotivoPerda, type Origem } from "@/lib/crm-tipos";
import type { Espaco } from "@/lib/painel-tipos";

export const COLUNAS = ["novo", "oferta", "negociando", "fechado"] as const satisfies readonly Estagio[];
export type Coluna = (typeof COLUNAS)[number];
// "Novo" tem a planilha inteira (mil e tantos): a coluna mostra poucos, e a fila se trabalha na Lista
export const NOVOS_POR_VEZ = 6;
export const NOVOS_MAX = 600;
export const PERIODOS = { mes: "Este mês", "30": "Últimos 30 dias", "90": "Últimos 90 dias", tudo: "Desde o início" } as const;
export type Periodo = keyof typeof PERIODOS;
export const ehPeriodo = (s: string): s is Periodo => Object.hasOwn(PERIODOS, s);

export const mensal = (c: Crm | undefined) => c?.mensalCents ?? PRECO_PADRAO.mensalCents;
export const origemDe = (c: Crm | undefined): Origem => c?.origem ?? "importado";

/** Meia-noite do dia `dia` (AAAA-MM-DD) no fuso, como ISO em UTC. Sem fuso, o da máquina. */
export function inicioDoDia(dia: string, fuso?: string) {
  const [a, m, d] = dia.split("-").map(Number);
  if (!fuso) return new Date(a, m - 1, d).toISOString();
  const palpite = Date.UTC(a, m - 1, d);
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: fuso, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
      .formatToParts(palpite)
      .map((p) => [p.type, Number(p.value)]),
  );
  const desvio = Date.UTC(partes.year, partes.month - 1, partes.day, partes.hour, partes.minute) - palpite;
  return new Date(palpite - desvio).toISOString();
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
    // quem tem data combinada vem antes; no resto, "Novo" fica na ordem da Lista (mais relevantes,
    // por padrão): em ordem alfabética, a coluna abria com "1000 Patas"
    const todos = [...por[e]].sort(
      (a, b) =>
        (crm[a.slug]?.proximaData ?? "9999").localeCompare(crm[b.slug]?.proximaData ?? "9999") || (e === "novo" ? 0 : colador.compare(a.nome, b.nome)),
    );
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
