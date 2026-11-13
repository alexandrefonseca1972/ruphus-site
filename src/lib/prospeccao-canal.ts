// Canal da prospecção (F3): regras puras do número de prospecção. Sem "server-only": o gerador
// (botão "Falar com a Ruphus" no site demo) usa a mesma trava.
//
// Regra fixa do plano: o número da plataforma (1726) nunca é usado para prospecção. A trava fica no
// código e não depende de configuração: a lista abaixo vale sempre; a config só acrescenta recusas.
import { ErroPrevisto } from "@/lib/erro-previsto";
import { NUMERO_META_ATUAL, soDigitosComDDI, telefoneDaMeta } from "@/lib/telefone";
import { paraSlug, type Slug } from "@/lib/tipos-marca";

/** Instâncias da plataforma no atendys que nunca falam de prospecção, com ou sem config. */
export const INSTANCIAS_DA_PLATAFORMA = ["ruphus-plataforma-cloud-1726"] as const;

/** Envio de prospecção por um canal que não pode prospectar (o da plataforma ou um número reservado). */
export class CanalProibido extends ErroPrevisto {
  readonly codigo = "CanalProibido";
}

/** Lança CanalProibido se o canal não pode prospectar. Sem fallback: recusado, não sai por outro número.
 *  `extras` (a instância da plataforma escolhida no admin, numerosReservados) só somam à lista fixa. */
export function travaDeProspeccao(canal: { instancia: string; numero: string }, extras: { instancias?: readonly string[]; reservados?: readonly string[] } = {}): void {
  const instancia = canal.instancia.trim();
  if (!instancia) throw new CanalProibido("Prospecção sem instância: nada sai.");
  // o nome da instância da plataforma leva o final do número; o teste por "1726" pega cópias renomeadas
  if ([...INSTANCIAS_DA_PLATAFORMA, ...(extras.instancias ?? [])].includes(instancia) || instancia.includes("1726")) {
    throw new CanalProibido(`A instância ${instancia} é da plataforma e não faz prospecção.`);
  }
  if (!soDigitosComDDI(canal.numero)) throw new CanalProibido("Prospecção sem o número remetente: nada sai.");
  if (telefoneDaMeta(canal.numero, [NUMERO_META_ATUAL, ...(extras.reservados ?? [])])) {
    throw new CanalProibido("Esse número é reservado à plataforma e não faz prospecção.");
  }
}

/** O número pode ser o de prospecção? (a mesma trava, sem lançar; o botão do site usa, com os
 *  `reservados` do Firestore: numerosReservados e o phone da plataforma). */
export const podeProspectar = (numero: string, reservados: readonly string[] = []) => {
  try {
    travaDeProspeccao({ instancia: "prospeccao", numero }, { reservados });
    return true;
  } catch (e) {
    if (e instanceof CanalProibido) return false;
    throw e;
  }
};

/** Palavras de saída (H-1): a palavra inteira ou o começo dela ("descadastra", "cancela", "tirar",
 *  "remover"). "tir[ae]" pega "tira/tirar/tire"; "remov" pega "remove/remova/remover". */
const PALAVRA_SAIDA = /^(?:sair|parar|pare|stop|descadastr\w*|cancel\w*|tir[ae]\w*|remov\w*)$/;
/** Opt-out determinístico: mensagem curta (até 6 palavras; NFKD, sem acento, sem pontuação, qualquer
 *  caixa) com uma palavra de saída em qualquer posição ("quero sair", "pode parar", "ok pare", "sim, pode
 *  tirar meu numero"); nenhuma IA decide isto. Conservador de propósito: "não quero parar agora" e
 *  "cancelar meu horário" também são saída (perder um lead custa menos que gravar opt-in falso).
 *  ponytail: lista de palavras; "pode tirar uma dúvida?" vira opt-out. Ajustar com as conversas da 3.7.
 *  É MAIS larga que a do atendys, que só registra a palavra sozinha stop/parar/sair (e frases como "pare
 *  de me mandar"): ../wtsfy conversation-intent.ts. A prospecção grava o opt-out do nosso lado com esta;
 *  o canal oficial (respostaForaDoFluxo) só se cala na palavra exata do atendys e, no resto, diz como sair. */
