"use server";

import { adminAuth, adminDb } from "@/lib/admin";
import { requireMember, reschedule, rescheduleSlots } from "@/lib/booking.server";
import { RescheduleInput } from "@/lib/scheduling";

// Chamáveis por POST direto: valida entrada e membro do tenant em toda chamada
const SlotsInput = RescheduleInput.omit({ time: true });

export async function getRescheduleSlots(idToken: string, input: unknown) {
  const q = SlotsInput.safeParse(input);
  if (!q.success) return [];
  await requireMember(adminAuth, adminDb, idToken, q.data.tenantId);
  return rescheduleSlots(adminDb, q.data);
}

export async function rescheduleAppointment(idToken: string, input: unknown) {
  const r = RescheduleInput.safeParse(input);
  if (!r.success) return { ok: false as const, error: r.error.issues[0].message };
  try {
    await requireMember(adminAuth, adminDb, idToken, r.data.tenantId);
  } catch (err) {
    return { ok: false as const, error: (err as Error).message };
  }
  return reschedule(adminDb, r.data);
}
