"use server";

import { adminDb } from "@/lib/admin";
import { createPlan, deleteCustomer, endPlan, renameCustomer, requireMember, reschedule, rescheduleSlots, salvarDadosCliente, UserError } from "@/lib/booking.server";
import { DadosCliente } from "@/lib/cliente-dados";
import { erroNome } from "@/lib/nome";
import { z } from "zod";
import { PlanInput, Recado, RescheduleInput, Staff } from "@/lib/scheduling";
import { revalidatePath } from "next/cache";
import { criarProfissional, lerNegocio, salvarNegocio } from "@/lib/negocios.server";
import { deslogarInstancia, enviarTexto, qrDaConexao, statusDaConexao } from "@/lib/atendys";
import { DEMO } from "@/lib/demo";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { avisarConfirmacaoPorSms } from "@/lib/sms-agendamento.server";
import { soDigitosComDDI } from "@/lib/telefone";
import { aceitarTermoWhatsApp, conectarNegocio, desligarConexao, espelharStatusVivo, lerConfigWhatsApp, lerConexao, paraTela } from "@/lib/whatsapp.server";
import { cancelar, Inscricao, inscrever, inscrito } from "@/lib/avisos.server";
import { verifyFirebaseToken } from "@/lib/verify-token";
import { criarConvite, revogarConvitesDaEquipe, tirarAcessosDoProfissional } from "@/lib/convite";
import { DIAS_CONVITE } from "@/lib/limites";
import { recebedorDe } from "@/lib/pix";
import { ConfigSinal } from "@/lib/sinal-config";
import { confirmarSinal } from "@/lib/sinal.server";
import { FieldValue } from "firebase-admin/firestore";
import { BaixaInput, EstornoInput, FixaInput, ID_AVULSO, LancamentoInput, PagamentoInput } from "@/lib/financeiro";
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
      // Só mensagens previstas chegam ao navegador (UserError e os ErroPrevisto do
      // atendys/gateways, como o /admin já faz); o resto vai para o log do servidor
      if (err instanceof ErroPrevisto) return { ok: false as const, error: err.message };
      console.error("[painel] erro inesperado em ação do tenant", err);
      return { ok: false as const, error: "Não foi possível concluir agora. Tente de novo." };
    }
  };
}

