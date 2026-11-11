// Rode: npm run test:financeiro  (Caixa do negócio no emulador do Firestore)
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { addDays, todayIn, zonedTime } from "@/lib/datetime";
import { categorias, comissoesDoMes, csvDoMes, diaNoMes, pctDoTexto, idDaBaixa, idDoEstorno, idDoPagamento, fixaNoMes, LancamentoInput, mesDaComissao, resumoDoMes } from "@/lib/financeiro";
import { adicionarFixa, editarFixa, baixarAgendamento, darVale, definirComissao, editar, estornar, excluir, lancar, pagar, removerFixa } from "@/lib/financeiro.server";

const db = getFirestore(initializeApp({ projectId: "demo-siteflow" }));
const quem = { uid: "dona", email: "dona@teste.dev" };
const hoje = todayIn();

// categorias: as do nicho primeiro, as comuns depois, sem repetir
assert.deepEqual(categorias("entrada", "aulas").slice(0, 3), ["Mensalidade", "Matrícula", "Atendimento"]);
assert.equal(categorias("saida", "pet")[0], "Estoque de ração");
assert.deepEqual(categorias("entrada"), ["Atendimento", "Produto", "Pacote/mensalidade", "Outro"], "sem nicho, só as comuns");

// os três números
const r = resumoDoMes([
  { tipo: "entrada", valorCents: 5000, categoria: "Atendimento", forma: "pix", staffName: "Bia" },
  { tipo: "entrada", valorCents: 3000, categoria: "Produto", forma: "dinheiro" },
  { tipo: "saida", valorCents: 9000, categoria: "Aluguel", forma: "pix" },
]);
assert.deepEqual([r.entrou, r.saiu, r.sobrou], [8000, 9000, -1000]);
assert.deepEqual(r.porForma, [["Pix", 5000], ["Dinheiro", 3000]], "por forma conta só entradas");
assert.deepEqual(r.porProfissional, [["Bia", 5000]]);

// sem o campo legado do módulo: o Caixa grava normalmente
await db.doc("tenants/salao").set({ name: "Salão", ownerId: "dona", site: { uf: "SP" } });
const entrada = { tipo: "entrada" as const, valorCents: 4500, data: hoje, categoria: "Produto", forma: "pix" as const };
const semModulo = await lancar(db, "salao", entrada, quem);
assert.equal((await db.doc(`tenants/salao/lancamentos/${semModulo}`).get()).get("valorCents"), 4500);
await excluir(db, "salao", semModulo);

await db.doc("tenants/salao").update({ "modulos.financeiro": true });
const id = await lancar(db, "salao", entrada, quem);
const l = (await db.doc(`tenants/salao/lancamentos/${id}`).get()).data()!;
assert.deepEqual([l.valorCents, l.mes, l.criadoPor], [4500, hoje.slice(0, 7), "dona@teste.dev"]);
await editar(db, "salao", id, { ...entrada, valorCents: 5500, descricao: "Shampoo" }, quem);
assert.equal((await db.doc(`tenants/salao/lancamentos/${id}`).get()).get("valorCents"), 5500);
await excluir(db, "salao", id);
assert.equal((await db.doc(`tenants/salao/lancamentos/${id}`).get()).exists, false);

// baixa de atendimento: só o que já começou e ainda está ativo, uma vez só
const ag = (id: string, start: Date, status = "confirmed") =>
  db.doc(`tenants/salao/appointments/${id}`).set({ status, start, serviceName: "Corte", priceCents: 4000, staffId: "bia", staffName: "Bia", customerKey: "5511999990000", customerName: "Ana" });
await ag("passado", zonedTime(addDays(hoje, -1), "10:00"));
await ag("futuro", zonedTime(addDays(hoje, 1), "10:00"));
await ag("cancelado", zonedTime(addDays(hoje, -1), "11:00"), "cancelled");

await baixarAgendamento(db, "salao", { appointmentId: "passado", valorCents: 4000, forma: "cartao" }, quem);
const b = (await db.doc(`tenants/salao/lancamentos/${idDaBaixa("passado")}`).get()).data()!;
assert.deepEqual([b.tipo, b.categoria, b.staffName, b.customerName, b.data, b.forma], ["entrada", "Atendimento", "Bia", "Ana", addDays(hoje, -1), "cartao"]);
await assert.rejects(baixarAgendamento(db, "salao", { appointmentId: "passado", valorCents: 4000, forma: "pix" }, quem), /já foi recebido/, "o segundo toque não duplica");
// recebido é atendido: o que aguardava confirmação fica confirmado, com o registro no histórico
await ag("aguardando", zonedTime(addDays(hoje, -1), "12:00"), "booked");
await baixarAgendamento(db, "salao", { appointmentId: "aguardando", valorCents: 4000, forma: "pix" }, quem);
const confirmado = await db.doc("tenants/salao/appointments/aguardando").get();
const registro = (await db.doc(`tenants/salao/history/${confirmado.get("lastHistoryId")}`).get()).data()!;
assert.deepEqual([confirmado.get("status"), registro.type, registro.reason, registro.appointmentId, registro.by], ["confirmed", "confirmed", "caixa_recebido", "aguardando", "dona"]);
await db.doc(`tenants/salao/lancamentos/${idDaBaixa("aguardando")}`).delete();
await assert.rejects(baixarAgendamento(db, "salao", { appointmentId: "futuro", valorCents: 4000, forma: "pix" }, quem), /ainda não começou/);
await assert.rejects(baixarAgendamento(db, "salao", { appointmentId: "cancelado", valorCents: 4000, forma: "pix" }, quem), /aconteceu/);
await assert.rejects(editar(db, "salao", idDaBaixa("passado"), { ...entrada, tipo: "saida" }, quem), /sempre entrada/);
// corrigir o valor do recebimento não tira ele do dia do atendimento
await editar(db, "salao", idDaBaixa("passado"), { ...entrada, valorCents: 4200, data: "2020-01-01" }, quem);
const corrigida = (await db.doc(`tenants/salao/lancamentos/${idDaBaixa("passado")}`).get()).data()!;
assert.deepEqual([corrigida.valorCents, corrigida.data, corrigida.mes], [4200, addDays(hoje, -1), addDays(hoje, -1).slice(0, 7)]);

