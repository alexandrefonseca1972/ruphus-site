// Os textos da prospecção: as variantes por nicho, etapa e ângulo (F2), com as 2 do A/B da F1 intactas.
// Sem "server-only": a gaveta monta a mensagem com eles e valida o rascunho do copiloto com as mesmas
// regras do servidor. Quem escolhe a variante é o servidor (`varianteAB` e `escolherVariante`,
// src/lib/prospeccao.ts).
import { z } from "zod";
import type { EtapaCadencia } from "@/lib/crm-tipos";
import { paraVarianteId, type VarianteId } from "@/lib/tipos-marca";

/** Os nichos reais da base (gerado.sub); `geral` é a reserva de quem não tem texto próprio. */
export const NICHOS = ["salao", "barbearia", "estetica", "unhas", "podologia", "tatuagem", "geral"] as const;
export type Nicho = (typeof NICHOS)[number];
export const ANGULOS = ["elogio_google", "agenda_online", "faltas", "pergunta_aberta", "vizinhanca"] as const;
export type Angulo = (typeof ANGULOS)[number];
export const ETAPAS_VARIANTE = ["primeiro", "lembrete", "ultima"] as const satisfies readonly EtapaCadencia[];

export type Variante = { id: VarianteId; nicho: Nicho; etapa: EtapaCadencia; angulo: Angulo; texto: string };

/** O nicho da variante a partir do gerado.sub do tenant: fora da lista, `geral`. */
export const nichoDe = (sub: unknown): Nicho => (NICHOS as readonly unknown[]).includes(sub) && sub !== "geral" ? (sub as Nicho) : "geral";

const id = (s: string): VarianteId => {
  const v = paraVarianteId(s);
  if (!v) throw new Error(`id de variante inválido: ${s}`);
  return v;
};

/** Marcadores: {oi} (saudação com quem assina), {prova} (dado do Google ou indicação), {nome},
 *  {site} (o link do site demo, só depois do primeiro contato). Curtas, sem preço, PARE no fim. */
export const VARIANTES_F1 = [
  {
    id: id("salao-primeiro-elogio-google"),
    nicho: "salao",
    etapa: "primeiro",
    angulo: "elogio_google",
    texto: "{oi} {prova} Estou montando agendas online para salões da região, onde a cliente marca sozinha. Posso mandar um exemplo do {nome}? Se não fizer sentido, responda PARE e não escrevo mais.",
  },
  {
    id: id("salao-primeiro-agenda-online"),
    nicho: "salao",
    etapa: "primeiro",
    angulo: "agenda_online",
    texto: "{oi} {prova} Muita cliente de salão quer marcar fora do horário, quando ninguém responde o WhatsApp. Montei uma prévia de agenda online para o {nome}, onde ela escolhe o horário sozinha. Quer ver? Se não fizer sentido, responda PARE e não escrevo mais.",
  },
] as const satisfies readonly Variante[];

const PARE = "Se não fizer sentido, responda PARE e não escrevo mais.";
const SAIDA = "Se não quiser mais mensagens, responda PARE.";
const v = (nicho: Nicho, etapa: EtapaCadencia, angulo: Angulo, texto: string): Variante => ({
  id: id(`${nicho}-${etapa}-${angulo.replace(/_/g, "-")}`),
  nicho,
  etapa,
  angulo,
  texto,
});

/** O resto da biblioteca (F2). Vocabulário do nicho: corte e escova, corte e barba, limpeza de pele,
 *  esmaltação, unha encravada, sessão de tatuagem. */
