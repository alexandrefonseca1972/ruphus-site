import "server-only";
import { FieldValue, type Firestore, Timestamp } from "firebase-admin/firestore";
import { UserError } from "@/lib/booking.server";
import { dateIn, formatBRL, todayIn } from "@/lib/datetime";
import { randomBytes } from "node:crypto";
import { BaixaInput, CaixaConfig, diaNoMes, EstornoInput, ehVinculado, FixaInput, idDaBaixa, idDoEstorno, idDoPagamento, LancamentoInput, mesDe, PagamentoInput } from "@/lib/financeiro";
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
const config = (db: Firestore, tenantId: string) => db.doc(`tenants/${tenantId}/caixa/config`);
/** Soma ao estorno guardado para abater da comissão do profissional (negativo: tira). */
const descontar = (tx: FirebaseFirestore.Transaction, db: Firestore, tenantId: string, staffId: unknown, centavos: number) => {
  if (typeof staffId === "string" && staffId && centavos) tx.set(config(db, tenantId), { descontos: { [staffId]: FieldValue.increment(centavos) } }, { merge: true });
};

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
    const [atual, estorno] = await Promise.all([tx.get(ref), tx.get(col(db, tenantId).doc(idDoEstorno(id)))]);
    if (!atual.exists) throw new UserError("Lançamento não encontrado.");
    // entrada estornada continua entrada, e não fica menor que o que já foi devolvido
    if (estorno.exists && l.tipo !== "entrada") throw new UserError("Este recebimento tem estorno: continua entrada.");
    if (estorno.exists && l.valorCents < Number(estorno.get("valorCents"))) throw new UserError(`Já foram estornados ${formatBRL(Number(estorno.get("valorCents")))}: o recebimento não fica menor que isso.`);
    // a baixa de um atendimento continua entrada: virar saída quebraria o "fechar o dia"
    if (atual.get("appointmentId") && l.tipo !== "entrada") throw new UserError("O recebimento de um atendimento é sempre entrada.");
    // conta fixa, comissão e estorno continuam saída
    const pagamento = ehVinculado(id);
    if (pagamento && l.tipo !== "saida") throw new UserError("Um pagamento é sempre saída.");
    // estorno não devolve mais do que entrou
    if (atual.get("estornoDe")) {
      const origem = await tx.get(col(db, tenantId).doc(String(atual.get("estornoDe"))));
      if (origem.exists && l.valorCents > Number(origem.get("valorCents"))) throw new UserError("O estorno não pode passar do valor recebido.");
    }
    // estorno corrigido: o desconto da comissão acompanha, pelo % do dia do estorno
    let desconto = {};
    if (atual.get("estornoDe") && typeof atual.get("pctComissao") === "number") {
      const novo = Math.round((l.valorCents * Number(atual.get("pctComissao"))) / 100);
      descontar(tx, db, tenantId, atual.get("staffId"), novo - Number(atual.get("descontoComissao") ?? 0));
      desconto = { descontoComissao: novo };
    }
    // e todos ficam no dia de origem: noutro mês, a agenda e o Caixa deixariam de achá-los
    const data = atual.get("appointmentId") || pagamento ? String(atual.get("data")) : l.data;
    tx.update(ref, { ...l, ...desconto, data, descricao: l.descricao ?? FieldValue.delete(), mes: mesDe(data), editadoPor: quem.email ?? quem.uid, editadoEm: FieldValue.serverTimestamp() });
  });
}

/** Apagar a baixa de um atendimento devolve ele ao "fechar o dia". */
export async function excluir(db: Firestore, tenantId: string, id: string) {
  await exigeCaixa(db, tenantId);
  // a entrada estornada não some sozinha: o estorno ficaria devolvendo um dinheiro que não entrou
  await db.runTransaction(async (tx) => {
    const [l, estorno] = await Promise.all([tx.get(col(db, tenantId).doc(id)), tx.get(col(db, tenantId).doc(idDoEstorno(id)))]);
    if (estorno.exists) throw new UserError("Este recebimento tem estorno. Apague o estorno antes.");
    // apagar o estorno tira o desconto dele; apagar o pagamento da comissão devolve o que ele abateu
    if (l.get("estornoDe")) descontar(tx, db, tenantId, l.get("staffId"), -Number(l.get("descontoComissao") ?? 0));
    if (id.startsWith("cm-")) descontar(tx, db, tenantId, l.get("staffId"), Number(l.get("descontoCents") ?? 0));
    tx.delete(col(db, tenantId).doc(id));
  });
}

/** "Estornar": devolve ao cliente, no todo ou em parte, uma entrada. Vira saída de hoje, com o
 *  profissional e o cliente dela. A comissão sobre o devolvido (pelo % de hoje) fica guardada
 *  e sai do próximo pagamento de comissão dele. Uma vez só por entrada. */
