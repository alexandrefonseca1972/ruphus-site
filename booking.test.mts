// Rode: npm run test:booking  (lógica de horários + reservas no emulador do Firestore)
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { verifyFirebaseToken } from "@/lib/verify-token";
import { availableSlots, book, createPlan, endPlan, loadCatalog, requireMember, reschedule, rescheduleSlots } from "@/lib/booking.server";
import { addDays, customerKey, formatPhone, freeSlots, phoneError, planDates, todayIn, weekday, zonedTime } from "@/lib/datetime";
import { BookingInput } from "@/lib/scheduling";

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

console.log("booking ok");
process.exit(0);
