// Rode: npm run test:booking  (lógica de horários + reservas no emulador do Firestore)
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { verifyFirebaseToken } from "@/lib/verify-token";
import { agendaDias, availableSlots, book, createPlan, deleteCustomer, endPlan, loadCatalog, renameCustomer, requireMember, reschedule, rescheduleSlots } from "@/lib/booking.server";
import { addDays, customerKey, formatPhone, maskBRL, freeSlots, phoneError, planDates, todayIn, weekday, zonedTime } from "@/lib/datetime";
import { BookingInput } from "@/lib/scheduling";
import { cotaDe, criarNegocio, definirLimite } from "@/lib/negocios.server";
import { anotar, linhaDoTempo, registrarMensagem, salvarCrm } from "@/lib/crm";
import { saudeDe } from "@/lib/saude.server";

// Funções puras
assert.equal(zonedTime("2026-09-20", "09:00").toISOString(), "2026-09-20T12:00:00.000Z");
assert.equal(weekday("2026-09-20"), 0); // domingo
assert.equal(addDays("2026-12-31", 1), "2027-01-01");
assert.equal(customerKey("(11) 91234-5678"), "5511912345678");
assert.equal(customerKey("+55 11 91234-5678"), "5511912345678");
assert.deepEqual(planDates("2026-09-17", 1, 3), ["2026-09-21", "2026-09-28", "2026-10-05"]); // quinta → segundas
assert.deepEqual(planDates("2026-09-21", 1, 2), ["2026-09-21", "2026-09-28"]); // já é segunda
assert.equal(formatPhone("11912345678"), "(11) 91234-5678");
assert.equal(formatPhone("1133334444"), "(11) 3333-4444");
assert.equal(formatPhone("5511912345678"), "(11) 91234-5678", "colado com DDI");
assert.equal(formatPhone("(11) 9123"), "(11) 9123");
assert.equal(formatPhone("1191234567890"), "(11) 91234-5678", "corta excesso");
assert.equal(formatPhone("1"), "(1");
assert.equal(formatPhone(""), "");
assert.equal(maskBRL("4500"), "R$\u00a045,00");
assert.equal(maskBRL("999999999"), "R$\u00a099.999,99", "corta excesso");
assert.equal(maskBRL("R$ 0,0"), "", "apagar o R$ 0,00 esvazia");
assert.equal(maskBRL("abc"), "");
assert.equal(phoneError("(11) 91234-5678"), "");
assert.equal(phoneError("(11) 3333-4444"), "");
assert.notEqual(phoneError("(11) 1234-56789"), "", "11 dígitos sem 9");
assert.notEqual(phoneError("(01) 91234-5678"), "", "DDD 0");
assert.notEqual(phoneError("(11) 9123"), "");
const phoneOk = (p: string) => BookingInput.shape.customerPhone.safeParse(p).success;
assert.ok(phoneOk("(11) 91234-5678") && phoneOk("+55 11 91234-5678") && phoneOk("1133334444"));
assert.ok(!phoneOk("--------") && !phoneOk("(((())))") && !phoneOk("1234-5678"), "telefone sem dígitos suficientes");
const day = "2030-01-07"; // segunda-feira
const at = (t: string) => zonedTime(day, t);
const w = { start: "09:00", end: "10:00" };
assert.deepEqual(freeSlots({ date: day, window: w, durationMin: 30, busy: [], now: new Date(0) }), ["09:00", "09:15", "09:30"]);
assert.deepEqual(freeSlots({ date: day, window: undefined, durationMin: 30, busy: [], now: new Date(0) }), []);
assert.deepEqual(
  freeSlots({ date: day, window: w, durationMin: 30, busy: [{ start: at("09:15"), end: at("09:45") }], now: new Date(0) }),
  [], // qualquer início colide com 09:15–09:45
);
assert.deepEqual(freeSlots({ date: day, window: w, durationMin: 15, busy: [], now: at("09:20") }), ["09:30", "09:45"]);

