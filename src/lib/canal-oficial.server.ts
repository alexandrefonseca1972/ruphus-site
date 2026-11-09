import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { apontarWebhook, garantirTenant, revogarChavesAntigas, type ConexaoAtendys, type Template } from "@/lib/atendys";
import { DEMO } from "@/lib/demo";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { soDigitosComDDI } from "@/lib/telefone";

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
} as const;

/** Templates com botões (Confirmar/Recusar ao dono; presença/remarcar/cancelar no lembrete).
 *  Liga com ATENDYS_TEMPLATES_BOTOES=1 depois que a Meta aprovar os dois na WABA do número. */
const comBotoes = () => process.env.ATENDYS_TEMPLATES_BOTOES === "1";

/** id do botão: volta no message.received. rph:<ação>:<negócio>:<agendamento>[:<extra>].
 *  Quem toca não edita o id, mas ele é conferido do mesmo jeito (dono do negócio, telefone do cliente). */
export const idBotao = (acao: AcaoBotao, slug: string, agendamento: string, extra?: string) =>
  ["rph", acao, slug, agendamento, ...(extra ? [extra] : [])].join(":");
export type AcaoBotao = "dc" | "dr" | "cp" | "cr" | "cx" | "ch";
export function lerBotao(id: unknown): { acao: AcaoBotao; slug: string; agendamento: string; extra?: string } | null {
  if (typeof id !== "string") return null;
  const m = /^rph:(dc|dr|cp|cr|cx|ch):([a-z0-9][a-z0-9-]{0,62}):([A-Za-z0-9]{1,40})(?::([0-9T:-]{1,20}))?$/.exec(id);
  return m ? { acao: m[1] as AcaoBotao, slug: m[2], agendamento: m[3], ...(m[4] ? { extra: m[4] } : {}) } : null;
}

/** Parâmetro de template: a Meta recusa quebra de linha, tab e mais de 4 espaços seguidos. */
export function parametro(valor: unknown): string {
  const texto = String(valor ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  return texto || "-";
}

/** Aviso ao cliente: { nome, negócio, serviço, quando } nos {{1}}…{{4}} do template. */
export function templateCliente(tipo: "recebido" | "confirmado" | "cancelado" | "lembrete", c: { nome: string; negocio: string; servico: string; quando: string }, ref?: { slug: string; agendamento: string }): Template {
  const parametros = [c.nome, c.negocio, c.servico, c.quando].map(parametro);
  if (tipo === "lembrete" && ref && comBotoes()) {
    return { nome: TEMPLATES.lembreteBotoes, parametros, botoes: (["cp", "cr", "cx"] as const).map((a) => idBotao(a, ref.slug, ref.agendamento)) };
  }
  return { nome: TEMPLATES[tipo], parametros };
}

/** Aviso de novo agendamento ao dono: {{1}} código (CONFIRMADO/RECUSAR + código), {{2}} negócio,
 *  {{3}} cliente, {{4}} telefone, {{5}} serviço, {{6}} quando. */
export function templateNovoDono(c: { negocio: string; cliente: string; telefone: string; servico: string; quando: string; codigo: string }, ref?: { slug: string; agendamento: string }): Template {
  const parametros = [c.codigo, c.negocio, c.cliente, c.telefone, c.servico, c.quando].map(parametro);
  if (ref && comBotoes()) return { nome: TEMPLATES.novoDonoBotoes, parametros, botoes: [idBotao("dc", ref.slug, ref.agendamento), idBotao("dr", ref.slug, ref.agendamento)] };
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
  return { atendysApiKey: c.apikey, instanceId: instanciaPlataforma(), slug };
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
