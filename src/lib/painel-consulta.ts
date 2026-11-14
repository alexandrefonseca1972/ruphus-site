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
import { etapaNaTela, mensal, mensalidadeDe, prazoDe, type Crm, type Estagio, type EtapaNaTela, type Prazo } from "@/lib/crm-tipos";
import { FILAS, type Espaco, type Fila, type Filtros, type Ordem, type Situacao } from "@/lib/painel-tipos";
import { paraTelefoneNorm, type TelefoneNorm } from "@/lib/tipos-marca";

export const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** relevância: a nota pesa, mas um 5,0 de três pessoas não passa na frente de um 4,7 de quinhentas */
export const relevancia = (e: Espaco) => (e.nota ?? 0) * Math.log10((e.avaliacoes ?? 0) + 1);
/** O rótulo do chip de cidade: "Cidade/UF", ou só a cidade quando não há UF. */
export const local = (e: Espaco) => (e.cidade ? `${e.cidade}${e.uf ? `/${e.uf}` : ""}` : "");
/** Celular brasileiro (DDD + 9 + 8 dígitos, com ou sem o 55): fixo raramente tem WhatsApp. */
export const celular = (t: string | null | undefined) => /^(?:55)?[1-9]{2}9\d{8}$/.test((t ?? "").replace(/\D/g, ""));
// O telefone normalizado de cada texto, uma vez: normalizar 20 mil a cada consulta pesava.
const normas = new Map<string, TelefoneNorm | null>();
/** O índice do painel foi remontado: os telefones de antes (editados, apagados) não ficam no cache. */
export const limparCacheDeTelefones = () => normas.clear();
/** O celular de contato do negócio (o do dono, senão o do site), normalizado; null se não for
 *  celular válido ou for número inventado. É ele que entra na fila "Primeiro contato". */
export function celularDe(e: Espaco, c: Crm | undefined): TelefoneNorm | null {
  const fone = c?.donoWhatsapp || e.telefone;
  if (!fone || !celular(fone)) return null;
  let n = normas.get(fone);
  if (n === undefined) normas.set(fone, (n = paraTelefoneNorm(fone)));
  return n;
}
/** Celulares que aparecem em mais de um negócio: a mesma pessoa receberia o primeiro contato duas vezes. */
export function celularesRepetidos(espacos: readonly Espaco[], crm: Record<string, Crm>): Set<TelefoneNorm> {
  const vistos = new Set<TelefoneNorm>();
  const repetidos = new Set<TelefoneNorm>();
  for (const e of espacos) {
    const n = celularDe(e, crm[e.slug]);
    if (n) (vistos.has(n) ? repetidos : vistos).add(n);
  }
  return repetidos;
}

/** Se o negócio está na fila: "retornos" (atrasados e para hoje), "primeiro" (nunca abordado,
 *  sem pedido para parar, com celular válido que nenhum outro negócio usa e com nota no Google)
 *  ou "responderam" (em conversa, ainda sem desfecho). `repetidos`: de `celularesRepetidos`. */
export function naFila(fila: Fila, e: Espaco, c: Crm | undefined, prazo: Prazo | null, repetidos: ReadonlySet<TelefoneNorm>) {
  const estagio = c?.estagio ?? "novo";
  if (fila === "retornos") return prazo === "atrasada" || prazo === "hoje";
  // `toques` só existe desde 05/11 (#262), sem migração: quem foi abordado antes tem só o último contato
  if (fila === "primeiro") {
    if (estagio !== "novo" || c?.toques || c?.ultimoContatoEm || c?.respondeuEm || c?.naoContatarEm || !e.nota) return false;
    const n = celularDe(e, c);
    return !!n && !repetidos.has(n);
  }
  return (estagio === "negociando" || !!c?.respondeuEm) && estagio !== "fechado" && estagio !== "perdido";
}
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
  prazo: 1 << 6, fora: 1 << 7, caixa: 1 << 8, contato: 1 << 9, fixados: 1 << 10, alerta: 1 << 11, fila: 1 << 12,
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
  estagios: Record<EtapaNaTela, number>;
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

/** Os filtros que cada negócio reprova (um bit por filtro), com o que foi calculado no caminho. */
function mascarador(f: Filtros, { crm, hoje, fuso }: Contexto, emFoco: Set<string> | null, repetidos: ReadonlySet<TelefoneNorm>) {
  const termo = semAcento(f.busca.trim());
  return (e: Espaco) => {
    const c = crm[e.slug];
    const estagio = c?.estagio ?? "novo";
    // o filtro e os chips de etapa separam o Novo já contatado ("Em contato"); as visões e o dinheiro seguem a etapa do banco
    const etapa = etapaNaTela(c);
    const prazo = prazoDe(c, hoje);
    const falou = diaLocal(c?.ultimoContatoEm ?? null, fuso) === hoje;
    const destaque = emDestaque(c, hoje);
    let m = 0;
    if (termo && !textoDeBusca(e).includes(termo)) m |= B.busca;
    if (f.uf && e.uf !== f.uf) m |= B.uf;
    if (f.cidade && local(e) !== f.cidade) m |= B.cidade;
    if (f.nicho && e.nicho !== f.nicho) m |= B.nicho;
    if (f.situacao && !naSituacao(e, f.situacao)) m |= B.situacao;
    if (f.estagio && etapa !== f.estagio) m |= B.estagio;
    if (f.prazo && prazo !== f.prazo) m |= B.prazo;
    if (f.fora && c?.publicado !== false) m |= B.fora;
    if (f.caixa && !e.caixa) m |= B.caixa;
    if (f.contato && !falou) m |= B.contato;
    if (f.fixados && !destaque) m |= B.fixados;
    if (emFoco && !emFoco.has(e.slug)) m |= B.alerta;
    if (f.fila && !naFila(f.fila, e, c, prazo, repetidos)) m |= B.fila;
    return { c, estagio, etapa, prazo, falou, destaque, m };
  };
}

