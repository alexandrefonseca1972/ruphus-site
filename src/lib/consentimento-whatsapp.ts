// Consentimento explícito para mensagens por WhatsApp (LGPD e política do WhatsApp). Sem
// "server-only" de propósito: a tela de agendamento usa o texto e a versão do aceite, e o
// servidor monta a evidência a partir dos mesmos valores. Sem aceite gravado, nada sai.

/** Muda sempre que o texto do aceite mudar: a versão vai gravada junto de cada aceite. */
export const TERMO_WHATSAPP_VERSAO = "2026-11-13";
export const TEXTO_ACEITE_WHATSAPP = "Quero receber pelo WhatsApp a confirmação, os avisos e o pedido de avaliação deste atendimento.";

/** O texto de cada versão. A evidência cita o que o cliente marcou na hora, não o texto de hoje: quem
 *  aceitou a versão de 08/11 não aceitou o pedido de avaliação. Versão nova entra aqui; nenhuma sai. */
const TEXTOS_ACEITE: Record<string, string> = {
  "2026-11-08": "Quero receber pelo WhatsApp a confirmação e os avisos deste agendamento.",
  [TERMO_WHATSAPP_VERSAO]: TEXTO_ACEITE_WHATSAPP,
};
/** A versão que a tela do cliente mostrou (página aberta antes de uma troca de texto manda a antiga);
 *  desconhecida ou ausente, a atual. */
export const versaoDoAceite = (daTela?: string | null) => (daTela && Object.hasOwn(TEXTOS_ACEITE, daTela) ? daTela : TERMO_WHATSAPP_VERSAO);

/** Última linha das mensagens automáticas ao cliente. "SAIR" é stop word do gateway (opt-out do
 *  cliente); o dono usa CONFIRMADO/RECUSAR, e lerComando não reconhece SAIR. */
export const AVISO_SAIR = "Para não receber mais mensagens, responda SAIR.";
export const comAvisoSair = (texto: string) => `${texto}\n\n${AVISO_SAIR}`;

/** O consentimento que o atendys registra: origem + evidência (texto livre, até ~500 caracteres),
 *  mais a prova do aceite. eventId é um por agendamento (o mesmo agendamento não cria evento novo)
 *  e occurredAt é o momento do aceite: depois de um SAIR, o atendys só reativa com os dois e com
 *  o aceite posterior à revogação. */
export function optInDoAgendamento(c: { tenantId: string; agendamentoId: string; versao: string; em: Date }) {
  return {
    eventId: `ruphus-agendamento:${c.tenantId}:${c.agendamentoId}`.slice(0, 128),
    occurredAt: c.em.toISOString(),
    origem: "ruphus-agendamento-online",
    evidencia: `Aceite marcado pelo cliente no agendamento online de ${c.tenantId} (ruphus.site). Texto: "${TEXTOS_ACEITE[c.versao] ?? TEXTO_ACEITE_WHATSAPP}" Versão ${c.versao}. Em ${c.em.toISOString()}. Agendamento ${c.agendamentoId}.`,
  };
}

/** O opt-in de um agendamento já gravado, ou null quando o cliente não aceitou. Agendamento
 *  anterior a este campo (sem whatsappConsent) conta como sem aceite: conservador. */
export function optInDoDoc(tenantId: string, d: { id: string; get(campo: string): unknown }) {
  const c = d.get("whatsappConsent") as { aceito?: unknown; versao?: unknown; em?: unknown } | undefined;
  if (c?.aceito !== true) return null;
  const em = c.em instanceof Date ? c.em : (c.em as { toDate?: () => Date } | undefined)?.toDate?.();
  if (!em) return null;
  return optInDoAgendamento({ tenantId, agendamentoId: d.id, versao: String(c.versao ?? ""), em });
}

export function optInAvaliacaoDoDoc(tenantId: string, d: { id: string; get(campo: string): unknown }) {
  const c = d.get("whatsappConsent") as { versao?: unknown } | undefined;
  return c?.versao === TERMO_WHATSAPP_VERSAO ? optInDoDoc(tenantId, d) : null;
}
