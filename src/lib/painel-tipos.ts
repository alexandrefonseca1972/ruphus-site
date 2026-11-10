// Contrato do painel do admin: o negócio como a lista o mostra, os filtros e a
// consulta. Código puro, sem "server-only": a tela e o servidor importam daqui, e os
// tipos saem dos schemas em vez de serem escritos duas vezes.
// Ver docs/plano-paginacao-admin.md (seções 6.1 e 6.4).
import { z } from "zod";
import type { Alerta } from "@/lib/alertas";
import { UFS, type Uf } from "@/lib/coleta";
import { ESTAGIOS, type Crm, type Prazo } from "@/lib/crm-tipos";
import type { ResultadoPainel } from "@/lib/painel-consulta";
import { NOVOS_MAX, NOVOS_POR_VEZ, PERIODOS, type NumerosDaSemana, type Periodo, type ResumoDoFunil } from "@/lib/funil-consulta";

export type Espaco = {
  slug: string;
  nome: string;
  telefone: string | null;
  nicho: string;          // rótulo em português, já agrupado
  cidade: string | null;
  uf: string | null;
  nota: number | null;    // estrelas no Google
  avaliacoes: number | null;
  acessos: number;        // quantas pessoas entram no painel deste espaço
  limiteStaff: number;    // profissionais que o negócio pode cadastrar
  caixa: boolean;         // módulo Caixa (financeiro) ligado para este cliente
};

// os tipos do schema.org viram nichos que a gente reconhece (e junta variações)
const NICHOS: Record<string, string> = {
  petstore: "Pet shop",
  veterinarycare: "Veterinária",
  beautysalon: "Estética e beleza",
  healthandbeautybusiness: "Estética e beleza",
  hairsalon: "Cabeleireiro",
  barbershop: "Barbearia",
  nailsalon: "Unhas",
  dayspa: "Spa e massagem",
  tattooparlor: "Tatuagem",
  medicalclinic: "Saúde",
  dentist: "Odontologia",
  physician: "Saúde",
  healthclub: "Fitness",
  podiatric: "Podologia",
  // os do gerador de sites
  physiotherapy: "Fisioterapia",
  medicalbusiness: "Saúde",
  educationalorganization: "Aulas e cursos",
  drivingschool: "Autoescola",
  exercisegym: "Fitness",
  sportsactivitylocation: "Fitness",
  autorepair: "Automotivo",
  autowash: "Automotivo",
  tireshop: "Automotivo",
};
export const NICHO_OUTROS = "Outros";
export const nichoDe = (tipo: unknown) => NICHOS[String(tipo ?? "").toLowerCase()] ?? NICHO_OUTROS;
export const NICHOS_DO_PAINEL = [...new Set([...Object.values(NICHOS), NICHO_OUTROS])];

export const ORDENS = ["relevancia", "nota", "avaliacoes", "nome", "compromisso", "contato"] as const;
export type Ordem = (typeof ORDENS)[number];
export const SITUACOES = ["ativo", "pendente"] as const;
export type Situacao = (typeof SITUACOES)[number];
export const PRAZOS = ["atrasada", "hoje", "futura"] as const satisfies readonly Prazo[];
/** As três filas do dia, no topo da Lista: quem cobrar, quem abordar, quem responder. */
export const FILAS = ["retornos", "primeiro", "responderam"] as const;
export type Fila = (typeof FILAS)[number];
export const ALERTAS = ["viu_proposta", "sem_proxima", "parado", "sem_toque", "implantacao", "destaque"] as const satisfies readonly Alerta["id"][];

/** Itens por página da lista; "mostrar mais" pede múltiplos disto. */
export const PAGINA = 40;
export const PAGINA_MAX = 2000;
export const BUSCA_MAX = 100;

// Object.keys perde o tipo das chaves (limite do TypeScript): o único cast, e com as chaves do próprio UFS
const UF_SIGLAS = Object.keys(UFS) as [Uf, ...Uf[]];

/** Forma canônica (NFC), sem caracteres de controle (C0, C1) nem de direção do texto
 *  (bidi, que embaralham a exibição), sem espaço nas pontas. O ZWJ fica: emoji composto usa. */
export const limparTexto = (s: string) =>
  s.normalize("NFC").replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069\u200e\u200f]/gu, "").trim();
/** Texto vindo da URL: o teto bruto vem antes da limpeza, para 1 MB não ser normalizado à toa. */
const texto = (max: number) => z.string().max(max * 4).transform(limparTexto).pipe(z.string().max(max));

/** "AAAA-MM-DD" que existe no calendário (2026-02-30 não passa). */
export const dataValida = (s: string) => {
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
/** "hoje" de quem consulta: no máximo um dia de distância do relógio do servidor (fusos de -12 a +14). */
export const hojePlausivel = (s: string, agora = Date.now()) =>
  dataValida(s) && Math.abs(new Date(`${s}T12:00:00Z`).getTime() - agora) <= 36 * 3_600_000;
/** Nome de fuso IANA ("America/Manaus") que o Intl reconhece. */
export const fusoValido = (s: string) => {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: s });
    return true;
  } catch {
    return false;
  }
};