// fase 2, sem banco: dia da conta no mês, comissão e planilha
assert.deepEqual(["40,5", "30", " 12.25 ", "10%", "", "abc", "150", "-3"].map(pctDoTexto), [40.5, 30, 12.25, 10, null, null, 100, 0], "vírgula e % valem; vazio e texto não gravam");
assert.equal(diaNoMes("2026-02", 31), "2026-02-28");
assert.equal(diaNoMes("2028-02", 30), "2028-02-29");
assert.equal(diaNoMes("2026-10", 5), "2026-10-05");
const cs = comissoesDoMes(
  [
    { tipo: "entrada", valorCents: 10000, staffId: "bia", staffName: "Bia" },
    { tipo: "entrada", valorCents: 5050, staffId: "bia", staffName: "Bia" },
    { tipo: "entrada", valorCents: 2000, staffId: "leo", staffName: "Léo" },
    { tipo: "entrada", valorCents: 9999 },
    { tipo: "saida", valorCents: 3000, staffId: "bia", staffName: "Bia" },
  ],
  { bia: 40 },
);
assert.deepEqual(cs.map((c) => [c.staffId, c.faturado, c.pct, c.valor]), [["bia", 15050, 40, 6020], ["leo", 2000, 0, 0]], "só entradas com profissional; sem % não paga");
const csv = csvDoMes([
  { data: "2026-10-02", tipo: "saida", categoria: "Aluguel", descricao: "Sala; 2º andar", forma: "pix", valorCents: 120000 },
  { data: "2026-10-01", tipo: "entrada", categoria: "Atendimento", descricao: "=HYPERLINK()", customerName: "Ana", staffName: "Bia", forma: "cartao", valorCents: 4550 },
]).split("\r\n");
assert.equal(csv[0], "Data;Tipo;Categoria;Descrição;Cliente;Profissional;Forma;Valor");
assert.equal(csv[1], "01/10/2026;Entrada;Atendimento;'=HYPERLINK();Ana;Bia;Cartão;45,50", "por data; fórmula vira texto");
assert.equal(csv[2], '02/10/2026;Saída;Aluguel;"Sala; 2º andar";;;Pix;-1200,00');