export function ehOptOut(texto: string): boolean {
  const palavras = texto.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim().split(/\s+/);
  return palavras.length <= 6 && palavras.some((p) => PALAVRA_SAIDA.test(p));
}

/** A mensagem pronta do botão "Falar com a Ruphus": o código identifica o site demo do lead. */
export const mensagemDeEntrada = (slug: string) => `Oi! Vi a proposta do site ${slug} e quero falar com a Ruphus. (código ${slug})`;
/** O slug que a mensagem de entrada traz, se trouxer. */
export const slugDaEntrada = (texto: string): Slug | null => {
  const m = /c[oó]digo:?\s+([a-z0-9-]{2,63})/i.exec(texto);
  return m ? paraSlug(m[1].toLowerCase()) : null;
};

/** wa.me do número de prospecção com a mensagem de entrada; null se o número não pode prospectar.
 *  Sem `reservados` (não deu para ler o Firestore), null: o botão some em vez de arriscar o 1726. */
export function linkDeEntrada(numero: string | undefined, slug: string, reservados: readonly string[] | undefined): string | null {
  const n = numero ? soDigitosComDDI(numero) : null;
  return n && reservados && podeProspectar(n, reservados) ? `https://wa.me/${n}?text=${encodeURIComponent(mensagemDeEntrada(slug))}` : null;
}

// ————— agente —————

/** Limites do agente. turnosPorDia: as respostas dentro da janela (replyToInbound) não contam no limite
 *  de 3 por destinatário do atendys (só envio "notification" conta), então 6 seguem valendo.
 *  custoMaxCentavos: centavos de dólar por conversa (o custo do roteador). */
export const LIMITES_AGENTE = { turnosPorDia: 6, custoMaxCentavos: 10, automaticasSeguidas: 3, lacoMs: 60_000 } as const;

/** Quanto vale a reserva do turno (L-2), calculado na hora: a soma dos prazos da cadeia de IA mais 3
 *  prazos do atendys (trava, opt-in e envio) e 10 s de folga. Uma cadeia mais longa em Ajustes não deixa
 *  a reserva vencer com a IA ainda pensando (outra mensagem tomaria o turno e responderia junto). */
export const reservaDoTurno = (prazosIA: readonly number[], prazoAtendys: number) => prazosIA.reduce((a, b) => a + b, 0) + 3 * prazoAtendys + 10_000;

export const APRESENTACAO = "Oi! Aqui é a assistente virtual da Ruphus.";
export const PERGUNTA_OPTIN = "Posso te mandar por aqui as novidades da sua proposta?";
export const PEDE_TEXTO = "Ainda não consigo ouvir áudio por aqui. Pode mandar por texto? Já chamei alguém da equipe da Ruphus para te ajudar.";
export const PASSA_PARA_HUMANO = "Vou chamar alguém da equipe da Ruphus para continuar com você por aqui.";
// sem "se mudar de ideia, é só escrever": naoContatarEm silencia o agente e não há volta pela conversa
export const CONFIRMA_SAIDA = "Pronto, você não vai mais receber mensagens da Ruphus por aqui.";

const sem = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

const PARAR_CLARO = /\bparar de\b|\bpar[ae] de (me )?(mandar|enviar|escrever)|\bspam\b|\bbloque/;
// M-5: "não quero", "me deixa", "me tira" sozinhos aparecem em pergunta de venda ("não quero pagar caro,
// como funciona?"): só valem em mensagem curta (até 6 palavras) ou com o contexto de receber mensagem
const PARAR_AMBIGUO = /\bnao quero\b|\bme deixa\b|\bme tir[ae]\b/;
const PARAR_CONTEXTO = /\bnao quero (mais )?(receber|mensage|contato|ser contatad|que (me )?(mand|envi|escrev|lig|cham))|\bme deixa em paz\b|\bme tir[ae] (da|dessa|desta|do|desse|deste) (lista|grupo|cadastro)/;
/** Pedido de parar sem a palavra exata ("não quero", "pare de me mandar", "me tira", "spam"...):
 *  vale como opt-out, sem IA. ponytail: lista de palavras; ajustar com as conversas reais da 3.7. */