const VARIANTES_F2: Variante[] = [
  // salão: as 2 da F1 mais a pergunta aberta
  v("salao", "primeiro", "pergunta_aberta", `{oi} {prova} Pergunta rápida: hoje a cliente do {nome} marca corte e escova só pelo WhatsApp? ${PARE}`),
  v("salao", "lembrete", "agenda_online", `{oi} A prévia da agenda do {nome} está pronta: {site}. A cliente escolhe o serviço e o horário sozinha. Quer que eu ajuste algo? ${SAIDA}`),
  v("salao", "lembrete", "faltas", `{oi} Deixei a agenda do {nome} em {site}. Ela lembra a cliente do horário e ajuda a reduzir as faltas na coloração e na escova. Posso ajustar? ${SAIDA}`),
  v("salao", "ultima", "pergunta_aberta", `{oi} Não vou insistir. A prévia do {nome} fica em {site}. Se agenda online não for prioridade agora, tudo bem: me conta o que pesa mais aí? ${SAIDA}`),
  v("salao", "ultima", "vizinhanca", `{oi} Último recado: outros salões da região já recebem horário pela agenda online. A do {nome} fica em {site}, se quiser ver depois. ${SAIDA}`),

  // barbearia
  v("barbearia", "primeiro", "elogio_google", `{oi} {prova} Estou montando agendas online para barbearias da região, onde o cliente marca corte e barba sozinho. Posso mandar um exemplo do {nome}? ${PARE}`),
  v("barbearia", "primeiro", "faltas", `{oi} {prova} Cadeira vazia por cliente que não aparece custa caro. Montei uma prévia de agenda para o {nome} que lembra o cliente do horário. Quer ver? ${PARE}`),
  v("barbearia", "primeiro", "pergunta_aberta", `{oi} {prova} Pergunta rápida: no {nome}, o cliente marca corte e barba pelo WhatsApp ou chega e espera? ${PARE}`),
  v("barbearia", "lembrete", "agenda_online", `{oi} A agenda do {nome} está pronta: {site}. O cliente escolhe o barbeiro e o horário sem te chamar. Quer que eu ajuste algo? ${SAIDA}`),
  v("barbearia", "lembrete", "faltas", `{oi} Deixei a prévia do {nome} em {site}. O lembrete automático ajuda a segurar a cadeira ocupada. Posso ajustar os serviços? ${SAIDA}`),
  v("barbearia", "ultima", "pergunta_aberta", `{oi} Não vou insistir. A prévia do {nome} fica em {site}. Se não for a hora, me conta o que pesa mais aí? ${SAIDA}`),
  v("barbearia", "ultima", "vizinhanca", `{oi} Último recado: barbearias aqui da região já recebem horário pela agenda online. A do {nome} fica em {site}. ${SAIDA}`),

  // estética
  v("estetica", "primeiro", "elogio_google", `{oi} {prova} Estou montando agendas online para clínicas de estética da região, onde a cliente marca limpeza de pele e outros procedimentos sozinha. Posso mandar um exemplo do {nome}? ${PARE}`),
  v("estetica", "primeiro", "agenda_online", `{oi} {prova} Muita cliente de estética pesquisa à noite e quer marcar na hora. Montei uma prévia de agenda para o {nome}, com cada procedimento e duração. Quer ver? ${PARE}`),
  v("estetica", "primeiro", "pergunta_aberta", `{oi} {prova} Pergunta rápida: no {nome}, a cliente marca limpeza de pele e depilação só pelo WhatsApp? ${PARE}`),
  v("estetica", "lembrete", "agenda_online", `{oi} A agenda do {nome} está pronta: {site}. Os procedimentos aparecem com a duração, e a cliente escolhe o horário. Quer ajustar algo? ${SAIDA}`),
  v("estetica", "lembrete", "faltas", `{oi} Deixei a prévia do {nome} em {site}. O lembrete do horário ajuda a cliente a não faltar no procedimento. Posso ajustar? ${SAIDA}`),
  v("estetica", "ultima", "pergunta_aberta", `{oi} Não vou insistir. A prévia do {nome} fica em {site}. Se não for prioridade, me conta o que pesa mais aí? ${SAIDA}`),
  v("estetica", "ultima", "vizinhanca", `{oi} Último recado: clínicas de estética da região já recebem horário pela agenda online. A do {nome} fica em {site}. ${SAIDA}`),

  // unhas
  v("unhas", "primeiro", "elogio_google", `{oi} {prova} Estou montando agendas online para estúdios de unhas da região, onde a cliente marca esmaltação e alongamento sozinha. Posso mandar um exemplo do {nome}? ${PARE}`),
  v("unhas", "primeiro", "faltas", `{oi} {prova} Horário de alongamento perdido por falta pesa no fim do mês. Montei uma prévia de agenda para o {nome} que lembra a cliente do horário. Quer ver? ${PARE}`),
  v("unhas", "primeiro", "pergunta_aberta", `{oi} {prova} Pergunta rápida: no {nome}, a cliente marca a manicure pelo WhatsApp ou pelo Instagram? ${PARE}`),
  v("unhas", "lembrete", "agenda_online", `{oi} A agenda do {nome} está pronta: {site}. A cliente escolhe esmaltação, alongamento e o horário sozinha. Quer ajustar algo? ${SAIDA}`),
  v("unhas", "lembrete", "faltas", `{oi} Deixei a prévia do {nome} em {site}. O lembrete ajuda a segurar o horário marcado. Posso ajustar os serviços? ${SAIDA}`),
  v("unhas", "ultima", "pergunta_aberta", `{oi} Não vou insistir. A prévia do {nome} fica em {site}. Se não for a hora, me conta o que pesa mais aí? ${SAIDA}`),
  v("unhas", "ultima", "vizinhanca", `{oi} Último recado: estúdios de unhas da região já recebem horário pela agenda online. A do {nome} fica em {site}. ${SAIDA}`),

  // podologia
  v("podologia", "primeiro", "elogio_google", `{oi} {prova} Estou montando agendas online para consultórios de podologia da região, onde o paciente marca o atendimento sozinho. Posso mandar um exemplo do {nome}? ${PARE}`),
  v("podologia", "primeiro", "pergunta_aberta", `{oi} {prova} Pergunta rápida: no {nome}, quem tem unha encravada consegue marcar fora do horário de atendimento? ${PARE}`),
  v("podologia", "lembrete", "agenda_online", `{oi} A agenda do {nome} está pronta: {site}. O paciente escolhe o atendimento e o horário sem precisar ligar. Quer ajustar algo? ${SAIDA}`),
  v("podologia", "lembrete", "faltas", `{oi} Deixei a prévia do {nome} em {site}. O lembrete do horário ajuda a reduzir as faltas. Posso ajustar? ${SAIDA}`),
  v("podologia", "ultima", "pergunta_aberta", `{oi} Não vou insistir. A prévia do {nome} fica em {site}. Se não for prioridade, me conta o que pesa mais aí? ${SAIDA}`),
  v("podologia", "ultima", "vizinhanca", `{oi} Último recado: consultórios da região já recebem horário pela agenda online. A do {nome} fica em {site}. ${SAIDA}`),

  // tatuagem
  v("tatuagem", "primeiro", "elogio_google", `{oi} {prova} Estou montando agendas online para estúdios de tatuagem da região, onde o cliente reserva a sessão sozinho. Posso mandar um exemplo do {nome}? ${PARE}`),
  v("tatuagem", "primeiro", "pergunta_aberta", `{oi} {prova} Pergunta rápida: no {nome}, as sessões são marcadas pelo direct ou pelo WhatsApp? ${PARE}`),
  v("tatuagem", "primeiro", "faltas", `{oi} {prova} Sessão longa desmarcada em cima da hora deixa o dia vazio. Montei uma prévia de agenda para o {nome} que lembra o cliente da sessão. Quer ver? ${PARE}`),
  v("tatuagem", "lembrete", "agenda_online", `{oi} A agenda do {nome} está pronta: {site}. O cliente vê os horários livres e reserva a sessão. Quer ajustar algo? ${SAIDA}`),
  v("tatuagem", "lembrete", "faltas", `{oi} Deixei a prévia do {nome} em {site}. O lembrete da sessão ajuda a não perder o dia. Posso ajustar? ${SAIDA}`),
  v("tatuagem", "ultima", "pergunta_aberta", `{oi} Não vou insistir. A prévia do {nome} fica em {site}. Se não for a hora, me conta o que pesa mais aí? ${SAIDA}`),
  v("tatuagem", "ultima", "vizinhanca", `{oi} Último recado: estúdios da região já recebem reservas pela agenda online. A do {nome} fica em {site}. ${SAIDA}`),

  // geral (reserva)
  v("geral", "primeiro", "elogio_google", `{oi} {prova} Estou montando agendas online para negócios da região, onde o cliente marca sozinho. Posso mandar um exemplo do {nome}? ${PARE}`),
  v("geral", "primeiro", "pergunta_aberta", `{oi} {prova} Pergunta rápida: no {nome}, o cliente marca horário só pelo WhatsApp? ${PARE}`),
  v("geral", "lembrete", "agenda_online", `{oi} A prévia do {nome} está pronta: {site}. Ela mostra os serviços e os horários, e o cliente marca sozinho. Quer que eu ajuste algo? ${SAIDA}`),
  v("geral", "lembrete", "faltas", `{oi} Deixei a agenda do {nome} em {site}. O lembrete do horário ajuda a reduzir as faltas. Posso ajustar? ${SAIDA}`),
  v("geral", "ultima", "pergunta_aberta", `{oi} Não vou insistir. A prévia fica no ar em {site}. Se quiser ver depois, é só responder. ${SAIDA}`),
  v("geral", "ultima", "vizinhanca", `{oi} Último recado: negócios da região já recebem horário pela agenda online. A do {nome} fica em {site}. ${SAIDA}`),
];

