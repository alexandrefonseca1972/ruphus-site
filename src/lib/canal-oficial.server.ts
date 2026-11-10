import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { apontarWebhook, garantirTenant, revogarChavesAntigas, type ConexaoAtendys, type Template } from "@/lib/atendys";
import { DEMO } from "@/lib/demo";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { soDigitosComDDI } from "@/lib/telefone";
import { FieldValue } from "firebase-admin/firestore";
import { enviarTemplate, OPTIN_DONO } from "@/lib/atendys";

// Canal oficial do WhatsApp (API oficial da Meta, pelo atendys): um número da plataforma Ruphus
// fala com os clientes e com o dono dos negócios marcados com whatsapp.canalOficial = true.
// Fora da janela de 24 h a Meta só entrega template aprovado, por isso cada aviso tem o seu.
// O dono confirma respondendo CONFIRMADO <código> ao número da plataforma: o webhook acha o
// negócio pelo WhatsApp pessoal dele (ownerPhone) entre os negócios do canal oficial.
//
// As credenciais do tenant da plataforma no atendys (apikey e segredo dos webhooks) moram em
// config/atendys-plataforma (nenhuma regra libera config/*, só o Admin SDK lê). São emitidas
// SÓ pelo script (npm run canal-oficial -- provisionar), nunca numa requisição: rotacionar o
// segredo em dois processos ao mesmo tempo, ou de outro ambiente, deixava os webhooks recusados.
//
// Limite do número compartilhado: o SAIR de um cliente vale para todos os negócios do canal
// oficial (um tenant só no atendys) até um aceite posterior num novo agendamento.

const DOC = "config/atendys-plataforma";
const SLUG_PLATAFORMA = "ruphus-plataforma";
/** Instância "cloud" do tenant da plataforma (troca para a do número verificado sem deploy). */
export const instanciaPlataforma = () => process.env.ATENDYS_PLATAFORMA_INSTANCIA ?? "ruphus-plataforma-cloud-teste";

type Credenciais = { tenantId: string; apikey: string; keyId?: string; webhookSecret: string };

/** Nomes dos templates aprovados na WABA. Clientes: {{1}} nome, {{2}} negócio, {{3}} serviço, {{4}} quando. */
export const TEMPLATES = {
  recebido: "agendamento_recebido",
  confirmado: "agendamento_confirmado_cliente",
  cancelado: "agendamento_cancelado",
  lembrete: "agendamento_lembrete",
  novoDono: "agendamento_pedido_dono",
  novoDonoBotoes: "agendamento_pedido_dono_botoes",
  lembreteBotoes: "agendamento_lembrete_botoes",
  /** ao dono que cadastrou o WhatsApp no painel: {{1}} negócio, botão "Sou eu" (rph:ok:{slug}:dono) */
  confirmarDono: "ruphus_confirmar_whatsapp_dono",
} as const;

/** Templates com botões (Confirmar/Recusar ao dono; presença/remarcar/cancelar no lembrete).
 *  Liga com ATENDYS_TEMPLATES_BOTOES=1 depois que a Meta aprovar os dois na WABA do número. */
const comBotoes = () => process.env.ATENDYS_TEMPLATES_BOTOES === "1";

/** id do botão: volta no message.received. rph:<ação>:<negócio>:<agendamento>[:<extra>].
 *  extra: o horário de origem ("2026-11-14T15:00", hora de parede); em ch, "<origem>_<destino>".
 *  Ids sem horário (enviados antes dele) continuam valendo.
 *  Quem toca não edita o id, mas ele é conferido do mesmo jeito (dono do negócio, telefone do cliente). */
export const idBotao = (acao: AcaoBotao, slug: string, agendamento: string, extra?: string) =>
  ["rph", acao, slug, agendamento, ...(extra ? [extra] : [])].join(":");
// cx pede a confirmação; só cxx cancela, cm mantém; ok: o dono confirma que o WhatsApp é dele ("dono" no lugar do agendamento)
export type AcaoBotao = "dc" | "dr" | "cp" | "cr" | "cx" | "cxx" | "cm" | "ch" | "ok";
export function lerBotao(id: unknown): { acao: AcaoBotao; slug: string; agendamento: string; extra?: string } | null {
  if (typeof id !== "string") return null;
  const m = /^rph:(dc|dr|cp|cr|cxx|cx|cm|ch|ok):([a-z0-9][a-z0-9-]{0,62}):([A-Za-z0-9]{1,40})(?::([0-9T:_-]{1,40}))?$/.exec(id);
  return m ? { acao: m[1] as AcaoBotao, slug: m[2], agendamento: m[3], ...(m[4] ? { extra: m[4] } : {}) } : null;
}

