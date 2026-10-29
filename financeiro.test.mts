// Rode: npm run test:financeiro  (Caixa do negócio no emulador do Firestore)
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { addDays, todayIn, zonedTime } from "@/lib/datetime";
import { categorias, idDaBaixa, resumoDoMes } from "@/lib/financeiro";
import { baixarAgendamento, editar, excluir, lancar } from "@/lib/financeiro.server";

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

// desligar não apaga: o histórico volta quando religar
await db.doc("tenants/salao").update({ "modulos.financeiro": false });
await assert.rejects(excluir(db, "salao", idDaBaixa("passado")), /não está ativo/);
assert.equal((await db.doc(`tenants/salao/lancamentos/${idDaBaixa("passado")}`).get()).exists, true);

console.log("financeiro ok");
process.exit(0);
