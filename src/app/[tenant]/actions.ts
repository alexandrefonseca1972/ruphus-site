"use server";

import { conexaoOficial } from "@/lib/canal-oficial.server";
import { adminDb } from "@/lib/admin";
import { createPlan, deleteCustomer, endPlan, profissionalDaConta, renameCustomer, requireMember, reschedule, rescheduleSlots, salvarDadosCliente, UserError } from "@/lib/booking.server";
import { DadosCliente } from "@/lib/cliente-dados";
import { erroNome } from "@/lib/nome";
import { z } from "zod";
import { LimitesAgenda, PlanInput, Recado, RescheduleInput, Staff } from "@/lib/scheduling";
import { revalidatePath } from "next/cache";
import { renovarSite } from "@/lib/renovar-site.server";
import { criarProfissional, gastarCota, lerNegocio, salvarNegocio } from "@/lib/negocios.server";
import { SITE_BASE } from "@/lib/dominio";
import { atenderComo, type Atendimento, conversaVisivel, exigeConversaVisivel, exigeMensagemVisivel, permitirEquipeNasConversas, visiveis } from "@/lib/conversas.server";
import { agirNaMensagem, arquivarConversa, assumirEnvio, buscarNasConversas, CHAVE_IDEMPOTENCIA, deslogarInstancia, ID_INBOX, enviarTexto, ErroAtendys, listarConversas, manterAgendada, marcarConversa, mensagensDaConversa, qrDaConexao, responderConversa, statusDaConexao, statusDaMensagem, type ConexaoAtendys } from "@/lib/atendys";
import { DEMO } from "@/lib/demo";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { avisarConfirmacaoPorSms } from "@/lib/sms-agendamento.server";
import { enviarEmail } from "@/lib/email.server";
import { comAvisoSair, optInDoDoc } from "@/lib/consentimento-whatsapp";
import { situacaoDe } from "@/lib/envio-whatsapp";
import { atualizarParada, negocioDaMensagem, paradasDoNegocio } from "@/lib/mensagens-paradas.server";
import { htmlDoRecibo, textoDoRecibo } from "@/lib/recibo";
import { reciboDoBanco } from "@/lib/recibo.server";
import { formatBRL } from "@/lib/datetime";
import { soDigitosComDDI } from "@/lib/telefone";
import { aceitarTermoWhatsApp, conectarNegocio, type ConexaoWhatsapp, desligarConexao, espelharStatusVivo, lerConfigWhatsApp, lerConexao, paraTela } from "@/lib/whatsapp.server";
import { cancelar, Inscricao, inscrever, inscrito } from "@/lib/avisos.server";
import { verifyFirebaseToken } from "@/lib/verify-token";
import { criarConvite, revogarConvitesDaEquipe, tirarAcessosDoProfissional } from "@/lib/convite";
import { DIAS_CONVITE } from "@/lib/limites";
import { brCode, PixInvalido, recebedorDe } from "@/lib/pix";
import { ConfigSinal } from "@/lib/sinal-config";
import { confirmarSinal } from "@/lib/sinal.server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { after } from "next/server";
import { textoAvisoCliente, textoConvite, textoPix, textoVale } from "@/lib/mensagens";
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
// A mesma seção existe no /admin da plataforma, com prioridade: quando a
// plataforma assume a conexão (ownerManaged false), aqui vira só leitura.

const SoTenant = z.object({ tenantId: docIdStaff });

export const lerWhatsAppDoNegocioAction = memberAction(SoTenant, async ({ tenantId }, user) => {
  await exigeGestor(tenantId, user.uid);
  // negócio novo ainda não tem configuração: {} (nada ligado), não null, que a tela lê como falha
  const vazia: Partial<ConexaoWhatsapp> = {};
  return paraTela((await lerConfigWhatsApp(adminDb, tenantId)) ?? vazia);
});

export const aceitarTermoWhatsAppAction = memberAction(SoTenant, async ({ tenantId }, user) => {
  await exigeGestor(tenantId, user.uid);
  await aceitarTermoWhatsApp(adminDb, tenantId);
  return true;
});

// ponytail: trava em memória por negócio (um processo na VPS); vira doc de lock se houver mais de um processo
const conectando = new Map<string, Promise<unknown>>();

