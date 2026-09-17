import "server-only";
import { FieldValue, type Firestore, type Timestamp, type Transaction } from "firebase-admin/firestore";
import {
  addDays,
  type BookingInput,
  freeSlots,
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
      return s.success ? [{ id: d.id, name: s.data.name, serviceIds: s.data.serviceIds }] : [];
    }),
  };
}

async function slotContext(tx: Transaction, db: Firestore, q: SlotQuery) {
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
      .filter((d) => d.get("status") !== "cancelled")
      .map((d) => ({ start: (d.get("start") as Timestamp).toDate(), end: (d.get("end") as Timestamp).toDate() })),
    now: new Date(),
  });
  return { t, svc, durationMin, staff: staff.data, slots };
}

export async function availableSlots(db: Firestore, q: SlotQuery) {
  return db.runTransaction(async (tx) => (await slotContext(tx, db, q))?.slots ?? [], { readOnly: true });
}

export async function book(db: Firestore, input: BookingInput) {
  return db.runTransaction(async (tx) => {
    const ctx = await slotContext(tx, db, input);
    if (!ctx) return { ok: false as const, error: "Serviço ou profissional indisponível." };
    if (!ctx.slots.includes(input.time)) {
      return { ok: false as const, error: "Esse horário acabou de ser ocupado. Escolha outro." };
    }
    const start = zonedTime(input.date, input.time);
    const ref = ctx.t.collection("appointments").doc();
    tx.create(ref, {
      serviceIds: input.serviceIds,
      serviceName: ctx.svc.map((s) => s.name).join(" + "),
      durationMin: ctx.durationMin,
      priceCents: ctx.svc.reduce((sum, s) => sum + s.priceCents, 0),
      staffId: input.staffId,
      staffName: ctx.staff.name,
      start,
      end: new Date(start.getTime() + ctx.durationMin * 60_000),
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      status: "booked",
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ok: true as const, id: ref.id };
  });
}
