// Rode: npm run test:sinal  (sinal por Pix no agendamento online, no emulador do Firestore)
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { book, loadCatalog } from "@/lib/booking.server";
import { addDays, todayIn } from "@/lib/datetime";
import { prazoDoSinal, restanteDe, valorDoSinal } from "@/lib/sinal";
import { confirmarSinal, expirarSinais, idDoSinal } from "@/lib/sinal.server";

// Funções puras
assert.equal(valorDoSinal({ tipo: "percentual", valor: 30 }, 5000), 1500);
assert.equal(valorDoSinal({ tipo: "percentual", valor: 33 }, 4999), 1650, "arredonda");
assert.equal(valorDoSinal({ tipo: "fixo", valor: 2000 }, 5000), 2000);
assert.equal(valorDoSinal({ tipo: "fixo", valor: 9000 }, 5000), 5000, "fixo não passa do preço");
assert.equal(valorDoSinal({ tipo: "percentual", valor: 30 }, 0), 0, "sem preço, sem sinal");
const agora = new Date("2030-01-07T12:00:00Z");
assert.equal(prazoDoSinal(agora, 30, new Date("2030-01-08T12:00:00Z")).toISOString(), "2030-01-07T12:30:00.000Z");
assert.equal(prazoDoSinal(agora, 30, new Date("2030-01-07T12:10:00Z")).toISOString(), "2030-01-07T12:10:00.000Z", "nunca depois do horário");
assert.equal(restanteDe({ priceCents: 5000, sinal: { status: "pago", cents: 1500 } }), 3500);
assert.equal(restanteDe({ priceCents: 5000, sinal: { status: "pendente", cents: 1500 } }), 5000, "pendente não abate");
assert.equal(restanteDe({ priceCents: 5000 }), 5000);

// No emulador
const db = getFirestore(initializeApp({ projectId: "demo-siteflow" }));
const t = db.collection("tenants").doc("sinal-salao");
const pix = { chave: "52998224725", nome: "Ana Souza", cidade: "Belem" };
await t.set({ name: "Salão Sinal", ownerId: "owner", modulos: { financeiro: true }, pix, sinal: { ativo: true, tipo: "percentual", valor: 30, prazoMin: 30 } });
await t.collection("services").doc("corte").set({ name: "Corte", durationMin: 30, priceCents: 5000, active: true });
const hours = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, { start: "09:00", end: "12:00" }]));
await t.collection("staff").doc("ana").set({ name: "Ana", serviceIds: ["corte"], hours, active: true });
const date = addDays(todayIn(), 3);
const base = { tenantId: "sinal-salao", staffId: "ana", date, serviceIds: ["corte"], customerName: "Cliente" };

assert.deepEqual((await loadCatalog(db, "sinal-salao"))?.sinal, { tipo: "percentual", valor: 30, prazoMin: 30 }, "a página avisa o sinal");

// reserva com sinal: segura o horário e devolve o QR
const r1 = await book(db, { ...base, time: "09:00", customerPhone: "11 91111-1111" });
assert.ok(r1.ok && r1.sinal, "reserva com sinal");
assert.equal(r1.sinal!.cents, 1500);
assert.deepEqual(r1.sinal!.pix, pix);
const a1 = t.collection("appointments").doc(r1.id!);
assert.equal((await a1.get()).get("sinal.status"), "pendente");
assert.equal((await a1.get()).get("status"), "booked");
const ocupado = await book(db, { ...base, time: "09:00", customerPhone: "11 92222-2222" });
assert.equal(ocupado.ok, false, "o horário com sinal pendente fica segurado");

// "Sinal recebido": confirma o horário e lança no Caixa com o profissional
await confirmarSinal(db, "sinal-salao", r1.id!, { uid: "owner", email: "dono@x.com" });
const pago = await a1.get();
assert.equal(pago.get("status"), "confirmed");
assert.equal(pago.get("sinal.status"), "pago");
const lancamento = await t.collection("lancamentos").doc(idDoSinal(r1.id!)).get();
assert.equal(lancamento.get("valorCents"), 1500);
assert.equal(lancamento.get("forma"), "pix");
assert.equal(lancamento.get("staffId"), "ana", "conta para a comissão");
await assert.rejects(confirmarSinal(db, "sinal-salao", r1.id!, { uid: "owner" }), /não tem sinal/, "não confirma duas vezes");

// prazo vencido: o cron cancela e libera o horário
const r2 = await book(db, { ...base, time: "10:00", customerPhone: "11 93333-3333" });
assert.ok(r2.ok && r2.sinal);
assert.equal(await expirarSinais(db, new Date()), 0, "dentro do prazo, fica");
const depois = new Date(Date.now() + 31 * 60_000);
assert.equal(await expirarSinais(db, depois), 1);
const vencido = await t.collection("appointments").doc(r2.id!).get();
assert.equal(vencido.get("status"), "cancelled");
assert.equal(vencido.get("sinal.status"), "vencido");
assert.equal((await t.collection("history").doc(vencido.get("lastHistoryId")).get()).get("reason"), "sinal_nao_pago");
assert.equal((await book(db, { ...base, time: "10:00", customerPhone: "11 94444-4444" })).ok, true, "horário liberado");
assert.equal(await expirarSinais(db, depois), 1, "a reserva nova (também com sinal) vence igual");

// confirmado na mão sem o sinal: no prazo vencido, o sinal é dispensado (não cancela, sai da consulta)
const r3 = await book(db, { ...base, time: "11:00", customerPhone: "11 96666-6666" });
await t.collection("appointments").doc(r3.id!).update({ status: "confirmed" });
assert.equal(await expirarSinais(db, depois), 0);
const dispensado = await t.collection("appointments").doc(r3.id!).get();
assert.equal(dispensado.get("status"), "confirmed");
assert.equal(dispensado.get("sinal.status"), "dispensado");

// recebido no Caixa antes do sinal: "Sinal recebido" não lança de novo
const r4 = await book(db, { ...base, time: "09:30", customerPhone: "11 97777-7777" });
await t.collection("lancamentos").doc(`ag-${r4.id}`).set({ tipo: "entrada", valorCents: 5000 });
await confirmarSinal(db, "sinal-salao", r4.id!, { uid: "owner" });
assert.equal((await t.collection("lancamentos").doc(idDoSinal(r4.id!)).get()).exists, false, "não conta duas vezes");
assert.equal((await t.collection("appointments").doc(r4.id!).get()).get("sinal.status"), "pago");

// fuso do negócio: o teto do prazo é o início real (Manaus), e a hora mostrada é a de lá
await t.update({ "site.uf": "AM" });
const r5 = await book(db, { ...base, time: "10:30", customerPhone: "11 98888-8888" });
const s5 = (await t.collection("appointments").doc(r5.id!).get()).get("sinal");
assert.ok(s5.ate.toDate() > new Date(), "prazo no futuro");
assert.match(s5.hora, /^\d{2}:\d{2}$/);
await t.update({ "site.uf": null });

// sem chave Pix ou sem preço: reserva comum, sem sinal
await t.update({ pix: null });
const semChave = await book(db, { ...base, time: "11:30", customerPhone: "11 95555-5555" });
assert.ok(semChave.ok && semChave.sinal === null);
assert.equal((await loadCatalog(db, "sinal-salao"))?.sinal, null);

console.log("sinal ok");
process.exit(0);