// conta fixa paga uma vez por mês; comissão também
const mes = hoje.slice(0, 7);
await assert.rejects(pagar(db, "salao", { tipo: "fixa", alvoId: "naoexiste", mes, valorCents: 120000, forma: "pix" }, quem), /não encontrada/);
// uma mudança por vez: a comissão de um não apaga as contas nem a comissão do outro
await adicionarFixa(db, "salao", { nome: "Aluguel", valorCents: 120000, dia: 5, categoria: "Aluguel" });
await adicionarFixa(db, "salao", { nome: "Internet", valorCents: 9990, dia: 10, categoria: "Contas (luz, água, internet)" });
await definirComissao(db, "salao", "bia", 40);
await definirComissao(db, "salao", "leo", 30);
const cfg = (await db.doc("tenants/salao/caixa/config").get()).data()!;
assert.deepEqual([cfg.fixas.map((f: { nome: string }) => f.nome), cfg.comissoes], [["Aluguel", "Internet"], { bia: 40, leo: 30 }]);
assert.equal(cfg.fixas[0].desde, mes, "a conta nasce no mês em que foi criada");
const aluguel = cfg.fixas[0].id as string;
await removerFixa(db, "salao", cfg.fixas[1].id);
assert.equal((await db.doc("tenants/salao/caixa/config").get()).get("fixas").filter((f: { ate?: string }) => !f.ate).length, 1, "tirada fica só até este mês");
assert.deepEqual((await db.doc("tenants/salao/caixa/config").get()).get("comissoes"), { bia: 40, leo: 30 }, "tirar conta não mexe na comissão");
await pagar(db, "salao", { tipo: "fixa", alvoId: aluguel, mes, valorCents: 119000, forma: "pix" }, quem);
const fx = (await db.doc(`tenants/salao/lancamentos/${idDoPagamento("fixa", aluguel, mes)}`).get()).data()!;
assert.deepEqual([fx.tipo, fx.valorCents, fx.categoria, fx.descricao, fx.mes, fx.data], ["saida", 119000, "Aluguel", "Aluguel", mes, hoje]);
await assert.rejects(pagar(db, "salao", { tipo: "fixa", alvoId: aluguel, mes, valorCents: 120000, forma: "pix" }, quem), /já foi paga/);
await assert.rejects(editar(db, "salao", idDoPagamento("fixa", aluguel, mes), { ...entrada, tipo: "entrada" }, quem), /sempre saída/);
// antes de cadastrada, a conta não se paga
await assert.rejects(pagar(db, "salao", { tipo: "fixa", alvoId: aluguel, mes: "2026-02", valorCents: 120000, forma: "pix" }, quem), /ainda não existia/);
// conta de um mês passado cai no dia dela (cadastrada antes daquele mês)
await db.doc("tenants/salao/caixa/config").update({ fixas: (await db.doc("tenants/salao/caixa/config").get()).get("fixas").map((f: object) => ({ ...f, desde: "2026-01" })) });
await pagar(db, "salao", { tipo: "fixa", alvoId: aluguel, mes: "2026-02", valorCents: 120000, forma: "pix" }, quem);
assert.equal((await db.doc(`tenants/salao/lancamentos/${idDoPagamento("fixa", aluguel, "2026-02")}`).get()).get("data"), "2026-02-05");
// editar a conta (o aluguel subiu) mantém o id: o mês já pago continua pago
await editarFixa(db, "salao", aluguel, { nome: "Aluguel", valorCents: 150000, dia: 5, categoria: "Aluguel" });
const editada = (await db.doc("tenants/salao/caixa/config").get()).get("fixas")[0];
assert.deepEqual([editada.id, editada.valorCents, editada.desde], [aluguel, 150000, "2026-01"]);
// mês que ainda não chegou não se paga
const proximo = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 15)).toISOString().slice(0, 7);
await assert.rejects(pagar(db, "salao", { tipo: "fixa", alvoId: aluguel, mes: proximo, valorCents: 150000, forma: "pix" }, quem), /ainda não chegou/);
// tirar: some deste mês em diante, os meses de antes continuam
await removerFixa(db, "salao", aluguel);
const tirada = (await db.doc("tenants/salao/caixa/config").get()).get("fixas")[0];
assert.deepEqual([tirada.id, tirada.ate], [aluguel, proximo], "a deste mês continua a pagar");
await removerFixa(db, "salao", aluguel);
assert.equal((await db.doc("tenants/salao/caixa/config").get()).get("fixas")[0].ate, proximo, "tirar de novo não mexe");
await pagar(db, "salao", { tipo: "fixa", alvoId: aluguel, mes: "2026-03", valorCents: 120000, forma: "pix" }, quem);
await assert.rejects(editarFixa(db, "salao", aluguel, { nome: "x", valorCents: 1, dia: 1, categoria: "Aluguel" }), /não encontrada/);
assert.equal(fixaNoMes(tirada, "2026-03"), true);
assert.equal(fixaNoMes(tirada, mes), true);
assert.equal(fixaNoMes(tirada, proximo), false);
await assert.rejects(pagar(db, "salao", { tipo: "comissao", alvoId: "ninguem", mes, valorCents: 1680, forma: "pix" }, quem), /Profissional não encontrado/);
// a Bia saiu da equipe (sem staff/bia), mas atendeu no mês: a comissão sai com o nome da baixa
const mesBia = addDays(hoje, -1).slice(0, 7); // o mês do atendimento "passado"
await pagar(db, "salao", { tipo: "comissao", alvoId: "bia", mes: mesBia, valorCents: 1680, forma: "dinheiro" }, quem);
const cm = (await db.doc(`tenants/salao/lancamentos/${idDoPagamento("comissao", "bia", mesBia)}`).get()).data()!;
assert.deepEqual([cm.tipo, cm.categoria, cm.descricao, cm.staffId, cm.staffName], ["saida", "Comissão/salário", "Comissão Bia", "bia", "Bia"], "o nome vai para a coluna Profissional da planilha");
assert.equal(typeof cm.pctComissao, "number", "o % do pagamento fica gravado para os ajustes de depois");
await assert.rejects(pagar(db, "salao", { tipo: "comissao", alvoId: "bia", mes: mesBia, valorCents: 1680, forma: "pix" }, quem), /já foi paga/);
// comissão paga: editar não troca o valor (só forma e descrição); o mesmo valor passa
await assert.rejects(editar(db, "salao", idDoPagamento("comissao", "bia", mesBia), { tipo: "saida", valorCents: 9999, data: hoje, categoria: "Comissão/salário", forma: "pix" }, quem), /não muda/);
await editar(db, "salao", idDoPagamento("comissao", "bia", mesBia), { tipo: "saida", valorCents: 1680, data: hoje, categoria: "Comissão/salário", forma: "pix", descricao: "Comissão Bia (pix)" }, quem);
assert.equal((await db.doc(`tenants/salao/lancamentos/${idDoPagamento("comissao", "bia", mesBia)}`).get()).get("forma"), "pix");

