// Os textos das mensagens prontas da gaveta (envio manual pelo wa.me). O padrão mora aqui; o que o
// vendedor personalizar na aba Prospecção fica em config/crm.textos e vale no lugar do padrão.
// Sem "server-only": a gaveta preenche, o editor valida ao vivo e o servidor revalida com o mesmo schema.
import { z } from "zod";

export const CHAVES_TEXTO = ["primeiro", "lembrete", "ultima", "proposta", "boasVindas"] as const;
export type ChaveTexto = (typeof CHAVES_TEXTO)[number];

export const ROTULO_TEXTO: Record<ChaveTexto, string> = {
  primeiro: "Primeiro contato",
  lembrete: "Lembrete",
  ultima: "Última tentativa",
  proposta: "Proposta",
  boasVindas: "Boas-vindas",
};
export const chaveDoModelo = (modelo: string): ChaveTexto | null => CHAVES_TEXTO.find((c) => ROTULO_TEXTO[c] === modelo) ?? null;

/** O que cada marcador vira na mensagem (a explicação aparece no editor). */
export const MARCADORES_TEXTO = {
  oi: "saudação com o nome do dono e quem assina",
  vendedor: "quem assina",
  nome: "nome do negócio",
  cliente: "nome do negócio (igual a {nome})",
  prova: "nota do Google ou quem indicou",
  site: "endereço do site do lead",
  entrada: "taxa de ativação",
  mensal: "mensalidade",
  proposta: "linha com o link da proposta (some se não houver link)",
} as const;
export type MarcadoresTexto = Record<Exclude<keyof typeof MARCADORES_TEXTO, "cliente">, string>;

const SAIDA = "Se não quiser mais mensagens, responda PARE.";

export const TEXTOS_PADRAO: Record<ChaveTexto, string> = {
  primeiro: "{oi} {prova} Estou montando agendas online para negócios da região, onde o cliente marca sozinho. Posso mandar um exemplo do {nome}? Se não fizer sentido, responda PARE e não escrevo mais.",
  lembrete: `{oi} A prévia do {nome} está pronta: {site}. Ela mostra serviços, preço e horários. Quer que eu ajuste algo? ${SAIDA}`,
  ultima: `{oi} Não vou insistir. A prévia fica no ar em {site}. Se quiser ver depois, é só responder. ${SAIDA}`,
  proposta: `{oi} Combinado: o {nome} em {site}.\n\nInclui serviços com preço e duração, horário de cada profissional e link na bio do Instagram.\n\nValores: taxa de ativação de {entrada} e {mensal} por mês, sem taxa por agendamento.\n\n{proposta}\n\nPosso liberar seu acesso para testar com um cliente hoje?\n\n${SAIDA}`,
  boasVindas: `{oi} Que bom. A agenda do {nome} está em {site}.\n\nVamos finalizar juntos: serviços, horários da equipe e link na bio. Qual horário funciona para você hoje ou amanhã?\n\n${SAIDA}`,
};

/** O molde vale até 800 caracteres: preenchido, tem de caber nos 1000 do EnvioConfirmado. */
export const TEXTO_MAX = 800;
const DESCONHECIDO = new RegExp(`\\{(?!(?:${Object.keys(MARCADORES_TEXTO).join("|")})\\})`);

/** Por que o texto não pode ser salvo (vazio = pode). Chave aberta sem marcador conhecido iria ao
 *  cliente como está ("{nome }"). */
export function problemasDoTexto(texto: string): string[] {
  const p: string[] = [];
  if (!texto.trim()) p.push("O texto está vazio.");
  if (texto.trim().length > TEXTO_MAX) p.push(`Passou de ${TEXTO_MAX} caracteres.`);
  if (DESCONHECIDO.test(texto)) p.push("Tem marcador desconhecido: confira o que está entre chaves.");
  return p;
}

/** Aviso, não trava: mensagem fria sem saída leva a bloqueio e denúncia do número. */
export const semSaida = (chave: ChaveTexto, texto: string) =>
  chave === "primeiro" && !/\bPARE\b|n[aã]o (?:te )?(?:escrevo|mando|envio) mais|[eé] s[oó] (?:me )?(?:avisar|falar|dizer)|me avis[ae]/i.test(texto);

/** config/crm.textos: só o que foi personalizado; chave ausente = o padrão. */
export const TextosCrmEstrito = z.partialRecord(
  z.enum(CHAVES_TEXTO),
  z.string().trim().refine((s) => !problemasDoTexto(s).length, "texto fora da regra"),
);
/** Para ler o doc: fora da regra, vale o padrão (a gaveta não quebra por um doc torto). */
export const TextosCrm = TextosCrmEstrito.catch({});
export type TextosCrm = z.infer<typeof TextosCrmEstrito>;

/** O texto com os marcadores trocados; a linha que ficou vazia ({proposta} sem link) some. */
export const preencherTexto = (molde: string, m: MarcadoresTexto) =>
  molde
    .replace(/\{(\w+)\}/g, (tudo, k: string) => (k === "cliente" ? m.nome : Object.hasOwn(m, k) ? m[k as keyof MarcadoresTexto] : tudo))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