/** Profissional novo passa pelo servidor: as regras não deixam o cliente criar. */
export const criarProfissionalAction = memberAction(
  z.object({ tenantId: docIdStaff, dados: Staff }),
  async (data, user) => {
    await exigeGestor(data.tenantId, user.uid, { publico: true });
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

/** Link de acesso ao painel para alguém da equipe: entra como funcionário, preso ao
 *  profissional (a agenda abre na dele) e sem Caixa nem dados do negócio. O dono manda
 *  o link; só a conta com este e-mail, confirmado, abre. */
export const convidarEquipeAction = memberAction(
  z.object({ tenantId: docIdStaff, staffId: docId, email: z.string().trim().email("E-mail inválido.").max(254) }),
  async (data, user) => {
    await exigeGestor(data.tenantId, user.uid);
    const prof = await adminDb.doc(`tenants/${data.tenantId}/staff/${data.staffId}`).get();
    if (!prof.exists) throw new UserError("Esse profissional não existe mais.");
    const base = process.env.SITE_URL ?? "https://www.ruphus.site";
    const url = `${base}/convite?c=${await criarConvite(adminDb, data.tenantId, data.email, { staffId: data.staffId })}`;
    return { ok: true as const, url, dias: DIAS_CONVITE };
  },
);

/** Tira o acesso de alguém da equipe. Dono e admin ficam: esses só o admin da plataforma tira. */
export const tirarAcessoEquipeAction = memberAction(z.object({ tenantId: docIdStaff, uid: docId }), async (data, user) => {
  await exigeGestor(data.tenantId, user.uid);
  const ref = adminDb.doc(`tenants/${data.tenantId}/members/${data.uid}`);
  const membro = await ref.get();
  if (membro.exists && membro.get("role") !== "member") throw new UserError("Esse acesso é de quem gere o negócio. Fale com a Ruphus para mudar.");
  await ref.delete();
  // o link que sobrou (gerado duas vezes, mandado por dois canais) não devolve o acesso
  const staffId = membro.get("staffId") as string | undefined;
  if (staffId) await revogarConvitesDaEquipe(adminDb, data.tenantId, staffId);
  return { ok: true as const };
});

/** Excluir profissional é pelo servidor: leva junto o acesso de quem entrava como ele,
 *  e os links dele ainda não usados. Sem isso a conta seguia vendo a agenda e os
 *  clientes, e o "Tirar acesso" sumia da tela com o profissional. */
export const excluirProfissionalAction = memberAction(z.object({ tenantId: docIdStaff, staffId: docId }), async (data, user) => {
  await exigeGestor(data.tenantId, user.uid);
  await tirarAcessosDoProfissional(adminDb, data.tenantId, data.staffId);
  await adminDb.doc(`tenants/${data.tenantId}/staff/${data.staffId}`).delete();
  return { ok: true as const };
});

/** Dados do negócio só para quem gere: dono, admin do negócio ou da plataforma. */
async function exigeGestor(tenantId: string, uid: string, opts: { publico?: boolean } = {}) {
  const [membro, plataforma] = await Promise.all([adminDb.doc(`tenants/${tenantId}/members/${uid}`).get(), adminDb.doc("config/admin").get()]);
  const daPlataforma = (plataforma.get("uids") as unknown[] | undefined)?.includes(uid) ?? false;
  const gere = ["owner", "admin"].includes(membro.get("role")) || daPlataforma;
  if (!gere) throw new UserError("Só o dono ou um administrador do negócio pode mudar esses dados.");
  // a senha da demonstração é compartilhada: o que aparece em público (dados do site, Pix do
  // sinal, recado depois de agendar) não pode virar isca de golpe sob o domínio da Ruphus
  // até a restauração da madrugada. Só a plataforma muda; o resto da demo segue livre
  if (opts.publico && tenantId === DEMO && !daPlataforma) {
    throw new UserError("Na demonstração, os dados do negócio, o Pix, o sinal, o recado e a equipe ficam como estão: eles aparecem no site público. O resto pode testar à vontade.");
  }
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

export const cancelarAvisosAction = memberAction(z.object({ tenantId: docIdStaff, endpoint: Inscricao.shape.endpoint }), async (data, user) => {
  await cancelar(adminDb, data.tenantId, user.uid, data.endpoint);
  return { ok: true as const };
});

export const salvarRecadoAction = memberAction(z.object({ tenantId: docIdStaff, recado: Recado, online: z.boolean() }), async (data, user) => {
  await exigeGestor(data.tenantId, user.uid, { publico: true });
  await adminDb.doc(`tenants/${data.tenantId}`).update({ "agenda.recado": data.recado, "agenda.online": data.online });
  revalidatePath(`/agendar/${data.tenantId}`);
  revalidatePath(`/bio/${data.tenantId}`);
  return { ok: true as const };
});

// A chave Pix do salão: o QR do balcão e do sinal sai dela, e o dinheiro cai na conta dele.
// Só quem gere troca; chave vazia tira o Pix do negócio.
export const salvarPixAction = memberAction(
  z.object({ tenantId: docIdStaff, pix: z.object({ chave: z.string().max(100), nome: z.string().max(100), cidade: z.string().max(60) }) }),
  async (data, user) => {
    await exigeGestor(data.tenantId, user.uid, { publico: true });
    const t = adminDb.doc(`tenants/${data.tenantId}`);
    if (!data.pix.chave.trim()) {
      await t.update({ pix: FieldValue.delete(), "sinal.ativo": false });
      revalidatePath(`/agendar/${data.tenantId}`);
      return { ok: true as const, pix: null };
    }
    const pix = recebedorDe(data.pix);
    if (typeof pix === "string") throw new UserError(pix);
    await t.update({ pix });
    return { ok: true as const, pix };
  },
);

// Sinal do agendamento online: só com a chave Pix cadastrada (o QR sai dela)
export const salvarSinalAction = memberAction(z.object({ tenantId: docIdStaff, sinal: ConfigSinal }), async (data, user) => {
  await exigeGestor(data.tenantId, user.uid, { publico: true });
  const t = adminDb.doc(`tenants/${data.tenantId}`);
  const pix = (await t.get()).get("pix");
  if (data.sinal.ativo && (!pix || typeof recebedorDe(pix) === "string")) throw new UserError("Cadastre uma chave Pix válida antes de ligar o sinal.");
  await t.update({ sinal: data.sinal });
  revalidatePath(`/agendar/${data.tenantId}`);
  return { ok: true as const, sinal: data.sinal };
});

/** O salão conferiu no banco que o sinal caiu. */
export const confirmarSinalAction = memberAction(z.object({ tenantId: docIdStaff, appointmentId: docId }), async (data, user) => {
  await exigeGestor(data.tenantId, user.uid);
  await confirmarSinal(adminDb, data.tenantId, data.appointmentId, user);
  return { ok: true as const };
});

export const salvarNegocioAction = memberAction(z.object({ tenantId: docIdStaff, dados: z.unknown() }), async (data, user) => {
  await exigeGestor(data.tenantId, user.uid, { publico: true });
  await salvarNegocio(adminDb, data.tenantId, data.dados);
  // o site, a imagem do WhatsApp e a bio mostram a mudança agora, não em até uma hora
  for (const p of ["index.html", "og.jpg"]) revalidatePath(`/s/${data.tenantId}/${p}`);
  revalidatePath(`/bio/${data.tenantId}`);
  return { ok: true as const };
});

// Só dígitos, DDI+DDD+número: é o formato que o gateway (atendys) exige no envio.
const FONE_INTERNACIONAL = /^\d{10,15}$/;

/** Texto pelo WhatsApp que o dono conectou ao negócio (gateway atendys): sai do
 *  número dele, não da Ruphus. Cai no wa.me comum quando ninguém conectou. */
export const enviarWhatsAppAction = memberAction(
  z.object({
    tenantId: docIdStaff,
    phone: z.string().regex(FONE_INTERNACIONAL, "Use só números, com DDD (ex.: 11998887777)."),
    message: z.string().trim().min(1, "Escreva a mensagem.").max(1000, "Mensagem longa demais (máx. 1000)."),
  }),
  async (data, user) => {
    await exigeGestor(data.tenantId, user.uid);
    const conexao = await lerConexao(adminDb, data.tenantId);
    if (!conexao) throw new UserError("O WhatsApp do negócio ainda não está conectado.");
    // número do Brasil sem o 55 (como todo mundo digita) ganha o DDI; estrangeiro vai como veio.
    // Teste avulso não registra consentimento (null): sem opt-in, a tela diz que o número não autorizou
    const envio = await enviarTexto(conexao, soDigitosComDDI(data.phone) ?? data.phone, data.message, null);
    return { ok: true as const, messageId: envio.messageId };
  },
);

// ─── WhatsApp do negócio (painel do dono) ────────────────────────────────────
// A mesma seção existe no /admin da plataforma, com prioridade: quando a
// plataforma assume a conexão (ownerManaged false), aqui vira só leitura.

const SoTenant = z.object({ tenantId: docIdStaff });

export const lerWhatsAppDoNegocioAction = memberAction(SoTenant, async ({ tenantId }, user) => {
  await exigeGestor(tenantId, user.uid);
  return paraTela(await lerConfigWhatsApp(adminDb, tenantId));
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
  return paraTela(await conectarNegocio(adminDb, tenantId, tenantId, true));
});

export const refreshWhatsAppStatusDonoAction = memberAction(SoTenant, async ({ tenantId }, user) => {
  await exigeGestor(tenantId, user.uid);
  const salva = await lerConexao(adminDb, tenantId);
  if (!salva) return null;
  const lidoEm = Date.now();
  const vivo = await statusDaConexao(salva);
  await espelharStatusVivo(adminDb, tenantId, vivo, lidoEm);
  return paraTela(await lerConfigWhatsApp(adminDb, tenantId));
});

export const qrWhatsAppDonoAction = memberAction(SoTenant, async ({ tenantId }, user) => {
  await exigeGestor(tenantId, user.uid);
  const config = await lerConfigWhatsApp(adminDb, tenantId);
  if (config?.ownerManaged === false) throw new UserError("Gerenciado pela plataforma — quem conecta é o suporte.");
  const salva = await lerConexao(adminDb, tenantId);
  if (!salva) throw new UserError("Conecte o WhatsApp antes de pedir o QR.");
  return qrDaConexao(salva);
});

export const desconectarWhatsAppDonoAction = memberAction(SoTenant, async ({ tenantId }, user) => {
  await exigeGestor(tenantId, user.uid);
  const config = await lerConfigWhatsApp(adminDb, tenantId);
  if (config?.ownerManaged === false) throw new UserError("Gerenciado pela plataforma — quem desconecta é o suporte.");
  const salva = await lerConexao(adminDb, tenantId);
  // solta o vínculo ANTES de despareiar: o "disconnected" que o atendys manda no logout chega
  // sem negócio para achar, e o dono não recebe "seu WhatsApp desconectou" pelo que ele pediu
  await desligarConexao(adminDb, tenantId);
  if (salva) await deslogarInstancia(salva.instanceId).catch(() => {});
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
export const lancarAction = memberAction(z.object({ tenantId: docIdStaff, lancamento: LancamentoInput, id: z.string().regex(ID_AVULSO).optional() }), async (data, user) => {
  await exigeGestor(data.tenantId, user.uid);
  return { ok: true as const, id: await lancar(adminDb, data.tenantId, data.lancamento, user, data.id) };
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

/** Depois que a casa confirma um horário pelo painel: o cliente recebe o SMS de confirmação, se o
 *  negócio tiver o SMS ligado. A confirmação em si é gravada pelo navegador (regras); isto só avisa,
 *  e confere no banco que o horário está mesmo confirmado. */
export const avisarConfirmacaoSmsAction = memberAction(z.object({ tenantId: docIdStaff, appointmentId: docIdStaff }), async (data) => {
  return { ok: true as const, resultado: await avisarConfirmacaoPorSms(adminDb, data.tenantId, data.appointmentId) };
});
