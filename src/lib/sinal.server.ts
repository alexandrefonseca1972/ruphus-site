import "server-only";
import { FieldValue, type Firestore, Timestamp } from "firebase-admin/firestore";
import { UserError } from "@/lib/booking.server";
import { todayIn } from "@/lib/datetime";
import { mesDe } from "@/lib/financeiro";

type Quem = { uid: string; email?: string };

/** Id do lançamento do sinal no Caixa: um por agendamento, sem repetir. */
export const idDoSinal = (appointmentId: string) => `sn-${appointmentId}`;

/** "Sinal recebido": o salão conferiu no banco. O horário fica confirmado e, com o Caixa
 *  ligado, o sinal entra como recebido (com o profissional, para a comissão). */
export async function confirmarSinal(db: Firestore, tenantId: string, appointmentId: string, quem: Quem) {
  const t = db.doc(`tenants/${tenantId}`);
  const agendamento = t.collection("appointments").doc(appointmentId);
  await db.runTransaction(async (tx) => {
    const [a, tenant] = await Promise.all([tx.get(agendamento), tx.get(t)]);
    if (!a.exists) throw new UserError("Agendamento não encontrado.");
    if (a.get("sinal.status") !== "pendente") throw new UserError("Este agendamento não tem sinal a confirmar.");
    if (!["booked", "confirmed"].includes(a.get("status"))) throw new UserError("Este horário já foi cancelado. Combine a devolução do sinal com o cliente.");
    const cents = Number(a.get("sinal.cents"));
    const mudanca: Record<string, unknown> = { "sinal.status": "pago", "sinal.pagoEm": FieldValue.serverTimestamp() };
    if (a.get("status") === "booked") {
      const historico = t.collection("history").doc();
      tx.create(historico, { appointmentId, type: "confirmed", reason: "sinal_pago", at: FieldValue.serverTimestamp(), by: quem.uid, byName: quem.email ?? null });
      Object.assign(mudanca, { status: "confirmed", lastHistoryId: historico.id });
    }
    tx.update(agendamento, mudanca);
    if (tenant.get("modulos.financeiro") === true) {
      const data = todayIn();
      tx.create(t.collection("lancamentos").doc(idDoSinal(appointmentId)), {
        tipo: "entrada",
        valorCents: cents,
        forma: "pix",
        categoria: "Atendimento",
        descricao: `Sinal · ${String(a.get("serviceName") ?? "")}`.slice(0, 80),
        data,
        mes: mesDe(data),
        staffId: a.get("staffId") ?? null,
        staffName: a.get("staffName") ?? null,
        customerKey: a.get("customerKey") ?? null,
        customerName: a.get("customerName") ?? null,
        criadoPor: quem.email ?? quem.uid,
        criadoEm: FieldValue.serverTimestamp(),
      });
    }
  });
}

/** O cron (a cada 10 min) libera o horário de quem não pagou o sinal no prazo. Só o que
 *  ainda aguarda confirmação: o que o salão confirmou na mão fica, mesmo sem sinal. */
export async function expirarSinais(db: Firestore, agora = new Date()) {
  const vencidos = await db.collectionGroup("appointments").where("sinal.status", "==", "pendente").where("sinal.ate", "<=", Timestamp.fromDate(agora)).get();
  let liberados = 0;
  for (const d of vencidos.docs) {
    if (d.ref.parent.parent?.parent.id !== "tenants") continue;
    const ok = await db.runTransaction(async (tx) => {
      const a = await tx.get(d.ref);
      if (a.get("status") !== "booked" || a.get("sinal.status") !== "pendente") return false;
      const historico = d.ref.parent.parent!.collection("history").doc();
      tx.create(historico, { appointmentId: d.id, type: "cancelled", reason: "sinal_nao_pago", at: FieldValue.serverTimestamp(), by: "sistema", byName: "Sinal não pago no prazo" });
      tx.update(d.ref, { status: "cancelled", lastHistoryId: historico.id, "sinal.status": "vencido" });
      return true;
    });
    if (ok) liberados++;
  }
  return liberados;
}
