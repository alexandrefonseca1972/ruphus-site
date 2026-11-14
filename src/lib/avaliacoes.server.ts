import "server-only";
import { createHash, createHmac } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { COMENTARIO_AVALIACAO_MAX, mediaGeral, RespostaAvaliacao } from "@/lib/avaliacoes";
import { textoSeguro } from "@/lib/sanitizar";
import { segredoIgual } from "@/lib/segredo.server";
import { todayIn } from "@/lib/datetime";
import { redeDoIp } from "@/lib/booking.server";

export function tokenAvaliacao(tenantId: string, appointmentId: string) {
  const segredo = process.env.AVALIACAO_TOKEN_SECRET || process.env.CRON_SECRET;
  if (!segredo) throw new Error("AVALIACAO_TOKEN_SECRET ou CRON_SECRET não configurado.");
  return createHmac("sha256", segredo).update(`ruphus-avaliacao:${tenantId}:${appointmentId}`).digest("hex");
}
export const hashTokenAvaliacao = (token: string) => createHash("sha256").update(`ruphus-avaliacao:${token}`).digest("hex");

export function refAvaliacao(db: Firestore, tenantId: string, appointmentId: string) {
  return db.doc(`tenants/${tenantId}/avaliacoes/${appointmentId}`);
}

function millis(valor: unknown): number | null {
  if (valor instanceof Date) return valor.getTime();
  const v = valor as { toMillis?: () => number } | undefined;
  return typeof v?.toMillis === "function" ? v.toMillis() : null;
}

export type AvaliacaoPublica = {
  customerName: string;
  businessName: string;
  serviceName: string;
  staffName: string;
  siteUrl: string;
  status: "aberta" | "respondida" | "expirada";
};

export async function abrirAvaliacao(db: Firestore, tenantId: string, appointmentId: string, token: string): Promise<AvaliacaoPublica | null> {
  const ids = RespostaAvaliacao.pick({ tenantId: true, appointmentId: true, token: true }).safeParse({ tenantId, appointmentId, token });
  if (!ids.success) return null;
  const snap = await refAvaliacao(db, tenantId, appointmentId).get();
  if (!snap.exists || !segredoIgual(hashTokenAvaliacao(token), String(snap.get("tokenHash") ?? ""))) return null;
  const expiraEm = millis(snap.get("expiraEm"));
  const status = snap.get("status") === "respondida" ? "respondida" : expiraEm !== null && expiraEm <= Date.now() ? "expirada" : "aberta";
  return {
    customerName: String(snap.get("customerName") ?? ""),
    businessName: String(snap.get("businessName") ?? "o negócio"),
    serviceName: String(snap.get("serviceName") ?? "Atendimento"),
    staffName: String(snap.get("staffName") ?? ""),
    siteUrl: String(snap.get("siteUrl") ?? `https://${tenantId}.ruphus.site/`),
    status,
  };
}

export async function responderAvaliacao(db: Firestore, entrada: unknown, ip?: string) {
  const parsed = RespostaAvaliacao.safeParse(entrada);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const input = parsed.data;
  const comentario = textoSeguro(input.comentario, COMENTARIO_AVALIACAO_MAX + 1, true);
  if (Array.from(comentario).length > COMENTARIO_AVALIACAO_MAX) return { ok: false as const, error: `Use no máximo ${COMENTARIO_AVALIACAO_MAX} caracteres no comentário.` };
  const ref = refAvaliacao(db, input.tenantId, input.appointmentId);
  const appointment = db.doc(`tenants/${input.tenantId}/appointments/${input.appointmentId}`);
  const dia = todayIn();
  const limite = ip ? db.doc(`tenants/${input.tenantId}/limits/review-${createHash("sha256").update(`ruphus-avaliacao-ip:${redeDoIp(ip.trim().slice(0, 100))}`).digest("hex").slice(0, 16)}-${dia}`) : null;

  return db.runTransaction(async (tx) => {
    const [snap, agendamento, contador] = await Promise.all([tx.get(ref), tx.get(appointment), ...(limite ? [tx.get(limite)] : [])]);
    if (!snap.exists || !segredoIgual(hashTokenAvaliacao(input.token), String(snap.get("tokenHash") ?? ""))) return { ok: false as const, error: "Este link de avaliação não é válido." };
    if (snap.get("status") === "respondida") return { ok: true as const, already: true };
    const expiraEm = millis(snap.get("expiraEm"));
    if (expiraEm !== null && expiraEm <= Date.now()) return { ok: false as const, error: "Este link de avaliação venceu. Fale com o negócio se ainda quiser compartilhar sua experiência." };
    if (!agendamento.exists || !agendamento.get("completedAt") || agendamento.get("status") !== "confirmed") return { ok: false as const, error: "Este atendimento não está mais disponível para avaliação." };
    if (Number(contador?.get("count") ?? 0) >= 10) return { ok: false as const, error: "Muitas tentativas em sequência. Aguarde alguns minutos e tente de novo." };
    if (limite) tx.set(limite, { count: FieldValue.increment(1), day: dia }, { merge: true });
    tx.update(ref, {
      status: "respondida",
      notas: input.notas,
      notaGeral: mediaGeral(input.notas),
      ...(comentario && { comentario }),
      respondidaEm: FieldValue.serverTimestamp(),
      proximaTentativaEm: FieldValue.delete(),
      enviandoEm: FieldValue.delete(),
    });
    return { ok: true as const, already: false };
  });
}
