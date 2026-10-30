"use server";

import { adminDb } from "@/lib/admin";
import { createPlan, deleteCustomer, endPlan, renameCustomer, requireMember, reschedule, rescheduleSlots, salvarDadosCliente, UserError } from "@/lib/booking.server";
import { DadosCliente } from "@/lib/cliente-dados";
import { erroNome } from "@/lib/nome";
import { z } from "zod";
import { PlanInput, Recado, RescheduleInput, Staff } from "@/lib/scheduling";
import { revalidatePath } from "next/cache";
import { criarProfissional, lerNegocio, salvarNegocio } from "@/lib/negocios.server";
import { createInstance, getQr, getStatus, logout, sendText } from "@/lib/wtsfy";
import { aceitarTermoWhatsApp, desligarConexao, gravarConexao, lerConfigWhatsApp, lerConexao } from "@/lib/whatsapp.server";
import { cancelar, Inscricao, inscrever, inscrito } from "@/lib/avisos.server";
import { verifyFirebaseToken } from "@/lib/verify-token";
import { BaixaInput, EstornoInput, FixaInput, LancamentoInput, PagamentoInput } from "@/lib/financeiro";
import { adicionarFixa, baixarAgendamento, definirComissao, editar, estornar, excluir, lancar, pagar, removerFixa } from "@/lib/financeiro.server";

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
  async (data, user) => {
    await exigeGestor(data.tenantId, user.uid);
    return { ok: true as const, id: await criarProfissional(adminDb, data.tenantId, data.dados) };
  },
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

// Só dígitos, DDI+DDD+número: é o formato que o gateway (wtsfy) exige no envio.
const FONE_INTERNACIONAL = /^\d{10,15}$/;

/** Texto pelo WhatsApp que o dono conectou ao negócio (gateway wtsfy): sai do
 *  número dele, não da Ruphus. Cai no wa.me comum quando ninguém conectou. */
export const enviarWhatsAppAction = memberAction(
  z.object({
    tenantId: docIdStaff,
    phone: z.string().regex(FONE_INTERNACIONAL, "Use só números, com DDI e DDD (ex.: 5511998887777)."),
    message: z.string().trim().min(1, "Escreva a mensagem.").max(1000, "Mensagem longa demais (máx. 1000)."),
  }),
  async (data, user) => {
    await exigeGestor(data.tenantId, user.uid);
    const instanceId = (await adminDb.doc(`tenants/${data.tenantId}`).get()).get("whatsapp.instanceId") as string | undefined;
    if (!instanceId) throw new UserError("O WhatsApp do negócio ainda não está conectado.");
    const envio = await sendText(instanceId, data.phone, data.message);
    return { ok: true as const, messageId: envio.messageId };
  },
);

// ─── WhatsApp do negócio (painel do dono) ────────────────────────────────────
// A mesma seção existe no /admin da plataforma, com prioridade: quando a
// plataforma assume a conexão (ownerManaged false), aqui vira só leitura.

const SoTenant = z.object({ tenantId: docIdStaff });

export const lerWhatsAppDoNegocioAction = memberAction(SoTenant, async ({ tenantId }, user) => {
  await exigeGestor(tenantId, user.uid);
  return lerConfigWhatsApp(adminDb, tenantId);
});

export const aceitarTermoWhatsAppAction = memberAction(SoTenant, async ({ tenantId }, user) => {
  await exigeGestor(tenantId, user.uid);
  await aceitarTermoWhatsApp(adminDb, tenantId);
  return true;
});

export const conectarWhatsAppDonoAction = memberAction(SoTenant, async ({ tenantId }, user) => {
  await exigeGestor(tenantId, user.uid);
  const config = await lerConfigWhatsApp(adminDb, tenantId);
  if (config?.ownerManaged === false) {
    throw new UserError("O WhatsApp do seu negócio é gerenciado pela plataforma. Fale com o suporte para conectar ou alterar.");
  }
  if (!config?.termsAcceptedAt) {
    throw new UserError("Leia e aceite o termo sobre o WhatsApp antes de conectar.");
  }
  if (await lerConexao(adminDb, tenantId)) throw new UserError("Já existe um WhatsApp conectado. Desconecte antes de trocar de número.");
  const { id } = await createInstance(`ruphus-${tenantId}`);
  const conexao = { instanceId: id, phone: null, status: "created", updatedAt: Date.now(), ownerManaged: true };
  await gravarConexao(adminDb, tenantId, conexao);
  return conexao;
});

export const refreshWhatsAppStatusDonoAction = memberAction(SoTenant, async ({ tenantId }, user) => {
  await exigeGestor(tenantId, user.uid);
  const salva = await lerConexao(adminDb, tenantId);
  if (!salva) return null;
  const vivo = await getStatus(salva.instanceId);
  const conexao = { ...salva, phone: vivo.phone ?? salva.phone, status: vivo.status, updatedAt: Date.now() };
  await gravarConexao(adminDb, tenantId, conexao);
  return conexao;
});

