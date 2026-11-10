import "server-only";
import { FieldValue, type Firestore, Timestamp } from "firebase-admin/firestore";
import { UserError } from "@/lib/booking.server";
import { dateIn, formatBRL, todayIn } from "@/lib/datetime";
import { randomBytes } from "node:crypto";
import { BaixaInput, CaixaConfig, diaNoMes, EstornoInput, ehSinal, ehVinculado, FixaInput, ID_AVULSO, idDaBaixa, idDoEstorno, idDoPagamento, LancamentoInput, ValeInput, ehVale, mesDaComissao, mesDe, PagamentoInput } from "@/lib/financeiro";
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

/** Entrada ou saída avulsa. Com o id gerado na tela, reenviar (a resposta caiu, o dono tocou
 *  de novo) não duplica: o segundo envio encontra o primeiro e devolve o mesmo id. */
export async function lancar(db: Firestore, tenantId: string, l: LancamentoInput, quem: Quem, id?: string) {
  await exigeCaixa(db, tenantId);
  if (id !== undefined && !ID_AVULSO.test(id)) throw new UserError("Lançamento inválido.");
  const ref = id ? col(db, tenantId).doc(id) : col(db, tenantId).doc();
  // o Admin SDK recusa campo undefined: descrição vazia não vai
  const { descricao, ...resto } = l;
  try {
    await ref.create({ ...resto, ...(descricao && { descricao }), mes: mesDe(l.data), criadoPor: quem.email ?? quem.uid, criadoEm: FieldValue.serverTimestamp() });
  } catch (e) {
    // 6 = ALREADY_EXISTS: o mesmo lançamento chegou duas vezes
    if (!(id && (e as { code?: number }).code === 6)) throw e;
  }
  return ref.id;
}