export const fusoCanonico = (s: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: s }).resolvedOptions().timeZone;

/** Uma opção fechada ou "" (sem filtro), que é também o padrão. */
const opcao = <T extends readonly [string, ...string[]]>(valores: T) => z.union([z.literal(""), z.enum(valores)]).default("");

/** A consulta do painel como chega na URL. Estrito: parâmetro desconhecido é recusado. */
export const ConsultaPainel = z.strictObject({
  busca: texto(BUSCA_MAX).default(""),
  uf: opcao(UF_SIGLAS),
  // "Cidade/UF", ou só "Cidade" quando o negócio não tem UF (é o rótulo do chip)
  cidade: texto(100).default(""),
  nicho: z.string().refine((s) => s === "" || NICHOS_DO_PAINEL.includes(s), "nicho desconhecido").default(""),
  situacao: opcao(SITUACOES),
  estagio: opcao(ESTAGIOS),
  prazo: opcao(PRAZOS),
  alerta: opcao(ALERTAS),
  // sem padrão: ausente quando não vem na URL
  fila: z.union([z.literal(""), z.enum(FILAS)]).optional(),
  fora: z.stringbool().default(false),
  caixa: z.stringbool().default(false),
  contato: z.stringbool().default(false), // "falei hoje"
  fixados: z.stringbool().default(false),
  ordem: z.enum(ORDENS).default("relevancia"),
  // só dígitos: "0x28", "4e1" e " 40 " seriam 40 com a coerção solta
  n: z.string().regex(/^\d{1,4}$/, "número inteiro").transform(Number).pipe(z.number().int().min(1).max(PAGINA_MAX)).default(PAGINA),
  hoje: z.string().refine((s) => hojePlausivel(s), "data fora do dia de hoje"),
  // canônico ("america/sao_paulo" vira "America/Sao_Paulo"): uma grafia por fuso no cache de formatadores
  tz: z.string().max(64).refine(fusoValido, "fuso desconhecido").transform(fusoCanonico).optional(),
  // a aba Funil: os números e as colunas dos mesmos negócios filtrados
  funil: z.stringbool().default(false),
  periodo: z.enum(Object.keys(PERIODOS) as [Periodo, ...Periodo[]]).default("mes"),
  novos: z.string().regex(/^\d{1,4}$/, "número inteiro").transform(Number).pipe(z.number().int().min(1).max(NOVOS_MAX)).default(NOVOS_POR_VEZ),
});
export type ConsultaPainel = z.output<typeof ConsultaPainel>;

/** Os filtros que a consulta aplica: a consulta sem paginação, data e fuso. A UF é texto:
 *  o chip vem do valor gravado, e a sigla é conferida na fronteira (URL) e na limpeza do índice
 *  (docs/plano-paginacao-admin.md, 6.3 e 6.4), não aqui — senão um valor fora do padrão
 *  ligaria o chip sem filtrar a lista. */
export type Filtros = Omit<ConsultaPainel, "n" | "hoje" | "tz" | "uf" | "funil" | "periodo" | "novos" | "fila"> & { uf: string; fila?: "" | Fila };
export const SEM_FILTROS: Filtros = {
  busca: "", uf: "", cidade: "", nicho: "", situacao: "", estagio: "", prazo: "", alerta: "",
  fila: "", fora: false, caixa: false, contato: false, fixados: false, ordem: "relevancia",
};

/** Guarda de tipo para o que vem de fora (chip, <select>, URL). */
export const ehUf = (s: string): s is Uf => (UF_SIGLAS as readonly string[]).includes(s);
export const ehOrdem = (s: string): s is Ordem => (ORDENS as readonly string[]).includes(s);

/** Por que a rota do painel recusou: a tela trata cada um (6.2). */
export const CODIGOS_DE_ERRO = ["sessao", "restrito", "invalido", "preparando", "falha"] as const;
export type CodigoDeErro = (typeof CODIGOS_DE_ERRO)[number];

/** Resposta de GET /api/admin/painel: a página pedida, com o CRM dela, e as contagens. */
export type RespostaPainel =
  | {
      ok: true;
      itens: Espaco[];
      crm: Record<string, Crm>;
      /** quantos passam nos filtros, além da página */
      total: number;
      /** quantos negócios há na base, sem filtro nenhum */
      base: number;
      contagens: Omit<ResultadoPainel, "lista" | "avisos"> & { avisos: (Omit<Alerta, "slugs"> & { total: number })[]; filas: Record<Fila, number> };
      /** com funil=1: os números e as colunas; o CRM dos cartões vai junto em `crm` */
      funil?: ResumoDoFunil;
      /** com funil=1: a linha de números do funil, dos últimos 7 dias */
      semana?: NumerosDaSemana;
      versao: number;
      montadoEm: string;
    }
  | { ok: false; codigo: CodigoDeErro; erro: string };
