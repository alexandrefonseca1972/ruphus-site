import "server-only";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { apontarWebhook, enviarTexto, garantirTenant, revogarChavesAntigas, type ConexaoAtendys, type Template } from "@/lib/atendys";
import { DEMO } from "@/lib/demo";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { customerKey, formatBRL, formatPhone } from "@/lib/datetime";
import { SITE_BASE, urlDoSite, type Dominio } from "@/lib/dominio";
import type { Previsao } from "@/lib/consumo";
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
  /** ao dono: {{1}} negócio, {{2}} saldo, {{3}} quanto dura, {{4}} recarga indicada, {{5}} link do painel */
  saldoBaixo: "ruphus_saldo_baixo",
} as const;

/** Templates com botões (Confirmar/Recusar ao dono; presença/remarcar/cancelar no lembrete).
 *  Liga com ATENDYS_TEMPLATES_BOTOES=1 depois que a Meta aprovar os dois na WABA do número. */
const comBotoes = () => process.env.ATENDYS_TEMPLATES_BOTOES === "1";
/** Versão _v2 dos templates (📌/📅 no texto e, nos de cliente, {{5}} = contato do estabelecimento).
 *  Liga com ATENDYS_TEMPLATES_V2=1 depois que a Meta aprovar os _v2 na WABA. */
const v2 = () => process.env.ATENDYS_TEMPLATES_V2 === "1";
/** O nome que vai à Meta: o de TEMPLATES, com _v2 quando a chave está ligada. */
const nomeTemplate = (chave: keyof typeof TEMPLATES) => (v2() ? `${TEMPLATES[chave]}_v2` : TEMPLATES[chave]);

/** id do botão: volta no message.received. rph:<ação>:<negócio>:<agendamento>[:<extra>].
 *  extra: o horário de origem ("2026-11-14T15:00", hora de parede); em ch, "<origem>_<destino>".
 *  Ids sem horário (enviados antes dele) continuam valendo.
 *  Quem toca não edita o id, mas ele é conferido do mesmo jeito (dono do negócio, telefone do cliente). */
export const idBotao = (acao: AcaoBotao, slug: string, agendamento: string, extra?: string) =>
  ["rph", acao, slug, agendamento, ...(extra ? [extra] : [])].join(":");