// estorno: saída de hoje ligada à entrada, com o profissional dela, uma vez só e até o valor recebido
const recebido = idDaBaixa("passado"); // R$ 42,00, da Bia, cliente Ana
const es = idDoEstorno(recebido);
await assert.rejects(estornar(db, "salao", { lancamentoId: recebido, valorCents: 4201, forma: "pix" }, quem), /não pode passar/);
await estornar(db, "salao", { lancamentoId: recebido, valorCents: 1200, forma: "pix" }, quem);
const e = (await db.doc(`tenants/salao/lancamentos/${es}`).get()).data()!;
assert.deepEqual([e.tipo, e.valorCents, e.categoria, e.descricao, e.data, e.mes, e.estornoDe, e.staffId, e.staffName, e.customerName], ["saida", 1200, "Estorno", "Estorno Ana", hoje, hoje.slice(0, 7), recebido, "bia", "Bia", "Ana"]);
await assert.rejects(estornar(db, "salao", { lancamentoId: recebido, valorCents: 100, forma: "pix" }, quem), /já foi estornado/, "o segundo toque não devolve de novo");
await assert.rejects(estornar(db, "salao", { lancamentoId: es, valorCents: 100, forma: "pix" }, quem), /Só dá para estornar uma entrada/);
await assert.rejects(estornar(db, "salao", { lancamentoId: "naoexiste", valorCents: 100, forma: "pix" }, quem), /não encontrado/);
await assert.rejects(excluir(db, "salao", recebido), /tem estorno/, "a entrada estornada não some deixando o estorno órfão");
await assert.rejects(editar(db, "salao", es, { ...entrada, tipo: "saida", valorCents: 5000 }, quem), /não pode passar/);
await assert.rejects(editar(db, "salao", es, { ...entrada, tipo: "entrada" }, quem), /sempre saída/);
await assert.rejects(editar(db, "salao", recebido, { ...entrada, valorCents: 1000 }, quem), /não fica menor/, "a entrada não fica abaixo do estornado");
await editar(db, "salao", es, { ...entrada, tipo: "saida", valorCents: 4200, categoria: "Estorno", data: "2020-01-01" }, quem);
assert.deepEqual(Object.values((({ valorCents, data }) => ({ valorCents, data }))((await db.doc(`tenants/salao/lancamentos/${es}`).get()).data()!)), [4200, hoje], "estorno corrigido fica no dia dele");
// a comissão sobre o estornado (pelo % do dia) fica guardada para abater; corrigir o estorno acompanha
const descontoBia = async () => (await db.doc("tenants/salao/caixa/config").get()).get("descontos.bia");
assert.deepEqual([e.pctComissao, e.descontoComissao], [40, 480]);
assert.equal(await descontoBia(), 1680, "1200 viraram 4200: 40% de 4200");
// o faturamento por profissional desconta o estorno; a comissão abate o guardado até zerar, e o resto fica
const ce = comissoesDoMes(
  [
    { tipo: "entrada", valorCents: 10000, staffId: "bia", staffName: "Bia" },
    { tipo: "saida", valorCents: 3000, staffId: "bia", staffName: "Bia" },
    { tipo: "entrada", valorCents: 2000, staffId: "leo", staffName: "Léo" },
    { tipo: "entrada", valorCents: 1000, staffId: "ana", staffName: "Ana" },
  ],
  { bia: 40, leo: 50, ana: 10 },
  { bia: 1500, leo: 3000, ana: -500 },
);
assert.deepEqual(ce.map((c) => [c.staffId, c.bruto, c.abatido, c.valor]), [["bia", 4000, 1500, 2500], ["leo", 1000, 1000, 0], ["ana", 100, -500, 600]]);
// crédito sem atendimento no mês (saiu da equipe): a linha aparece para pagar
assert.deepEqual(comissoesDoMes([], { rui: 30 }, { rui: -5000, bia: 300 }, { rui: "Rui" }).map((c) => [c.staffId, c.nome, c.valor]), [["rui", "Rui", 5000]]);
assert.deepEqual(
  resumoDoMes([
    { tipo: "entrada", valorCents: 10000, categoria: "Atendimento", forma: "pix", staffName: "Bia" },
    { tipo: "saida", valorCents: 3000, categoria: "Estorno", forma: "pix", staffName: "Bia", estornoDe: "ag-x" },
  ]).porProfissional,
  [["Bia", 7000]],
);
// por id: duas "Ana" ficam separadas, a renomeada fica uma linha com o nome novo; por forma sem estorno
const rp = resumoDoMes([
  { tipo: "entrada", valorCents: 1000, categoria: "Atendimento", forma: "pix", staffId: "a1", staffName: "Ana", data: "2026-11-01" },
  { tipo: "entrada", valorCents: 2000, categoria: "Atendimento", forma: "pix", staffId: "a2", staffName: "Ana", data: "2026-11-01" },
  { tipo: "entrada", valorCents: 3000, categoria: "Atendimento", forma: "dinheiro", staffId: "b1", staffName: "Bia", data: "2026-11-01" },
  { tipo: "entrada", valorCents: 4000, categoria: "Atendimento", forma: "dinheiro", staffId: "b1", staffName: "Beatriz", data: "2026-11-20" },
  { tipo: "saida", valorCents: 500, categoria: "Estorno", forma: "pix", staffId: "a1", staffName: "Ana", estornoDe: "x", data: "2026-11-21" },
]);
assert.deepEqual(rp.porProfissional, [["Beatriz", 7000], ["Ana", 2000], ["Ana", 500]]);
assert.deepEqual(rp.porForma, [["Dinheiro", 7000], ["Pix", 2500]]);
// pagar a comissão abate o guardado, nunca mais do que há; R$ 0 só quando o estorno zerou a comissão
await db.doc("tenants/salao/staff/bia").set({ name: "Bia" });
// atendimentos da Bia: 2025-01 rende R$ 10 de comissão (40% de 25), 2025-03 rende R$ 20
const atendimento = (id: string, mes: string, valorCents: number) =>
  db.doc(`tenants/salao/lancamentos/${id}`).set({ tipo: "entrada", valorCents, mes, data: `${mes}-10`, categoria: "Atendimento", forma: "pix", staffId: "bia", staffName: "Bia" });