// Reservas no emulador
const app = initializeApp({ projectId: "demo-siteflow" });
const db = getFirestore(app);
const t = db.collection("tenants").doc("salao");
await t.set({ name: "Salão Teste", ownerId: "owner" });
await t.collection("services").doc("corte").set({ name: "Corte", durationMin: 30, priceCents: 5000, active: true });
await t.collection("services").doc("luzes").set({ name: "Luzes", durationMin: 90, priceCents: 20000, active: true });
await t.collection("services").doc("off").set({ name: "Antigo", durationMin: 30, priceCents: 1, active: false });
const hours = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, { start: "09:00", end: "12:00" }]));
await t.collection("staff").doc("ana").set({ name: "Ana", serviceIds: ["corte", "luzes"], hours, active: true });
await t.collection("staff").doc("bia").set({ name: "Bia", serviceIds: ["corte"], hours, active: true });

const date = addDays(todayIn(), 7);
let seq = 0;
/** Cada cliente com seu telefone: o limite por telefone é testado à parte */
const outro = () => ({ customerPhone: `11 96${String(100000 + seq++)}` });
const base = { tenantId: "salao", staffId: "ana", date, customerName: "Cliente", customerPhone: "11 91234-5678" };

const catalog = await loadCatalog(db, "salao");
assert.deepEqual(catalog?.services.map((s) => s.id).sort(), ["corte", "luzes"]); // inativo fora
assert.equal(JSON.stringify(catalog).includes("customer"), false);
assert.equal(await loadCatalog(db, "nao-existe"), null);

assert.equal((await availableSlots(db, { ...base, serviceIds: ["corte"] })).length, 11); // 09:00..11:30

assert.deepEqual(await book(db, { ...base, serviceIds: ["corte"], time: "09:00" }), { ok: true, id: (await t.collection("appointments").limit(1).get()).docs[0]?.id ?? assert.fail() });
assert.equal((await book(db, { ...base, serviceIds: ["corte"], time: "09:00" })).ok, false, "mesmo horário");
assert.equal((await book(db, { ...base, serviceIds: ["luzes"], time: "08:45" })).ok, false, "fora do expediente");
assert.equal((await book(db, { ...base, serviceIds: ["luzes"], time: "09:15" })).ok, false, "sobreposição parcial");
assert.equal((await book(db, { ...base, serviceIds: ["corte"], time: "09:07" })).ok, false, "fora da grade de 15 min");
assert.equal((await book(db, { ...base, staffId: "bia", serviceIds: ["luzes"], time: "10:00" })).ok, false, "serviço que ela não faz");
assert.equal((await book(db, { ...base, serviceIds: ["off"], time: "10:00" })).ok, false, "serviço inativo");
assert.equal((await book(db, { ...base, ...outro(), staffId: "bia", serviceIds: ["corte"], time: "09:00" })).ok, true, "outra profissional, mesmo horário");
assert.equal((await book(db, { ...base, serviceIds: ["corte"], time: "09:00", date: addDays(todayIn(), -1) })).ok, false, "no passado");

// Vários serviços: Bia faz só corte; Ana faz corte + luzes (30 + 90 = 120 min, R$ 250)
assert.equal((await book(db, { ...base, staffId: "bia", serviceIds: ["corte", "luzes"], time: "11:00" })).ok, false, "profissional não faz todos");
assert.equal((await book(db, { ...base, serviceIds: ["corte", "off"], time: "11:00" })).ok, false, "um dos serviços inativo");
assert.equal(BookingInput.safeParse({ ...base, serviceIds: ["corte", "corte"], time: "11:00" }).success, false, "serviço repetido");
const combo = { ...base, ...outro(), date: addDays(todayIn(), 8), serviceIds: ["corte", "luzes"] };
assert.deepEqual(await availableSlots(db, combo), ["09:00", "09:15", "09:30", "09:45", "10:00"]); // termina até 12:00
const booked = await book(db, { ...combo, time: "09:30" });
assert.equal(booked.ok, true, "combo");
const saved = (await t.collection("appointments").doc(booked.ok ? booked.id : "").get()).data()!;
const created = (await t.collection("history").doc(saved.lastHistoryId).get()).data()!;
assert.deepEqual([created.type, created.by, created.byName, created.appointmentId], ["created", "cliente", "Cliente", booked.ok && booked.id]);
assert.equal(saved.serviceName, "Corte + Luzes");
assert.equal(saved.durationMin, 120);
assert.equal(saved.priceCents, 25000);
assert.equal(saved.end.toMillis() - saved.start.toMillis(), 120 * 60_000);
assert.deepEqual(await availableSlots(db, { ...combo, serviceIds: ["corte"] }), ["09:00", "11:30"], "combo ocupa 09:30–11:30");

