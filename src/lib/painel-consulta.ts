// A consulta do painel do admin: filtro, contagens, visões e ordem sobre a lista de
// negócios. Código puro: hoje roda na tela; na fase 2 roda no servidor, sobre o índice
// em memória (docs/plano-paginacao-admin.md, seção 3.2).
//
// Uma passada só: cada negócio ganha uma máscara com os filtros que ele reprova. Ele
// entra na lista se não reprova nenhum, e na contagem de um chip se reprova no máximo
// o filtro do próprio chip — o número ao lado de "Barbearia" diz quantas barbearias
// sobram com os OUTROS filtros ligados. Somar tudo fazia um chip prometer 115 e
// entregar lista vazia.
import { alertas, type Alerta } from "@/lib/alertas";
import { ETAPAS, mensalidadeDe, prazoDe, type Crm, type Estagio, type Prazo } from "@/lib/crm-tipos";
import type { Espaco, Filtros, Ordem, Situacao } from "@/lib/painel-tipos";

export const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** relevância: a nota pesa, mas um 5,0 de três pessoas não passa na frente de um 4,7 de quinhentas */
export const relevancia = (e: Espaco) => (e.nota ?? 0) * Math.log10((e.avaliacoes ?? 0) + 1);
/** O rótulo do chip de cidade: "Cidade/UF", ou só a cidade quando não há UF. */
export const local = (e: Espaco) => (e.cidade ? `${e.cidade}${e.uf ? `/${e.uf}` : ""}` : "");
export const emDestaque = (c: Crm | undefined, hoje: string) => !!c?.fixadoAte && c.fixadoAte >= hoje;
// toLocaleDateString monta um formatador a cada chamada (~100 µs): com milhares de
// negócios, era a maior parte do tempo da consulta. Um formatador por fuso, reaproveitado.
const formatadores = new Map<string, Intl.DateTimeFormat>();
const formatadorDe = (fuso = "") => {
  let f = formatadores.get(fuso);
  if (!f) formatadores.set(fuso, (f = new Intl.DateTimeFormat("sv-SE", { timeZone: fuso || undefined, year: "numeric", month: "2-digit", day: "2-digit" })));
  return f;
};
/** "AAAA-MM-DD" do instante no fuso de quem olha ("sv-SE" formata assim); sem fuso, o da máquina. */
export const diaLocal = (iso: string | null, fuso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : formatadorDe(fuso).format(d);
};

// As visões são combinações de filtro que se repetem todo dia. Viram aba para
// ninguém ter de remontá-las de manhã — e cada uma é só um preset dos mesmos
// filtros, não um caminho paralelo.
export type Visao = {
  id: string; rotulo: string; urgente?: boolean; separa?: boolean;
  prazo: "" | Prazo; situacao: "" | Situacao; estagio: "" | Estagio; fora: boolean; contato?: boolean; fixados?: boolean;
};
const LISTA_DE_VISOES = [
  { id: "atrasados", rotulo: "Atrasados", urgente: true, prazo: "atrasada", situacao: "", estagio: "", fora: false },
  { id: "hoje", rotulo: "Para hoje", prazo: "hoje", situacao: "", estagio: "", fora: false },
  { id: "falei", rotulo: "Falei hoje", prazo: "", situacao: "", estagio: "", fora: false, contato: true },
  { id: "fixados", rotulo: "Em destaque", prazo: "", situacao: "", estagio: "", fora: false, fixados: true },
  { id: "todos", rotulo: "Todos", separa: true, prazo: "", situacao: "", estagio: "", fora: false },
  { id: "pendentes", rotulo: "Sem cliente dentro", prazo: "", situacao: "pendente", estagio: "", fora: false },
  { id: "negociando", rotulo: "Em negociação", prazo: "", situacao: "", estagio: "negociando", fora: false },
  { id: "foradoar", rotulo: "Fora do ar", prazo: "", situacao: "", estagio: "", fora: true },
] as const satisfies readonly Visao[];
export type VisaoId = (typeof LISTA_DE_VISOES)[number]["id"];
export const VISOES: readonly (Visao & { id: VisaoId })[] = LISTA_DE_VISOES;

/** A visão que os filtros ligados formam, se formam alguma. */
export const visaoDe = (f: Pick<Filtros, "prazo" | "situacao" | "estagio" | "fora" | "contato" | "fixados">): Visao | undefined =>
  VISOES.find(
    (v) =>
      v.prazo === f.prazo && v.situacao === f.situacao && v.estagio === f.estagio && v.fora === f.fora &&
      (v.contato ?? false) === f.contato && (v.fixados ?? false) === f.fixados,
  );