/** Quantos há em cada fila com a busca, o lugar, o nicho e o Caixa ligados. As visões, o alerta
 *  e a própria fila não contam: são outra entrada na mesma lista. `faleiHoje` é o contador do dia:
 *  quantos receberam contato hoje, sem filtro nenhum. */
export function contarFilas(espacos: readonly Espaco[], f: Filtros, ctx: Contexto): { filas: Record<Fila, number>; faleiHoje: number } {
  const repetidos = celularesRepetidos(espacos, ctx.crm);
  const marcar = mascarador(f, ctx, null, repetidos);
  const livres = B.situacao | B.estagio | B.prazo | B.fora | B.contato | B.fixados | B.alerta | B.fila;
  const filas: Record<Fila, number> = { retornos: 0, primeiro: 0, responderam: 0 };
  let faleiHoje = 0;
  for (const e of espacos) {
    const x = marcar(e);
    if (x.falou) faleiHoje += 1;
    if (passaSalvo(x.m, livres)) for (const fila of FILAS) if (naFila(fila, e, x.c, x.prazo, repetidos)) filas[fila] += 1;
  }
  return { filas, faleiHoje };
}

export function consultar(espacos: readonly Espaco[], f: Filtros, ctx: Contexto): ResultadoPainel {
  const { crm, hoje } = ctx;
  const avisos = alertas([...espacos], crm, hoje);
  const foco = f.alerta ? avisos.find((a) => a.id === f.alerta) : undefined;
  const emFoco = foco ? new Set(foco.slugs) : null;
  // só a fila "Primeiro contato" precisa dos repetidos: as outras consultas não pagam a passada
  const marcar = mascarador(f, ctx, emFoco, f.fila === "primeiro" ? celularesRepetidos(espacos, crm) : new Set());

  // destacados ficam no topo de qualquer ordenação: separados aqui, ordenados cada grupo
  // e juntados no fim (o mesmo que usar o destaque como primeiro critério, sem recalculá-lo
  // a cada comparação)
  const destacados: Espaco[] = [];
  const demais: Espaco[] = [];
  const ufs = contador(), cidades = contador(), nichos = contador();
  const estagios: Record<EtapaNaTela, number> = { novo: 0, contato: 0, oferta: 0, negociando: 0, fechado: 0, perdido: 0 };
  const prazos: Record<Prazo, number> = { atrasada: 0, hoje: 0, futura: 0 };
  const visoes: Record<VisaoId, number> = { atrasados: 0, hoje: 0, falei: 0, fixados: 0, todos: 0, pendentes: 0, negociando: 0, foradoar: 0 };
  let caixa = 0, contratadoCents = 0, negociacaoCents = 0;
  const tirando = { cidade: 0, nicho: 0 };
  // os alertas contam no mesmo recorte das filas (busca, lugar, nicho e Caixa): com a cidade
  // filtrada, o número do chip é o que a lista mostra ao tocar nele
  const recortado = !!(f.busca || f.uf || f.cidade || f.nicho || f.caixa);
  const noRecorte = new Set<string>();
  const foraDoRecorte = B.situacao | B.estagio | B.prazo | B.fora | B.contato | B.fixados | B.alerta | B.fila;

  for (const e of espacos) {
    const { c, estagio, etapa, prazo, falou, destaque, m } = marcar(e);
    if (recortado && passaSalvo(m, foraDoRecorte)) noRecorte.add(e.slug);

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
    // a etapa tira da fila do dia (escolherEtapa, na tela): o chip conta sem a fila, que é o que o clique mostra
    if (passaSalvo(m, B.estagio | B.fila) && etapa in estagios) estagios[etapa] += 1;
    if (passaSalvo(m, B.prazo) && prazo) prazos[prazo] += 1;
    if (passaSalvo(m, B.caixa) && e.caixa) caixa += 1;
    // cada visão controla prazo, situação, estágio e fora do ar; o resto vem dos filtros ligados.
    // A fila é outra entrada: não muda a contagem das visões ("Falei hoje" é o contador do dia)
    if (passaSalvo(m, B.prazo | B.situacao | B.estagio | B.fora | B.fila)) {
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
    if (estagio === "fechado") contratadoCents += mensalidadeDe(c);
    // a mesma conta do funil: oferta e negociação, com o preço padrão onde nada foi combinado
    if (estagio === "oferta" || estagio === "negociando") negociacaoCents += mensal(c);
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
    avisos: recortado
      ? avisos.map((a) => ({ ...a, slugs: a.slugs.filter((x) => noRecorte.has(x)) })).filter((a) => a.slugs.length > 0 || a.id === f.alerta)
      : avisos,
    totais: { contratadoCents, negociacaoCents },
  };
}