export const conectarWhatsAppDonoAction = memberAction(SoTenant, async ({ tenantId }, user) => {
  await exigeGestor(tenantId, user.uid);
  // dois cliques seguidos passavam os dois pelo "já existe conexão?" e criavam duas instâncias
  if (conectando.has(tenantId)) throw new UserError("Já estamos conectando. Aguarde o QR.");
  const tarefa = (async () => {
    const config = await lerConfigWhatsApp(adminDb, tenantId);
    if (config?.ownerManaged === false) {
      throw new UserError("O WhatsApp do seu negócio é gerenciado pela plataforma. Fale com o suporte para conectar ou alterar.");
    }
    if (!config?.termsAcceptedAt) {
      throw new UserError("Leia e aceite o termo sobre o WhatsApp antes de conectar.");
    }
    if (await lerConexao(adminDb, tenantId)) throw new UserError("Já existe um WhatsApp conectado. Desconecte antes de trocar de número.");
    return paraTela(await conectarNegocio(adminDb, tenantId, tenantId, true));
  })();
  conectando.set(tenantId, tarefa);
  try {
    return await tarefa;
  } finally {
    conectando.delete(tenantId);
  }
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
  if (salva) {
    // o gateway não respondeu: o número pode seguir logado lá, e reconectar criaria uma segunda
    // instância. O vínculo já foi solto; o dono precisa saber, não ler "desconectado"
    const saiu = await deslogarInstancia(salva.instanceId).then(() => true, () => false);
    if (!saiu) return "desconectado-sem-confirmacao" as const;
  }
  return "desconectado" as const;
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
    // a tela esconde quando a plataforma gerencia; o servidor também tem que recusar
    if ((await lerConfigWhatsApp(adminDb, tenantId))?.ownerManaged === false) throw new UserError("Gerenciado pela plataforma — quem configura os lembretes é o suporte.");
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

/** O Pix de um atendimento direto no WhatsApp do cliente, pelo WhatsApp que o negócio conectou
 *  (atendys). Número, chave e texto saem do servidor; do navegador vêm só o valor (até o preço
 *  do horário) e o txid do QR na tela, para o código ser o mesmo. Sem conexão, recusa: a tela
 *  então abre o WhatsApp do aparelho. */
export const enviarPixWhatsappAction = memberAction(
  z.object({ tenantId: docIdStaff, appointmentId: docIdStaff, valorCents: z.number().int().positive(), txid: z.string().max(25) }),
  async (data, user) => {
    await exigeGestor(data.tenantId, user.uid);
    const [ag, tenant] = await Promise.all([
      adminDb.doc(`tenants/${data.tenantId}/appointments/${data.appointmentId}`).get(),
      adminDb.doc(`tenants/${data.tenantId}`).get(),
    ]);
    if (!ag.exists) throw new UserError("Esse horário não existe mais.");
    if (data.valorCents > Number(ag.get("priceCents") ?? 0)) throw new UserError("O valor passa do preço do atendimento.");
    const recebedor = tenant.get("pix") ? recebedorDe(tenant.get("pix")) : "Cadastre a chave Pix em Meu negócio.";
    if (typeof recebedor === "string") throw new UserError(recebedor);
    const cliente = soDigitosComDDI(String(ag.get("customerPhone") ?? ""));
    if (!cliente) throw new UserError("O cliente não tem WhatsApp válido.");
    const w = await lerConexao(adminDb, data.tenantId);
    if (!w?.instanceId || w.status !== "connected") throw new UserError("O WhatsApp do negócio não está conectado.");
    let codigo: string;
    try {
      codigo = brCode({ ...recebedor, valorCents: data.valorCents, txid: data.txid });
    } catch (e) {
      if (e instanceof PixInvalido) throw new UserError(e.message);
      throw e;
    }
    // vale o aceite gravado NESTE agendamento: sem ele não envia, mesmo que o número tenha
    // aceitado em outro horário (o termo vale "deste agendamento")
    const optIn = optInDoDoc(data.tenantId, ag);
    if (!optIn) throw new UserError("O cliente não autorizou WhatsApp neste agendamento. Envie o Pix por outro meio.");
    const envio = await enviarTexto(w, cliente, textoPix({ valorCents: data.valorCents, nome: recebedor.nome, codigo }), optIn);
    return { ok: true as const, situacao: situacaoDe(envio) };
  },
);

/** Mensagem ao cliente de um horário (confirmação, cancelamento, remarcação) pelo WhatsApp que o
 *  negócio conectou (atendys). O texto e o número saem do agendamento, não do navegador: o painel
 *  só diz qual aviso é, e o aviso tem de bater com o estado do horário (sem "confirmado" de um
 *  horário cancelado, nem aviso de horário que já passou). Sem conexão ativa, recusa: o painel
 *  então abre o WhatsApp do aparelho. */
export const avisarClienteWhatsappAction = memberAction(
  z.object({ tenantId: docIdStaff, appointmentId: docIdStaff, tipo: z.enum(["confirmado", "cancelado", "remarcado"]) }),
  async (data, user) => {
    const [ag, tenant, preso] = await Promise.all([
      adminDb.doc(`tenants/${data.tenantId}/appointments/${data.appointmentId}`).get(),
      adminDb.doc(`tenants/${data.tenantId}`).get(),
      profissionalDaConta(adminDb, data.tenantId, user.uid),
    ]);
    if (!ag.exists) throw new UserError("Esse horário não existe mais.");
    // quem é da equipe só avisa os clientes dos próprios horários, como no resto da agenda
    if (preso && ag.get("staffId") !== preso) throw new UserError("Esse horário é de outro profissional.");
    const status = ag.get("status") as string;
    const start = (ag.get("start") as Timestamp).toDate();
    const valeAviso = data.tipo === "cancelado" ? status === "cancelled" : data.tipo === "confirmado" ? status === "confirmed" : status === "booked" || status === "confirmed";
    if (!valeAviso) throw new UserError("O horário mudou desde então: esse aviso não vale mais.");
    if (start.getTime() < Date.now()) throw new UserError("Esse horário já passou.");
    const cliente = soDigitosComDDI(String(ag.get("customerPhone") ?? ""));
    if (!cliente) throw new UserError("O cliente não tem WhatsApp válido.");
    const w = await lerConexao(adminDb, data.tenantId);
    if (!w?.instanceId || w.status !== "connected") throw new UserError("O WhatsApp do negócio não está conectado.");
    const base = SITE_BASE;
    const texto = textoAvisoCliente(
      data.tipo,
      { customerName: String(ag.get("customerName") ?? ""), serviceName: String(ag.get("serviceName") ?? ""), staffName: String(ag.get("staffName") ?? ""), start },
      String(tenant.get("name") ?? data.tenantId),
      `${base}/agendar/${data.tenantId}`,
    );
    const optIn = optInDoDoc(data.tenantId, ag);
    if (!optIn) throw new UserError("O cliente não autorizou WhatsApp neste agendamento. Avise por outro meio.");
    const envio = await enviarTexto(w, cliente, comAvisoSair(texto), optIn);
    return { ok: true as const, situacao: situacaoDe(envio) };
  },
);

/** Mensagem parada na cota do dia: "Enviar agora" (o atendys marca a ação manual e devolve o
 *  wa.me, que a tela abre só depois desta resposta) ou "Manter agendada" (volta à fila para o
 *  retryAt). Quem pode avisar o cliente pode decidir; o atendys confere que a mensagem é do negócio. */
export const decidirEnvioAction = memberAction(
  z.object({ tenantId: docIdStaff, messageId: z.string().uuid(), acao: z.enum(["agora", "agendar"]) }),
  async (data) => {
    // a mensagem tem de ser DESTE negócio: no canal oficial a credencial (da plataforma) é a mesma
    // para todos, e o atendys não distingue o salão A do B. Sem isto, o UUID de uma mensagem de
    // outro salão devolvia o wa.me com o telefone e o texto do cliente dele
    if ((await negocioDaMensagem(data.messageId)) !== data.tenantId) throw new UserError("Mensagem não encontrada.");
    // a mensagem parada pode ser do número do salão ou do canal oficial (plataforma)
    const conexoes = await conexoesDasParadas(data.tenantId);
    if (!conexoes.length) throw new UserError("O WhatsApp do negócio não está conectado.");
    try {
      const w = await conexaoDaMensagem(conexoes, data.messageId);
      if (data.acao === "agora") {
        const r = await assumirEnvio(w, data.messageId);
        // manual_started: ação manual iniciada, não "enviada"; sai da lista de pendentes
        await atualizarParada(data.tenantId, data.messageId, "manual_started");
        return { ok: true as const, url: r.manualHandoffUrl, retryAt: null, vencida: false };
      }
      const r = await manterAgendada(w, data.messageId);
      await atualizarParada(data.tenantId, data.messageId, "queued", r.retryAt);
      return { ok: true as const, url: null, retryAt: r.retryAt, vencida: false };
    } catch (e) {
      // 409: o atendys não segura mais a mensagem (venceu as 24 h ou já foi resolvida). Sai da
      // lista em vez de deixar dois botões que sempre falham
      if (!(e instanceof ErroAtendys && e.status === 409)) throw e;
      await atualizarParada(data.tenantId, data.messageId, "expired");
      return { ok: true as const, url: null, retryAt: null, vencida: true };
    }
  },
);

/** Mensagens que pararam na cota sem ninguém olhando (lembrete, aviso de agendamento, robô):
 *  o painel lista para o dono decidir. Só quem gere (texto e número do cliente). */
export const mensagensParadasAction = memberAction(SoTenant, async ({ tenantId }, user) => {
  await exigeGestor(tenantId, user.uid);
  const lista = await paradasDoNegocio(tenantId);
  if (!lista.length) return { ok: true as const, mensagens: lista };
  // confere cada uma no atendys: só fica a que ele ainda segura para decisão. A vencida, a de
  // conta de WhatsApp excluída/reconectada e a que ele não conhece saem da lista (sem isto o painel
  // oferecia "Enviar agora" e "Manter agendada" que sempre falhavam). Atendys fora do ar: não tira nada
  const conexoes = await conexoesDasParadas(tenantId);
  if (!conexoes.length) return { ok: true as const, mensagens: lista };
  const valem = await Promise.all(
    lista.map(async (m) => {
      try {
        const r = await statusNasConexoes(conexoes, m.messageId);
        if (r.status === "awaiting_manual") return true;
        await atualizarParada(tenantId, m.messageId, r.status, r.retryAt);
        return false;
      } catch (e) {
        if (!(e instanceof ErroAtendys && [404, 409, 410].includes(e.status))) return true;
        await atualizarParada(tenantId, m.messageId, "expired");
        return false;
      }
    }),
  );
  return { ok: true as const, mensagens: lista.filter((_, i) => valem[i]) };
});

// ─── Central de conversas (/v1/inbox do atendys) ────────────────────────────
// A apikey nunca sai do servidor: o navegador chama estas ações, que conferem sessão, membro,
// negócio e a permissão da equipe (atenderComo) e falam com o atendys na mesma máquina.

/** Valida a entrada, confere quem atende e devolve a recusa do atendys com o código (a tela
 *  decide: janela fechada desliga o campo, opt-out bloqueia de vez) e o Retry-After. */
function conversaAction<S extends z.ZodType<{ tenantId: string }>, R>(schema: S, run: (data: z.infer<S>, a: Atendimento) => Promise<R>) {
  return async (idToken: string, input: unknown) => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
    try {
      return await run(parsed.data, await atenderComo(verifyFirebaseToken, adminDb, idToken, parsed.data.tenantId));
    } catch (e) {
      if (e instanceof ErroAtendys) return { ok: false as const, error: e.message, codigo: e.codigo, retryAfter: e.retryAfter };
      if (e instanceof ErroPrevisto) return { ok: false as const, error: e.message };
      console.error("[conversas] erro inesperado", e);
      return { ok: false as const, error: "Não foi possível concluir agora. Tente de novo." };
    }
  };
}

const soGestor = (a: Atendimento, oque: string) => {
  if (!a.gestor) throw new UserError(`Só o dono ou um administrador do negócio pode ${oque}.`);
};
const idOpaco = z.string().regex(ID_INBOX, "Conversa inválida. Atualize a lista.");
const cursor = z.string().min(1).max(1024).optional();
const chaveEnvio = z.string().regex(CHAVE_IDEMPOTENCIA, "Chave de envio inválida.");
const ComConversa = z.object({ tenantId: docIdStaff, conversa: idOpaco });

export const listarConversasAction = conversaAction(
  z.object({ tenantId: docIdStaff, filtro: z.enum(["active", "unread", "archived"]).optional(), cursor, limite: z.number().int().min(1).max(100).optional() }),
  async ({ tenantId: _t, ...q }, a) => {
    const pagina = await listarConversas(a.conn, q);
    return { ok: true as const, pagina: { ...pagina, items: visiveis(a, pagina.items) } };
  },
);

// a busca devolve trechos sem o telefone: não dá para tirar dela a conversa do dono, e por isso
// fica com quem gere; a equipe acha o cliente pela lista
export const buscarConversasAction = conversaAction(
  z.object({ tenantId: docIdStaff, termo: z.string().trim().min(3, "Digite pelo menos 3 letras.").max(100), cursor }),
  async ({ termo, cursor }, a) => {
    soGestor(a, "buscar nas conversas");
    return { ok: true as const, pagina: await buscarNasConversas(a.conn, termo, cursor) };
  },
);

export const mensagensDaConversaAction = conversaAction(
  ComConversa.extend({ cursor, limite: z.number().int().min(1).max(100).optional() }),
  async ({ conversa, cursor, limite }, a) => {
    await exigeConversaVisivel(a, conversa);
    return { ok: true as const, pagina: await mensagensDaConversa(a.conn, conversa, { cursor, limite }) };
  },
);

/** Conversa aberta por id (busca, link): os dados dela, para a tela saber número e bloqueios. */
export const obterConversaAction = conversaAction(ComConversa, async ({ conversa }, a) => ({ ok: true as const, conversa: await conversaVisivel(a, conversa) }));

export const marcarConversaAction = conversaAction(ComConversa.extend({ lida: z.boolean() }), async ({ conversa, lida }, a) => {
  await exigeConversaVisivel(a, conversa);
  await marcarConversa(a.conn, conversa, lida);
  return { ok: true as const };
});

export const arquivarConversaAction = conversaAction(ComConversa.extend({ arquivada: z.boolean() }), async ({ conversa, arquivada }, a) => {
  await exigeConversaVisivel(a, conversa);
  await arquivarConversa(a.conn, conversa, arquivada);
  return { ok: true as const };
});

export const responderConversaAction = conversaAction(
  ComConversa.extend({ texto: z.string().trim().min(1, "Escreva a mensagem.").max(4096, "Mensagem longa demais."), chave: chaveEnvio, citada: idOpaco.optional() }),
  async ({ conversa, texto, chave, citada }, a) => {
    await exigeConversaVisivel(a, conversa);
    return { ok: true as const, envio: await responderConversa(a.conn, conversa, texto, chave, citada) };
  },
);

export const agirNaMensagemAction = conversaAction(
  z.object({
    tenantId: docIdStaff,
    mensagem: idOpaco,
    // a conversa da mensagem: a equipe só reage em mensagem de conversa que pode ver
    conversa: idOpaco.optional(),
    chave: chaveEnvio,
    acao: z.discriminatedUnion("tipo", [
      z.object({ tipo: z.literal("reacao"), emoji: z.string().regex(/^(\p{Extended_Pictographic}[\p{Emoji_Modifier}️‍\p{Extended_Pictographic}]*)?$/u, "Reação inválida.").max(16) }),
      z.object({ tipo: z.literal("editar"), texto: z.string().trim().min(1).max(4096) }),
      z.object({ tipo: z.literal("apagar") }),
    ]),
  }),
  async ({ mensagem, conversa, chave, acao }, a) => {
    // editar e apagar para todos mexem no que o dono, a IA e as confirmações automáticas mandaram
    if (acao.tipo !== "reacao") soGestor(a, acao.tipo === "editar" ? "editar mensagens enviadas" : "apagar mensagens enviadas");
    await exigeMensagemVisivel(a, conversa ?? null, mensagem);
    return { ok: true as const, resultado: await agirNaMensagem(a.conn, mensagem, acao, chave) };
  },
);

/** "Equipe pode atender conversas": só quem gere liga (padrão: só o dono). */
export const permitirEquipeNasConversasAction = memberAction(z.object({ tenantId: docIdStaff, equipeAtende: z.boolean() }), async ({ tenantId, equipeAtende }, user) => {
  await permitirEquipeNasConversas(adminDb, tenantId, user.uid, equipeAtende);
  return { ok: true as const, equipeAtende };
});

// Mensagem parada pode ter saído pelo número do salão ou pelo canal oficial (tenant da plataforma
// no atendys): cada uma só é conhecida pelo tenant que a enviou. Pergunta às duas; 404 numa
// passa para a outra, e só o 404 de todas diz que a mensagem não existe mais.
async function conexoesDasParadas(tenantId: string): Promise<ConexaoAtendys[]> {
  const [oficial, salao] = await Promise.all([
    conexaoOficial(adminDb, tenantId).catch((e) => (console.error(`[mensagens] canal oficial de ${tenantId}`, e), null)),
    lerConexao(adminDb, tenantId),
  ]);
  return [oficial, salao].filter((c): c is NonNullable<typeof c> => !!c?.instanceId);
}

async function statusNasConexoes(conexoes: ConexaoAtendys[], messageId: string) {
  for (const [i, c] of conexoes.entries()) {
    try {
      return await statusDaMensagem(c, messageId);
    } catch (e) {
      if (!(e instanceof ErroAtendys && e.status === 404) || i === conexoes.length - 1) throw e;
    }
  }
  throw new Error("sem conexão");
}

async function conexaoDaMensagem(conexoes: ConexaoAtendys[], messageId: string): Promise<ConexaoAtendys> {
  if (conexoes.length === 1) return conexoes[0];
  for (const c of conexoes) {
    const achou = await statusDaMensagem(c, messageId).then(() => true, (e) => (e instanceof ErroAtendys && e.status === 404 ? false : Promise.reject(e)));
    if (achou) return c;
  }
  return conexoes[conexoes.length - 1];
}
