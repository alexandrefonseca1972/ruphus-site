import "server-only";
import { FieldValue, type Firestore, Timestamp } from "firebase-admin/firestore";
import { UserError } from "@/lib/booking.server";
import { dateIn } from "@/lib/datetime";
import { BaixaInput, idDaBaixa, LancamentoInput, mesDe } from "@/lib/financeiro";
import type { z } from "zod";

// Escritas do Caixa: só pelo servidor, e só com o módulo ligado pelo admin da plataforma
// (tenants/{t}.modulos.financeiro). As regras deixam o gestor ler e ninguém gravar.
// Quem chama já conferiu que é dono ou admin do negócio (exigeGestor).

type Quem = { uid: string; email?: string };

async function exigeCaixa(db: Firestore, tenantId: string) {
  const t = await db.doc(`tenants/${tenantId}`).get();
  if (t.get("modulos.financeiro") !== true) throw new UserError("O Caixa não está ativo para este negócio.");
  return t;
}

const col = (db: Firestore, tenantId: string) => db.collection(`tenants/${tenantId}/lancamentos`);

export async function lancar(db: Firestore, tenantId: string, l: LancamentoInput, quem: Quem) {
  await exigeCaixa(db, tenantId);
  const ref = col(db, tenantId).doc();
  // o Admin SDK recusa campo undefined: descrição vazia não vai
  const { descricao, ...resto } = l;
  await ref.create({ ...resto, ...(descricao && { descricao }), mes: mesDe(l.data), criadoPor: quem.email ?? quem.uid, criadoEm: FieldValue.serverTimestamp() });
  return ref.id;
}

/** Corrige valor, categoria, forma, data ou descrição. O vínculo com a agenda fica. */
export async function editar(db: Firestore, tenantId: string, id: string, l: LancamentoInput, quem: Quem) {
  await exigeCaixa(db, tenantId);
  const ref = col(db, tenantId).doc(id);
  await db.runTransaction(async (tx) => {
    const atual = await tx.get(ref);
    if (!atual.exists) throw new UserError("Lançamento não encontrado.");
    // a baixa de um atendimento continua entrada: virar saída quebraria o "fechar o dia"
    if (atual.get("appointmentId") && l.tipo !== "entrada") throw new UserError("O recebimento de um atendimento é sempre entrada.");
    // e fica no dia do atendimento: noutro mês, a agenda e o Caixa deixariam de achá-lo
    const data = atual.get("appointmentId") ? String(atual.get("data")) : l.data;
    tx.update(ref, { ...l, data, descricao: l.descricao ?? FieldValue.delete(), mes: mesDe(data), editadoPor: quem.email ?? quem.uid, editadoEm: FieldValue.serverTimestamp() });
  });
}

/** Apagar a baixa de um atendimento devolve ele ao "fechar o dia". */
export async function excluir(db: Firestore, tenantId: string, id: string) {
  await exigeCaixa(db, tenantId);
  await col(db, tenantId).doc(id).delete();
}

/** "Recebi": a entrada nasce do atendimento, com o valor, o profissional e o cliente dele. */
export async function baixarAgendamento(db: Firestore, tenantId: string, b: z.infer<typeof BaixaInput>, quem: Quem) {
  await exigeCaixa(db, tenantId);
  const agendamento = db.doc(`tenants/${tenantId}/appointments/${b.appointmentId}`);
  const baixa = col(db, tenantId).doc(idDaBaixa(b.appointmentId));
  await db.runTransaction(async (tx) => {
    const [a, ja] = await Promise.all([tx.get(agendamento), tx.get(baixa)]);
    if (!a.exists) throw new UserError("Agendamento não encontrado.");
    if (ja.exists) throw new UserError("Este atendimento já foi recebido.");
    if (!["booked", "confirmed"].includes(a.get("status"))) throw new UserError("Só dá para receber um atendimento que aconteceu.");
    if (!(a.get("start") instanceof Timestamp)) throw new UserError("Agendamento inválido.");
    const start = (a.get("start") as Timestamp).toDate();
    // o mesmo relógio da agenda e do Caixa (start.toMillis() <= agora): o que o painel oferece, o servidor aceita
    if (start.getTime() > Date.now()) throw new UserError("Este atendimento ainda não começou.");
    const data = dateIn(start);
    tx.create(baixa, {
      tipo: "entrada",
      valorCents: b.valorCents,
      forma: b.forma,
      categoria: "Atendimento",
      descricao: String(a.get("serviceName") ?? "").slice(0, 80),
      data,
      mes: mesDe(data),
      appointmentId: b.appointmentId,
      staffId: a.get("staffId") ?? null,
      staffName: a.get("staffName") ?? null,
      customerKey: a.get("customerKey") ?? null,
      customerName: a.get("customerName") ?? null,
      criadoPor: quem.email ?? quem.uid,
      criadoEm: FieldValue.serverTimestamp(),
    });
  });
}
