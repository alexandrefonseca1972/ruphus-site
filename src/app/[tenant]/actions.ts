"use server";

import { adminDb } from "@/lib/admin";
import { createPlan, endPlan, requireMember, reschedule, rescheduleSlots } from "@/lib/booking.server";
import { z } from "zod";
import { PlanInput, RescheduleInput } from "@/lib/scheduling";
import { verifyFirebaseToken } from "@/lib/verify-token";

// Chamáveis por POST direto: valida entrada e membro do tenant em toda chamada
const SlotsInput = RescheduleInput.omit({ time: true });

export async function getRescheduleSlots(idToken: string, input: unknown) {
  const q = SlotsInput.safeParse(input);
  if (!q.success) return [];
  await requireMember(verifyFirebaseToken, adminDb, idToken, q.data.tenantId);
  return rescheduleSlots(adminDb, q.data);
}

/** Valida a entrada e o membro; erros esperados voltam como { ok: false, error } */
function memberAction<S extends z.ZodType<{ tenantId: string }>, R>(
  schema: S,
  run: (data: z.infer<S>, user: { uid: string; email?: string }) => Promise<R>,
) {
  return async (idToken: string, input: unknown) => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
    try {
      return await run(parsed.data, await requireMember(verifyFirebaseToken, adminDb, idToken, parsed.data.tenantId));
    } catch (err) {
      return { ok: false as const, error: (err as Error).message };
    }
  };
}

export const rescheduleAppointment = memberAction(RescheduleInput, (data, user) => reschedule(adminDb, data, user));
export const createPlanAction = memberAction(PlanInput, (data, user) => createPlan(adminDb, data, user));
export const endPlanAction = memberAction(
  z.object({ tenantId: PlanInput.shape.tenantId, planId: z.string().min(1).max(128).regex(/^[^/]+$/) }),
  (data, user) => endPlan(adminDb, data, user),
);