// Concorrência: 10 clientes no mesmo horário, só 1 consegue
const results = await Promise.all(
  Array.from({ length: 10 }, (_, i) =>
    book(db, { ...base, serviceIds: ["luzes"], time: "10:00", customerName: `C${i}`, customerPhone: `11 97000-00${String(10 + i)}` }),
  ),
);
assert.equal(results.filter((r) => r.ok).length, 1, "concorrência");

// Cancelado libera o horário
const luzes = await t.collection("appointments").where("serviceIds", "==", ["luzes"]).get();
await luzes.docs[0].ref.update({ status: "cancelled" });
assert.equal((await book(db, { ...base, ...outro(), serviceIds: ["luzes"], time: "10:00" })).ok, true, "após cancelamento");

// Remarcar (Ana: corte 09:00 no dia D; combo 09:30–11:30 no dia D+1)
const D = base.date, D1 = addDays(todayIn(), 8);
const [corte] = (await t.collection("appointments").where("staffId", "==", "ana").where("start", "==", zonedTime(D, "09:00")).get()).docs;
assert.ok((await rescheduleSlots(db, { tenantId: "salao", appointmentId: corte.id, date: D })).includes("09:00"), "próprio horário não conta como ocupado");
const actor = { uid: "owner", email: "dono@teste.dev" };
assert.equal((await reschedule(db, { tenantId: "salao", appointmentId: corte.id, date: D1, time: "10:00" }, actor)).ok, false, "conflito com combo");
await corte.ref.update({ status: "confirmed" });
assert.equal((await reschedule(db, { tenantId: "salao", appointmentId: corte.id, date: D, time: "09:15" }, actor)).ok, true, "sobrepõe só a si mesmo");
let moved = (await corte.ref.get()).data()!;
const log = (await t.collection("history").doc(moved.lastHistoryId).get()).data()!;
assert.deepEqual([log.type, log.by, log.byName], ["rescheduled", "owner", "dono@teste.dev"]);
assert.equal(log.from.start.toMillis(), zonedTime(D, "09:00").getTime());
assert.equal(log.to.start.toMillis(), zonedTime(D, "09:15").getTime());
assert.equal(moved.start.toMillis(), zonedTime(D, "09:15").getTime());
assert.equal(moved.end.toMillis() - moved.start.toMillis(), 30 * 60_000);
assert.equal(moved.status, "booked", "remarcado volta a aguardar confirmação");
// Serviço mudou de duração/preço depois da reserva: remarcar deixa tudo coerente
await t.collection("services").doc("corte").update({ durationMin: 45, priceCents: 6000 });
assert.equal((await reschedule(db, { tenantId: "salao", appointmentId: corte.id, date: D, time: "09:15" }, actor)).ok, true);
moved = (await corte.ref.get()).data()!;
assert.deepEqual([moved.durationMin, moved.priceCents, (moved.end.toMillis() - moved.start.toMillis()) / 60_000], [45, 6000, 45]);
await t.collection("services").doc("corte").update({ durationMin: 30, priceCents: 5000 });
assert.equal((await reschedule(db, { tenantId: "salao", appointmentId: corte.id, date: D, time: "09:15" }, actor)).ok, true);
moved = (await corte.ref.get()).data()!;
assert.equal((await reschedule(db, { tenantId: "salao", appointmentId: corte.id, date: D1, time: "11:30" }, actor)).ok, true, "outro dia");
moved = (await corte.ref.get()).data()!;
assert.equal(moved.start.toMillis(), zonedTime(D1, "11:30").getTime());
assert.ok((await availableSlots(db, { ...base, serviceIds: ["corte"] })).includes("09:00"), "horário antigo liberado");
assert.equal((await reschedule(db, { tenantId: "salao", appointmentId: "nao-existe", date: D1, time: "09:00" }, actor)).ok, false);
assert.equal((await t.collection("history").where("appointmentId", "==", corte.id).get()).size, 5, "criado + 4 remarcações");
await corte.ref.update({ status: "no_show" });
assert.equal((await reschedule(db, { tenantId: "salao", appointmentId: corte.id, date: D1, time: "09:00" }, actor)).ok, false, "falta não remarca");
await corte.ref.update({ status: "cancelled" });
assert.equal((await reschedule(db, { tenantId: "salao", appointmentId: corte.id, date: D1, time: "09:00" }, actor)).ok, false, "cancelado não remarca");

