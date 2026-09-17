// Rode: npm run test:booking  (lógica de horários + reservas no emulador do Firestore)
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { availableSlots, book, loadCatalog } from "@/lib/booking.server";
import { addDays, BookingInput, freeSlots, todayIn, weekday, zonedTime } from "@/lib/scheduling";

// Funções puras
assert.equal(zonedTime("2026-09-20", "09:00").toISOString(), "2026-09-20T12:00:00.000Z");
assert.equal(weekday("2026-09-20"), 0); // domingo
assert.equal(addDays("2026-12-31", 1), "2027-01-01");
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
const db = getFirestore(initializeApp({ projectId: "demo-siteflow" }));
const t = db.collection("tenants").doc("salao");
await t.set({ name: "Salão Teste", ownerId: "owner" });
await t.collection("services").doc("corte").set({ name: "Corte", durationMin: 30, priceCents: 5000, active: true });
await t.collection("services").doc("luzes").set({ name: "Luzes", durationMin: 90, priceCents: 20000, active: true });
await t.collection("services").doc("off").set({ name: "Antigo", durationMin: 30, priceCents: 1, active: false });
const hours = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, { start: "09:00", end: "12:00" }]));
await t.collection("staff").doc("ana").set({ name: "Ana", serviceIds: ["corte", "luzes"], hours, active: true });
await t.collection("staff").doc("bia").set({ name: "Bia", serviceIds: ["corte"], hours, active: true });

const date = addDays(todayIn(), 7);
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
assert.equal((await book(db, { ...base, staffId: "bia", serviceIds: ["corte"], time: "09:00" })).ok, true, "outra profissional, mesmo horário");
assert.equal((await book(db, { ...base, serviceIds: ["corte"], time: "09:00", date: addDays(todayIn(), -1) })).ok, false, "no passado");

// Vários serviços: Bia faz só corte; Ana faz corte + luzes (30 + 90 = 120 min, R$ 250)
assert.equal((await book(db, { ...base, staffId: "bia", serviceIds: ["corte", "luzes"], time: "11:00" })).ok, false, "profissional não faz todos");
assert.equal((await book(db, { ...base, serviceIds: ["corte", "off"], time: "11:00" })).ok, false, "um dos serviços inativo");
assert.equal(BookingInput.safeParse({ ...base, serviceIds: ["corte", "corte"], time: "11:00" }).success, false, "serviço repetido");
const combo = { ...base, date: addDays(todayIn(), 8), serviceIds: ["corte", "luzes"] };
assert.deepEqual(await availableSlots(db, combo), ["09:00", "09:15", "09:30", "09:45", "10:00"]); // termina até 12:00
const booked = await book(db, { ...combo, time: "09:30" });
assert.equal(booked.ok, true, "combo");
const saved = (await t.collection("appointments").doc(booked.ok ? booked.id : "").get()).data()!;
assert.equal(saved.serviceName, "Corte + Luzes");
assert.equal(saved.durationMin, 120);
assert.equal(saved.priceCents, 25000);
assert.equal(saved.end.toMillis() - saved.start.toMillis(), 120 * 60_000);
assert.deepEqual(await availableSlots(db, { ...combo, serviceIds: ["corte"] }), ["09:00", "11:30"], "combo ocupa 09:30–11:30");

// Concorrência: 10 clientes no mesmo horário, só 1 consegue
const results = await Promise.all(
  Array.from({ length: 10 }, (_, i) => book(db, { ...base, serviceIds: ["luzes"], time: "10:00", customerName: `C${i}` })),
);
assert.equal(results.filter((r) => r.ok).length, 1, "concorrência");

// Cancelado libera o horário
const luzes = await t.collection("appointments").where("serviceIds", "==", ["luzes"]).get();
await luzes.docs[0].ref.update({ status: "cancelled" });
assert.equal((await book(db, { ...base, serviceIds: ["luzes"], time: "10:00" })).ok, true, "após cancelamento");

console.log("booking ok");
process.exit(0);