/** A biblioteca inteira: as 2 da F1 primeiro (a ordem delas é a do A/B, que depende disso). */
export const VARIANTES: readonly Variante[] = [...VARIANTES_F1, ...VARIANTES_F2];

export const varianteDoId = (v: string | null | undefined): Variante | null => VARIANTES.find((x) => x.id === v) ?? null;

/** O texto da variante com os marcadores trocados. */
export const preencher = (v: Variante, m: { oi: string; prova: string; nome: string; site?: string }) =>
  v.texto.replace(/\{(oi|prova|nome|site)\}/g, (_, k: keyof typeof m) => m[k] ?? "");

// ————— regras do texto (biblioteca e rascunho do copiloto) —————

/** Preço: R$ (com espaço também), "reais", "pila", porcentagem (% ou "por cento"), desconto, valor
 *  mensal ("89 por mês", "/mês") ou número com centavos (89,90 e 79,9). Nota do Google (4,8) não conta. */
export const temPreco = (s: string) =>
  /R\s*\$|\breais\b|\bpilas?\b|%|\bpor\s+cento\b|\bdescontos?\b|\/\s*m[eê]s(?![a-z])|\d\s*(?:por|ao)\s+m[eê]s(?![a-z])|\d,\d{2}(?!\d)|\d{2},\d/i.test(s);