await atendimento("t1", "2025-01", 2500);
await atendimento("t3", "2025-03", 5000);
await assert.rejects(pagar(db, "salao", { tipo: "comissao", alvoId: "bia", mes: "2025-02", valorCents: 0, forma: "pix" }, quem), /Não há comissão a pagar/);
await pagar(db, "salao", { tipo: "comissao", alvoId: "bia", mes: "2025-01", valorCents: 0, forma: "pix", descontoCents: 1000 }, quem);
assert.equal((await db.doc(`tenants/salao/lancamentos/${idDoPagamento("comissao", "bia", "2025-01")}`).get()).get("descontoCents"), 1000);
assert.equal(await descontoBia(), 680, "o resto fica para o próximo");
// o pagamento de R$ 0 (todo abatido) ainda se corrige; outro lançamento não fica com R$ 0
await editar(db, "salao", idDoPagamento("comissao", "bia", "2025-01"), { tipo: "saida", valorCents: 0, data: "2025-01-31", categoria: "Comissão/salário", forma: "dinheiro" }, quem);
assert.equal((await db.doc(`tenants/salao/lancamentos/${idDoPagamento("comissao", "bia", "2025-01")}`).get()).get("forma"), "dinheiro");
await assert.rejects(editar(db, "salao", "t1", { tipo: "entrada", valorCents: 0, data: "2025-01-10", categoria: "Atendimento", forma: "pix" }, quem), /Informe o valor/);
await assert.rejects(pagar(db, "salao", { tipo: "comissao", alvoId: "bia", mes: "2025-03", valorCents: 0, forma: "pix", descontoCents: 680 }, quem), /comissão deste mês é R\$\s?13,20/, "R$ 0 só quando o estorno cobre a comissão toda");
// pagar a menos não quita o mês: o servidor só aceita o valor que a conta dá
await assert.rejects(pagar(db, "salao", { tipo: "comissao", alvoId: "bia", mes: "2025-03", valorCents: 100, forma: "pix", descontoCents: 680 }, quem), /comissão deste mês é/);
// tela desatualizada (o desconto que ela via já foi abatido em outro pagamento): recusa, não paga o valor errado
await assert.rejects(pagar(db, "salao", { tipo: "comissao", alvoId: "bia", mes: "2025-03", valorCents: 100, forma: "pix", descontoCents: 99999 }, quem), /mudou enquanto a tela/);
await pagar(db, "salao", { tipo: "comissao", alvoId: "bia", mes: "2025-03", valorCents: 1320, forma: "pix", descontoCents: 680 }, quem);
assert.equal(await descontoBia(), 0, "abateu o que estava guardado");
// comissão de mês que ainda não chegou não se paga
await assert.rejects(pagar(db, "salao", { tipo: "comissao", alvoId: "bia", mes: "2099-01", valorCents: 100, forma: "pix" }, quem), /ainda não pode ser paga/);
// apagar o pagamento devolve o que ele abateu; apagar o estorno tira o desconto dele (o já abatido volta ao profissional)
await excluir(db, "salao", idDoPagamento("comissao", "bia", "2025-03"));
assert.equal(await descontoBia(), 680);
// apagar o estorno: o recebimento volta a valer e pode ser estornado de novo
await excluir(db, "salao", es);
assert.equal(await descontoBia(), -1000, "1000 já abatidos de um estorno desfeito: a devolver à Bia");
await estornar(db, "salao", { lancamentoId: recebido, valorCents: 4200, forma: "dinheiro" }, quem);
assert.equal(await descontoBia(), 680);
await excluir(db, "salao", es);
await excluir(db, "salao", idDoPagamento("comissao", "bia", "2025-01"));
assert.equal(await descontoBia(), 0);
await db.doc("tenants/salao/staff/bia").delete();
await db.doc("tenants/salao/lancamentos/t1").delete();
await db.doc("tenants/salao/lancamentos/t3").delete();

// o campo legado não bloqueia mais o Caixa nem apaga o histórico
await db.doc("tenants/salao").update({ "modulos.financeiro": false });
await definirComissao(db, "salao", "bia", 10);
assert.equal((await db.doc(`tenants/salao/lancamentos/${idDaBaixa("passado")}`).get()).exists, true);

// Caixa desligado pelo /admin (ou plano só site): lançamento novo recusado, o histórico fica
for (const desligado of [{ "modulos.caixa": false }, { "modulos.agendamento": false }]) {
  await db.doc("tenants/salao").update(desligado);
  await assert.rejects(lancar(db, "salao", entrada, quem), /O Caixa está desligado para este negócio/);
  assert.equal((await db.doc(`tenants/salao/lancamentos/${idDaBaixa("passado")}`).get()).exists, true, "nada apagado");
  await db.doc("tenants/salao").update({ "modulos.caixa": FieldValue.delete(), "modulos.agendamento": FieldValue.delete() });
}

await db.doc("tenants/salao").update({ "modulos.financeiro": true });
// avulso com id da tela: o reenvio (resposta perdida) devolve o mesmo e não duplica
const idTela = "mn-0123456789abcdef0123";
assert.equal(await lancar(db, "salao", entrada, quem, idTela), idTela);
assert.equal(await lancar(db, "salao", entrada, quem, idTela), idTela);
assert.equal((await db.collection("tenants/salao/lancamentos").where("valorCents", "==", 4500).get()).size, 1, "um só");
await assert.rejects(lancar(db, "salao", entrada, quem, "ag-qualquer"), /inválido/, "id da tela não ocupa o de outro registro");
await excluir(db, "salao", idTela);

