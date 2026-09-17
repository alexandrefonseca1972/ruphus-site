"use server";

import { adminDb } from "@/lib/admin";
import { createPlan, endPlan, requireMember, reschedule, rescheduleSlots, UserError } from "@/lib/booking.server";
import { z } from "zod";
import { PlanInput, RescheduleInput } from "@/lib/scheduling";
import { verifyFirebaseToken } from "@/lib/verify-token";

// Chamáveis por POST direto: valida entrada e membro do tenant em toda chamada
const SlotsInput = RescheduleInput.omit({ time: true });

export async function getRescheduleSlots(idToken: string, input: unknown) {
  const q = SlotsInput.safeParse(input);
  if (!q.success) return [];
  try {
    await requireMember(verifyFirebaseToken, adminDb, idToken, q.data.tenantId);
    return await rescheduleSlots(adminDb, q.data);
  } catch (err) {
    console.error("[agenda] falha ao buscar horários para remarcar", err);
    return [];
  }
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
      // Só mensagens previstas chegam ao navegador; o resto vai para o log do servidor
      if (err instanceof UserError) return { ok: false as const, error: err.message };
      console.error("[painel] erro inesperado em ação do tenant", err);
      return { ok: false as const, error: "Não foi possível concluir agora. Tente de novo." };
    }
  };
}

export const rescheduleAppointment = memberAction(RescheduleInput, (data, user) => reschedule(adminDb, data, user));
export const createPlanAction = memberAction(PlanInput, (data, user) => createPlan(adminDb, data, user));
const docId = z.string().min(1).max(128).regex(/^[^/]+$/);
export const endPlanAction = memberAction(
  z.object({ tenantId: docId, planId: docId }),
  (data, user) => endPlan(adminDb, data, user),
);