// cx pede a confirmação; só cxx cancela, cm mantém
export type AcaoBotao = "dc" | "dr" | "cp" | "cr" | "cx" | "cxx" | "cm" | "ch";
export function lerBotao(id: unknown): { acao: AcaoBotao; slug: string; agendamento: string; extra?: string } | null {
  if (typeof id !== "string") return null;
  const m = /^rph:(dc|dr|cp|cr|cxx|cx|cm|ch):([a-z0-9][a-z0-9-]{0,62}):([A-Za-z0-9]{1,40})(?::([0-9T:_-]{1,40}))?$/.exec(id);
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
/** Data/hora em negrito com o ícone de calendário. Nos _v2 o 📅 já está no texto do template. */
export const quandoFormatado = (valor: unknown) => (v2() ? destaque(valor) : `📅 ${destaque(valor)}`);

/** Contato do estabelecimento ({{5}} dos _v2 e a resposta automática): o telefone do site (o mesmo
 *  do botão de WhatsApp da /bio), formatado; sem telefone válido, o endereço público do site. */
export function contatoDoNegocio(tenant: { id: string; get(campo: string): unknown }): string {
  const numero = soDigitosComDDI(String(tenant.get("site.phone") ?? ""));
  return numero ? formatPhone(numero) : urlDoSite(tenant.id, tenant.get("dominio") as Dominio | undefined).replace(/\/+$/, "");
}

/** Aviso ao cliente: { nome, negócio, serviço, quando } nos {{1}}…{{4}} do template; nos _v2, contato no {{5}}. */
/** ref.horario: o horário do lembrete no id dos botões; tocar depois de o salão remarcar é recusado. */
export function templateCliente(tipo: "recebido" | "confirmado" | "cancelado" | "lembrete", c: { nome: string; negocio: string; servico: string; quando: string; contato: string }, ref?: { slug: string; agendamento: string; horario?: string }): Template {
  const parametros = [parametro(c.nome), destaque(c.negocio), parametro(c.servico), quandoFormatado(c.quando), ...(v2() ? [parametro(c.contato)] : [])];
  if (tipo === "lembrete" && ref && comBotoes()) {
    return { nome: nomeTemplate("lembreteBotoes"), parametros, botoes: (["cp", "cr", "cx"] as const).map((a) => idBotao(a, ref.slug, ref.agendamento, ref.horario)) };
  }
  return { nome: nomeTemplate(tipo), parametros };
}

/** Aviso de novo agendamento ao dono: {{1}} código (CONFIRMADO/RECUSAR + código), {{2}} negócio,
 *  {{3}} cliente, {{4}} telefone, {{5}} serviço, {{6}} quando. */
/** ref.horario ("2026-11-14T15:00"): vai no id dos botões; pedido de um horário que já mudou é recusado. */
export function templateNovoDono(c: { negocio: string; cliente: string; telefone: string; servico: string; quando: string; codigo: string }, ref?: { slug: string; agendamento: string; horario?: string }): Template {
  const parametros = [destaque(c.codigo), destaque(c.negocio), parametro(c.cliente), parametro(c.telefone), parametro(c.servico), quandoFormatado(c.quando)];
  if (ref && comBotoes()) return { nome: nomeTemplate("novoDonoBotoes"), parametros, botoes: [idBotao("dc", ref.slug, ref.agendamento, ref.horario), idBotao("dr", ref.slug, ref.agendamento, ref.horario)] };
  return { nome: nomeTemplate("novoDono"), parametros };
}

/** Saldo de mensagens baixo, ao WhatsApp pessoal do dono (sem _v2: o template nasceu com as 5 variáveis). */
export function templateSaldoBaixo(c: { negocio: string; slug: string; saldoCents: number; previsao: Previsao }): Template {
  const dias = c.previsao.diasRestantesEstimados;
  const p = c.previsao.pacoteIndicado;
  return {
    nome: TEMPLATES.saldoBaixo,
    parametros: [
      parametro(c.negocio),
      parametro(formatBRL(c.saldoCents)),
      parametro(dias === null ? "poucos dias" : dias === 0 ? "menos de 1 dia" : `${dias} ${dias === 1 ? "dia" : "dias"}`),
      parametro(p ? `${formatBRL(p.valorCents)}${p.bonusCents ? ` (+ ${formatBRL(p.bonusCents)} de bônus)` : ""}` : "o valor que preferir"),
      parametro(`${SITE_BASE.replace(/^https?:\/\//, "")}/${c.slug}/consumo`),
    ],
  };
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

/** Resposta automática a quem escreveu ao número da plataforma sem ser dono de negócio do canal
 *  oficial (o cliente respondendo a um aviso; botão nem chega aqui). null = não responde: mensagem
 *  vazia ou só a palavra de opt-out (o SAIR é do atendys, que já registra a revogação). */
export function respostaForaDoFluxo(texto: string, ultimo: { negocio: string; contato: string } | null): string | null {
  const palavra = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/gi, "").trim().toLowerCase();
  if (!palavra || ["sair", "parar", "pare", "stop", "cancelar", "descadastrar"].includes(palavra)) return null;
  const aviso = "Este número da Ruphus só envia avisos de agendamento.";
  return ultimo ? `${aviso} Para falar com *${ultimo.negocio.replace(/\*/g, "")}*, chame ${ultimo.contato}.` : `${aviso} Fale com o estabelecimento onde você agendou.`;
}

/** Negócio e contato do agendamento mais recente deste telefone entre os negócios do canal oficial.
 *  ponytail: uma consulta por negócio oficial (poucos; índice customerKey+start já existe); índice
 *  telefone→negócio se crescer. */
async function ultimoAgendamentoDoCliente(db: Firestore, telefone: string): Promise<{ negocio: string; contato: string } | null> {
  const chave = customerKey(telefone);
  // agendamento de antes da canonização pode ter a chave sem o 9 (12 dígitos): procura as duas.
  // Só celular (assinante começando em 6-9): fixo "9 3222-4444" não vira o fixo 3222-4444 de outro
  const chaves = [...new Set([chave, chave.replace(/^(55\d\d)9([6-9]\d{7})$/, "$1$2")])];
  const oficiais = await db.collection("tenants").where("whatsapp.canalOficial", "==", true).get();
  let achado: { t: FirebaseFirestore.QueryDocumentSnapshot; start: number } | null = null;
  for (const t of oficiais.docs) {
    if (t.id === DEMO) continue;
    const a = (await t.ref.collection("appointments").where("customerKey", "in", chaves).orderBy("start", "desc").limit(1).get()).docs[0];
    const start = a?.get("start")?.toMillis?.() ?? 0;
    if (a && (!achado || start > achado.start)) achado = { t, start };
  }
  return achado ? { negocio: String(achado.t.get("name") ?? "").trim() || achado.t.id, contato: contatoDoNegocio(achado.t) } : null;
}

/** Responde (uma vez por telefone a cada 24 h) quem escreveu ao número da plataforma fora do fluxo.
 *  replyToInbound pela instância que recebeu (a pessoa acabou de escrever nela; não conta na cota).
 *  Nunca lança: falha só loga. A marca guarda o telefone: o campo expira é o TTL do Firestore
 *  (LGPD), ligado uma vez com gcloud firestore fields ttls update expira --collection-group=respostas. */
export async function responderForaDoFluxo(db: Firestore, telefone: string, texto: string, instancia: string): Promise<void> {
  try {
    const numero = soDigitosComDDI(telefone);
    if (!numero || !respostaForaDoFluxo(texto, null)) return;
    const c = await lerCredenciais(db);
    if (!c) return;
    const ref = db.doc(`${DOC}/respostas/${numero}`);
    // antes da marca: consulta que falha não deixa o cliente 24 h sem resposta
    const ultimo = await ultimoAgendamentoDoCliente(db, numero);
    const livre = await db.runTransaction(async (tx) => {
      const em = (await tx.get(ref)).get("em");
      if (typeof em === "number" && Date.now() - em < 86_400_000) return false;
      tx.set(ref, { em: Date.now(), expira: Timestamp.fromMillis(Date.now() + 86_400_000) });
      return true;
    });
    if (!livre) return;
    await enviarTexto({ atendysApiKey: c.apikey, instanceId: instancia, oficial: true }, numero, respostaForaDoFluxo(texto, ultimo)!, null, undefined, { resposta: true });
  } catch (e) {
    console.error(`[canal oficial] resposta automática a …${telefone.slice(-4)}`, e);
  }
}
