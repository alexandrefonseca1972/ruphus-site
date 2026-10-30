// Rode: npm run test:financeiro  (Caixa do negócio no emulador do Firestore)
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { addDays, todayIn, zonedTime } from "@/lib/datetime";
import { categorias, comissoesDoMes, csvDoMes, diaNoMes, pctDoTexto, idDaBaixa, idDoEstorno, idDoPagamento, resumoDoMes } from "@/lib/financeiro";
import { adicionarFixa, baixarAgendamento, definirComissao, editar, estornar, excluir, lancar, pagar, removerFixa } from "@/lib/financeiro.server";

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

// módulo desligado: nada grava
await db.doc("tenants/salao").set({ name: "Salão", ownerId: "dona", site: { uf: "SP" } });
const entrada = { tipo: "entrada" as const, valorCents: 4500, data: hoje, categoria: "Produto", forma: "pix" as const };
await assert.rejects(lancar(db, "salao", entrada, quem), /não está ativo/);

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
assert.equal((await db.doc("tenants/salao/caixa/config").get()).get("fixas").length, 1);
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
await assert.rejects(pagar(db, "salao", { tipo: "comissao", alvoId: "ninguem", mes, valorCents: 1680, forma: "pix" }, quem), /Profissional não encontrado/);
// a Bia saiu da equipe (sem staff/bia), mas atendeu no mês: a comissão sai com o nome da baixa
const mesBia = addDays(hoje, -1).slice(0, 7); // o mês do atendimento "passado"
await pagar(db, "salao", { tipo: "comissao", alvoId: "bia", mes: mesBia, valorCents: 1680, forma: "dinheiro" }, quem);
const cm = (await db.doc(`tenants/salao/lancamentos/${idDoPagamento("comissao", "bia", mesBia)}`).get()).data()!;
assert.deepEqual([cm.tipo, cm.categoria, cm.descricao, cm.staffId, cm.staffName], ["saida", "Comissão/salário", "Comissão Bia", "bia", "Bia"], "o nome vai para a coluna Profissional da planilha");
await assert.rejects(pagar(db, "salao", { tipo: "comissao", alvoId: "bia", mes: mesBia, valorCents: 1680, forma: "pix" }, quem), /já foi paga/);

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
assert.deepEqual(
  resumoDoMes([
    { tipo: "entrada", valorCents: 10000, categoria: "Atendimento", forma: "pix", staffName: "Bia" },
    { tipo: "saida", valorCents: 3000, categoria: "Estorno", forma: "pix", staffName: "Bia", estornoDe: "ag-x" },
  ]).porProfissional,
  [["Bia", 7000]],
);
// pagar a comissão abate o guardado, nunca mais do que há; R$ 0 só quando o estorno zerou a comissão
await db.doc("tenants/salao/staff/bia").set({ name: "Bia" });
// atendimentos da Bia: 2027-01 rende R$ 10 de comissão (40% de 25), 2027-03 rende R$ 20
const atendimento = (id: string, mes: string, valorCents: number) =>
  db.doc(`tenants/salao/lancamentos/${id}`).set({ tipo: "entrada", valorCents, mes, data: `${mes}-10`, categoria: "Atendimento", forma: "pix", staffId: "bia", staffName: "Bia" });
await atendimento("t1", "2027-01", 2500);
await atendimento("t3", "2027-03", 5000);
await assert.rejects(pagar(db, "salao", { tipo: "comissao", alvoId: "bia", mes: "2027-02", valorCents: 0, forma: "pix" }, quem), /Informe o valor/);
await pagar(db, "salao", { tipo: "comissao", alvoId: "bia", mes: "2027-01", valorCents: 0, forma: "pix", descontoCents: 1000 }, quem);
assert.equal((await db.doc(`tenants/salao/lancamentos/${idDoPagamento("comissao", "bia", "2027-01")}`).get()).get("descontoCents"), 1000);
assert.equal(await descontoBia(), 680, "o resto fica para o próximo");
await assert.rejects(pagar(db, "salao", { tipo: "comissao", alvoId: "bia", mes: "2027-03", valorCents: 0, forma: "pix", descontoCents: 680 }, quem), /Informe o valor/, "R$ 0 só quando o estorno cobre a comissão toda");
await pagar(db, "salao", { tipo: "comissao", alvoId: "bia", mes: "2027-03", valorCents: 100, forma: "pix", descontoCents: 99999 }, quem);
assert.equal(await descontoBia(), 0, "não abate mais do que está guardado");
// apagar o pagamento devolve o que ele abateu; apagar o estorno tira o desconto dele (o já abatido volta ao profissional)
await excluir(db, "salao", idDoPagamento("comissao", "bia", "2027-03"));
assert.equal(await descontoBia(), 680);
// apagar o estorno: o recebimento volta a valer e pode ser estornado de novo
await excluir(db, "salao", es);
assert.equal(await descontoBia(), -1000, "1000 já abatidos de um estorno desfeito: a devolver à Bia");
await estornar(db, "salao", { lancamentoId: recebido, valorCents: 4200, forma: "dinheiro" }, quem);
assert.equal(await descontoBia(), 680);
await excluir(db, "salao", es);
await excluir(db, "salao", idDoPagamento("comissao", "bia", "2027-01"));
assert.equal(await descontoBia(), 0);
await db.doc("tenants/salao/staff/bia").delete();
await db.doc("tenants/salao/lancamentos/t1").delete();
await db.doc("tenants/salao/lancamentos/t3").delete();

// desligar não apaga: o histórico volta quando religar
await db.doc("tenants/salao").update({ "modulos.financeiro": false });
await assert.rejects(excluir(db, "salao", idDaBaixa("passado")), /não está ativo/);
await assert.rejects(definirComissao(db, "salao", "bia", 10), /não está ativo/);
assert.equal((await db.doc(`tenants/salao/lancamentos/${idDaBaixa("passado")}`).get()).exists, true);

console.log("financeiro ok");
process.exit(0);
