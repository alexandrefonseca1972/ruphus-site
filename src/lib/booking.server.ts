import "server-only";
import { FieldValue, type Firestore, type Timestamp, type Transaction } from "firebase-admin/firestore";
import {
  addDays,
  type BookingInput,
  customerKey,
  freeSlots,
  type PlanInput,
  planDates,
  type RescheduleInput,
  Service,
  type SlotQuery,
  Staff,
  weekday,
  zonedTime,
} from "@/lib/scheduling";

const SLUG = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

/** Dados públicos da página de agendamento. Nunca inclui dados de clientes. */
export async function loadCatalog(db: Firestore, tenantId: string) {
  if (!SLUG.test(tenantId)) return null;
  const t = db.collection("tenants").doc(tenantId);
  const [tenant, services, staff] = await Promise.all([
    t.get(),
    t.collection("services").where("active", "==", true).get(),
    t.collection("staff").where("active", "==", true).get(),
  ]);
  if (!tenant.exists) return null;
  return {
    name: String(tenant.get("name")),
    services: services.docs.flatMap((d) => {
      const s = Service.safeParse(d.data());
      return s.success ? [{ id: d.id, name: s.data.name, durationMin: s.data.durationMin, priceCents: s.data.priceCents }] : [];
    }),
    staff: staff.docs.flatMap((d) => {
      const s = Staff.safeParse(d.data());
      // workDays: dias da semana em que atende (para desabilitar datas na página pública)
      return s.success ? [{ id: d.id, name: s.data.name, serviceIds: s.data.serviceIds, workDays: Object.keys(s.data.hours).map(Number) }] : [];
    }),
  };
}

/** Garante que o token é válido e o usuário é membro do tenant. */
export type VerifyToken = (idToken: string) => Promise<{ uid: string; email?: string }>;

export async function requireMember(verify: VerifyToken, db: Firestore, idToken: string, tenantId: string) {
  const user = await verify(idToken).catch(() => {
    throw new Error("Sessão expirada. Entre novamente.");
  });
  const member = await db.doc(`tenants/${tenantId}/members/${user.uid}`).get();
  if (!member.exists) throw new Error("Sem acesso a este espaço.");
  return user;
}

// excludeId: ao remarcar, o próprio agendamento não conta como ocupado
async function slotContext(tx: Transaction, db: Firestore, q: SlotQuery, excludeId?: string) {
  const t = db.collection("tenants").doc(q.tenantId);
  const [staffSnap, ...svcSnaps] = await tx.getAll(
    t.collection("staff").doc(q.staffId),
    ...q.serviceIds.map((id) => t.collection("services").doc(id)),
  );
  const staff = Staff.safeParse(staffSnap.data());
  const services = svcSnaps.map((s) => Service.safeParse(s.data()));
  if (
    !staff.success ||
    !staff.data.active ||
    !q.serviceIds.every((id) => staff.data.serviceIds.includes(id)) ||
    services.some((s) => !s.success || !s.data.active)
  ) {
    return null;
  }
  const svc = services.map((s) => s.data!);
  const durationMin = svc.reduce((sum, s) => sum + s.durationMin, 0);
  // Lido dentro da transação: uma reserva concorrente no mesmo dia/profissional força retry
  const booked = await tx.get(
    t
      .collection("appointments")
      .where("staffId", "==", q.staffId)
      .where("start", ">=", zonedTime(q.date, "00:00"))
      .where("start", "<", zonedTime(addDays(q.date, 1), "00:00")),
  );
  const slots = freeSlots({
    date: q.date,
    window: staff.data.hours[String(weekday(q.date)) as keyof Staff["hours"]],
    durationMin,
    busy: booked.docs
      .filter((d) => d.get("status") !== "cancelled" && d.id !== excludeId)
      .map((d) => ({ start: (d.get("start") as Timestamp).toDate(), end: (d.get("end") as Timestamp).toDate() })),
    now: new Date(),
  });
  return { t, svc, durationMin, staff: staff.data, slots };
}

