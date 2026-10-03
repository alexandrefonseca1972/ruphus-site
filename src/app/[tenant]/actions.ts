"use server";

import { adminDb } from "@/lib/admin";
import { createPlan, deleteCustomer, endPlan, renameCustomer, requireMember, reschedule, rescheduleSlots, salvarDadosCliente, UserError } from "@/lib/booking.server";
import { DadosCliente } from "@/lib/cliente-dados";
import { erroNome } from "@/lib/nome";
import { z } from "zod";
import { PlanInput, Recado, RescheduleInput, Staff } from "@/lib/scheduling";
import { revalidatePath } from "next/cache";
import { criarProfissional, lerNegocio, salvarNegocio } from "@/lib/negocios.server";
import { cancelar, Inscricao, inscrever, inscrito } from "@/lib/avisos.server";
import { verifyFirebaseToken } from "@/lib/verify-token";

// Chamáveis por POST direto: valida entrada e membro do tenant em toda chamada
const SlotsInput = RescheduleInput.omit({ time: true });
const docIdStaff = z.string().min(1).max(128).regex(/^[^/]+$/);

export async function getRescheduleSlots(idToken: string, input: unknown) {
  const q = SlotsInput.safeParse(input);
  if (!q.success) return { ok: false as const, error: "Dados inválidos." };
  try {
    await requireMember(verifyFirebaseToken, adminDb, idToken, q.data.tenantId);
    return { ok: true as const, slots: await rescheduleSlots(adminDb, q.data) };
  } catch (err) {
    if (err instanceof UserError) return { ok: false as const, error: err.message };
    console.error("[agenda] falha ao buscar horários para remarcar", err);
    return { ok: false as const, error: "Não foi possível carregar os horários." };
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

/** Profissional novo passa pelo servidor: as regras não deixam o cliente criar. */
export const criarProfissionalAction = memberAction(
  z.object({ tenantId: docIdStaff, dados: Staff }),
  async (data) => ({ ok: true as const, id: await criarProfissional(adminDb, data.tenantId, data.dados) }),
);

export const rescheduleAppointment = memberAction(RescheduleInput, (data, user) => reschedule(adminDb, data, user));
export const createPlanAction = memberAction(PlanInput, (data, user) => createPlan(adminDb, data, user));
const docId = z.string().min(1).max(128).regex(/^[^/]+$/);
export const endPlanAction = memberAction(
  z.object({ tenantId: docId, planId: docId }),
  (data, user) => endPlan(adminDb, data, user),
);

export const renameCustomerAction = memberAction(
  z.object({ tenantId: docId, customerId: docId, name: z
      .string()
      .trim()
      .max(80)
      // a regra da agenda (#82): sem ela, o dono renomeava para "3232" ou "."
      .refine((v) => !erroNome(v), "Use só letras no nome, com pelo menos 2."),
  }),
  (data, user) => renameCustomer(adminDb, data, user),
);

export const salvarDadosClienteAction = memberAction(
  z.object({ tenantId: docId, customerId: docId, dados: DadosCliente }),
  (data, user) => salvarDadosCliente(adminDb, data, user),
);

export const deleteCustomerAction = memberAction(
  z.object({ tenantId: docId, customerId: docId }),
  (data, user) => deleteCustomer(adminDb, data, user),
);

/** Dados do negócio só para quem gere: dono, admin do negócio ou da plataforma. */
async function exigeGestor(tenantId: string, uid: string) {
  const [membro, plataforma] = await Promise.all([adminDb.doc(`tenants/${tenantId}/members/${uid}`).get(), adminDb.doc("config/admin").get()]);
  const gere = ["owner", "admin"].includes(membro.get("role")) || ((plataforma.get("uids") as unknown[] | undefined)?.includes(uid) ?? false);
  if (!gere) throw new UserError("Só o dono ou um administrador do negócio pode mudar esses dados.");
}

export const lerNegocioAction = memberAction(z.object({ tenantId: docIdStaff }), async (data, user) => {
  await exigeGestor(data.tenantId, user.uid);
  return { ok: true as const, dados: await lerNegocio(adminDb, data.tenantId) };
});

// Avisos de agendamento neste aparelho: qualquer membro (cada um decide o seu celular)
export const inscreverAvisosAction = memberAction(z.object({ tenantId: docIdStaff, inscricao: Inscricao }), async (data, user) => {
  await inscrever(adminDb, data.tenantId, user.uid, data.inscricao);
  return { ok: true as const };
});

export const avisosLigadosAction = memberAction(z.object({ tenantId: docIdStaff, endpoint: Inscricao.shape.endpoint }), async (data, user) => ({
  ok: true as const,
  ligado: await inscrito(adminDb, data.tenantId, user.uid, data.endpoint),
}));

export const cancelarAvisosAction = memberAction(z.object({ tenantId: docIdStaff, endpoint: Inscricao.shape.endpoint }), async (data) => {
  await cancelar(adminDb, data.tenantId, data.endpoint);
  return { ok: true as const };
});

export const salvarRecadoAction = memberAction(z.object({ tenantId: docIdStaff, recado: Recado }), async (data, user) => {
  await exigeGestor(data.tenantId, user.uid);
  await adminDb.doc(`tenants/${data.tenantId}`).update({ "agenda.recado": data.recado });
  revalidatePath(`/agendar/${data.tenantId}`);
  return { ok: true as const };
});

export const salvarNegocioAction = memberAction(z.object({ tenantId: docIdStaff, dados: z.unknown() }), async (data, user) => {
  await exigeGestor(data.tenantId, user.uid);
  await salvarNegocio(adminDb, data.tenantId, data.dados);
  // o site, a imagem do WhatsApp e a bio mostram a mudança agora, não em até uma hora
  for (const p of ["index.html", "og.jpg"]) revalidatePath(`/s/${data.tenantId}/${p}`);
  revalidatePath(`/bio/${data.tenantId}`);
  return { ok: true as const };
});