// Membro do tenant (emulador de Auth)
const auth = getAuth(app);
async function tokenFor(uid: string) {
  const custom = await auth.createCustomToken(uid);
  const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  return ((await r.json()) as { idToken: string }).idToken;
}
await t.collection("members").doc("owner").set({ uid: "owner", role: "owner" });
const emulatorVerify = (token: string) => auth.verifyIdToken(token);
assert.equal((await requireMember(emulatorVerify, db, await tokenFor("owner"), "salao")).uid, "owner");
await assert.rejects(requireMember(emulatorVerify, db, await tokenFor("intruso"), "salao"), /não tem acesso/);
await assert.rejects(requireMember(emulatorVerify, db, "token-falso", "salao"), /Sessão expirada/);
// Verificador de produção: token do emulador (sem assinatura) e lixo são recusados
await assert.rejects(verifyFirebaseToken(await tokenFor("owner"), "demo-siteflow"));
await assert.rejects(verifyFirebaseToken("a.b.c", "demo-siteflow"));

// Cliente salvo a cada reserva; reserva anônima com o mesmo telefone não troca o nome
const cliente = (await t.collection("customers").doc("5511912345678").get()).data()!;
assert.deepEqual([cliente.name, cliente.phone], ["Cliente", "11 91234-5678"]);
assert.equal((await book(db, { ...base, date: addDays(todayIn(), 9), serviceIds: ["corte"], time: "09:00", customerName: "Impostor" })).ok, true);
assert.equal((await t.collection("customers").doc("5511912345678").get()).get("name"), "Cliente", "nome não sobrescrito");
assert.ok((await t.collection("appointments").where("customerKey", "==", "5511912345678").get()).size > 0);

// Plano recorrente: toda segunda 10:00 com a Bia, 4 semanas a partir de daqui a 14 dias
const planStart = addDays(todayIn(), 14);
const segundas = planDates(planStart, 1, 4);
// ocupa a 2ª segunda antes de criar o plano
assert.equal((await book(db, { ...base, staffId: "bia", date: segundas[1], serviceIds: ["corte"], time: "10:00", customerName: "Outro", customerPhone: "11 90000-0000" })).ok, true);
const planInput = { tenantId: "salao", customerName: "Xavier", customerPhone: "(11) 97777-0000", serviceIds: ["corte"], staffId: "bia", weekday: 1, time: "10:00", startDate: planStart, weeks: 4 };
assert.equal((await createPlan(db, { ...planInput, serviceIds: ["luzes"] }, actor)).ok, false, "Bia não faz luzes");
const plan = await createPlan(db, planInput, actor);
assert.ok(plan.ok);
assert.deepEqual(plan.created, [segundas[0], segundas[2], segundas[3]]);
assert.deepEqual(plan.skipped, [segundas[1]]);
const planAppts = await t.collection("appointments").where("planId", "==", plan.planId).orderBy("start").get();
assert.equal(planAppts.size, 3);
assert.equal(planAppts.docs[0].get("start").toMillis(), zonedTime(segundas[0], "10:00").getTime());
assert.equal(planAppts.docs[0].get("customerKey"), "5511977770000");
const planLog = (await t.collection("history").doc(planAppts.docs[0].get("lastHistoryId")).get()).data()!;
assert.deepEqual([planLog.type, planLog.planId, planLog.byName], ["created", plan.planId, "dono@teste.dev"]);
assert.equal((await t.collection("customers").doc("5511977770000").get()).get("name"), "Xavier");
assert.equal((await createPlan(db, planInput, actor)).ok, false, "mesmo plano de novo: tudo ocupado");