// sinal pago: no balcão só o restante; o Caixa fica com o preço inteiro, sem contar o sinal duas vezes
const comSinal = (id: string) =>
  db.doc(`tenants/salao/appointments/${id}`).set({ status: "confirmed", start: zonedTime(addDays(hoje, -1), "15:00"), serviceName: "Mechas", priceCents: 10000, staffId: "bia", staffName: "Bia", customerName: "Lia", sinal: { cents: 3000, status: "pago" } });
// sinal no Caixa (sn-): a baixa grava só o restante
await comSinal("sinal-no-caixa");
await db.doc("tenants/salao/lancamentos/sn-sinal-no-caixa").set({ tipo: "entrada", valorCents: 3000, data: hoje, mes: hoje.slice(0, 7), categoria: "Atendimento", forma: "pix" });
await assert.rejects(baixarAgendamento(db, "salao", { appointmentId: "sinal-no-caixa", valorCents: 10000, forma: "pix", sinalCents: 0 }, quem), /sinal deste atendimento mudou/, "tela aberta antes da confirmação do sinal");
await baixarAgendamento(db, "salao", { appointmentId: "sinal-no-caixa", valorCents: 7000, forma: "pix", sinalCents: 3000 }, quem);
assert.equal((await db.doc(`tenants/salao/lancamentos/${idDaBaixa("sinal-no-caixa")}`).get()).get("valorCents"), 7000);
// sinal fora do Caixa (confirmado com ele desligado): entra junto na baixa
await comSinal("sinal-fora");
await baixarAgendamento(db, "salao", { appointmentId: "sinal-fora", valorCents: 7000, forma: "dinheiro", sinalCents: 3000 }, quem);
// o sinal entra como o lançamento dele, por Pix; a baixa fica com o que entrou no balcão
const fora = (await db.doc(`tenants/salao/lancamentos/${idDaBaixa("sinal-fora")}`).get()).data()!;
const snFora = (await db.doc("tenants/salao/lancamentos/sn-sinal-fora").get()).data()!;
assert.deepEqual([fora.valorCents, fora.forma], [7000, "dinheiro"]);
assert.deepEqual([snFora.valorCents, snFora.forma, snFora.staffId, snFora.data], [3000, "pix", "bia", fora.data]);
// depois da baixa, apagar o sinal o perderia de vez
await assert.rejects(excluir(db, "salao", "sn-sinal-fora"), /Apague o recebimento do atendimento antes/);
await assert.rejects(excluir(db, "salao", "sn-sinal-no-caixa"), /Apague o recebimento do atendimento antes/);
// sinal de horário ainda marcado não se devolve pelo estorno: a baixa ainda o descontaria
await comSinal("sinal-vivo");
await db.doc("tenants/salao/lancamentos/sn-sinal-vivo").set({ tipo: "entrada", valorCents: 3000, data: hoje, mes: hoje.slice(0, 7), categoria: "Atendimento", forma: "pix", staffId: "bia" });
await assert.rejects(estornar(db, "salao", { lancamentoId: "sn-sinal-vivo", valorCents: 3000, forma: "pix" }, quem), /Cancele o agendamento/);
await db.doc("tenants/salao/appointments/sinal-vivo").update({ status: "cancelled" });
await estornar(db, "salao", { lancamentoId: "sn-sinal-vivo", valorCents: 3000, forma: "pix" }, quem);
// data impossível não cria um mês que nenhuma tela mostra
assert.equal(LancamentoInput.safeParse({ ...entrada, data: "2026-13-45" }).success, false);
assert.equal(LancamentoInput.safeParse({ ...entrada, data: "2026-02-30" }).success, false);
assert.equal(LancamentoInput.safeParse({ ...entrada, data: "2028-02-29" }).success, true);
// recebimento apagado ou corrigido depois de paga a comissão do mês: a diferença vai para o desconto
await db.doc("tenants/salao/caixa/config").set({ comissoes: { leo: 50 }, descontos: { leo: 0 } }, { merge: true });
const leo = (id: string, valorCents: number) => db.doc(`tenants/salao/lancamentos/${id}`).set({ tipo: "entrada", valorCents, mes: "2025-05", data: "2025-05-10", categoria: "Atendimento", forma: "pix", staffId: "leo", staffName: "Léo", appointmentId: id.slice(3) });
await leo("ag-leo1", 10000);
await leo("ag-leo2", 4000);
const descontoLeo = async () => (await db.doc("tenants/salao/caixa/config").get()).get("descontos.leo");
await editar(db, "salao", "ag-leo1", { ...entrada, valorCents: 8000 }, quem);
assert.equal(await descontoLeo(), 0, "comissão ainda não paga: nada a guardar");
// pago a 50%; depois o % muda para 10: o ajuste segue o % do pagamento
await db.doc(`tenants/salao/lancamentos/${idDoPagamento("comissao", "leo", "2025-05")}`).set({ tipo: "saida", valorCents: 6000, mes: "2025-05", staffId: "leo", pctComissao: 50 });
await db.doc("tenants/salao/caixa/config").set({ comissoes: { leo: 10 } }, { merge: true });
await editar(db, "salao", "ag-leo1", { ...entrada, valorCents: 6000 }, quem);
assert.equal(await descontoLeo(), 1000, "50% dos 2000 a menos");
await excluir(db, "salao", "ag-leo2");
assert.equal(await descontoLeo(), 3000, "mais 50% dos 4000 apagados");
await editar(db, "salao", "ag-leo1", { ...entrada, valorCents: 7000 }, quem);
assert.equal(await descontoLeo(), 2500, "valor subiu: a comissão a mais volta");
// apagar o pagamento desfaz os ajustes dele: pagar de novo usa só o faturamento de agora
assert.equal((await db.doc(`tenants/salao/lancamentos/${idDoPagamento("comissao", "leo", "2025-05")}`).get()).get("ajusteCents"), 2500);
await excluir(db, "salao", idDoPagamento("comissao", "leo", "2025-05"));
assert.equal(await descontoLeo(), 0, "sem pagamento, nada a descontar");
// recebimento que cai num mês de comissão já paga (o atendimento do dia 31 recebido depois): fica devendo ao Léo
await db.doc(`tenants/salao/lancamentos/${idDoPagamento("comissao", "leo", "2025-05")}`).set({ tipo: "saida", valorCents: 3000, mes: "2025-05", staffId: "leo", pctComissao: 50 });
await db.doc("tenants/salao/appointments/leo-tarde").set({ status: "confirmed", start: zonedTime("2025-05-31", "19:00"), serviceName: "Barba", priceCents: 2000, staffId: "leo", staffName: "Léo", customerName: "Rui" });
await baixarAgendamento(db, "salao", { appointmentId: "leo-tarde", valorCents: 2000, forma: "pix", sinalCents: 0 }, quem);
assert.equal(await descontoLeo(), -1000, "50% dos 2000 recebidos depois do pagamento: a pagar ao Léo");
// apagar o recebimento e receber de novo não conta duas vezes
await excluir(db, "salao", idDaBaixa("leo-tarde"));
assert.equal(await descontoLeo(), 0);
await baixarAgendamento(db, "salao", { appointmentId: "leo-tarde", valorCents: 2000, forma: "pix", sinalCents: 0 }, quem);
assert.equal(await descontoLeo(), -1000);
// o lançamento do sinal fica preso ao atendimento: entrada, no dia dele
await assert.rejects(editar(db, "salao", "sn-sinal-no-caixa", { tipo: "saida", valorCents: 3000, data: hoje, categoria: "Atendimento", forma: "pix" }, quem), /sempre entrada/);
await editar(db, "salao", "sn-sinal-no-caixa", { tipo: "entrada", valorCents: 3000, data: addDays(hoje, -40), categoria: "Atendimento", forma: "pix" }, quem);
assert.equal((await db.doc("tenants/salao/lancamentos/sn-sinal-no-caixa").get()).get("data"), hoje, "a data não muda");