/** Telefone: 8 ou mais dígitos de qualquer escrita (\p{Nd}: "١١٩…" também), com qualquer quantidade de
 *  espaço, ponto, barra, traço (qualquer \p{Pd}) ou parêntese entre eles ("1 1 - 9 9 9…" também).
 *  Dígito e separador não se sobrepõem: sem retrocesso explosivo. */
export const temTelefone = (s: string) => /(?:\+?\p{Nd}[\s\p{Pd}()./]*){8,}/u.test(s);
// qualquer "palavra.letras" é link, com TLD de qualquer escrita (.pt, .cc, .top, .рф...): "obrigado.Até"
// sem espaço também cai, e é de propósito
const LINK = /(?:https?:\/\/)?(?:[\p{L}\p{N}-]+\.)+\p{L}{2,}(?![\p{L}\p{N}])(?:[/?#][^\s]*)?/giu;
/** Brinde e gratuidade: a oferta é só pela proposta. */
const temGratis = (s: string) => /gr[aá]tis|\bgratuit|\bde gra[cç]a|\bsem custo|\bfree\b|\bbrinde|\bpromo(?:[cç]|s?\b)/i.test(s);
/** Endereço soletrado: "h t t p", "w w w" e "p o n t o" letra a letra (com ou sem separador), "@",
 *  "dot x" e "palavra ponto final" com qualquer final curto ("site ponto qualquer"), menos as
 *  palavras comuns depois de "ponto" ("ponto de vista", "ponto forte").
 *  ponytail: lista de palavras comuns; um final fora dela que seja palavra comum vira falso positivo
 *  (conservador: o rascunho só deixa de sair) — ajustar com as respostas reais. */
const COMUNS_DEPOIS_DE_PONTO = "de|do|da|dos|das|e|em|no|na|que|para|por|pra|com o|final|forte|fraco|alto|baixo|certo|exato|vista|chave|morto|fixo|zero|bom|legal|mais|menos|so|ate|a|o|os|as";
const SOLETRADO = new RegExp(
  [
    String.raw`\bh[\W_]*t[\W_]*t[\W_]*p`,
    String.raw`\bw[\W_]*w[\W_]*w\b`,
    String.raw`\bp[\W_]+o[\W_]+n[\W_]+t[\W_]+o\b`,
    String.raw`\b[a-z0-9-]{2,}\s+ponto\s+(?!(?:${COMUNS_DEPOIS_DE_PONTO})\b)[a-z]{2,6}\b`,
    String.raw`\bponto\s+(?:com|br|net|org|xyz|site|app|io|me|ly|info|online|store|shop|link|top|cc|pt|co)\b`,
    String.raw`\bdot\s+[a-z]{2,}\b`,
    "@",
  ].join("|"),
  "i",
);
const temLinkSoletrado = (s: string) => SOLETRADO.test(s.normalize("NFKC"));
/** Link na forma comparável: sem protocolo, www, barra e pontuação do fim, em minúsculas. */
export const normalizarLink = (s: string) =>
  s.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[.,;:!?)]+$/, "").replace(/\/$/, "");
export const linksDe = (s: string) => (s.match(LINK) ?? []).map(normalizarLink);
export const temLink = (s: string) => linksDe(s).length > 0;

/** Os links que a resposta pode levar: o site demo do lead (com e sem ?c=1) e a proposta, se houver. */
export const linksPermitidos = (slug: string, linkProposta?: string | null) =>
  [`${slug}.ruphus.site`, `${slug}.ruphus.site/?c=1`, ...(linkProposta ? [linkProposta] : [])].map(normalizarLink);