// Encerrar plano: cancela os futuros, com histórico; não encerra duas vezes
await planAppts.docs[2].ref.update({ status: "no_show" }); // não ativo: fica como está
const ended = await endPlan(db, { tenantId: "salao", planId: plan.planId }, actor);
assert.deepEqual(ended, { ok: true, cancelled: 2 });
const after = await t.collection("appointments").where("planId", "==", plan.planId).orderBy("start").get();
assert.deepEqual(after.docs.map((d) => d.get("status")), ["cancelled", "cancelled", "no_show"]);
const endLog = (await t.collection("history").doc(after.docs[0].get("lastHistoryId")).get()).data()!;
assert.deepEqual([endLog.type, endLog.reason], ["cancelled", "plan_ended"]);
assert.equal((await t.collection("plans").doc(plan.planId).get()).get("status"), "ended");
assert.equal((await endPlan(db, { tenantId: "salao", planId: plan.planId }, actor)).ok, false);

// Limites contra reservas em massa (telefone e dispositivo)
// Longe da janela do plano (hoje+14 a hoje+35): com hoje+20, o 3º dia deste bloco
// caía em segundas[1] às 10:00 sempre que o teste rodava num domingo, e a recusa
// vinha do horário ocupado na linha 176, não do limite.
const limDate = addDays(todayIn(), 60);
const spam = { tenantId: "salao", staffId: "bia", serviceIds: ["corte"], customerName: "Robô", customerPhone: "11 98888-1111" };
const horarios = ["09:00", "09:30", "10:00", "10:30", "11:00"];
const feitas = [];
for (const [i, time] of horarios.entries()) feitas.push(await book(db, { ...spam, date: addDays(limDate, i), time }, "203.0.113.5"));
assert.deepEqual(feitas.map((r) => r.ok), [true, true, true, false, false], "4ª reserva barrada: já tem 3 futuras");
assert.match(("error" in feitas[3] && feitas[3].error) || "", /já tem 3 horários/);
// Cancelar libera o limite de "ativas"
const doRobo = await t.collection("appointments").where("customerKey", "==", "5511988881111").get();
for (const d of doRobo.docs.slice(0, 3)) await d.ref.update({ status: "cancelled" });
assert.equal((await book(db, { ...spam, date: addDays(limDate, 10), time: "09:00" }, "203.0.113.5")).ok, true, "após cancelar, volta a poder");
// Limite diário por telefone: conta as que deram certo (5 por dia)
const cancelarTudo = async () => {
  const snap = await t.collection("appointments").where("customerKey", "==", "5511988881111").get();
  for (const d of snap.docs) await d.ref.update({ status: "cancelled" });
};
await cancelarTudo();
assert.equal((await book(db, { ...spam, date: addDays(limDate, 11), time: "09:00" }, "203.0.113.5")).ok, true, "5ª do dia ainda passa");
await cancelarTudo();
const r5 = await book(db, { ...spam, date: addDays(limDate, 12), time: "09:30" }, "203.0.113.5");
assert.equal(r5.ok, false, "6ª do dia barrada mesmo sem horários ativos");
assert.match(("error" in r5 && r5.error) || "", /Muitos agendamentos com este WhatsApp/);
// Outro telefone, mesmo dispositivo, continua funcionando (limite maior)
assert.equal((await book(db, { ...spam, customerPhone: "11 98888-2222", date: addDays(limDate, 13), time: "09:00" }, "203.0.113.5")).ok, true);
// Contadores ficam fora do alcance do app (regras) e guardam só o hash do IP
const limits = await t.collection("limits").get();
assert.ok(limits.size >= 2);
assert.equal(limits.docs.some((d) => d.id.includes("203.0.113.5")), false, "IP não aparece em claro");