export function pedeParar(texto: string): boolean {
  const t = sem(texto).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  return PARAR_CLARO.test(t) || PARAR_CONTEXTO.test(t) || (t.split(" ").length <= 6 && PARAR_AMBIGUO.test(t));
}

const INICIO_SIM = "sim|s|ss|pode|claro|ok|okay|beleza|blz|manda|mande|quero|isso|perfeito|otimo|show|bora|opa|uhum|aham|com certeza";
/** O lead disse sim a "posso te mandar por aqui?" (H-1): a resposta INTEIRA é afirmativa curta (até 6
 *  palavras, âncora no começo e no fim: "sim", "pode sim", "claro, pode mandar", "ok obrigado"). Qualquer
 *  outra palavra recusa, e com ela as de saída ("pode parar", "quero sair") e as negações ("não", "nem"). */
const ACEITE = new RegExp(`^(?:${INICIO_SIM})(?: (?:${INICIO_SIM}|mandar|por favor|obrigad[oa]|pfv|pf))*$`);
export function aceitaContinuar(texto: string): boolean {
  const t = sem(texto).replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  return t.split(" ").length <= 6 && ACEITE.test(t);
}

/** Por que a mensagem do lead vai direto para um humano, antes da IA (null = a IA responde).
 *  ponytail: lista de palavras (e a de aceitaContinuar); ajustar com as conversas reais da 3.7. */
export function motivoDeEscalada(texto: string): string | null {
  const t = sem(texto);
  if (/quanto (custa|e|fica|sai)|\bpreco|\bvalor|\bmensalidade|\bplano|r\s*\$|\bdesconto|\bparcel/.test(t)) return "preço";
  if (/\b(quero|vamos|bora) (fechar|contratar|assinar)|\bfechado\b|\bcomo (eu )?(pago|contrato|assino)|\bpix\b|\bboleto\b/.test(t)) return "fechamento";
  if (/\bspam\b|\bchato|\bpalhacada|\bdenunci|\bbloque|\bpara de\b|\bpare de\b|\bnao (quero|tenho interesse|enche)|\bme deixa|\bsaco\b|\bporra|\bmerda|\bcaralho/.test(t)) return "irritação";
  return null;
}

// ————— disjuntor —————

const NIVEL: Record<string, number> = { GREEN: 3, HIGH: 3, YELLOW: 2, MEDIUM: 2, RED: 1, LOW: 1 };
/** Por que o disjuntor desliga o agente (null = segue): opt-out + bloqueio acima de 2% das enviadas no
 *  dia, com no mínimo 5 casos (M-2: poucos PAREs não desligam), ou queda do quality_rating. Quem chama só
 *  conta casos de conversas que a Ruphus abordou primeiro (envio ativo ou slug confirmado). */
export function disjuntorDispara(dia: { enviadas: number; optouts: number; bloqueios: number }, qualidade?: { antes?: string | null; agora: string }): string | null {
  if (qualidade?.antes && (NIVEL[qualidade.agora.toUpperCase()] ?? 0) < (NIVEL[qualidade.antes.toUpperCase()] ?? 0)) {
    return `quality_rating caiu de ${qualidade.antes} para ${qualidade.agora}`;
  }
  const ruins = dia.optouts + dia.bloqueios;
  if (ruins >= 5 && ruins / Math.max(dia.enviadas, 1) > 0.02) return `opt-out + bloqueio em ${ruins} de ${dia.enviadas} enviadas no dia (acima de 2%)`;
  return null;
}