// um bit por filtro
const B = {
  busca: 1 << 0, uf: 1 << 1, cidade: 1 << 2, nicho: 1 << 3, situacao: 1 << 4, estagio: 1 << 5,
  prazo: 1 << 6, fora: 1 << 7, caixa: 1 << 8, contato: 1 << 9, fixados: 1 << 10, alerta: 1 << 11,
} as const;
/** passa em todos os filtros, exceto (talvez) os dos bits em `livres` */
const passaSalvo = (mascara: number, livres: number) => (mascara & ~livres) === 0;
// as duas comparações escritas, como antes: com acessos fora do padrão (NaN), nenhuma das duas passa
const naSituacao = (e: Espaco, s: Situacao) => (s === "ativo" ? e.acessos > 1 : e.acessos <= 1);

// O texto da busca sem acento, uma vez por negócio: normalizar 15 mil textos a cada
// tecla era a maior parte do tempo de uma busca. Pela identidade do objeto: negócio
// alterado chega como objeto novo.
const textosDeBusca = new WeakMap<Espaco, string>();
function textoDeBusca(e: Espaco) {
  let t = textosDeBusca.get(e);
  if (t === undefined) textosDeBusca.set(e, (t = semAcento(`${e.nome} ${e.slug} ${e.cidade ?? ""} ${e.telefone ?? ""}`)));
  return t;
}

const colador = new Intl.Collator("pt-BR");
// Comparar nomes com o Collator a cada passo da ordenação era metade do tempo da consulta.
// A posição alfabética de cada negócio é calculada uma vez por lista (a lista só muda
// quando chega negócio novo) e a ordenação compara números. Nome igual fica na ordem da
// lista, como no desempate antigo (ordenação estável com comparação 0).
const posicoes = new WeakMap<readonly Espaco[], Map<Espaco, number>>();
function posicaoPorNome(espacos: readonly Espaco[]) {
  let m = posicoes.get(espacos);
  if (!m) {
    m = new Map([...espacos].sort((a, b) => colador.compare(a.nome, b.nome)).map((e, i) => [e, i]));
    posicoes.set(espacos, m);
  }
  return m;
}

export type Contexto = {
  crm: Record<string, Crm>;
  /** "AAAA-MM-DD" de quem olha */
  hoje: string;
  /** fuso IANA de quem olha; sem ele, o da máquina que calcula */
  fuso?: string;
};

export type ResultadoPainel = {
  /** filtrada e ordenada, inteira: quem pagina é quem chama */
  lista: Espaco[];
  ufs: [string, number][];
  cidades: [string, number][];
  nichos: [string, number][];
  estagios: Record<Estagio, number>;
  prazos: Record<Prazo, number>;
  caixa: number;
  /** quantos sobram ao tirar o filtro de cidade ou de nicho (inclui quem não tem cidade) */
  tirando: { cidade: number; nicho: number };
  visoes: Record<VisaoId, number>;
  avisos: Alerta[];
  /** o que já entrou (fechados) e o que ainda está em jogo (etapas abertas), de todos os negócios */
  totais: { contratadoCents: number; negociacaoCents: number };
};

/** Contagem por valor, do mais frequente ao menos; empate fica na ordem em que apareceu. */
function contador() {
  const m = new Map<string, number>();
  return {
    somar: (v: string) => v && m.set(v, (m.get(v) ?? 0) + 1),
    lista: () => [...m.entries()].sort((a, b) => b[1] - a[1]),
  };
}