// Corrigir o nome do cliente: o futuro acompanha, o historico nao
{
  const chave = "5511966660000"; // exclusivo deste bloco: 97777 é do plano do Xavier
  const cli = t.collection("customers").doc(chave);
  await cli.set({ name: "Mrcia", phone: "(11) 96666-0000" });
  const passado = t.collection("appointments").doc("ap-passado");
  const futuro = t.collection("appointments").doc("ap-futuro");
  await passado.set({ customerKey: chave, customerName: "Mrcia", start: Timestamp.fromDate(new Date(Date.now() - 864e5)), status: "confirmed" });
  await futuro.set({ customerKey: chave, customerName: "Mrcia", start: Timestamp.fromDate(new Date(Date.now() + 864e5)), status: "booked" });

  const r = await renameCustomer(db, { tenantId: "salao", customerId: chave, name: "Márcia" });
  assert.deepEqual([r.ok, r.agendamentos], [true, 1]);
  assert.equal((await cli.get()).get("name"), "Márcia");
  assert.equal((await futuro.get()).get("customerName"), "Márcia", "o que o dono ainda vai atender é corrigido");
  assert.equal((await passado.get()).get("customerName"), "Mrcia", "o histórico guarda o que foi dito na época");

  await assert.rejects(
    renameCustomer(db, { tenantId: "salao", customerId: "5500000000000", name: "Ninguém" }),
    /Cliente nao encontrado/,
  );

  // Excluir: só dono/admin, e nunca com horário marcado
  await t.collection("members").doc("func").set({ uid: "func", role: "member" });
  await t.collection("members").doc("gerente").set({ uid: "gerente", role: "admin" });
  await cli.collection("notas").add({ texto: "prefere manhã" });
  const del = (uid: string) => deleteCustomer(db, { tenantId: "salao", customerId: chave }, { uid });
  await assert.rejects(del("func"), /Só o dono ou um administrador/);
  await assert.rejects(del("gerente"), /tem horário marcado/);
  await futuro.update({ status: "cancelled" });
  assert.equal((await del("gerente")).ok, true);
  assert.equal((await cli.get()).exists, false);
  assert.equal((await cli.collection("notas").get()).size, 0, "anotações vão junto");
  assert.equal((await passado.get()).exists, true, "o histórico fica");
}

// A semana que a página pública desenha: contagem por dia e união da equipe
{
  const semana = addDays(todayIn(), 20); // longe dos agendamentos criados acima
  const dias = [semana, addDays(semana, 1)];
  const corte = { tenantId: "salao", serviceIds: ["corte"] };

  const soAna = await agendaDias(db, { ...corte, staffId: "ana", from: semana }, dias);
  assert.deepEqual(soAna.map((d) => d.date), dias);
  assert.equal(soAna[0].horarios.length, 11, "09:00..11:30 de 15 em 15");
  assert.ok(soAna[0].horarios.every((h) => h.staffId === "ana"));

  const qualquer = await agendaDias(db, { ...corte, staffId: "", from: semana }, dias);
  assert.equal(qualquer[0].horarios.length, 11, "união não duplica horário que as duas atendem");
  assert.ok(qualquer[0].horarios.every((h) => h.staffId === "ana"), "ordem do catálogo decide o empate");

  // Ana ocupada às 09:00: quem sobra é Bia, e o horário continua na lista
  assert.equal((await book(db, { ...corte, ...outro(), staffId: "ana", date: semana, time: "09:00", customerName: "Cliente" })).ok, true);
  const depois = await agendaDias(db, { ...corte, staffId: "", from: semana }, dias);
  assert.equal(depois[0].horarios.find((h) => h.hora === "09:00")?.staffId, "bia", "o horário passa para quem está livre");
  const soAnaDepois = await agendaDias(db, { ...corte, staffId: "ana", from: semana }, dias);
  assert.ok(!soAnaDepois[0].horarios.some((h) => h.hora === "09:00"), "para quem pediu Ana, 09:00 sumiu");

  // Luzes só a Ana faz: escolher os dois serviços tira a Bia da conta
  const combo2 = await agendaDias(db, { tenantId: "salao", serviceIds: ["corte", "luzes"], staffId: "", from: semana }, [semana]);
  assert.ok(combo2[0].horarios.every((h) => h.staffId === "ana"));
  assert.deepEqual(await agendaDias(db, { ...corte, staffId: "", from: semana }, []), [], "sem dias, sem consulta");
  assert.deepEqual(await agendaDias(db, { ...corte, staffId: "", from: semana, tenantId: "nao-existe" }, dias), []);
}

