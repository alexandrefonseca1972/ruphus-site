"use server";

import { headers } from "next/headers";
import { adminDb } from "@/lib/admin";
import { availableSlots, book } from "@/lib/booking.server";
import { MAX_DAYS_AHEAD, addDays, todayIn } from "@/lib/datetime";
import { BookingInput, SlotQuery } from "@/lib/scheduling";

// Chamáveis por qualquer pessoa via POST: toda entrada é validada aqui
const withinRange = (date: string) => date >= todayIn() && date <= addDays(todayIn(), MAX_DAYS_AHEAD);

export async function getSlots(input: unknown) {
  const q = SlotQuery.safeParse(input);
  return q.success && withinRange(q.data.date) ? availableSlots(adminDb, q.data) : [];
}

export async function createBooking(input: unknown) {
  const b = BookingInput.safeParse(input);
  if (!b.success) return { ok: false as const, error: b.error.issues[0].message, field: true as const };
  if (!withinRange(b.data.date)) {
    return { ok: false as const, error: `Agende com até ${MAX_DAYS_AHEAD} dias de antecedência.`, field: true as const };
  }
  // IP só para contar tentativas por dispositivo; guardado apenas como hash
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim();
  return book(adminDb, b.data, ip);
}
