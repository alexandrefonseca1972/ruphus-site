"use server";

import { adminDb } from "@/lib/admin";
import { availableSlots, book } from "@/lib/booking.server";
import { BookingInput, SlotQuery } from "@/lib/scheduling";

// Chamáveis por qualquer pessoa via POST: toda entrada é validada aqui
export async function getSlots(input: unknown) {
  const q = SlotQuery.safeParse(input);
  return q.success ? availableSlots(adminDb, q.data) : [];
}

export async function createBooking(input: unknown) {
  const b = BookingInput.safeParse(input);
  if (!b.success) return { ok: false as const, error: b.error.issues[0].message };
  return book(adminDb, b.data);
}