// Ordem dos serviços na página pública: o que mais se agenda vem primeiro
{
  const c0 = await loadCatalog(db, "salao");
  // "usos" já subiu nos agendamentos deste teste; sem nada agendado valeria "ordem"
  const usos = async (id: string) => (await t.collection("services").doc(id).get()).get("usos") ?? 0;
  assert.ok((await usos("corte")) > 0, "cada agendamento conta como uso do serviço");
  const ordenado = [...(c0?.services ?? [])].map((s) => s.id);
  const contagens = await Promise.all(ordenado.map(usos));
  assert.deepEqual(contagens, [...contagens].sort((a, b) => b - a), "mais agendados primeiro");

  // Empate em usos: decide a ordem em que o site lista (campo ordem)
  await t.collection("services").doc("corte").set({ usos: 0 }, { merge: true });
  await t.collection("services").doc("luzes").set({ usos: 0 }, { merge: true });
  await t.collection("services").doc("corte").set({ ordem: 1 }, { merge: true });
  await t.collection("services").doc("luzes").set({ ordem: 0 }, { merge: true });
  assert.deepEqual((await loadCatalog(db, "salao"))?.services.map((s) => s.id), ["luzes", "corte"]);
}

// Um negócio por conta, até o admin da plataforma liberar mais
{
  const dona = { uid: "dona-limite", email: "dona@teste.dev" };
  assert.equal(await criarNegocio(db, dona, { name: "Primeiro", slug: "primeiro-limite" }), "primeiro-limite");
  const membro = await db.doc("tenants/primeiro-limite/members/dona-limite").get();
  assert.deepEqual([membro.get("role"), membro.get("email")], ["owner", "dona@teste.dev"]);
  assert.deepEqual(await cotaDe(db, dona.uid), { usados: 1, limite: 1 });
  await assert.rejects(criarNegocio(db, dona, { name: "Segundo", slug: "segundo-limite" }), /Sua conta inclui 1 negócio/);
  assert.equal((await db.doc("tenants/segundo-limite").get()).exists, false, "recusado não deixa nada gravado");

  await definirLimite(db, dona.uid, 2);
  assert.equal(await criarNegocio(db, dona, { name: "Segundo", slug: "segundo-limite" }), "segundo-limite");
  await assert.rejects(criarNegocio(db, dona, { name: "Terceiro", slug: "terceiro-limite" }), /Sua conta inclui 2 negócios/);

  const outra = { uid: "outra-limite" };
  await assert.rejects(criarNegocio(db, outra, { name: "Tomado", slug: "primeiro-limite" }), /já está em uso/);
  await assert.rejects(criarNegocio(db, outra, { name: "Reservado", slug: "painel" }), /reservado/);
  // Funcionário de outro negócio não gasta a cota
  await db.doc("tenants/primeiro-limite/members/outra-limite").set({ uid: "outra-limite", role: "member" });
  assert.equal(await criarNegocio(db, outra, { name: "Dela", slug: "dela-limite" }), "dela-limite");
  await assert.rejects(definirLimite(db, dona.uid, 0), /de 1 a 50/);
  // Admin adicionado por outro dono não gasta a cota; admin que entrou por convite gasta
  const alvo = { uid: "alvo-limite" };
  await db.doc("tenants/primeiro-limite/members/alvo-limite").set({ uid: "alvo-limite", role: "admin" });
  assert.equal((await cotaDe(db, alvo.uid)).usados, 0, "admin sem convite não conta");
  await db.doc("tenants/primeiro-limite/members/alvo-limite").set({ uid: "alvo-limite", role: "admin", viaConvite: true });
  assert.equal((await cotaDe(db, alvo.uid)).usados, 1, "admin do convite conta");
}