export const qrWhatsAppDonoAction = memberAction(SoTenant, async ({ tenantId }, user) => {
  await exigeGestor(tenantId, user.uid);
  const config = await lerConfigWhatsApp(adminDb, tenantId);
  if (config?.ownerManaged === false) throw new UserError("Gerenciado pela plataforma — quem conecta é o suporte.");
  const salva = await lerConexao(adminDb, tenantId);
  if (!salva) throw new UserError("Conecte o WhatsApp antes de pedir o QR.");
  return getQr(salva.instanceId);
});

export const desconectarWhatsAppDonoAction = memberAction(SoTenant, async ({ tenantId }, user) => {
  await exigeGestor(tenantId, user.uid);
  const config = await lerConfigWhatsApp(adminDb, tenantId);
  if (config?.ownerManaged === false) throw new UserError("Gerenciado pela plataforma — quem desconecta é o suporte.");
  const salva = await lerConexao(adminDb, tenantId);
  if (salva) await logout(salva.instanceId).catch(() => {});
  await desligarConexao(adminDb, tenantId);
  return "desconectado";
});

/** Lembretes de horário: o dono liga/desliga e escolhe quantas horas antes de
 *  cada agendamento confirmado o cliente recebe o lembrete. */
export const configurarLembretesWhatsAppAction = memberAction(
  z.object({
    tenantId: docIdStaff,
    enabled: z.boolean(),
    hours: z.number().int().min(1, "No mínimo 1 hora antes.").max(24, "No máximo 24 horas antes."),
  }),
  async ({ tenantId, enabled, hours }, user) => {
    await exigeGestor(tenantId, user.uid);
    if (!(await lerConexao(adminDb, tenantId))) throw new UserError("Conecte o WhatsApp do negócio antes de ligar os lembretes.");
    await adminDb.doc(`tenants/${tenantId}`).set({ whatsapp: { remindersEnabled: enabled, remindersBeforeHours: hours } }, { merge: true });
    return { enabled, hours };
  },
);

// Caixa: dinheiro só para quem gere, e só com o módulo ligado (conferido em financeiro.server)
export const lancarAction = memberAction(z.object({ tenantId: docIdStaff, lancamento: LancamentoInput }), async (data, user) => {
  await exigeGestor(data.tenantId, user.uid);
  return { ok: true as const, id: await lancar(adminDb, data.tenantId, data.lancamento, user) };
});

export const editarLancamentoAction = memberAction(z.object({ tenantId: docIdStaff, id: docId, lancamento: LancamentoInput }), async (data, user) => {
  await exigeGestor(data.tenantId, user.uid);
  await editar(adminDb, data.tenantId, data.id, data.lancamento, user);
  return { ok: true as const };
});

export const excluirLancamentoAction = memberAction(z.object({ tenantId: docIdStaff, id: docId }), async (data, user) => {
  await exigeGestor(data.tenantId, user.uid);
  await excluir(adminDb, data.tenantId, data.id);
  return { ok: true as const };
});

export const baixarAgendamentoAction = memberAction(z.object({ tenantId: docIdStaff, baixa: BaixaInput }), async (data, user) => {
  await exigeGestor(data.tenantId, user.uid);
  await baixarAgendamento(adminDb, data.tenantId, data.baixa, user);
  return { ok: true as const };
});

export const adicionarFixaAction = memberAction(z.object({ tenantId: docIdStaff, fixa: FixaInput }), async (data, user) => {
  await exigeGestor(data.tenantId, user.uid);
  await adicionarFixa(adminDb, data.tenantId, data.fixa);
  return { ok: true as const };
});

export const removerFixaAction = memberAction(z.object({ tenantId: docIdStaff, fixaId: docId }), async (data, user) => {
  await exigeGestor(data.tenantId, user.uid);
  await removerFixa(adminDb, data.tenantId, data.fixaId);
  return { ok: true as const };
});

export const definirComissaoAction = memberAction(z.object({ tenantId: docIdStaff, staffId: docId, pct: z.number().min(0).max(100) }), async (data, user) => {
  await exigeGestor(data.tenantId, user.uid);
  await definirComissao(adminDb, data.tenantId, data.staffId, data.pct);
  return { ok: true as const };
});

export const pagarAction = memberAction(z.object({ tenantId: docIdStaff, pagamento: PagamentoInput }), async (data, user) => {
  await exigeGestor(data.tenantId, user.uid);
  await pagar(adminDb, data.tenantId, data.pagamento, user);
  return { ok: true as const };
});

export const estornarAction = memberAction(z.object({ tenantId: docIdStaff, estorno: EstornoInput }), async (data, user) => {
  await exigeGestor(data.tenantId, user.uid);
  await estornar(adminDb, data.tenantId, data.estorno, user);
  return { ok: true as const };
});