// [1] corrigir o sinal muda também o agendamento: o restante do balcão sai dele
await comSinal("sinal-edita");
await db.doc("tenants/salao/lancamentos/sn-sinal-edita").set({ tipo: "entrada", valorCents: 3000, data: hoje, mes: hoje.slice(0, 7), categoria: "Atendimento", forma: "pix", staffId: "bia" });
await editar(db, "salao", "sn-sinal-edita", { tipo: "entrada", valorCents: 2000, data: hoje, categoria: "Atendimento", forma: "pix" }, quem);
assert.equal((await db.doc("tenants/salao/appointments/sinal-edita").get()).get("sinal.cents"), 2000);
await assert.rejects(editar(db, "salao", "sn-sinal-no-caixa", { tipo: "entrada", valorCents: 2000, data: hoje, categoria: "Atendimento", forma: "pix" }, quem), /apague o recebimento antes/);
// [5] editar e desfazer não deixa centavo de desconto (50% já pago no mês do Léo)
const antesLeo = await descontoLeo();
await editar(db, "salao", idDaBaixa("leo-tarde"), { ...entrada, valorCents: 2001 }, quem);
await editar(db, "salao", idDaBaixa("leo-tarde"), { ...entrada, valorCents: 2000 }, quem);
assert.equal(await descontoLeo(), antesLeo, "100,00 → 100,01 → 100,00 volta a zero");
// [2] estorno de entrada de mês com comissão paga: o desconto vai pelo % do pagamento (50), não pelo de hoje (10)
await estornar(db, "salao", { lancamentoId: idDaBaixa("leo-tarde"), valorCents: 2000, forma: "pix" }, quem);
assert.equal(await descontoLeo(), antesLeo + 1000);
assert.equal((await db.doc(`tenants/salao/lancamentos/${idDoEstorno(idDaBaixa("leo-tarde"))}`).get()).get("pctComissao"), 50);
// [4] crédito a devolver sem atendimento no mês (saiu da equipe): paga-se o crédito
await db.doc("tenants/salao/caixa/config").set({ descontos: { rui: -5000 } }, { merge: true });
await pagar(db, "salao", { tipo: "comissao", alvoId: "rui", mes: hoje.slice(0, 7), valorCents: 5000, forma: "pix", descontoCents: -5000 }, quem);
assert.equal((await db.doc("tenants/salao/caixa/config").get()).get("descontos.rui"), 0);