// CRM: perda pede motivo; estágio e mensagem viram eventos; a linha do tempo junta tudo
{
  const slug = "primeiro-limite";
  await salvarCrm(db, slug, { estagio: "oferta" }, "vendedor@teste.dev");
  await assert.rejects(salvarCrm(db, slug, { estagio: "perdido" }, "vendedor@teste.dev"), /motivo da perda/);
  await salvarCrm(db, slug, { estagio: "perdido", motivoPerda: "preco", detalhePerda: "achou alto" }, "vendedor@teste.dev");
  await assert.rejects(salvarCrm(db, slug, { donoEmail: "sem-arroba" }), /E-mail inválido/);
  await salvarCrm(db, slug, { donoNome: "Dona Teste", donoWhatsapp: "92991234567", donoEmail: "dona@teste.dev" });
  await registrarMensagem(db, slug, "Proposta", "Dona Teste", "vendedor@teste.dev");
  await anotar(db, slug, "pediu para voltar em janeiro", "vendedor@teste.dev");
  await db.doc(`tenants/${slug}/members/cliente-crm`).set({ uid: "cliente-crm", role: "admin", email: "cliente@teste.dev", createdAt: Timestamp.now() });
  await db.collection("cobrancas").doc(`${slug}-entrada`).set({ slug, tipo: "entrada", competencia: null, valorCents: 25000, criadaEm: Timestamp.now(), pagoEm: null });

  const linha = await linhaDoTempo(db, slug);
  const tipos = new Set(linha.map((e) => e.tipo));
  for (const t of ["estagio", "mensagem", "nota", "convite", "cobranca"]) assert.ok(tipos.has(t as never), `falta ${t} na linha do tempo`);
  const perda = linha.find((e) => e.titulo === "Oferta enviada → Perdido");
  assert.equal(perda?.detalhe, "Preço · achou alto");
  assert.equal(perda?.autor, "vendedor@teste.dev");
  assert.ok(linha.every((e, i) => i === 0 || linha[i - 1].quando >= e.quando), "do mais novo ao mais antigo");

  const crmDoc = async () => (await db.doc(`crm/${slug}`).get());
  // A mensagem enviada marca o dia no próprio negócio: é o que alimenta "Falei hoje"
  assert.ok((await crmDoc()).get("ultimoContatoEm"), "mensagem registra o último contato");
  // Destaque por alguns dias, e sair dele
  await salvarCrm(db, slug, { fixadoAte: "2030-01-31" });
  assert.equal((await crmDoc()).get("fixadoAte"), "2030-01-31");
  await salvarCrm(db, slug, { fixadoAte: null });
  assert.equal((await crmDoc()).get("fixadoAte"), null);
  const entrou = (await crmDoc()).get("entrouEm");
  assert.ok(entrou, "sair de novo marca o começo da negociação");
  assert.ok((await crmDoc()).get("perdidoEm"), "perda tem data");

  // Voltar ao funil apaga o motivo e a data da perda; o começo da negociação fica
  await salvarCrm(db, slug, { estagio: "negociando" });
  assert.equal((await crmDoc()).get("motivoPerda"), undefined);
  assert.equal((await crmDoc()).get("perdidoEm"), undefined);
  assert.ok((await crmDoc()).get("entrouEm").isEqual(entrou), "entrouEm não é reescrito");

  await salvarCrm(db, slug, { origem: "indicacao", indicadoPor: "Jéssica" });
  await assert.rejects(salvarCrm(db, slug, { origem: "tv" as never }));
  assert.equal((await crmDoc()).get("origem"), "indicacao");
}

// Saúde: implantação lida do tenant, cobrança aberta vencida vira risco
{
  const slug = "dela-limite";
  const hoje = todayIn();
  let x = await saudeDe(db, slug, hoje);
  // criado pelo próprio dono no /painel: o dono já está dentro
  assert.deepEqual(x.passos, { convite: true, servicos: false, profissionais: false, agendamento: false });
  assert.equal(x.saude, "atencao");
  await db.doc(`tenants/${slug}/members/dono-saude`).set({ uid: "dono-saude", role: "admin", email: "dono@teste.dev", createdAt: Timestamp.now() });
  await db.doc(`tenants/${slug}/services/corte`).set({ name: "Corte", durationMin: 30, priceCents: 4000, active: true });
  await db.collection("cobrancas").doc(`${slug}-mensal`).set({ slug, tipo: "mensal", competencia: "2026-01", valorCents: 5990, vencimento: addDays(hoje, -2), status: "aberta" });
  x = await saudeDe(db, slug, hoje);
  assert.deepEqual([x.passos.convite, x.passos.servicos, x.passos.profissionais], [true, true, false]);
  assert.equal(x.detalhes.convite, "dono@teste.dev");
  assert.deepEqual([x.cobranca, x.diasParaVencer, x.saude], ["atrasada", -2, "risco"]);
}

console.log("booking ok");
process.exit(0);