export async function availableSlots(db: Firestore, q: SlotQuery) {
  return db.runTransaction(async (tx) => (await slotContext(tx, db, q))?.slots ?? [], { readOnly: true });
}

type Actor = { uid: string; email?: string };
type SlotContext = NonNullable<Awaited<ReturnType<typeof slotContext>>>;

/** Grava agendamento + registro "created" + cadastro do cliente. Só escritas: chame depois de todas as leituras. */
function writeAppointment(
  tx: Transaction,
  ctx: SlotContext,
  a: { serviceIds: string[]; staffId: string; date: string; time: string; customerName: string; customerPhone: string },
  by: { by: string; byName: string },
  opts: { planId?: string; renameCustomer: boolean },
) {
  const { planId } = opts;
  const start = zonedTime(a.date, a.time);
  const ref = ctx.t.collection("appointments").doc();
  const history = ctx.t.collection("history").doc();
  const key = customerKey(a.customerPhone);
  tx.create(history, { appointmentId: ref.id, type: "created", at: FieldValue.serverTimestamp(), ...by, ...(planId && { planId }) });
  tx.create(ref, {
    lastHistoryId: history.id,
    serviceIds: a.serviceIds,
    serviceName: ctx.svc.map((s) => s.name).join(" + "),
    durationMin: ctx.durationMin,
    priceCents: ctx.svc.reduce((sum, s) => sum + s.priceCents, 0),
    staffId: a.staffId,
    staffName: ctx.staff.name,
    start,
    end: new Date(start.getTime() + ctx.durationMin * 60_000),
    customerKey: key,
    customerName: a.customerName,
    customerPhone: a.customerPhone,
    status: "booked",
    createdAt: FieldValue.serverTimestamp(),
    ...(planId && { planId }),
  });
  // Reserva anônima não troca o nome de um cliente já cadastrado (qualquer um pode digitar o telefone de outro)
  tx.set(
    ctx.t.collection("customers").doc(key),
    { ...(opts.renameCustomer && { name: a.customerName }), phone: a.customerPhone, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return ref.id;
}

export async function book(db: Firestore, input: BookingInput) {
  return db.runTransaction(async (tx) => {
    const ctx = await slotContext(tx, db, input);
    if (!ctx) return { ok: false as const, error: "Serviço ou profissional indisponível." };
    if (!ctx.slots.includes(input.time)) {
      return { ok: false as const, error: "Esse horário acabou de ser ocupado. Escolha outro." };
    }
    const customer = await tx.get(ctx.t.collection("customers").doc(customerKey(input.customerPhone)));
    const id = writeAppointment(tx, ctx, input, { by: "cliente", byName: input.customerName }, { renameCustomer: !customer.exists });
    return { ok: true as const, id };
  });
}

/** Cria o plano e um agendamento por semana. Datas ocupadas (ou já passadas) são puladas e devolvidas. */
export async function createPlan(db: Firestore, input: PlanInput, actor: Actor) {
  return db.runTransaction(async (tx) => {
    const dates = planDates(input.startDate, input.weekday, input.weeks);
    const free: { date: string; ctx: SlotContext }[] = [];
    const skipped: string[] = [];
    for (const date of dates) {
      const ctx = await slotContext(tx, db, { ...input, date });
      if (!ctx) return { ok: false as const, error: "Serviço ou profissional indisponível." };
      if (ctx.slots.includes(input.time)) free.push({ date, ctx });
      else skipped.push(date);
    }
    if (free.length === 0) {
      return { ok: false as const, error: "Nenhuma das datas tem esse horário livre com o profissional." };
    }
    const t = db.collection("tenants").doc(input.tenantId);
    const plan = t.collection("plans").doc();
    const by = { by: actor.uid, byName: actor.email ?? actor.uid };
    tx.create(plan, {
      customerKey: customerKey(input.customerPhone),
      customerName: input.customerName,
      serviceIds: input.serviceIds,
      serviceName: free[0].ctx.svc.map((s) => s.name).join(" + "),
      staffId: input.staffId,
      staffName: free[0].ctx.staff.name,
      weekday: input.weekday,
      time: input.time,
      firstDate: free[0].date,
      lastDate: free.at(-1)!.date,
      count: free.length,
      skipped,
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
      createdBy: by.byName,
    });
    for (const { date, ctx } of free) writeAppointment(tx, ctx, { ...input, date }, by, { planId: plan.id, renameCustomer: true });
    return { ok: true as const, planId: plan.id, created: free.map((f) => f.date), skipped };
  });
}

/** Encerra o plano: cancela os agendamentos futuros dele, com registro no histórico. */
export async function endPlan(db: Firestore, input: { tenantId: string; planId: string }, actor: Actor) {
  return db.runTransaction(async (tx) => {
    const t = db.collection("tenants").doc(input.tenantId);
    const plan = await tx.get(t.collection("plans").doc(input.planId));
    if (!plan.exists || plan.get("status") !== "active") return { ok: false as const, error: "Plano não encontrado ou já encerrado." };
    const future = await tx.get(
      t.collection("appointments").where("planId", "==", input.planId).where("start", ">", new Date()),
    );
    const toCancel = future.docs.filter((d) => ["booked", "confirmed"].includes(d.get("status")));
    const by = { by: actor.uid, byName: actor.email ?? actor.uid };
    for (const appt of toCancel) {
      const history = t.collection("history").doc();
      tx.create(history, { appointmentId: appt.id, type: "cancelled", reason: "plan_ended", at: FieldValue.serverTimestamp(), ...by });
      tx.update(appt.ref, { status: "cancelled", lastHistoryId: history.id });
    }
    tx.update(plan.ref, { status: "ended", endedAt: FieldValue.serverTimestamp(), endedBy: by.byName });
    return { ok: true as const, cancelled: toCancel.length };
  });
}

async function rescheduleContext(tx: Transaction, db: Firestore, q: Omit<RescheduleInput, "time">) {
  const ref = db.doc(`tenants/${q.tenantId}/appointments/${q.appointmentId}`);
  const appt = await tx.get(ref);
  if (!appt.exists || !["booked", "confirmed"].includes(appt.get("status"))) return null;
  const query = { tenantId: q.tenantId, serviceIds: appt.get("serviceIds") as string[], staffId: appt.get("staffId") as string, date: q.date };
  const ctx = await slotContext(tx, db, query, q.appointmentId);
  return ctx && { ...ctx, ref, appt };
}

export async function rescheduleSlots(db: Firestore, q: Omit<RescheduleInput, "time">) {
  return db.runTransaction(async (tx) => (await rescheduleContext(tx, db, q))?.slots ?? [], { readOnly: true });
}

export async function reschedule(db: Firestore, input: RescheduleInput, actor: Actor) {
  return db.runTransaction(async (tx) => {
    const ctx = await rescheduleContext(tx, db, input);
    if (!ctx) return { ok: false as const, error: "Agendamento, serviço ou profissional indisponível." };
    if (!ctx.slots.includes(input.time)) return { ok: false as const, error: "Esse horário não está livre. Escolha outro." };
    const start = zonedTime(input.date, input.time);
    const end = new Date(start.getTime() + ctx.durationMin * 60_000);
    const history = ctx.t.collection("history").doc();
    tx.create(history, {
      appointmentId: ctx.ref.id,
      type: "rescheduled",
      at: FieldValue.serverTimestamp(),
      by: actor.uid,
      byName: actor.email ?? actor.uid,
      from: { start: ctx.appt.get("start"), end: ctx.appt.get("end") },
      to: { start, end },
    });
    tx.update(ctx.ref, {
      lastHistoryId: history.id,
      start,
      end,
      // Duração vem dos serviços atuais: mantém nome/duração/preço coerentes com o novo fim
      serviceName: ctx.svc.map((s) => s.name).join(" + "),
      durationMin: ctx.durationMin,
      priceCents: ctx.svc.reduce((sum, s) => sum + s.priceCents, 0),
      status: "booked", // precisa de nova confirmação
      rescheduledAt: FieldValue.serverTimestamp(),
    });
    return { ok: true as const };
  });
}