/** Parâmetro de template: a Meta recusa quebra de linha, tab e mais de 4 espaços seguidos. */
export function parametro(valor: unknown): string {
  const texto = String(valor ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  return texto || "-";
}

/** Destaque dentro da variável: o texto do template é congelado pela Meta, mas o conteúdo de {{n}}
 *  aceita a formatação do WhatsApp. Asteriscos do próprio valor saem, senão quebram o negrito. */
export const destaque = (valor: unknown) => `*${parametro(valor).replace(/\*/g, "")}*`;
/** Data/hora em negrito com o ícone de calendário. */
export const quandoFormatado = (valor: unknown) => `📅 ${destaque(valor)}`;

/** Aviso ao cliente: { nome, negócio, serviço, quando } nos {{1}}…{{4}} do template. */
/** ref.horario: o horário do lembrete no id dos botões; tocar depois de o salão remarcar é recusado. */
export function templateCliente(tipo: "recebido" | "confirmado" | "cancelado" | "lembrete", c: { nome: string; negocio: string; servico: string; quando: string }, ref?: { slug: string; agendamento: string; horario?: string }): Template {
  const parametros = [parametro(c.nome), destaque(c.negocio), parametro(c.servico), quandoFormatado(c.quando)];
  if (tipo === "lembrete" && ref && comBotoes()) {
    return { nome: TEMPLATES.lembreteBotoes, parametros, botoes: (["cp", "cr", "cx"] as const).map((a) => idBotao(a, ref.slug, ref.agendamento, ref.horario)) };
  }
  return { nome: TEMPLATES[tipo], parametros };
}

/** Aviso de novo agendamento ao dono: {{1}} código (CONFIRMADO/RECUSAR + código), {{2}} negócio,
 *  {{3}} cliente, {{4}} telefone, {{5}} serviço, {{6}} quando. */
/** ref.horario ("2026-11-14T15:00"): vai no id dos botões; pedido de um horário que já mudou é recusado. */
export function templateNovoDono(c: { negocio: string; cliente: string; telefone: string; servico: string; quando: string; codigo: string }, ref?: { slug: string; agendamento: string; horario?: string }): Template {
  const parametros = [destaque(c.codigo), destaque(c.negocio), parametro(c.cliente), parametro(c.telefone), parametro(c.servico), quandoFormatado(c.quando)];
  if (ref && comBotoes()) return { nome: TEMPLATES.novoDonoBotoes, parametros, botoes: [idBotao("dc", ref.slug, ref.agendamento, ref.horario), idBotao("dr", ref.slug, ref.agendamento, ref.horario)] };
  return { nome: TEMPLATES.novoDono, parametros };
}

async function lerCredenciais(db: Firestore): Promise<Credenciais | null> {
  const c = (await db.doc(DOC).get()).data() as Partial<Credenciais> | undefined;
  return c?.tenantId && c.apikey && c.webhookSecret ? (c as Credenciais) : null;
}

/** Só pelo script: emite apikey e segredo do tenant da plataforma, grava e aponta o webhook
 *  para este site. Grava antes de apontar (falha no PATCH não perde a chave já emitida) e revoga
 *  as chaves da Ruphus anteriores. `forcar` emite de novo mesmo com credenciais gravadas. */
export async function provisionarPlataforma(db: Firestore, forcar = false): Promise<{ tenantId: string; novaChave: boolean }> {
  const atual = (await db.doc(DOC).get()).data() as Partial<Credenciais> | undefined;
  const c = await garantirTenant(SLUG_PLATAFORMA, "Ruphus plataforma (API oficial)", {
    reatribuirChave: forcar || !atual?.apikey,
    rotacionarSegredo: forcar || !atual?.webhookSecret,
    tenantId: atual?.tenantId,
    keyId: atual?.keyId,
  });
  const novas: Credenciais = {
    tenantId: c.tenantId,
    apikey: c.apikey || atual?.apikey || "",
    ...(c.keyId || atual?.keyId ? { keyId: c.keyId || atual?.keyId } : {}),
    webhookSecret: c.webhookSecret || atual?.webhookSecret || "",
  };
  await db.doc(DOC).set(novas, { merge: true });
  await apontarWebhook(c.tenantId);
  if (c.keyId) {
    const gravada = async () => (await db.doc(DOC).get()).get("keyId") as string | undefined;
    await revogarChavesAntigas(c.tenantId, c.keyId, gravada).catch((e) => console.error("[canal oficial] revogar chaves antigas", e));
  }
  return { tenantId: c.tenantId, novaChave: !!c.keyId };
}

/** O negócio usa o canal oficial? (só a marca: barato, sem credencial) */
export async function usaCanalOficial(db: Firestore, slug: string): Promise<boolean> {
  // a demonstração é aberta e os clientes dela têm números de verdade: nunca envia
  if (slug === DEMO) return false;
  return (await db.doc(`tenants/${slug}`).get()).get("whatsapp.canalOficial") === true;
}

/** Conexão da plataforma para um negócio do canal oficial (slug = o negócio, para as mensagens
 *  paradas na cota aparecerem no painel dele). null = negócio fora do canal oficial. Negócio
 *  marcado sem a plataforma provisionada LANÇA: quem chama registra a falha e não volta para o
 *  número do salão (seria o canal errado). */
export async function conexaoOficial(db: Firestore, slug: string): Promise<ConexaoAtendys | null> {
  if (!(await usaCanalOficial(db, slug))) return null;
  const c = await lerCredenciais(db);
  if (!c) throw new ErroPrevisto("O canal oficial do WhatsApp não está provisionado (npm run canal-oficial -- provisionar).");
  return { atendysApiKey: c.apikey, instanceId: instanciaPlataforma(), slug, oficial: true };
}

/** Segredo dos webhooks do tenant da plataforma. */
export async function segredoPlataforma(db: Firestore): Promise<string | null> {
  return (await lerCredenciais(db))?.webhookSecret ?? null;
}

/** Negócios do canal oficial que têm este número como WhatsApp pessoal do dono.
 *  ponytail: varre os negócios do canal oficial (poucos); índice dono→negócio se crescer. */
export async function negociosDoDono(db: Firestore, telefone: string): Promise<string[]> {
  const numero = soDigitosComDDI(telefone);
  if (!numero) return [];
  const oficiais = await db.collection("tenants").where("whatsapp.canalOficial", "==", true).get();
  const achados: string[] = [];
  for (const t of oficiais.docs) {
    if (t.id === DEMO) continue;
    const dono = (await db.doc(`tenants/${t.id}/privado/whatsapp`).get()).get("ownerPhone");
    if (typeof dono === "string" && soDigitosComDDI(dono) === numero) achados.push(t.id);
  }
  return achados;
}

/** Dono com mais de um negócio: o do agendamento cujo código está no texto ("CONFIRMADO AB12").
 *  Sem código que case, o primeiro (o comando responde "não encontrei" com a ajuda). */
export async function negocioDoComando(db: Firestore, slugs: string[], texto: string): Promise<string | null> {
  if (slugs.length <= 1) return slugs[0] ?? null;
  const tokens = [...texto.matchAll(/\b([a-z0-9]{4,12})\b/gi)].map((m) => m[1].toUpperCase());
  const desde = new Date(Date.now() - 7 * 86_400_000);
  for (const slug of slugs) {
    const ags = await db.collection(`tenants/${slug}/appointments`).where("start", ">", desde).get();
    if (ags.docs.some((a) => tokens.some((t) => a.id.toUpperCase().startsWith(t)))) return slug;
  }
  return slugs[0];
}

// ─── WhatsApp do dono pelo painel: cadastro e confirmação pelo botão "Sou eu" ────────────────
// O dono cadastra o WhatsApp pessoal; a plataforma manda o template de confirmação e o toque em
// "Sou eu" (do mesmo número) grava ownerPhoneVerifiedAt. Sem confirmar, os pedidos continuam indo
// para o número cadastrado (negócios que já estavam no ar não param); a tela só avisa.

/** O "Sou eu" ao dono: {{1}} o negócio; o botão volta como rph:ok:{slug}:dono. */
export const templateConfirmarDono = (negocio: string, slug: string): Template => ({
  nome: TEMPLATES.confirmarDono,
  parametros: [destaque(negocio)],
  botoes: [idBotao("ok", slug, "dono")],
});

const REENVIO_MS = 10 * 60_000;
const privadoWhatsApp = (db: Firestore, slug: string) => db.doc(`tenants/${slug}/privado/whatsapp`);
export type EnvioConfirmacao = "enviado" | "confirmado" | "aguarde" | "falhou";

/** Grava o WhatsApp do dono (`numero` já validado por celularDoDono), liga o canal oficial e manda o
 *  "Sou eu". O mesmo número já confirmado fica como está; número novo zera a confirmação e o limite. */
export async function cadastrarDonoOficial(db: Firestore, slug: string, numero: string): Promise<EnvioConfirmacao> {
  if (slug === DEMO) throw new ErroPrevisto("A demonstração não envia WhatsApp: teste num negócio de verdade.");
  if (!(await lerCredenciais(db))) throw new ErroPrevisto("O canal oficial ainda não está pronto: fale com a Ruphus.");
  const p = await privadoWhatsApp(db, slug).get();
  const mesmo = soDigitosComDDI(String(p.get("ownerPhone") ?? "")) === numero;
  const lote = db.batch();
  // o antigo ownerPhone no documento do negócio (a equipe lê) sai, como em gravarOwnerPhone
  lote.set(db.doc(`tenants/${slug}`), { whatsapp: { canalOficial: true, ownerPhone: FieldValue.delete() } }, { merge: true });
  if (!(mesmo && p.get("ownerPhoneVerifiedAt"))) {
    // ponytail: o limite de reenvio é por número; alternar números manda de novo (a cota do atendys segura)
    lote.set(privadoWhatsApp(db, slug), { ownerPhone: numero, ownerPhoneVerifiedAt: FieldValue.delete(), ...(!mesmo && { confirmacaoEnviadaEm: FieldValue.delete() }) }, { merge: true });
  }
  await lote.commit();
  return enviarConfirmacaoDono(db, slug);
}

/** Manda o "Sou eu" ao número cadastrado: no máximo um a cada 10 min. A marca é reservada na
 *  transação (dois cliques não mandam dois) e solta se o envio falhar (o dono tenta de novo já). */
export async function enviarConfirmacaoDono(db: Firestore, slug: string): Promise<EnvioConfirmacao> {
  const ref = privadoWhatsApp(db, slug);
  const r = await db.runTransaction(async (tx) => {
    const p = await tx.get(ref);
    const para = p.get("ownerPhone");
    if (typeof para !== "string" || !para) throw new ErroPrevisto("Cadastre o seu WhatsApp antes.");
    if (p.get("ownerPhoneVerifiedAt")) return "confirmado" as const;
    const em = p.get("confirmacaoEnviadaEm");
    if (typeof em === "number" && Date.now() - em < REENVIO_MS) return "aguarde" as const;
    tx.set(ref, { confirmacaoEnviadaEm: Date.now() }, { merge: true });
    return { para };
  });
  if (typeof r === "string") return r;
  try {
    const conn = await conexaoOficial(db, slug);
    if (!conn) throw new Error("negócio fora do canal oficial");
    const nome = String((await db.doc(`tenants/${slug}`).get()).get("name") ?? "").trim() || slug;
    const envio = await enviarTemplate(conn, r.para, templateConfirmarDono(nome, slug), OPTIN_DONO);
    if (envio.status === "failed") throw new Error(`recusado: ${envio.errorCode ?? "sem código"}`);
    return "enviado";
  } catch (e) {
    console.error(`[canal oficial] confirmação do WhatsApp do dono de ${slug}`, e);
    await ref.update({ confirmacaoEnviadaEm: FieldValue.delete() }).catch(() => {});
    return "falhou";
  }
}

/** Toque em "Sou eu" (rph:ok:{slug}:dono): confirma o WhatsApp do dono se quem tocou é o número
 *  cadastrado. { negocio } quando acabou de confirmar (para a resposta); o motivo, quando não. */
export async function confirmarDono(db: Firestore, slug: string, telefone: string): Promise<{ negocio: string } | "fora do canal oficial" | "outro telefone" | "já confirmado"> {
  if (!(await usaCanalOficial(db, slug))) return "fora do canal oficial";
  const numero = soDigitosComDDI(telefone);
  const ref = privadoWhatsApp(db, slug);
  return db.runTransaction(async (tx) => {
    const [p, t] = await Promise.all([tx.get(ref), tx.get(db.doc(`tenants/${slug}`))]);
    if (!numero || soDigitosComDDI(String(p.get("ownerPhone") ?? "")) !== numero) return "outro telefone" as const;
    if (p.get("ownerPhoneVerifiedAt")) return "já confirmado" as const;
    tx.set(ref, { ownerPhoneVerifiedAt: Date.now() }, { merge: true });
    return { negocio: String(t.get("name") ?? "").trim() || slug };
  });
}
