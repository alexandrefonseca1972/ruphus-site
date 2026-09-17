// Rode: npm run test:scale — 1 a 5 profissionais, muitos agendamentos simultâneos, no emulador
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore, type Timestamp } from "firebase-admin/firestore";
import { availableSlots, book, createPlan, endPlan, loadCatalog } from "@/lib/booking.server";
import { addDays, freeSlots, todayIn, type Window, weekday } from "@/lib/datetime";

const db = getFirestore(initializeApp({ projectId: "demo-siteflow" }));
const actor = { uid: "dono", email: "dono@teste.dev" };
const HOURS: Record<string, Window> = Object.fromEntries(
  ["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, { start: "09:00", end: "18:00" }]),
);
const SERVICES = [
  { id: "corte", name: "Corte", durationMin: 30, priceCents: 5000 },
  { id: "barba", name: "Barba", durationMin: 15, priceCents: 3000 },
  { id: "combo", name: "Combo", durationMin: 60, priceCents: 9000 },
];

async function setupTenant(tenantId: string, staffCount: number) {
  const t = db.collection("tenants").doc(tenantId);
  const batch = db.batch();
  batch.set(t, { name: tenantId, ownerId: actor.uid });
  for (const s of SERVICES) batch.set(t.collection("services").doc(s.id), { ...s, active: true });
  const staffIds = Array.from({ length: staffCount }, (_, i) => `prof${i + 1}`);
  for (const id of staffIds) {
    batch.set(t.collection("staff").doc(id), {
      name: id.toUpperCase(),
      serviceIds: SERVICES.map((s) => s.id),
      hours: HOURS,
      active: true,
    });
  }
  await batch.commit();
  return { t, staffIds };
}

/** Invariantes que sempre valem, não importa a ordem das reservas */
async function checkTenant(t: FirebaseFirestore.DocumentReference, staffIds: string[], db: Firestore) {
  const appts = (await t.collection("appointments").get()).docs.map((d) => ({
    id: d.id,
    staffId: d.get("staffId") as string,
    start: (d.get("start") as Timestamp).toDate(),
    end: (d.get("end") as Timestamp).toDate(),
    durationMin: d.get("durationMin") as number,
    serviceIds: d.get("serviceIds") as string[],
    status: d.get("status") as string,
    lastHistoryId: d.get("lastHistoryId") as string,
  }));
  const active = appts.filter((a) => a.status !== "cancelled");

  for (const staffId of staffIds) {
    const mine = active.filter((a) => a.staffId === staffId).sort((a, b) => +a.start - +b.start);
    for (let i = 1; i < mine.length; i++) {
      assert.ok(
        mine[i].start >= mine[i - 1].end,
        `sobreposição em ${staffId}: ${mine[i - 1].start.toISOString()}–${mine[i - 1].end.toISOString()} e ${mine[i].start.toISOString()}`,
      );
    }
  }
  for (const a of appts) {
    const expected = a.serviceIds.reduce((sum, id) => sum + SERVICES.find((s) => s.id === id)!.durationMin, 0);
    assert.equal(a.durationMin, expected, "duração = soma dos serviços");
    assert.equal(+a.end - +a.start, a.durationMin * 60_000, "fim = início + duração");
    const slotsThatDay = freeSlots({
      date: a.start.toISOString().slice(0, 10),
      window: HOURS[String(weekday(a.start.toISOString().slice(0, 10)))],
      durationMin: a.durationMin,
      busy: [],
      now: new Date(0),
    });
    const hhmm = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(a.start);
    assert.ok(slotsThatDay.includes(hhmm), `${hhmm} fora do expediente/grade`);
    const history = await db.doc(`${t.path}/history/${a.lastHistoryId}`).get();
    assert.ok(history.exists, "todo agendamento tem registro no histórico");
  }
  return { total: appts.length, active: active.length };
}

const date = addDays(todayIn(), 3);
console.log("dia do teste:", date);

for (const staffCount of [1, 2, 3, 4, 5]) {
  const tenantId = `escala-${staffCount}`;
  const { t, staffIds } = await setupTenant(tenantId, staffCount);
  const started = Date.now();

  // Todos os horários possíveis do dia (grade de 15 min entre 09:00 e 18:00)
  const grid = freeSlots({ date, window: HOURS["1"], durationMin: 15, busy: [], now: new Date(0) });

  // Investida: cada profissional recebe 3 tentativas para cada horário, todas ao mesmo tempo
  const attempts = staffIds.flatMap((staffId) =>
    grid.flatMap((time, i) =>
      Array.from({ length: 3 }, (_, k) => ({
        tenantId,
        staffId,
        serviceIds: [SERVICES[(i + k) % 3].id],
        date,
        time,
        customerName: `Cliente ${staffId}-${time}-${k}`,
        customerPhone: `11${String(900000000 + i * 7 + k).slice(-9)}`, // telefone único por tentativa
      })),
    ),
  );
  // Em ondas de 12 simultâneas (mais parecido com a realidade), mais uma rajada no mesmo horário
  const results: Awaited<ReturnType<typeof book>>[] = [];
  for (let i = 0; i < attempts.length; i += 12) {
    results.push(...(await Promise.all(attempts.slice(i, i + 12).map((a) => book(db, a)))));
  }
  const burst = await Promise.all(
    Array.from({ length: 10 }, (_, k) =>
      book(db, { tenantId, staffId: staffIds[0], serviceIds: ["combo"], date: addDays(date, 1), time: "10:00", customerName: `Rajada ${k}`, customerPhone: `11955551${String(100 + k)}` }),
    ),
  );
  assert.equal(burst.filter((r) => r.ok).length, 1, "rajada no mesmo horário: só 1 entra");
  results.push(...burst);
  const ok = results.filter((r) => r.ok).length;
  const busy = results.filter((r) => !r.ok && "error" in r && r.error.includes("Muita gente")).length;
  const { total, active } = await checkTenant(t, staffIds, db);

  // Plano recorrente para cada profissional, no mesmo horário (sem conflito entre eles)
  const plans = await Promise.all(
    staffIds.map((staffId) =>
      createPlan(db, { tenantId, customerName: `Mensalista ${staffId}`, customerPhone: `1195555${String(4440 + Number(staffId.slice(-1)))}`, serviceIds: ["corte"], staffId, weekday: 1, time: "12:00", startDate: addDays(todayIn(), 7), weeks: 8 }, actor),
    ),
  );
  assert.ok(plans.every((p) => p.ok), "todos os planos criados");
  await checkTenant(t, staffIds, db);

  // Horários livres batem com o que foi reservado
  for (const staffId of staffIds) {
    const free = await availableSlots(db, { tenantId, staffId, serviceIds: ["barba"], date });
    const busy = (await t.collection("appointments").where("staffId", "==", staffId).get()).docs
      .filter((d) => d.get("status") !== "cancelled")
      .map((d) => ({ start: (d.get("start") as Timestamp).toDate(), end: (d.get("end") as Timestamp).toDate() }));
    for (const slot of free) {
      const start = new Date(`${date}T${slot}:00-03:00`);
      const end = new Date(start.getTime() + 15 * 60_000);
      assert.ok(!busy.some((b) => b.start < end && b.end > start), `${slot} livre mas ocupado (${staffId})`);
    }
  }

  // Encerrar todos os planos cancela os futuros
  for (const p of plans) if (p.ok) assert.ok((await endPlan(db, { tenantId, planId: p.planId }, actor)).ok);
  const after = await checkTenant(t, staffIds, db);

  const catalog = await loadCatalog(db, tenantId);
  assert.equal(catalog?.staff.length, staffCount);
  assert.equal(JSON.stringify(catalog).includes("customer"), false, "catálogo público sem dados de cliente");

  console.log(
    `${staffCount} profissional(is): ${attempts.length + 10} tentativas → ${ok} reservas, ${busy} adiadas por disputa, ${total} agendamentos (${active} ativos), ` +
      `${after.active} após encerrar planos, ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}

console.log("scale ok");
process.exit(0);