/** Corrige valor, categoria, forma, data ou descrição. O vínculo com a agenda fica. */
export async function editar(db: Firestore, tenantId: string, id: string, l: LancamentoInput, quem: Quem) {
  await exigeCaixa(db, tenantId);
  const ref = col(db, tenantId).doc(id);
  await db.runTransaction(async (tx) => {
    const [atual, estorno] = await Promise.all([tx.get(ref), tx.get(col(db, tenantId).doc(idDoEstorno(id)))]);
    if (!atual.exists) throw new UserError("Lançamento não encontrado.");
    // comissão paga: o valor é a conta do mês (pagar confere); aqui só forma e descrição. Inclui o R$ 0 todo abatido
    if (id.startsWith("cm-") && l.valorCents !== Number(atual.get("valorCents"))) throw new UserError("O valor de uma comissão paga não muda. Para corrigir, apague o pagamento e pague de novo.");
    if (!l.valorCents && !id.startsWith("cm-")) throw new UserError("Informe o valor.");
    // entrada estornada continua entrada, e não fica menor que o que já foi devolvido
    if (estorno.exists && l.tipo !== "entrada") throw new UserError("Este recebimento tem estorno: continua entrada.");
    if (estorno.exists && l.valorCents < Number(estorno.get("valorCents"))) throw new UserError(`Já foram estornados ${formatBRL(Number(estorno.get("valorCents")))}: o recebimento não fica menor que isso.`);
    // a baixa e o sinal de um atendimento continuam entrada: virar saída quebraria o "fechar o dia"
    const daAgenda = !!atual.get("appointmentId") || ehSinal(id);
    if (daAgenda && l.tipo !== "entrada") throw new UserError("O recebimento de um atendimento é sempre entrada.");
    // conta fixa, comissão e estorno continuam saída
    const pagamento = ehVinculado(id);
    if (pagamento && l.tipo !== "saida") throw new UserError("Um pagamento é sempre saída.");
    // estorno não devolve mais do que entrou
    if (atual.get("estornoDe")) {
      const origem = await tx.get(col(db, tenantId).doc(String(atual.get("estornoDe"))));
      if (origem.exists && l.valorCents > Number(origem.get("valorCents"))) throw new UserError("O estorno não pode passar do valor recebido.");
    }
    // sinal corrigido: o agendamento guarda o mesmo valor, é dele que sai o restante a cobrar no balcão
    const agDoSinal = ehSinal(id) ? db.doc(`tenants/${tenantId}/appointments/${id.slice(3)}`) : null;
    if (agDoSinal && l.valorCents !== Number(atual.get("valorCents"))) {
      const [ag, baixaDoAg] = await Promise.all([tx.get(agDoSinal), tx.get(col(db, tenantId).doc(idDaBaixa(id.slice(3))))]);
      if (baixaDoAg.exists) throw new UserError("Este atendimento já foi recebido. Para corrigir o sinal, apague o recebimento antes.");
      if (!ag.exists || ag.get("sinal.status") !== "pago") throw new UserError("O agendamento deste sinal não foi encontrado.");
    }
    const ajuste = await ajusteDaComissaoPaga(tx, db, tenantId, atual, l.valorCents);
    // estorno corrigido: o desconto da comissão acompanha, pelo % do dia do estorno
    let desconto = {};
    if (ehVale(id) || (atual.get("estornoDe") && typeof atual.get("pctComissao") === "number")) {
      // vale: o desconto é o próprio valor; estorno: a comissão sobre ele, pelo % do dia
      const novo = ehVale(id) ? l.valorCents : Math.round((l.valorCents * Number(atual.get("pctComissao"))) / 100);
      descontar(tx, db, tenantId, atual.get("staffId"), novo - Number(atual.get("descontoComissao") ?? 0));
      desconto = { descontoComissao: novo };
    }
    aplicarAjuste(tx, db, tenantId, ajuste);
    if (agDoSinal && l.valorCents !== Number(atual.get("valorCents"))) tx.update(agDoSinal, { "sinal.cents": l.valorCents });
    // e todos ficam no dia de origem: noutro mês, a agenda e o Caixa deixariam de achá-los
    const data = daAgenda || pagamento ? String(atual.get("data")) : l.data;
    tx.update(ref, { ...l, ...desconto, data, descricao: l.descricao ?? FieldValue.delete(), mes: mesDe(data), editadoPor: quem.email ?? quem.uid, editadoEm: FieldValue.serverTimestamp() });
  });
}

/** Entrada com profissional cuja comissão do mês já foi paga: ao apagar (novo = 0) ou mudar o
 *  valor, a diferença da comissão vai para o desconto guardado, como num estorno (pelo % de hoje),
 *  e sai do próximo pagamento. Só lê: quem chama grava depois das leituras da transação. */
async function ajusteDaComissaoPaga(tx: FirebaseFirestore.Transaction, db: Firestore, tenantId: string, l: FirebaseFirestore.DocumentSnapshot, novo: number) {
  const mes = mesDaComissao({ id: l.id, mes: String(l.get("mes")), mesComissao: l.get("mesComissao") });
  if (l.get("tipo") !== "entrada" || !mes) return null;
  return ajusteNoMes(tx, db, tenantId, l.get("staffId"), mes, Number(l.get("valorCents")) || 0, novo);
}

/** O mesmo para quem cria uma entrada (antes = 0): o recebimento que cai num mês de comissão
 *  já paga fica devendo ao profissional (desconto negativo), e sai no próximo pagamento. */
export async function ajusteNoMes(tx: FirebaseFirestore.Transaction, db: Firestore, tenantId: string, staffId: unknown, mes: string, antes: number, novo: number) {
  if (typeof staffId !== "string" || !staffId || antes === novo) return null;
  const [pago, cfg] = await Promise.all([tx.get(col(db, tenantId).doc(idDoPagamento("comissao", staffId, mes))), tx.get(config(db, tenantId))]);
  if (!pago.exists) return null;
  // o % do dia do pagamento; pagamento antigo, sem ele gravado, usa o de hoje
  const comissoes = CaixaConfig.shape.comissoes.safeParse(cfg.get("comissoes"));
  const pct = typeof pago.get("pctComissao") === "number" ? Number(pago.get("pctComissao")) : comissoes.success ? (comissoes.data[staffId] ?? 0) : 0;
  // a diferença das comissões arredondadas: 100,00 → 100,01 → 100,00 volta a zero
  const centavos = Math.round((antes * pct) / 100) - Math.round((novo * pct) / 100);
  return centavos ? { staffId, centavos, pago: pago.ref } : null;
}