export async function estornar(db: Firestore, tenantId: string, e: z.infer<typeof EstornoInput>, quem: Quem) {
  await exigeCaixa(db, tenantId);
  const origem = col(db, tenantId).doc(e.lancamentoId);
  const ref = col(db, tenantId).doc(idDoEstorno(e.lancamentoId));
  await db.runTransaction(async (tx) => {
    const [o, ja, cfg] = await Promise.all([tx.get(origem), tx.get(ref), tx.get(config(db, tenantId))]);
    if (!o.exists) throw new UserError("Lançamento não encontrado.");
    if (o.get("tipo") !== "entrada") throw new UserError("Só dá para estornar uma entrada.");
    if (ja.exists) throw new UserError("Este recebimento já foi estornado.");
    if (e.valorCents > Number(o.get("valorCents"))) throw new UserError("O estorno não pode passar do valor recebido.");
    const hoje = todayIn();
    const staffId = o.get("staffId");
    // só o % importa aqui: uma conta fixa fora do esquema não trava o estorno
    const comissoes = CaixaConfig.shape.comissoes.safeParse(cfg.get("comissoes"));
    const pct = typeof staffId === "string" && comissoes.success ? (comissoes.data[staffId] ?? 0) : 0;
    const desconto = Math.round((e.valorCents * pct) / 100);
    descontar(tx, db, tenantId, staffId, desconto);
    const quemPagou = o.get("customerName") ?? o.get("descricao") ?? o.get("categoria");
    tx.create(ref, {
      tipo: "saida",
      valorCents: e.valorCents,
      forma: e.forma,
      categoria: "Estorno",
      descricao: `Estorno ${quemPagou ?? ""}`.trim().slice(0, 80),
      data: hoje,
      mes: mesDe(hoje),
      estornoDe: e.lancamentoId,
      pctComissao: pct,
      descontoComissao: desconto,
      staffId: o.get("staffId") ?? null,
      staffName: o.get("staffName") ?? null,
      customerKey: o.get("customerKey") ?? null,
      customerName: o.get("customerName") ?? null,
      criadoPor: quem.email ?? quem.uid,
      criadoEm: FieldValue.serverTimestamp(),
    });
  });
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
    let abatido = 0;
    let bruto = 0;
    if (p.tipo === "fixa") {
      const fixa = CaixaConfig.parse(cfg.data() ?? {}).fixas.find((f) => f.id === p.alvoId);
      if (!fixa) throw new UserError("Conta fixa não encontrada.");
      // a mesma regra da tela: antes de cadastrada, a conta não existia para pagar
      if (fixa.desde && p.mes < fixa.desde) throw new UserError("Esta conta ainda não existia neste mês.");
      campos = { categoria: fixa.categoria, descricao: fixa.nome, fixaId: fixa.id, data: mesDe(hoje) === p.mes ? hoje : diaNoMes(p.mes, fixa.dia) };
    } else {
      // quem saiu da equipe no meio do mês ainda recebe: basta ter atendido no mês
      const [staff, atendeu] = await Promise.all([
        tx.get(db.doc(`tenants/${tenantId}/staff/${p.alvoId}`)),
        tx.get(col(db, tenantId).where("mes", "==", p.mes).where("staffId", "==", p.alvoId)),
      ]);
      if (!staff.exists && atendeu.empty) throw new UserError("Profissional não encontrado.");
      // a comissão do mês refeita aqui: uma tela desatualizada não abate mais do que ela comporta
      const c = CaixaConfig.parse(cfg.data() ?? {});
      const faturado = atendeu.docs.reduce((t, d) => t + (d.get("tipo") === "entrada" ? Number(d.get("valorCents")) || 0 : 0), 0);
      bruto = Math.round((faturado * (c.comissoes[p.alvoId] ?? 0)) / 100);
      // abate o estorno guardado: nunca mais do que há para abater, nem que a comissão do mês, nem do lado errado
      const guardado = c.descontos[p.alvoId] ?? 0;
      abatido = Math.max(Math.min(0, guardado), Math.min(Math.max(0, Math.min(guardado, bruto)), p.descontoCents ?? 0));
      descontar(tx, db, tenantId, p.alvoId, -abatido);
      const nome = String(staff.get("name") ?? atendeu.docs[0]?.get("staffName") ?? "").slice(0, 60);
      campos = { categoria: "Comissão/salário", descricao: `Comissão ${nome}`.slice(0, 80), staffId: p.alvoId, staffName: nome || null, data: mesDe(hoje) === p.mes ? hoje : diaNoMes(p.mes, 31) };
    }
    // R$ 0 só quando o estorno abateu a comissão inteira: fica o registro de que o mês foi acertado
    if (!p.valorCents && !(p.tipo === "comissao" && abatido > 0 && bruto - abatido <= 0)) throw new UserError("Informe o valor.");
    tx.create(ref, { tipo: "saida", valorCents: p.valorCents, forma: p.forma, ...campos, ...(abatido && { descontoCents: abatido }), mes: p.mes, criadoPor: quem.email ?? quem.uid, criadoEm: FieldValue.serverTimestamp() });
  });
}
