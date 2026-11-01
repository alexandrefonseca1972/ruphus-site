import "server-only";
import { FieldValue, type Firestore, Timestamp } from "firebase-admin/firestore";
import { UserError } from "@/lib/booking.server";
import { todayIn } from "@/lib/datetime";
import { idDaBaixa, mesDe } from "@/lib/financeiro";

type Quem = { uid: string; email?: string };

/** Id do lançamento do sinal no Caixa: um por agendamento, sem repetir. */
export const idDoSinal = (appointmentId: string) => `sn-${appointmentId}`;

/** "Sinal recebido": o salão conferiu no banco. O horário fica confirmado e, com o Caixa
 *  ligado, o sinal entra como recebido (com o profissional, para a comissão). */
export async function confirmarSinal(db: Firestore, tenantId: string, appointmentId: string, quem: Quem) {
  const t = db.doc(`tenants/${tenantId}`);
  const agendamento = t.collection("appointments").doc(appointmentId);
  await db.runTransaction(async (tx) => {
    const [a, tenant, baixa] = await Promise.all([tx.get(agendamento), tx.get(t), tx.get(t.collection("lancamentos").doc(idDaBaixa(appointmentId)))]);
    if (!a.exists) throw new UserError("Agendamento não encontrado.");
    if (a.get("sinal.status") !== "pendente") throw new UserError("Este agendamento não tem sinal a confirmar.");
    if (!["booked", "confirmed"].includes(a.get("status"))) throw new UserError("Este horário já foi cancelado. Combine a devolução do sinal com o cliente.");
    const cents = Number(a.get("sinal.cents"));
    if (!Number.isInteger(cents) || cents <= 0) throw new UserError("O valor do sinal deste agendamento está inválido. Fale com o suporte.");
    const mudanca: Record<string, unknown> = { "sinal.status": "pago", "sinal.pagoEm": FieldValue.serverTimestamp() };
    if (a.get("status") === "booked") {
      const historico = t.collection("history").doc();
      tx.create(historico, { appointmentId, type: "confirmed", reason: "sinal_pago", at: FieldValue.serverTimestamp(), by: quem.uid, byName: quem.email ?? null });
      Object.assign(mudanca, { status: "confirmed", lastHistoryId: historico.id });
    }
    tx.update(agendamento, mudanca);
    // recebido no Caixa antes de confirmar o sinal: o valor já entrou lá, não conta duas vezes
    if (tenant.get("modulos.financeiro") === true && !baixa.exists) {
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
  // ponytail: 200 por rodada; o cron roda de 10 em 10 min
  const vencidos = await db.collectionGroup("appointments").where("sinal.status", "==", "pendente").where("sinal.ate", "<=", Timestamp.fromDate(agora)).limit(200).get();
  let liberados = 0;
  for (const d of vencidos.docs) {
    if (d.ref.parent.parent?.parent.id !== "tenants") continue;
    // um agendamento com problema não segura os outros: registra e segue
    const ok = await db.runTransaction(async (tx) => {
      const a = await tx.get(d.ref);
      if (a.get("sinal.status") !== "pendente") return false;
      // confirmado na mão, cancelado ou faltou: o sinal deixa de ser esperado e sai da consulta
      if (a.get("status") !== "booked") {
        tx.update(d.ref, { "sinal.status": a.get("status") === "confirmed" ? "dispensado" : "vencido" });
        return false;
      }
      const historico = d.ref.parent.parent!.collection("history").doc();
      tx.create(historico, { appointmentId: d.id, type: "cancelled", reason: "sinal_nao_pago", at: FieldValue.serverTimestamp(), by: "sistema", byName: "Sinal não pago no prazo" });
      tx.update(d.ref, { status: "cancelled", lastHistoryId: historico.id, "sinal.status": "vencido" });
      return true;
    }).catch(async (e) => {
      console.error("[sinal] expirar", d.ref.path, e);
      // tira da consulta: um documento que sempre falha não pode ocupar a rodada inteira
      await d.ref.update({ "sinal.status": "erro" }).catch(() => undefined);
      return false;
    });
    if (ok) liberados++;
  }
  return liberados;
}
