"use server";

import { adminDb } from "@/lib/admin";
import { availableSlots, book } from "@/lib/booking.server";
import { addDays, BookingInput, MAX_DAYS_AHEAD, SlotQuery, todayIn } from "@/lib/scheduling";

// Chamáveis por qualquer pessoa via POST: toda entrada é validada aqui
const withinRange = (date: string) => date >= todayIn() && date <= addDays(todayIn(), MAX_DAYS_AHEAD);

export async function getSlots(input: unknown) {
  const q = SlotQuery.safeParse(input);
  return q.success && withinRange(q.data.date) ? availableSlots(adminDb, q.data) : [];
}

export async function createBooking(input: unknown) {
  const b = BookingInput.safeParse(input);
  if (!b.success) return { ok: false as const, error: b.error.issues[0].message };
  if (!withinRange(b.data.date)) return { ok: false as const, error: `Agende com até ${MAX_DAYS_AHEAD} dias de antecedência.` };
  return book(adminDb, b.data);
}