export function consultar(espacos: readonly Espaco[], f: Filtros, { crm, hoje, fuso }: Contexto): ResultadoPainel {
  const avisos = alertas([...espacos], crm, hoje);
  const foco = f.alerta ? avisos.find((a) => a.id === f.alerta) : undefined;
  const emFoco = foco ? new Set(foco.slugs) : null;
  const termo = semAcento(f.busca.trim());
  const falouHoje = (c: Crm | undefined) => diaLocal(c?.ultimoContatoEm ?? null, fuso) === hoje;

  // destacados ficam no topo de qualquer ordenação: separados aqui, ordenados cada grupo
  // e juntados no fim (o mesmo que usar o destaque como primeiro critério, sem recalculá-lo
  // a cada comparação)
  const destacados: Espaco[] = [];
  const demais: Espaco[] = [];
  const ufs = contador(), cidades = contador(), nichos = contador();
  const estagios: Record<Estagio, number> = { novo: 0, oferta: 0, negociando: 0, fechado: 0, perdido: 0 };
  const prazos: Record<Prazo, number> = { atrasada: 0, hoje: 0, futura: 0 };
  const visoes: Record<VisaoId, number> = { atrasados: 0, hoje: 0, falei: 0, fixados: 0, todos: 0, pendentes: 0, negociando: 0, foradoar: 0 };
  let caixa = 0, contratadoCents = 0, negociacaoCents = 0;
  const tirando = { cidade: 0, nicho: 0 };

  for (const e of espacos) {
    const c = crm[e.slug];
    const estagio = c?.estagio ?? "novo";
    const prazo = prazoDe(c, hoje);
    const falou = falouHoje(c);
    const destaque = emDestaque(c, hoje);
    let m = 0;
    if (termo && !textoDeBusca(e).includes(termo)) m |= B.busca;
    if (f.uf && e.uf !== f.uf) m |= B.uf;
    if (f.cidade && local(e) !== f.cidade) m |= B.cidade;
    if (f.nicho && e.nicho !== f.nicho) m |= B.nicho;
    if (f.situacao && !naSituacao(e, f.situacao)) m |= B.situacao;
    if (f.estagio && estagio !== f.estagio) m |= B.estagio;
    if (f.prazo && prazo !== f.prazo) m |= B.prazo;
    if (f.fora && c?.publicado !== false) m |= B.fora;
    if (f.caixa && !e.caixa) m |= B.caixa;
    if (f.contato && !falou) m |= B.contato;
    if (f.fixados && !destaque) m |= B.fixados;
    if (emFoco && !emFoco.has(e.slug)) m |= B.alerta;

    if (m === 0) (destaque ? destacados : demais).push(e);
    if (passaSalvo(m, B.uf)) ufs.somar(e.uf ?? "");
    if (passaSalvo(m, B.cidade)) {
      cidades.somar(local(e));
      tirando.cidade += 1;
    }
    if (passaSalvo(m, B.nicho)) {
      nichos.somar(e.nicho);
      tirando.nicho += 1;
    }
    // estágio fora da lista (dado antigo) não vira chip, como antes
    if (passaSalvo(m, B.estagio) && estagio in estagios) estagios[estagio] += 1;
    if (passaSalvo(m, B.prazo) && prazo) prazos[prazo] += 1;
    if (passaSalvo(m, B.caixa) && e.caixa) caixa += 1;
    // cada visão controla prazo, situação, estágio e fora do ar; o resto vem dos filtros ligados
    if (passaSalvo(m, B.prazo | B.situacao | B.estagio | B.fora)) {
      for (const v of VISOES) {
        if (v.prazo && prazo !== v.prazo) continue;
        if (v.situacao && !naSituacao(e, v.situacao)) continue;
        if (v.estagio && estagio !== v.estagio) continue;
        if (v.fora && c?.publicado !== false) continue;
        if (v.contato && !falou) continue;
        if (v.fixados && !destaque) continue;
        visoes[v.id] += 1;
      }
    }
    if (estagio === "fechado") contratadoCents += mensalidadeDe(c, e.caixa);
    if ((ETAPAS as readonly string[]).includes(estagio)) negociacaoCents += c?.mensalCents ?? 0;
  }

  const posicao = posicaoPorNome(espacos);
  const porNome = (a: Espaco, b: Espaco) => (posicao.get(a) ?? 0) - (posicao.get(b) ?? 0);
  const pontos = new Map<Espaco, number>();
  if (f.ordem === "relevancia") for (const e of [...destacados, ...demais]) pontos.set(e, relevancia(e));
  const comparar: Record<Ordem, (a: Espaco, b: Espaco) => number> = {
    relevancia: (a, b) => (pontos.get(b) ?? 0) - (pontos.get(a) ?? 0) || porNome(a, b),
    nota: (a, b) => (b.nota ?? 0) - (a.nota ?? 0) || (b.avaliacoes ?? 0) - (a.avaliacoes ?? 0),
    avaliacoes: (a, b) => (b.avaliacoes ?? 0) - (a.avaliacoes ?? 0),
    nome: porNome,
    // quem foi prometido primeiro aparece primeiro; sem data combinada, vai para o fim
    compromisso: (a, b) => (crm[a.slug]?.proximaData ?? "9999").localeCompare(crm[b.slug]?.proximaData ?? "9999") || porNome(a, b),
    // a ordem em que se falou: o mais recente primeiro; quem nunca foi contatado fica no fim
    contato: (a, b) => (crm[b.slug]?.ultimoContatoEm ?? "").localeCompare(crm[a.slug]?.ultimoContatoEm ?? "") || porNome(a, b),
  };
  const lista = [...destacados.sort(comparar[f.ordem]), ...demais.sort(comparar[f.ordem])];

  return {
    lista,
    ufs: ufs.lista(),
    cidades: cidades.lista(),
    nichos: nichos.lista(),
    estagios,
    prazos,
    caixa,
    tirando,
    visoes,
    avisos,
    totais: { contratadoCents, negociacaoCents },
  };
}
