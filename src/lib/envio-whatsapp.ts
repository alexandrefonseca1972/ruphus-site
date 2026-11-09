// O que a tela sabe de um envio pelo WhatsApp do negócio. "cota": o atendys parou a mensagem
// (limite do dia) e o dono escolhe entre enviar à mão e manter agendada — nunca é "enviada".

export type SituacaoEnvio =
  | { estado: "enviada" }
  | { estado: "agendada"; retryAt: string }
  | { estado: "cota"; messageId: string; retryAt: string | null };

export function situacaoDe(e: { messageId: string; status: string; retryAt?: string | null }): SituacaoEnvio {
  if (e.status === "awaiting_manual") return { estado: "cota", messageId: e.messageId, retryAt: e.retryAt ?? null };
  if (e.retryAt) return { estado: "agendada", retryAt: e.retryAt };
  return { estado: "enviada" };
}
