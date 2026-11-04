import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { integracao } from "@/lib/integracoes.server";

// Cliente da plataforma de notificações WhatsApp (atendys). Só roda no servidor:
// as chaves moram em variáveis de ambiente e nenhum segredo vai ao navegador.
//
// Dois níveis de autenticação:
// - admin (X-Admin-Key, cadastrada no /admin ou no .env): provisionamento — criar o tenant
//   do negócio, a instância do número, logout/reinício administrativo.
// - tenant (header apikey, gravada no doc do negócio): status, QR, envio (com o header
//   instance = nome da instância), opt-in (origem + evidência obrigatórias).
//
// Contrato: https://<vps>:3002/docs (Swagger). Webhooks assinados por tenant
// com HMAC-SHA256 em x-atendys-signature (segredo gravado no doc do negócio).

const BASE = () => (process.env.ATENDYS_BASE_URL ?? "http://127.0.0.1:3002").replace(/\/+$/, "");
const SITE = () => (process.env.PUBLIC_SITE_URL ?? "https://ruphus.site").replace(/\/+$/, "");
const WEBHOOK_URL = () => `${SITE()}/api/webhooks/atendys`;
// o primeiro envio para um número novo estabelece a sessão de criptografia do
// WhatsApp e leva 8–15s; 35s cobre o pior caso sem deixar a tela travada
const TIMEOUT_MS = 35_000;

/** Vocabularão do atendys: pending_qr vira "qr" no painel (QR aguardando leitura). */
export type StatusConexao = "connected" | "disconnected" | "qr";

/** imagem: pronta para o src de um <img> (data URL). */
export type SituacaoQr = { status: "qr"; imagem: string } | { status: "connecting" } | { status: "connected"; phone: string };

export type Envio = { messageId: string; status: string };

// quem envia/recebe: precisa da apikey do tenant e do nome da instância
export type ConexaoAtendys = { atendysApiKey: string; instanceId: string };