// o sinal só conta para a comissão quando o atendimento é recebido; falta ou cancelamento, fica com o salão
const sinalDe = async (id: string) => (await db.doc(`tenants/salao/lancamentos/sn-${id}`).get()).data()!;
await db.doc("tenants/salao/staff/rui").set({ name: "Rui" });
await db.doc("tenants/salao/appointments/rui-sinal").set({ status: "confirmed", start: zonedTime("2025-07-10", "10:00"), serviceName: "Corte", priceCents: 10000, staffId: "rui", staffName: "Rui", customerName: "Lia", sinal: { cents: 3000, status: "pago" } });
await db.doc("tenants/salao/lancamentos/sn-rui-sinal").set({ tipo: "entrada", valorCents: 3000, data: "2025-06-28", mes: "2025-06", categoria: "Atendimento", forma: "pix", staffId: "rui", staffName: "Rui" });
await db.doc("tenants/salao/caixa/config").set({ comissoes: { rui: 50 }, descontos: { rui: 0 } }, { merge: true });
assert.equal(mesDaComissao({ id: "sn-rui-sinal", mes: "2025-06" }), null, "sinal ainda não conta");
await assert.rejects(pagar(db, "salao", { tipo: "comissao", alvoId: "rui", mes: "2025-06", valorCents: 1500, forma: "pix" }, quem), /Não há comissão a pagar/, "junho: só o sinal, que não conta");
await baixarAgendamento(db, "salao", { appointmentId: "rui-sinal", valorCents: 7000, forma: "dinheiro", sinalCents: 3000 }, quem);
assert.equal((await sinalDe("rui-sinal")).mesComissao, "2025-07", "recebido em julho: o sinal conta em julho");
// julho: 50% de 7000 + 3000 = 5000
await assert.rejects(pagar(db, "salao", { tipo: "comissao", alvoId: "rui", mes: "2025-07", valorCents: 3500, forma: "pix" }, quem), /comissão deste mês é R\$\s?50,00/);
// apagar o recebimento: o sinal volta a não contar
await excluir(db, "salao", idDaBaixa("rui-sinal"));
assert.equal((await sinalDe("rui-sinal")).mesComissao, undefined);
await assert.rejects(pagar(db, "salao", { tipo: "comissao", alvoId: "rui", mes: "2025-07", valorCents: 5000, forma: "pix" }, quem), /Não há comissão a pagar/);
// recebido com a comissão de julho já paga: o atendimento inteiro (com o sinal) fica devendo ao Rui
await db.doc(`tenants/salao/lancamentos/${idDoPagamento("comissao", "rui", "2025-07")}`).set({ tipo: "saida", valorCents: 0, mes: "2025-07", staffId: "rui", pctComissao: 50 });
await baixarAgendamento(db, "salao", { appointmentId: "rui-sinal", valorCents: 7000, forma: "dinheiro", sinalCents: 3000 }, quem);
assert.equal((await db.doc("tenants/salao/caixa/config").get()).get("descontos.rui"), -5000);

// quem tem % e ainda não faturou aparece (para o vale); sem nome na equipe, não
assert.deepEqual(comissoesDoMes([], { ana: 40, foi: 30 }, {}, { ana: "Ana" }).map((c) => [c.staffId, c.faturado, c.valor]), [["ana", 0, 0]]);

// vale: sai hoje, entra no desconto guardado e abate do próximo pagamento de comissão
{
  await db.doc("tenants/salao/staff/vi").set({ name: "Vi" });
  await db.doc("tenants/salao/caixa/config").set({ comissoes: { vi: 50 }, descontos: { vi: 0 } }, { merge: true });
  const descontoVi = async () => (await db.doc("tenants/salao/caixa/config").get()).get("descontos.vi");
  const mesVi = hoje.slice(0, 7);
  await db.doc("tenants/salao/lancamentos/ag-vi-1").set({ tipo: "entrada", valorCents: 10000, forma: "pix", categoria: "Atendimento", data: hoje, mes: mesVi, staffId: "vi", staffName: "Vi" });
  const v = { id: "vl-aaaaaaaaaaaaaaaa", staffId: "vi", valorCents: 2000, forma: "dinheiro" as const, email: "vi@teste.dev" };
  assert.deepEqual(await darVale(db, "salao", v, quem), { nome: "Vi", data: hoje, novo: true });
  assert.equal((await darVale(db, "salao", v, quem)).novo, false, "reenviar não paga duas vezes");
  assert.equal(await descontoVi(), 2000);
  // corrigir o vale corrige o desconto
  await editar(db, "salao", v.id, { tipo: "saida", valorCents: 3000, forma: "dinheiro", categoria: "Comissão/salário", data: hoje } as LancamentoInput, quem);
  assert.equal(await descontoVi(), 3000);
  // apagar devolve; dar de novo e pagar: 50% de 100 = 50, menos 30 de vale = 20
  await excluir(db, "salao", v.id);
  assert.equal(await descontoVi(), 0);
  await darVale(db, "salao", { ...v, id: "vl-bbbbbbbbbbbbbbbb", valorCents: 3000 }, quem);
  await pagar(db, "salao", { tipo: "comissao", alvoId: "vi", mes: mesVi, valorCents: 2000, forma: "pix", descontoCents: 3000 }, quem);
  assert.equal(await descontoVi(), 0);
  await assert.rejects(darVale(db, "salao", { ...v, id: "vl-cccccccccccccccc", staffId: "ninguem" }, quem), /Profissional não encontrado/);
}

console.log("financeiro ok");
process.exit(0);
