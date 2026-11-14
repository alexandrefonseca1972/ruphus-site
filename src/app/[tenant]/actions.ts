"use server";

import { RECARGA_MAXIMA_CENTS, RECARGA_MINIMA_CENTS } from "@/lib/consumo";
import { criarRecarga, lerConfigMensagens } from "@/lib/consumo.server";
import { painelDeConsumo, resumoDoSaldo } from "@/lib/consumo-painel.server";
import { abrirCobranca, listarCobrancas } from "@/lib/cobranca";
import { cadastrarDonoOficial, enviarConfirmacaoDono, exigeNaoPausado, usaCanalOficial } from "@/lib/canal-oficial.server";
import { adminDb } from "@/lib/admin";
import { concluirAtendimento, createPlan, deleteCustomer, endPlan, exigeProfissionalSemCompromisso, profissionalDaConta, renameCustomer, requireMember, reschedule, rescheduleSlots, restaurarAgendamento, salvarDadosCliente, UserError } from "@/lib/booking.server";
import { DadosCliente } from "@/lib/cliente-dados";
import { erroNome } from "@/lib/nome";
import { z } from "zod";
import { ConfigAvaliacoes } from "@/lib/avaliacoes";
import { LimitesAgenda, PlanInput, Recado, RescheduleInput, Staff } from "@/lib/scheduling";
import { revalidatePath } from "next/cache";
import { renovarSite } from "@/lib/renovar-site.server";
import { criarProfissional, gastarCota, lerNegocio, salvarNegocio } from "@/lib/negocios.server";
import { SITE_BASE } from "@/lib/dominio";
import { DEMO } from "@/lib/demo";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { avisarConfirmacaoPorSms } from "@/lib/sms-agendamento.server";
import { enviarEmail } from "@/lib/email.server";
import { htmlDoRecibo, textoDoRecibo } from "@/lib/recibo";
import { reciboDoBanco } from "@/lib/recibo.server";
import { formatBRL, todayIn } from "@/lib/datetime";
import { celularDoDono } from "@/lib/telefone";
import { avisarClientePeloPainel, lerConfigWhatsApp } from "@/lib/whatsapp.server";
import { cancelar, Inscricao, inscrever, inscrito } from "@/lib/avisos.server";
import { verifyFirebaseToken } from "@/lib/verify-token";
import { criarConvite, revogarConvitesDaEquipe, tirarAcessosDoProfissional } from "@/lib/convite";
import { DIAS_CONVITE } from "@/lib/limites";
import { recebedorDe } from "@/lib/pix";
import { ConfigSinal } from "@/lib/sinal-config";
import { confirmarSinal } from "@/lib/sinal.server";
import { FieldValue } from "firebase-admin/firestore";
import { after } from "next/server";
import { textoConvite, textoVale } from "@/lib/mensagens";
import { BaixaInput, EstornoInput, FixaInput, ID_AVULSO, LancamentoInput, PagamentoInput, ROTULO_FORMA, ValeInput } from "@/lib/financeiro";
import { adicionarFixa, editarFixa, baixarAgendamento, darVale, definirComissao, editar, estornar, excluir, lancar, pagar, removerFixa } from "@/lib/financeiro.server";

// Chamáveis por POST direto: valida entrada e membro do tenant em toda chamada
const SlotsInput = RescheduleInput.omit({ time: true });
const docIdStaff = z.string().min(1).max(128).regex(/^[^/]+$/);