/** A forma do texto que o validador confere e que deve sair (M-3): NFKC (largura total, ligaduras),
 *  ponto ideográfico vira ponto e largura zero (ZWJ, ZWNJ, ZWSP, word joiner, BOM) some, menos depois de
 *  emoji ("gr\u200datis" e "R\u200d$" se revelam; 👩‍🔧 fica). Quem envia manda exatamente isto. */
export const normalizarSaida = (s: string) =>
  s.normalize("NFKC").replace(/\u3002/g, ".").replace(/(?<![\p{Extended_Pictographic}\u{FE0F}\u{1F3FB}-\u{1F3FF}])[\u200B-\u200D\u2060\uFEFF]/gu, "");

/** Por que o rascunho não pode sair como está (vazio = pode). A mesma regra na tela e no servidor.
 *  Confere normalizarSaida(texto): o que sai tem de ser esse texto normalizado. */
export function problemasDaResposta(bruto: string, permitidos: readonly string[]): string[] {
  const texto = normalizarSaida(bruto);
  const p: string[] = [];
  if (!texto.trim()) p.push("A resposta está vazia.");
  // os links permitidos saem antes: o token da proposta tem dígitos que pareceriam telefone
  const fora = linksDe(texto).filter((l) => !permitidos.includes(l));
  let resto = texto;
  // com o protocolo e o www que o link permitido pode levar: o "https://" que sobrasse pareceria "http" soletrado
  for (const l of permitidos) resto = resto.split(new RegExp(`(?:https?://)?(?:www\\.)?${l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?`, "gi")).join(" ");
  if (fora.length) p.push(`Link fora da lista: ${fora.join(", ")}.`);
  if (temPreco(resto)) p.push("Fala de preço, valor ou desconto: preço só pela proposta.");
  if (temTelefone(resto)) p.push("Tem número de telefone.");
  if (temGratis(resto)) p.push("Fala de grátis, brinde ou promoção: a oferta é só pela proposta.");
  if (temLinkSoletrado(resto)) p.push("Tem endereço soletrado ou @.");
  if (texto.length > 700) p.push("Passou de 700 caracteres.");
  return p;
}

/** A regra da biblioteca (o editor da F4 usa a mesma): até 320 caracteres no texto da variante (os
 *  marcadores entram com o dado do lead), PARE no fim, sem preço e, no primeiro contato, sem link. */
export const VarianteValida = z
  .object({
    id: z.string().refine((s) => paraVarianteId(s) === s, "id fora da forma de slug"),
    nicho: z.enum(NICHOS),
    etapa: z.enum(ETAPAS_VARIANTE),
    angulo: z.enum(ANGULOS),
    texto: z
      .string()
      .max(320)
      .refine((s) => /\bPARE\b/.test(s), "sem PARE")
      .refine((s) => !temPreco(s), "com preço")
      .refine((s) => !temTelefone(s), "com telefone")
      .refine((s) => !/\{(?!(?:oi|prova|nome|site)\})/.test(s), "marcador desconhecido"),
  })
  .refine((x) => x.etapa !== "primeiro" || (!temLink(x.texto) && !x.texto.includes("{site}")), "link no primeiro contato");

/** As objeções que mais aparecem, com a resposta que não promete o que o produto não faz. A gaveta
 *  mostra; o copiloto de IA usa como base do que pode dizer. */
export const OBJECOES = [
  {
    q: "Já tenho Instagram.",
    a: "A agenda não substitui o Instagram. O Instagram faz o cliente te descobrir; a agenda transforma isso em horário marcado, sem você parar para responder cada mensagem.",
  },
  {
    q: "Está caro.",
    a: "Faz sentido olhar o retorno. Qual é o seu ticket médio? Com poucos atendimentos no mês a mensalidade já se paga — e o horário que deixa de ser perdido no WhatsApp entra nessa conta.",
  },
  {
    q: "Vou pensar.",
    a: "Claro. Só para eu te ajudar melhor: o que você quer avaliar — o valor, como fica na prática ou se a sua equipe vai usar?",
  },
  {
    q: "Manda os valores.",
    a: "Mando agora. Só me diz antes quantos profissionais atendem aí, para eu te passar já do jeito certo.",
  },
  {
    q: "Quem fez essa página?",
    a: "Fui eu. Montei com o que está público no seu perfil, justamente para você ver funcionando antes de decidir. Nada vai ao ar no seu nome sem a sua autorização.",
  },
] as const;
