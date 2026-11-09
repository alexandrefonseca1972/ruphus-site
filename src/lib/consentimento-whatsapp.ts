// Consentimento explícito para mensagens por WhatsApp (LGPD e política do WhatsApp). Sem
// "server-only" de propósito: a tela de agendamento usa o texto e a versão do aceite, e o
// servidor monta a evidência a partir dos mesmos valores. Sem aceite gravado, nada sai.

/** Muda sempre que o texto do aceite mudar: a versão vai gravada junto de cada aceite. */
export const TERMO_WHATSAPP_VERSAO = "2026-11-08";
export const TEXTO_ACEITE_WHATSAPP = "Quero receber pelo WhatsApp a confirmação e os avisos deste agendamento.";

/** Última linha das mensagens automáticas ao cliente. "SAIR" é stop word do gateway (opt-out do
 *  cliente); o dono usa CONFIRMADO/RECUSAR, e lerComando não reconhece SAIR. */
export const AVISO_SAIR = "Para não receber mais mensagens, responda SAIR.";
export const comAvisoSair = (texto: string) => `${texto}\n\n${AVISO_SAIR}`;

/** O consentimento que o atendys registra: origem + evidência (texto livre, até ~500 caracteres). */
export function optInDoAgendamento(c: { tenantId: string; agendamentoId: string; versao: string; em: Date }) {
  return {
    origem: "ruphus-agendamento-online",
    evidencia: `Aceite marcado pelo cliente no agendamento online de ${c.tenantId} (ruphus.site). Texto: "${TEXTO_ACEITE_WHATSAPP}" Versão ${c.versao}. Em ${c.em.toISOString()}. Agendamento ${c.agendamentoId}.`,
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