export async function getRescheduleSlots(idToken: string, input: unknown) {
  const q = SlotsInput.safeParse(input);
  if (!q.success) return { ok: false as const, error: "Dados inválidos." };
  try {
    await requireMember(verifyFirebaseToken, adminDb, idToken, q.data.tenantId);
    return { ok: true as const, slots: await rescheduleSlots(adminDb, q.data, false) };
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

/** O contrato que esta conta aceitou para o negócio: a versão e quando. Quem entrou pela
 *  equipe não aceitou nada (null). Só o próprio aceite: IP e e-mail ficam no servidor. */
export const meuContratoAction = memberAction(z.object({ tenantId: docIdStaff }), async (data, user) => {
  // ponytail: filtra o slug em memória (poucos aceites por conta); índice composto se crescer
  const docs = (await adminDb.collection("aceites").where("uid", "==", user.uid).get()).docs
    .map((d) => d.data())
    .filter((a) => a.slug === data.tenantId && typeof a.versao === "string")
    .sort((a, b) => (b.em?.toMillis?.() ?? 0) - (a.em?.toMillis?.() ?? 0));
  const a = docs[0];
  return { ok: true as const, contrato: a ? { versao: a.versao as string, em: (a.em?.toMillis?.() as number | undefined) ?? null } : null };
});

export const concluirAtendimentoAction = memberAction(
  z.object({ tenantId: docIdStaff, appointmentId: docIdStaff }),
  (data, user) => concluirAtendimento(adminDb, data, user),
);

// painel: remarca mesmo com o serviço oculto ou o profissional fora do link
export const rescheduleAppointment = memberAction(RescheduleInput, (data, user) => reschedule(adminDb, data, user, { exigirAtivo: false }));
export const desfazerCancelamentoAction = memberAction(
  z.object({ tenantId: docIdStaff, appointmentId: docIdStaff, status: z.enum(["booked", "confirmed"]) }),
  (data, user) => restaurarAgendamento(adminDb, data, user),
);
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
    // cada convite manda e-mail pela Ruphus: no máximo 20 por dia por negócio
    await gastarCota(adminDb, data.tenantId, "convites", 20);
    const base = SITE_BASE;
    const url = `${base}/convite?c=${await criarConvite(adminDb, data.tenantId, data.email, { staffId: data.staffId })}`;
    // o link já vai por e-mail para o endereço a que está preso, depois da resposta: o dono não
    // espera o Resend (10s de timeout, depois o SMTP). Falha no e-mail não perde o link: o dono
    // ainda copia ou manda pelo WhatsApp
    after(async () => {
      const negocio = String((await adminDb.doc(`tenants/${data.tenantId}`).get()).get("name") ?? data.tenantId);
      await enviarEmail({
        para: data.email,
        assunto: `Seu acesso à agenda do ${negocio}`,
        texto: textoConvite({ nome: String(prof.get("name") ?? ""), negocio, url, email: data.email, dias: DIAS_CONVITE }),
      }).catch((e) => console.error(`[convite] e-mail da equipe ${data.tenantId}`, e));
    });
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
  // antes de tirar os acessos: recusado, nada muda
  await exigeProfissionalSemCompromisso(adminDb, data.tenantId, data.staffId);
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

export const salvarRecadoAction = memberAction(z.object({ tenantId: docIdStaff, recado: Recado, online: z.boolean(), limites: LimitesAgenda }), async (data, user) => {
  await exigeGestor(data.tenantId, user.uid, { publico: true });
  if (data.online && (await adminDb.doc(`tenants/${data.tenantId}`).get()).get("modulos.agendamento") === false) {
    throw new UserError("O agendamento online não faz parte do plano deste negócio. Para ligar, fale com a Ruphus.");
  }
  await adminDb.doc(`tenants/${data.tenantId}`).update({
    "agenda.recado": data.recado,
    "agenda.online": data.online,
    "agenda.maxServicos": data.limites.maxServicos,
    "agenda.maxDuracaoMin": data.limites.maxDuracaoMin,
  });
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
    // o QR do sinal na página de agendar sai desta chave: a página em cache seguiria com a antiga
    revalidatePath(`/agendar/${data.tenantId}`);
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
  renovarSite(data.tenantId);
  // o nome e o WhatsApp também aparecem na página de agendar e na imagem do link dela (cache de 1 dia)
  revalidatePath(`/agendar/${data.tenantId}`);
  return { ok: true as const };
});

// ─── WhatsApp do negócio (painel do dono) ────────────────────────────────────
// Os avisos saem só pelo canal oficial (número da Ruphus): o dono só cadastra o WhatsApp pessoal,
// que recebe os pedidos.

const SoTenant = z.object({ tenantId: docIdStaff });

export const lerWhatsAppDoNegocioAction = memberAction(SoTenant, async ({ tenantId }, user) => {
  await exigeGestor(tenantId, user.uid);
  // negócio novo ainda não tem configuração: {} (nada ligado), não null, que a tela lê como falha
  return (await lerConfigWhatsApp(adminDb, tenantId)) ?? {};
});

/** WhatsApp pessoal do dono no canal oficial: só celular brasileiro (celularDoDono; o fixo do
 *  negócio com um 9 na frente é conferido depois, com o site.phone). Salvar liga o canal oficial e
 *  manda a confirmação "Sou eu" pelo número da Ruphus. */
export const definirWhatsAppDonoAction = memberAction(
  z.object({
    tenantId: docIdStaff,
    telefone: z.string().max(40).transform((v, ctx) => {
      const r = celularDoDono(v);
      if ("erro" in r) {
        ctx.addIssue({ code: "custom", message: r.erro });
        return z.NEVER;
      }
      return r.numero;
    }),
  }),
  async ({ tenantId, telefone }, user) => {
    await exigeGestor(tenantId, user.uid);
    const r = celularDoDono(telefone, (await adminDb.doc(`tenants/${tenantId}`).get()).get("site.phone") as string | undefined);
    if ("erro" in r) throw new UserError(r.erro);
    const envio = await cadastrarDonoOficial(adminDb, tenantId, r.numero);
    return { envio, cfg: (await lerConfigWhatsApp(adminDb, tenantId)) ?? {} };
  },
);

/** Manda de novo o "Sou eu" (no máximo um a cada 10 min, conferido em enviarConfirmacaoDono). */
export const reenviarConfirmacaoDonoAction = memberAction(SoTenant, async ({ tenantId }, user) => {
  await exigeGestor(tenantId, user.uid);
  await exigeNaoPausado(adminDb, tenantId);
  if (!(await usaCanalOficial(adminDb, tenantId))) throw new UserError("Salve o seu WhatsApp antes.");
  const envio = await enviarConfirmacaoDono(adminDb, tenantId);
  return { envio, cfg: (await lerConfigWhatsApp(adminDb, tenantId)) ?? {} };
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
    await exigeNaoPausado(adminDb, tenantId);
    // os lembretes saem pelo canal oficial (número da Ruphus)
    if (!(await usaCanalOficial(adminDb, tenantId))) throw new UserError("Salve o seu WhatsApp antes de ligar os lembretes.");
    await adminDb.doc(`tenants/${tenantId}`).set({ whatsapp: { remindersEnabled: enabled, remindersBeforeHours: hours } }, { merge: true });
    return { enabled, hours };
  },
);

export const configurarAvaliacoesAction = memberAction(
  z.object({ tenantId: docIdStaff, enabled: z.boolean(), delayMin: ConfigAvaliacoes.shape.delayMin }),
  async ({ tenantId, enabled, delayMin }, user) => {
    await exigeGestor(tenantId, user.uid);
    if (enabled) {
      await exigeNaoPausado(adminDb, tenantId);
      if (!(await usaCanalOficial(adminDb, tenantId))) throw new UserError("Salve o seu WhatsApp antes de ligar as avaliações.");
    }
    const ref = adminDb.doc(`tenants/${tenantId}`);
    const atual = await ref.get();
    const ativando = enabled && atual.get("avaliacoes.enabled") !== true;
    await ref.set({ avaliacoes: { enabled, delayMin, ...(ativando && { enabledAt: FieldValue.serverTimestamp() }) } }, { merge: true });
    return { ok: true as const, enabled, delayMin };
  },
);

// Caixa: dinheiro só para quem gere, e só com o módulo ligado (conferido em financeiro.server)
export const lancarAction = memberAction(z.object({ tenantId: docIdStaff, lancamento: LancamentoInput, id: z.string().regex(ID_AVULSO).optional() }), async (data, user) => {
  await exigeGestor(data.tenantId, user.uid);
  return { ok: true as const, id: await lancar(adminDb, data.tenantId, data.lancamento, user, data.id) };
});

// R$ 0 passa aqui só para a comissão toda abatida por estorno: o servidor confere (editar)
export const editarLancamentoAction = memberAction(z.object({ tenantId: docIdStaff, id: docId, lancamento: LancamentoInput.extend({ valorCents: z.number().int().min(0).max(99_999_99, "Valor alto demais.") }) }), async (data, user) => {
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

export const editarFixaAction = memberAction(z.object({ tenantId: docIdStaff, fixaId: docId, fixa: FixaInput }), async (data, user) => {
  await exigeGestor(data.tenantId, user.uid);
  await editarFixa(adminDb, data.tenantId, data.fixaId, data.fixa);
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

/** Vale ao profissional: registra a saída e manda a confirmação por e-mail a ele. O e-mail é
 *  esperado (não fica para depois): o dono vê na hora se a confirmação não saiu. */
export const darValeAction = memberAction(z.object({ tenantId: docIdStaff, vale: ValeInput }), async (data, user) => {
  await exigeGestor(data.tenantId, user.uid);
  const v = await darVale(adminDb, data.tenantId, data.vale, user);
  if (!v.novo) return { ok: true as const, emailEnviado: true };
  const negocio = String((await adminDb.doc(`tenants/${data.tenantId}`).get()).get("name") ?? "");
  const emailEnviado = await enviarEmail({
    para: data.vale.email,
    assunto: `Vale de ${formatBRL(data.vale.valorCents)} · ${negocio}`,
    texto: textoVale({ nome: v.nome, negocio, valorCents: data.vale.valorCents, forma: ROTULO_FORMA[data.vale.forma], data: v.data }),
  }).then(() => true, (err) => (console.error("[vale] e-mail", err), false));
  return { ok: true as const, emailEnviado };
});

/** Recibo por e-mail, pela plataforma: sai de contato@ruphus.site com o nome do negócio, no
 *  formato do cupom (HTML) e com o texto junto para quem não abre HTML. */
export const enviarReciboEmailAction = memberAction(
  z.object({ tenantId: docIdStaff, ids: z.array(z.string().min(4).max(160)).min(1).max(20), email: z.string().trim().toLowerCase().email("E-mail inválido.").max(254) }),
  async (data, user) => {
    await exigeGestor(data.tenantId, user.uid);
    const r = await reciboDoBanco(adminDb, data.tenantId, data.ids);
    // sai do domínio da Ruphus: no máximo 50 por dia por negócio, e o remetente diz que é "via Ruphus"
    // (48 + " via Ruphus" cabe nos 60 do nomeDe)
    await gastarCota(adminDb, data.tenantId, "recibos", 50);
    const de = r.emissor[0] ? `${r.emissor[0].slice(0, 48)} via Ruphus` : "Ruphus";
    await enviarEmail({ para: data.email, de, assunto: `${r.titulo} · ${r.emissor[0] ?? ""}`, texto: textoDoRecibo(r), html: htmlDoRecibo(r) });
    return { ok: true as const };
  },
);

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

/** Confirmar/Cancelar pelo painel no canal oficial: o navegador grava o status (regras) e pede aqui o
 *  aviso ao cliente pela API. Quem pode mudar o status pode avisar: a equipe presa a um profissional
 *  só nos horários dele (como as regras e o remarcar). */
export const avisarClienteAction = memberAction(
  z.object({ tenantId: docIdStaff, appointmentId: docId, tipo: z.enum(["confirmado", "cancelado"]) }),
  async (data, user) => {
    const preso = await profissionalDaConta(adminDb, data.tenantId, user.uid);
    // o envio segue depois da resposta (after): a tela não espera o atendys (até 35 s) nem trava as outras ações
    return { ok: true as const, ...(await avisarClientePeloPainel(adminDb, data.tenantId, data.appointmentId, data.tipo, preso, (tarefa) => after(tarefa))) };
  },
);

/** "Enviar pelo WhatsApp" de um aviso que não chegou: depois do toque no wa.me, a marca sai do horário. */
export const resolverAvisoAction = memberAction(z.object({ tenantId: docIdStaff, appointmentId: docId }), async (data, user) => {
  const preso = await profissionalDaConta(adminDb, data.tenantId, user.uid);
  const ref = adminDb.doc(`tenants/${data.tenantId}/appointments/${data.appointmentId}`);
  const a = await ref.get();
  if (!a.exists) throw new UserError("Esse horário não existe mais.");
  if (preso && a.get("staffId") !== preso) throw new UserError("Esse horário é de outro profissional: só quem gere o negócio mexe nele.");
  if (a.get("avisoFalhou") !== undefined) await ref.update({ avisoFalhou: FieldValue.delete() });
  return { ok: true as const };
});

/** Recarga de mensagens pré-pagas: pacote do /admin ou valor livre (mínimo R$ 10,00). Devolve a
 *  cobrança Pix (a mesma página /pagar da mensalidade); o saldo entra quando o pagamento é baixado. */
export const criarRecargaAction = memberAction(
  z.object({
    tenantId: docIdStaff,
    pedido: z.union([
      z.object({ pacoteId: z.string().regex(/^[a-z0-9-]{1,20}$/) }).strict(),
      z.object({ valorCents: z.number().int().min(RECARGA_MINIMA_CENTS, "A recarga mínima é de R$ 10,00.").max(RECARGA_MAXIMA_CENTS, "A recarga máxima é de R$ 10.000,00.") }).strict(),
    ]),
  }),
  async ({ tenantId, pedido }, user) => {
    await exigeGestor(tenantId, user.uid);
    if (tenantId === DEMO) throw new UserError("A demonstração não recarrega mensagens.");
    // o mesmo pedido (valor, bônus e pacote) ainda em aberto volta o mesmo Pix: tocar duas vezes não gera
    // duas cobranças. Bônus diferente (pacote × valor livre, bônus mudado no admin) é outra cobrança
    const pacote = "pacoteId" in pedido ? (await lerConfigMensagens()).pacotes.find((p) => p.id === pedido.pacoteId && p.ativo) : null;
    if ("pacoteId" in pedido && !pacote) throw new UserError("Esse pacote não está mais disponível.");
    const quer = { valorCents: pacote ? pacote.valorCents : (pedido as { valorCents: number }).valorCents, bonusCents: pacote?.bonusCents ?? 0, pacoteId: pacote?.id ?? null };
    const abertas = (await listarCobrancas(adminDb, tenantId)).filter((c) => c.tipo === "recarga" && c.status === "aberta" && c.vencimento >= todayIn());
    const docs = abertas.length ? await adminDb.getAll(...abertas.map((c) => adminDb.doc(`cobrancas/${c.id}`))) : [];
    const mesma = docs.find((d) => d.get("valorCents") === quer.valorCents && Number(d.get("bonusCents") ?? 0) === quer.bonusCents && (d.get("pacoteId") ?? null) === quer.pacoteId);
    if (!mesma && abertas.length >= 5) throw new UserError("Já há 5 recargas aguardando pagamento. Pague uma delas ou espere vencerem.");
    const r = mesma ? { id: mesma.id, token: String(mesma.get("token") ?? "") } : await criarRecarga(tenantId, pedido);
    return { ok: true as const, ...(await pixDaRecarga(r.id, r.token)) };
  },
);

/** O Pix de uma recarga em aberto deste negócio, para pagar de novo pela tela. */
export const pixDaRecargaAction = memberAction(z.object({ tenantId: docIdStaff, id: docId }), async ({ tenantId, id }, user) => {
  await exigeGestor(tenantId, user.uid);
  const c = await adminDb.doc(`cobrancas/${id}`).get();
  if (!c.exists || c.get("slug") !== tenantId || c.get("tipo") !== "recarga") throw new UserError("Essa recarga não existe mais.");
  return { ok: true as const, ...(await pixDaRecarga(id, String(c.get("token") ?? ""))) };
});

async function pixDaRecarga(id: string, token: string) {
  const c = await abrirCobranca(adminDb, id, token);
  if (!c) throw new UserError("Não foi possível abrir o Pix desta recarga.");
  const doc = await adminDb.doc(`cobrancas/${id}`).get();
  return { id, url: `${SITE_BASE}/pagar/${id}?t=${token}`, brCode: c.brCode, valorCents: c.valorCents, bonusCents: Number(doc.get("bonusCents") ?? 0), vencimento: c.vencimento, status: c.status };
}

/** Tela de consumo: envios do mês, saldo, previsão, preços, pacotes e extrato. Só quem gere. */
/** leve: sem a lista de envios do mês (a tela de recarga só precisa do saldo, do extrato e do gasto). */
export const consumoAction = memberAction(z.object({ tenantId: docIdStaff, mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), leve: z.boolean().optional() }), async ({ tenantId, mes, leve }, user) => {
  await exigeGestor(tenantId, user.uid);
  return { ok: true as const, dados: await painelDeConsumo(tenantId, mes, { envios: !leve }) };
});

/** Faixa de saldo baixo no topo do painel (null: sem conta pré-paga aberta). */
export const resumoDoSaldoAction = memberAction(z.object({ tenantId: docIdStaff }), async ({ tenantId }, user) => {
  await exigeGestor(tenantId, user.uid);
  return { ok: true as const, saldo: await resumoDoSaldo(tenantId) };
});