async function chamar<T>(auth: Record<string, string>, method: string, caminho: string, corpo?: unknown): Promise<T> {
  const headers: Record<string, string> = { ...auth };
  if (corpo !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${BASE()}${caminho}`, {
      method,
      headers,
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new ErroPrevisto(`O serviço de WhatsApp demorou mais de ${Math.round(TIMEOUT_MS / 1000)}s para responder. Tente de novo.`);
    }
    throw new ErroPrevisto("O serviço de WhatsApp não respondeu. Verifique se o atendys está no ar.");
  }
  if (!res.ok) {
    const detalhe = await res.text().catch(() => "");
    throw new ErroPrevisto(`O serviço de WhatsApp respondeu ${res.status}${detalhe ? `: ${detalhe.slice(0, 160)}` : ""}.`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function chamarAdmin<T>(method: string, caminho: string, corpo?: unknown): Promise<T> {
  const chave = await integracao("ATENDYS_ADMIN_KEY");
  if (!chave) {
    throw new ErroPrevisto("O provisionamento do WhatsApp não está configurado (falta a chave de administração do atendys no /admin).");
  }
  return chamar<T>({ "x-admin-key": chave }, method, caminho, corpo);
}

const authTenant = (conn: ConexaoAtendys) => {
  if (!conn.atendysApiKey) throw new ErroPrevisto("Conexão do WhatsApp sem credencial. Reconecte pelo painel.");
  if (!conn.instanceId) throw new ErroPrevisto("Conexão do WhatsApp inválida. Reconecte pelo painel.");
  return { apikey: conn.atendysApiKey };
};

// ─── Provisionamento (admin) ────────────────────────────────────────────────

/**
 * Garante o tenant do negócio no atendys e devolve as credenciais para gravar.
 * Idempotente por slug: se o tenant já existe, reutiliza; reatribuirChave emite
 * uma nova apikey (quando o doc local perdeu a credencial). O segredo de
 * assinatura dos webhooks só é rotacionado quando o caller não tem um gravado
 * (tenant novo ou credencial perdida): rotacionar a cada reconexão deixava os
 * webhooks recusados entre o rotate e a gravação — e para sempre, se a gravação
 * falhasse. Sem rotate, webhookSecret volta "" e o caller mantém o que tem.
 */
export async function garantirTenant(
  slug: string,
  nomeNegocio: string,
  opts: { reatribuirChave?: boolean; rotacionarSegredo?: boolean } = {},
): Promise<{ tenantId: string; apikey: string; webhookSecret: string }> {
  const lista = await chamarAdmin<Array<{ id: string; slug: string }>>("GET", "/admin/tenants");
  const existente = lista.find((t) => t.slug === slug);

  let tenantId: string;
  let apikey: string;
  let novo = false;
  if (existente) {
    tenantId = existente.id;
    if (opts.reatribuirChave) {
      const chave = await chamarAdmin<{ apikey: string }>("POST", `/admin/tenants/${tenantId}/keys`, { label: "ruphus-recovery" });
      apikey = chave.apikey;
    } else {
      // o caller reutiliza a apikey já gravada; o rotate abaixo devolve o segredo novo
      apikey = "";
    }
  } else {
    const criado = await chamarAdmin<{ tenant: { id: string }; apikey: string }>("POST", "/admin/tenants", {
      name: nomeNegocio,
      slug,
      webhookUrl: WEBHOOK_URL(),
    });
    tenantId = criado.tenant.id;
    apikey = criado.apikey;
    novo = true;
  }

  // tenant novo nunca teve segredo do lado de cá: rotaciona para conhecê-lo
  if (!novo && !opts.rotacionarSegredo) return { tenantId, apikey, webhookSecret: "" };
  const rotacionado = await chamarAdmin<{ webhookSecret: string }>("POST", `/admin/tenants/${tenantId}/webhook-secret/rotate`);
  return { tenantId, apikey, webhookSecret: rotacionado.webhookSecret };
}

/** Cria a instância do número (uma por negócio). 409 = já existe → idempotente. */
export async function criarInstancia(tenantId: string, slug: string): Promise<{ name: string }> {
  const name = `${slug}-main`;
  try {
    await chamarAdmin("POST", `/admin/tenants/${tenantId}/instances`, { name: "main" });
  } catch (e) {
    if (!(e instanceof ErroPrevisto && /409/.test(e.message))) throw e;
  }
  return { name };
}

/** Despareia o número (administrativo — o painel do dono desconecta via plataforma). */
export function deslogarInstancia(instanceId: string) {
  return chamarAdmin("POST", `/admin/instances/${encodeURIComponent(instanceId)}/logout`, {});
}

// ─── Operações do tenant ────────────────────────────────────────────────────

export async function statusDaConexao(conn: ConexaoAtendys): Promise<{ status: StatusConexao; phone: string | null }> {
  const r = await chamar<{ name: string; status: string; phone?: string | null }>(
    authTenant(conn), "GET", `/v1/instance/${encodeURIComponent(conn.instanceId)}/status`,
  );
  const status = r.status === "connected" ? "connected" : r.status === "pending_qr" ? "qr" : "disconnected";
  return { status, phone: r.phone ?? null };
}

export async function qrDaConexao(conn: ConexaoAtendys): Promise<SituacaoQr> {
  const r = await chamar<{ base64: string }>(
    authTenant(conn), "GET", `/v1/instance/${encodeURIComponent(conn.instanceId)}/qr`,
  );
  if (r.base64) return { status: "qr", imagem: await imagemDoQr(r.base64) };
  // sem QR novo: a instância pode estar conectando ou já conectada — o status vem do polling
  return { status: "connecting" };
}

// o atendys exige origem E evidência (texto livre) em todo consentimento (OptInDto);
// sem evidência o opt-in volta 400 e o envio nunca sai
const EVIDENCIA_PADRAO = "Número informado pelo próprio titular ao agendar pelo site do negócio (ruphus.site)";

/**
 * Texto simples (confirmação, lembrete, recibo). O atendys exige o cabeçalho
 * `instance` (qual número do tenant envia) e opt-in do destinatário (LGPD, sempre
 * em produção): quando o número ainda não tem, registramos com origem ruphus e
 * a evidência de que o titular forneceu o número para receber a comunicação do
 * agendamento. Falha de opt-in inscreve e repete o envio uma vez.
 */
export async function enviarTexto(conn: ConexaoAtendys, phone: string, message: string): Promise<Envio> {
  const digits = phone.replace(/\D/g, "");
  const auth = { ...authTenant(conn), instance: conn.instanceId };
  const enviar = () => chamar<{ id: string; status: string }>(auth, "POST", "/v1/message/send-text", { number: digits, text: message });
  try {
    const r = await enviar();
    return { messageId: r.id, status: r.status };
  } catch (e) {
    if (e instanceof ErroPrevisto && /NOT_OPTED_IN/.test(e.message)) {
      await registrarOptIn(conn, digits, "ruphus-agendamento");
      const r = await enviar();
      return { messageId: r.id, status: r.status };
    }
    throw e;
  }
}

/** Consentimento explícito (quando o fluxo pede, ex.: aceite no agendamento). */
export function registrarOptIn(conn: ConexaoAtendys, phone: string, origem: string, evidencia = EVIDENCIA_PADRAO) {
  return chamar(authTenant(conn), "POST", "/v1/optin", {
    number: phone.replace(/\D/g, ""),
    source: origem,
    category: "transactional",
    evidence: evidencia,
  });
}

/** Webhook do atendys: HMAC-SHA256 do corpo bruto com o segredo do tenant, em hex no cabeçalho
 *  x-atendys-signature. Comparação em tempo constante. */
export function assinaturaValida(segredo: string, bruto: string, assinatura: string) {
  const recebida = Buffer.from(assinatura, "utf8");
  const calculada = Buffer.from(createHmac("sha256", segredo).update(bruto, "utf8").digest("hex"), "utf8");
  return recebida.length === calculada.length && timingSafeEqual(recebida, calculada);
}

/** O QR como o atendys devolve (repassado da Evolution) vira um src de imagem. Vem em três formas:
 *  já com "data:image/png;base64," (o comum — prefixar de novo quebrava a imagem), só o base64
 *  do PNG, ou o texto do pareamento ("2@…", quando a Evolution não manda imagem), que vira QR aqui. */
export async function imagemDoQr(valor: string) {
  if (valor.startsWith("data:")) return valor;
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(valor) && valor.startsWith("iVBOR")) return `data:image/png;base64,${valor}`;
  return QRCode.toDataURL(valor, { margin: 1, width: 264 });
}