/** Grava o ajuste lido antes: no desconto guardado e no próprio pagamento, que ao ser apagado o desfaz. */
export function aplicarAjuste(tx: FirebaseFirestore.Transaction, db: Firestore, tenantId: string, ajuste: Awaited<ReturnType<typeof ajusteNoMes>>) {
  if (!ajuste) return;
  descontar(tx, db, tenantId, ajuste.staffId, ajuste.centavos);
  tx.update(ajuste.pago, { ajusteCents: FieldValue.increment(ajuste.centavos) });
}

/** Apagar a baixa de um atendimento devolve ele ao "fechar o dia". */
export async function excluir(db: Firestore, tenantId: string, id: string) {
  await exigeCaixa(db, tenantId);
  // a entrada estornada não some sozinha: o estorno ficaria devolvendo um dinheiro que não entrou
  await db.runTransaction(async (tx) => {
    const [l, estorno, baixaDoSinal] = await Promise.all([
      tx.get(col(db, tenantId).doc(id)),
      tx.get(col(db, tenantId).doc(idDoEstorno(id))),
      ehSinal(id) ? tx.get(col(db, tenantId).doc(idDaBaixa(id.slice(3)))) : null,
    ]);
    if (estorno.exists) throw new UserError("Este recebimento tem estorno. Apague o estorno antes.");
    // depois da baixa, ninguém mais traria o sinal de volta: nem a confirmação nem a baixa
    if (baixaDoSinal?.exists) throw new UserError("Este sinal já faz parte de um atendimento recebido. Apague o recebimento do atendimento antes.");
    // apagar a baixa: o sinal do atendimento volta a não contar para a comissão (até receber de novo)
    const snDaBaixa = id.startsWith("ag-") ? await tx.get(col(db, tenantId).doc(`sn-${id.slice(3)}`)) : null;
    const sinalContava = snDaBaixa?.exists && snDaBaixa.get("mesComissao") ? Number(snDaBaixa.get("valorCents")) || 0 : 0;
    const ajuste = !l.exists
      ? null
      : sinalContava
        ? await ajusteNoMes(tx, db, tenantId, l.get("staffId"), String(l.get("mesComissao") ?? l.get("mes")), (Number(l.get("valorCents")) || 0) + sinalContava, 0)
        : await ajusteDaComissaoPaga(tx, db, tenantId, l, 0);
    // apagar o estorno tira o desconto dele; apagar o pagamento da comissão devolve o que ele abateu
    if (l.get("estornoDe") || ehVale(id)) descontar(tx, db, tenantId, l.get("staffId"), -Number(l.get("descontoComissao") ?? 0));
    // pagamento apagado: volta o que ele abateu e sai o ajuste dos recebimentos mexidos depois dele
    if (id.startsWith("cm-")) descontar(tx, db, tenantId, l.get("staffId"), Number(l.get("descontoCents") ?? 0) - Number(l.get("ajusteCents") ?? 0));
    aplicarAjuste(tx, db, tenantId, ajuste);
    if (sinalContava) tx.update(snDaBaixa!.ref, { mesComissao: FieldValue.delete() });
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
    const doSinal = ehSinal(e.lancamentoId) ? e.lancamentoId.slice(3) : null;
    const [o, ja, cfg, ag, baixaDoAg] = await Promise.all([
      tx.get(origem),
      tx.get(ref),
      tx.get(config(db, tenantId)),
      doSinal ? tx.get(db.doc(`tenants/${tenantId}/appointments/${doSinal}`)) : null,
      doSinal ? tx.get(col(db, tenantId).doc(idDaBaixa(doSinal))) : null,
    ]);
    if (!o.exists) throw new UserError("Lançamento não encontrado.");
    // comissão do mês da entrada já paga: o desconto sai pelo % com que ela foi paga
    const staffDaOrigem = o.get("staffId");
    const mesDaOrigem = mesDaComissao({ id: o.id, mes: String(o.get("mes")), mesComissao: o.get("mesComissao") });
    const pagoDaOrigem = typeof staffDaOrigem === "string" && staffDaOrigem && mesDaOrigem ? await tx.get(col(db, tenantId).doc(idDoPagamento("comissao", staffDaOrigem, mesDaOrigem))) : null;
    // sinal devolvido com o horário de pé: a baixa continuaria descontando um sinal que voltou ao cliente
    if (ag?.exists && !baixaDoAg?.exists && ["booked", "confirmed"].includes(ag.get("status"))) throw new UserError("O horário deste sinal continua marcado. Cancele o agendamento antes de devolver o sinal.");
    if (o.get("tipo") !== "entrada") throw new UserError("Só dá para estornar uma entrada.");
    if (ja.exists) throw new UserError("Este recebimento já foi estornado.");
    if (e.valorCents > Number(o.get("valorCents"))) throw new UserError("O estorno não pode passar do valor recebido.");
    const hoje = todayIn();
    const staffId = o.get("staffId");
    // só o % importa aqui: uma conta fixa fora do esquema não trava o estorno
    const comissoes = CaixaConfig.shape.comissoes.safeParse(cfg.get("comissoes"));
    const pctPago = pagoDaOrigem?.exists && typeof pagoDaOrigem.get("pctComissao") === "number" ? Number(pagoDaOrigem.get("pctComissao")) : null;
    const pct = typeof staffId === "string" ? (pctPago ?? (comissoes.success ? (comissoes.data[staffId] ?? 0) : 0)) : 0;
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

/** "Recebi": a entrada nasce do atendimento, com o valor, o profissional e o cliente dele.
 *  Recebido é atendido: o que ainda aguardava confirmação fica confirmado, com registro no histórico. */
export async function baixarAgendamento(db: Firestore, tenantId: string, b: z.infer<typeof BaixaInput>, quem: Quem) {
  await exigeCaixa(db, tenantId);
  const agendamento = db.doc(`tenants/${tenantId}/appointments/${b.appointmentId}`);
  const baixa = col(db, tenantId).doc(idDaBaixa(b.appointmentId));
  const doSinal = col(db, tenantId).doc(`sn-${b.appointmentId}`);
  await db.runTransaction(async (tx) => {
    const [a, ja, sn] = await Promise.all([tx.get(agendamento), tx.get(baixa), tx.get(doSinal)]);
    if (!a.exists) throw new UserError("Agendamento não encontrado.");
    if (ja.exists) throw new UserError("Este atendimento já foi recebido.");
    if (!["booked", "confirmed"].includes(a.get("status"))) throw new UserError("Só dá para receber um atendimento que aconteceu.");
    if (!(a.get("start") instanceof Timestamp)) throw new UserError("Agendamento inválido.");
    const start = (a.get("start") as Timestamp).toDate();
    // o mesmo relógio da agenda e do Caixa (start.toMillis() <= agora): o que o painel oferece, o servidor aceita
    if (start.getTime() > Date.now()) throw new UserError("Este atendimento ainda não começou.");
    const data = dateIn(start);
    // O sinal pago sai do que se cobra no balcão. Se ele não está no Caixa (confirmado com o
    // Caixa desligado, ou o lançamento dele foi apagado), entra aqui junto, senão some das contas.
    const sinalPago = a.get("sinal.status") === "pago" ? Number(a.get("sinal.cents")) || 0 : 0;
    // a tela abriu antes de o sinal ser confirmado: o valor dela ainda inclui o sinal
    if ((b.sinalCents ?? 0) !== sinalPago) throw new UserError("O sinal deste atendimento mudou enquanto a tela estava aberta. Feche e abra de novo para ver o valor certo.");
    const sinalFora = sn.exists ? 0 : sinalPago;
    // comissão do mês já paga: o que entra agora fica devendo ao profissional (lido antes de gravar)
    // o atendimento inteiro (restante + sinal) conta no mês do recebimento
    const ajuste = await ajusteNoMes(tx, db, tenantId, a.get("staffId"), mesDe(data), 0, b.valorCents + sinalPago);
    const ligado = { staffId: a.get("staffId") ?? null, staffName: a.get("staffName") ?? null, customerKey: a.get("customerKey") ?? null, customerName: a.get("customerName") ?? null };
    // sem WhatsApp ao cliente: o atendimento já aconteceu, só a agenda fica em dia
    if (a.get("status") === "booked") {
      const historico = db.collection(`tenants/${tenantId}/history`).doc();
      tx.create(historico, { appointmentId: b.appointmentId, type: "confirmed", reason: "caixa_recebido", at: FieldValue.serverTimestamp(), by: quem.uid, byName: quem.email ?? null });
      tx.update(agendamento, { status: "confirmed", lastHistoryId: historico.id });
    }
    // o sinal foi por Pix: junto da baixa, "por forma" diria que entrou tudo na forma do balcão
    aplicarAjuste(tx, db, tenantId, ajuste);
    // recebido: o sinal passa a contar para a comissão, no mês do recebimento
    if (sn.exists) tx.update(doSinal, { mesComissao: mesDe(data) });
    if (sinalFora) tx.create(doSinal, { tipo: "entrada", valorCents: sinalFora, forma: "pix", categoria: "Atendimento", descricao: `Sinal · ${String(a.get("serviceName") ?? "")}`.slice(0, 80), data, mes: mesDe(data), mesComissao: mesDe(data), ...ligado, criadoPor: quem.email ?? quem.uid, criadoEm: FieldValue.serverTimestamp() });
    tx.create(baixa, {
      tipo: "entrada",
      valorCents: b.valorCents,
      forma: b.forma,
      categoria: "Atendimento",
      descricao: String(a.get("serviceName") ?? "").slice(0, 80),
      data,
      mes: mesDe(data),
      appointmentId: b.appointmentId,
      mesComissao: mesDe(data),
      ...ligado,
      criadoPor: quem.email ?? quem.uid,
      criadoEm: FieldValue.serverTimestamp(),
    });
  });
}


// Contas fixas e comissões mudam uma de cada vez, lidas e gravadas aqui: o painel nunca
// manda a configuração inteira, senão uma tela desatualizada apagaria o que outra gravou.
const configDe = (dados: unknown) => {
  const c = CaixaConfig.safeParse(dados ?? {});
  if (!c.success) throw new UserError("A configuração do Caixa está com um erro. Fale com o suporte.");
  return c.data;
};
const lerConfig = async (tx: FirebaseFirestore.Transaction, db: Firestore, tenantId: string) => configDe((await tx.get(config(db, tenantId))).data());

export async function adicionarFixa(db: Firestore, tenantId: string, f: z.infer<typeof FixaInput>) {
  await exigeCaixa(db, tenantId);
  await db.runTransaction(async (tx) => {
    const c = await lerConfig(tx, db, tenantId);
    if (c.fixas.filter((x) => !x.ate).length >= 30) throw new UserError("No máximo 30 contas fixas.");
    const fixa = { ...f, id: randomBytes(6).toString("hex"), desde: mesDe(todayIn()) };
    tx.set(config(db, tenantId), { fixas: [...c.fixas, fixa] }, { merge: true });
  });
}

export async function removerFixa(db: Firestore, tenantId: string, fixaId: string) {
  await exigeCaixa(db, tenantId);
  await db.runTransaction(async (tx) => {
    const c = await lerConfig(tx, db, tenantId);
    // some do próximo mês em diante: a deste mês (paga ou a pagar) e as de antes continuam.
    // Já tirada, fica como está: tirar de novo noutro mês reabriria o mês do meio
    const [ano, m] = mesDe(todayIn()).split("-").map(Number);
    const proximo = `${m === 12 ? ano + 1 : ano}-${String((m % 12) + 1).padStart(2, "0")}`;
    tx.set(config(db, tenantId), { fixas: c.fixas.map((f) => (f.id !== fixaId || f.ate ? f : { ...f, ate: proximo })) }, { merge: true });
  });
}

/** Corrige nome, valor, dia ou categoria sem trocar o id: o que já foi pago continua pago. */
export async function editarFixa(db: Firestore, tenantId: string, fixaId: string, f: z.infer<typeof FixaInput>) {
  await exigeCaixa(db, tenantId);
  await db.runTransaction(async (tx) => {
    const c = await lerConfig(tx, db, tenantId);
    if (!c.fixas.some((x) => x.id === fixaId && !x.ate)) throw new UserError("Conta fixa não encontrada.");
    tx.set(config(db, tenantId), { fixas: c.fixas.map((x) => (x.id === fixaId ? { ...x, ...f } : x)) }, { merge: true });
  });
}

export async function definirComissao(db: Firestore, tenantId: string, staffId: string, pct: number) {
  await exigeCaixa(db, tenantId);
  await config(db, tenantId).set({ comissoes: { [staffId]: pct } }, { merge: true });
}

/** Vale: saída de hoje com o profissional, e o valor entra no desconto guardado dele, como um
 *  estorno: sai do próximo pagamento de comissão, e o que não couber nele passa para o seguinte. */
export async function darVale(db: Firestore, tenantId: string, v: z.infer<typeof ValeInput>, quem: Quem) {
  await exigeCaixa(db, tenantId);
  const ref = col(db, tenantId).doc(v.id);
  return db.runTransaction(async (tx) => {
    const [ja, staff] = await Promise.all([tx.get(ref), tx.get(db.doc(`tenants/${tenantId}/staff/${v.staffId}`))]);
    const nome = String(staff.get("name") ?? "").slice(0, 60);
    // o mesmo vale chegou duas vezes (a resposta caiu): o primeiro vale, o e-mail não repete
    if (ja.exists) return { nome, data: String(ja.get("data")), novo: false };
    if (!staff.exists) throw new UserError("Profissional não encontrado.");
    const hoje = todayIn();
    descontar(tx, db, tenantId, v.staffId, v.valorCents);
    tx.create(ref, {
      tipo: "saida", valorCents: v.valorCents, forma: v.forma, categoria: "Comissão/salário", descricao: `Vale ${nome}`.slice(0, 80),
      data: hoje, mes: mesDe(hoje), staffId: v.staffId, staffName: nome || null, descontoComissao: v.valorCents,
      emailConfirmacao: v.email, criadoPor: quem.email ?? quem.uid, criadoEm: FieldValue.serverTimestamp(),
    });
    return { nome, data: hoje, novo: true };
  });
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
    let pctComissao: number | undefined;
    if (p.tipo === "fixa") {
      const fixa = configDe(cfg.data()).fixas.find((f) => f.id === p.alvoId);
      if (!fixa) throw new UserError("Conta fixa não encontrada.");
      // a mesma regra da tela: antes de cadastrada, a conta não existia para pagar
      if (fixa.desde && p.mes < fixa.desde) throw new UserError("Esta conta ainda não existia neste mês.");
      if (fixa.ate && p.mes >= fixa.ate) throw new UserError("Esta conta foi tirada antes deste mês.");
      // paga adiantado, a saída cairia num mês que ainda não chegou e o "Sobrou" de hoje mentiria
      if (p.mes > mesDe(hoje)) throw new UserError("Esta conta é de um mês que ainda não chegou. Pague quando o mês começar.");
      campos = { categoria: fixa.categoria, descricao: fixa.nome, fixaId: fixa.id, data: mesDe(hoje) === p.mes ? hoje : diaNoMes(p.mes, fixa.dia) };
    } else {
      if (p.mes > mesDe(hoje)) throw new UserError("A comissão deste mês ainda não pode ser paga.");
      // quem saiu da equipe no meio do mês ainda recebe: basta ter atendido no mês
      // pelo mês da comissão: o sinal pago num mês e recebido no outro conta no do recebimento
      const [staff, doMes, comissaoNoMes] = await Promise.all([
        tx.get(db.doc(`tenants/${tenantId}/staff/${p.alvoId}`)),
        tx.get(col(db, tenantId).where("mes", "==", p.mes).where("staffId", "==", p.alvoId)),
        tx.get(col(db, tenantId).where("mesComissao", "==", p.mes).where("staffId", "==", p.alvoId)),
      ]);
      const docs = [...new Map([...doMes.docs, ...comissaoNoMes.docs].map((d) => [d.id, d])).values()];
      const atendeu = { empty: docs.length === 0, docs: docs.filter((d) => mesDaComissao({ id: d.id, mes: String(d.get("mes")), mesComissao: d.get("mesComissao") }) === p.mes) };
      // a comissão do mês refeita aqui: uma tela desatualizada não abate mais do que ela comporta
      const c = configDe(cfg.data());
      // sem atendimento no mês ainda pode haver acerto: estorno desfeito a devolver ao profissional
      if (!staff.exists && atendeu.empty && !(c.descontos[p.alvoId] ?? 0)) throw new UserError("Profissional não encontrado.");
      const faturado = atendeu.docs.reduce((t, d) => t + (d.get("tipo") === "entrada" ? Number(d.get("valorCents")) || 0 : 0), 0);
      pctComissao = c.comissoes[p.alvoId] ?? 0;
      bruto = Math.round((faturado * pctComissao) / 100);
      // abate o estorno guardado: nunca mais do que há para abater, nem que a comissão do mês, nem do lado errado
      const guardado = c.descontos[p.alvoId] ?? 0;
      abatido = Math.max(Math.min(0, guardado), Math.min(Math.max(0, Math.min(guardado, bruto)), p.descontoCents ?? 0));
      if ((p.descontoCents ?? 0) !== abatido) throw new UserError("O desconto de estorno mudou enquanto a tela estava aberta. Feche e abra de novo para ver o valor certo.");
      descontar(tx, db, tenantId, p.alvoId, -abatido);
      const nome = String(staff.get("name") ?? atendeu.docs[0]?.get("staffName") ?? "").slice(0, 60);
      campos = { categoria: "Comissão/salário", descricao: `Comissão ${nome}`.slice(0, 80), staffId: p.alvoId, staffName: nome || null, data: mesDe(hoje) === p.mes ? hoje : diaNoMes(p.mes, 31) };
    }
    if (p.tipo === "comissao") {
      // paga-se o que a conta dá, nem menos (o mês ficaria quitado com saldo em aberto) nem de uma
      // tela de antes de novos recebimentos. R$ 0 só quando o estorno abateu a comissão inteira
      const devido = bruto - abatido;
      if (!devido && abatido <= 0) throw new UserError("Não há comissão a pagar neste mês.");
      if (p.valorCents !== devido) throw new UserError(`A comissão deste mês é ${formatBRL(devido)}. Feche e abra de novo para ver o valor certo.`);
    } else if (!p.valorCents) throw new UserError("Informe o valor.");
    tx.create(ref, { tipo: "saida", valorCents: p.valorCents, forma: p.forma, ...campos, ...(abatido && { descontoCents: abatido }), ...(pctComissao !== undefined && { pctComissao }), mes: p.mes, criadoPor: quem.email ?? quem.uid, criadoEm: FieldValue.serverTimestamp() });
  });
}
