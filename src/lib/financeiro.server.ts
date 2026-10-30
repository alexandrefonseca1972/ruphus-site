import "server-only";
import { FieldValue, type Firestore, Timestamp } from "firebase-admin/firestore";
import { UserError } from "@/lib/booking.server";
import { dateIn, todayIn } from "@/lib/datetime";
import { randomBytes } from "node:crypto";
import { BaixaInput, CaixaConfig, diaNoMes, FixaInput, idDaBaixa, idDoPagamento, LancamentoInput, mesDe, PagamentoInput } from "@/lib/financeiro";
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
    // conta fixa e comissão pagas continuam saída
    const pagamento = /^(fx|cm)-/.test(id);
    if (pagamento && l.tipo !== "saida") throw new UserError("Um pagamento é sempre saída.");
    // e todos ficam no dia de origem: noutro mês, a agenda e o Caixa deixariam de achá-los
    const data = atual.get("appointmentId") || pagamento ? String(atual.get("data")) : l.data;
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

const config = (db: Firestore, tenantId: string) => db.doc(`tenants/${tenantId}/caixa/config`);

// Contas fixas e comissões mudam uma de cada vez, lidas e gravadas aqui: o painel nunca
// manda a configuração inteira, senão uma tela desatualizada apagaria o que outra gravou.
const lerConfig = async (tx: FirebaseFirestore.Transaction, db: Firestore, tenantId: string) => CaixaConfig.parse((await tx.get(config(db, tenantId))).data() ?? {});

export async function adicionarFixa(db: Firestore, tenantId: string, f: z.infer<typeof FixaInput>) {
  await exigeCaixa(db, tenantId);
  await db.runTransaction(async (tx) => {
    const c = await lerConfig(tx, db, tenantId);
    if (c.fixas.length >= 30) throw new UserError("No máximo 30 contas fixas.");
    const fixa = { ...f, id: randomBytes(6).toString("hex"), desde: mesDe(todayIn()) };
    tx.set(config(db, tenantId), { fixas: [...c.fixas, fixa] }, { merge: true });
  });
}

export async function removerFixa(db: Firestore, tenantId: string, fixaId: string) {
  await exigeCaixa(db, tenantId);
  await db.runTransaction(async (tx) => {
    const c = await lerConfig(tx, db, tenantId);
    tx.set(config(db, tenantId), { fixas: c.fixas.filter((f) => f.id !== fixaId) }, { merge: true });
  });
}

export async function definirComissao(db: Firestore, tenantId: string, staffId: string, pct: number) {
  await exigeCaixa(db, tenantId);
  await config(db, tenantId).set({ comissoes: { [staffId]: pct } }, { merge: true });
}

/** "Paguei" a conta fixa ou a comissão do mês: vira saída, uma vez só por mês. */
export async function pagar(db: Firestore, tenantId: string, p: z.infer<typeof PagamentoInput>, quem: Quem) {
  await exigeCaixa(db, tenantId);
  const ref = col(db, tenantId).doc(idDoPagamento(p.tipo, p.alvoId, p.mes));
  await db.runTransaction(async (tx) => {
    const [ja, cfg] = await Promise.all([tx.get(ref), tx.get(config(db, tenantId))]);
    if (ja.exists) throw new UserError(p.tipo === "fixa" ? "Esta conta já foi paga neste mês." : "A comissão deste mês já foi paga.");
    const hoje = todayIn();
    let campos: Record<string, unknown>;
    if (p.tipo === "fixa") {
      const fixa = CaixaConfig.parse(cfg.data() ?? {}).fixas.find((f) => f.id === p.alvoId);
      if (!fixa) throw new UserError("Conta fixa não encontrada.");
      campos = { categoria: fixa.categoria, descricao: fixa.nome, fixaId: fixa.id, data: mesDe(hoje) === p.mes ? hoje : diaNoMes(p.mes, fixa.dia) };
    } else {
      // quem saiu da equipe no meio do mês ainda recebe: basta ter atendido no mês
      const [staff, atendeu] = await Promise.all([
        tx.get(db.doc(`tenants/${tenantId}/staff/${p.alvoId}`)),
        tx.get(col(db, tenantId).where("mes", "==", p.mes).where("staffId", "==", p.alvoId).limit(1)),
      ]);
      if (!staff.exists && atendeu.empty) throw new UserError("Profissional não encontrado.");
      const nome = String(staff.get("name") ?? atendeu.docs[0]?.get("staffName") ?? "").slice(0, 60);
      campos = { categoria: "Comissão/salário", descricao: `Comissão ${nome}`.slice(0, 80), staffId: p.alvoId, data: mesDe(hoje) === p.mes ? hoje : diaNoMes(p.mes, 31) };
    }
    tx.create(ref, { tipo: "saida", valorCents: p.valorCents, forma: p.forma, ...campos, mes: p.mes, criadoPor: quem.email ?? quem.uid, criadoEm: FieldValue.serverTimestamp() });
  });
}
