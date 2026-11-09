import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import { atualizarParada, avisarFalhaDeEnvio, prazoDaParada, registrarParada, vigiarEnvio } from "@/lib/mensagens-paradas.server";
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

/** O que vai para quem gere (lastNotifyError, painel): a frase prevista, nunca o texto técnico
 *  de um erro inesperado (ex.: "Unexpected token '<'" de um proxy que devolveu HTML). */
export const motivoLegivel = (e: unknown) => (e instanceof ErroPrevisto ? e.message : "erro inesperado no serviço de WhatsApp");
export const ROTULO_STATUS: Record<string, string> = { connected: "conectado", disconnected: "desconectado", qr: "aguardando o QR" };

/** Vocabularão do atendys: pending_qr vira "qr" no painel (QR aguardando leitura). */
export type StatusConexao = "connected" | "disconnected" | "qr";

/** imagem: pronta para o src de um <img> (data URL). */
export type SituacaoQr = { status: "qr"; imagem: string } | { status: "connecting" } | { status: "connected"; phone: string };

/** Resposta do envio. status "queued" com retryAt: aceita, sai mais tarde (limite curto).
 *  "awaiting_manual": a cota estourou e a mensagem fica parada até alguém escolher entre
 *  enviar à mão (manual-handoff) ou manter agendada (resume). Nenhum dos dois é "enviada". */
export type Envio = {
  messageId: string;
  status: string;
  retryAt?: string | null;
  manualHandoffRequired?: boolean;
  manualHandoffUrl?: string;
  /** Por que parou (RATE_LIMITED, INSTANCE_UNAVAILABLE, QUIET_HOURS), quando o atendys diz. */
  errorCode?: string;
};
export const aguardaDecisao = (e: Pick<Envio, "status">) => e.status === "awaiting_manual";

// quem envia/recebe: precisa da apikey do tenant e do nome da instância
// slug: o negócio (lerConexao preenche); com ele, mensagem parada na cota fica registrada para o painel
// oficial: conexão da plataforma (conexaoOficial preenche); sem import de canal-oficial (circular)
export type ConexaoAtendys = { atendysApiKey: string; instanceId: string; slug?: string; oficial?: boolean };

/** Recusa do atendys: status HTTP e o código do contrato ({ error: { code } }), para quem chama
 *  decidir (409 na instância, NOT_OPTED_IN no envio) sem ler a mensagem. */
export class ErroAtendys extends ErroPrevisto {
  constructor(message: string, readonly status: number, readonly codigo: string | null) {
    super(message);
  }
}

// O dono lê estas frases no painel; o corpo cru da resposta fica só no log do servidor
// (podia trazer detalhe interno do atendys e não dizia nada a quem não é técnico).
const MENSAGEM: Record<string, string> = {
  NOT_OPTED_IN: "Este número ainda não autorizou receber mensagens do negócio.",
  INVALID_NUMBER: "Número de WhatsApp inválido. Confira o DDD e os dígitos.",
  NUMBER_NOT_ON_WHATSAPP: "Este número não tem WhatsApp.",
  INSTANCE_DISCONNECTED: "O WhatsApp do negócio está desconectado. Reconecte pelo painel.",
  INSTANCE_NOT_FOUND: "A conexão do WhatsApp não foi encontrada. Reconecte pelo painel.",
  INVALID_API_KEY: "A credencial do WhatsApp foi recusada. Reconecte pelo painel.",
  UNAUTHORIZED: "A credencial do WhatsApp foi recusada. Reconecte pelo painel.",
  IDEMPOTENCY_CONFLICT: "Essa mesma mensagem já foi enviada há poucos minutos.",
  MESSAGE_NOT_FOUND: "Essa mensagem não foi encontrada no WhatsApp do negócio.",
};

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
    throw new ErroPrevisto("O serviço de WhatsApp não respondeu. Tente de novo em instantes.");
  }
  if (!res.ok) {
    const detalhe = await res.text().catch(() => "");
    let codigo: string | null = null;
    let doServidor = "";
    try {
      const e = (JSON.parse(detalhe) as { error?: { code?: unknown; message?: unknown } }).error;
      codigo = typeof e?.code === "string" ? e.code : null;
      doServidor = typeof e?.message === "string" ? e.message.slice(0, 200) : "";
    } catch {
      // corpo que não é JSON (proxy, HTML de erro): fica sem código
    }
    // sem consentimento (o envio registra o opt-in e repete) e opt-in em conflito (aceite já
    // registrado, ou anterior a um SAIR) são o fluxo de consentimento funcionando, não falha
    const esperado = codigo === "NOT_OPTED_IN" || (res.status === 409 && caminho === "/v1/optin");
    (esperado ? console.warn : console.error)(`[atendys] ${method} ${caminho} → ${res.status} ${detalhe.slice(0, 300)}`);
    // limite (por minuto, por dia, por destinatário), categoria desligada e validação: o atendys
    // já explica em português, e "espere um pouco" enganava quando o limite era o do dia
    const usaDoServidor = codigo !== null && ["RATE_LIMITED", "FORBIDDEN", "VALIDATION_ERROR"].includes(codigo) && doServidor;
    throw new ErroAtendys(
      (usaDoServidor ? doServidor : codigo && MENSAGEM[codigo]) || `O serviço de WhatsApp recusou o pedido (${res.status}). Tente de novo em instantes.`,
      res.status,
      codigo,
    );
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
  opts: { reatribuirChave?: boolean; rotacionarSegredo?: boolean; tenantId?: string; keyId?: string } = {},
): Promise<{ tenantId: string; apikey: string; keyId: string; webhookSecret: string }> {
  // o id já gravado do lado de cá evita baixar a lista de todos os tenants a cada conexão;
  // 404 (tenant apagado no atendys) cai na procura por slug
  const conhecido = opts.tenantId
    ? await chamarAdmin<{ id: string; slug: string }>("GET", `/admin/tenants/${encodeURIComponent(opts.tenantId)}`).catch((e) => {
        if (e instanceof ErroAtendys && e.status === 404) return null;
        throw e;
      })
    : null;
  const existente = conhecido ?? (await chamarAdmin<Array<{ id: string; slug: string }>>("GET", "/admin/tenants")).find((t) => t.slug === slug);

  let tenantId: string;
  let apikey: string;
  let keyId = "";
  let novo = false;
  // o tenant gravado sumiu e outro com o mesmo slug apareceu: a chave e o segredo guardados
  // eram do antigo e não valem neste — emite os dois
  const trocou = !!opts.tenantId && !!existente && existente.id !== opts.tenantId;
  // a chave gravada foi revogada (ou sumiu) no atendys: sem isto, reconectar reaproveitava a
  // chave morta para sempre e todo envio voltava 401
  // Conexão gravada antes de guardarmos o id da chave: morta quando o tenant não tem mais
  // nenhuma chave da Ruphus ativa.
  const chaveMorta =
    !!existente && !trocou && !opts.reatribuirChave &&
    !(await chamarAdmin<Array<{ id: string; label: string; revokedAt: string | null }>>("GET", `/admin/tenants/${existente.id}/keys`)).some((k) =>
      !k.revokedAt && (opts.keyId ? k.id === opts.keyId : ["default", "ruphus-recovery"].includes(k.label)),
    );
  if (existente) {
    tenantId = existente.id;
    if (opts.reatribuirChave || trocou || chaveMorta) {
      const chave = await chamarAdmin<{ id: string; apikey: string }>("POST", `/admin/tenants/${tenantId}/keys`, { label: "ruphus-recovery" });
      apikey = chave.apikey;
      keyId = chave.id;
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
  if (!novo && !trocou && !opts.rotacionarSegredo) return { tenantId, apikey, keyId, webhookSecret: "" };
  const rotacionado = await chamarAdmin<{ webhookSecret: string }>("POST", `/admin/tenants/${tenantId}/webhook-secret/rotate`);
  return { tenantId, apikey, keyId, webhookSecret: rotacionado.webhookSecret };
}

/** Depois de gravar uma chave nova: as emitidas pela Ruphus ANTES dela ("default" na criação,
 *  "ruphus-recovery" nas recuperações) não servem a ninguém e ficavam ativas para sempre.
 *  Só as mais antigas que a nova e nunca a que está gravada: duas conexões ao mesmo tempo
 *  revogavam a chave uma da outra e o negócio ficava sem nenhuma. Chave manual (outro rótulo) fica. */
export async function revogarChavesAntigas(tenantId: string, nova: string, gravada: () => Promise<string | undefined>) {
  const chaves = await chamarAdmin<Array<{ id: string; label: string; createdAt: string; revokedAt: string | null }>>("GET", `/admin/tenants/${tenantId}/keys`);
  const limite = chaves.find((k) => k.id === nova)?.createdAt;
  if (!limite) return;
  for (const k of chaves) {
    if (k.id === nova || k.revokedAt || !["default", "ruphus-recovery"].includes(k.label)) continue;
    if (!(Date.parse(k.createdAt) < Date.parse(limite))) continue;
    // outra conexão gravou a chave dela depois: esta não é mais a dona, não revoga nada
    const atual = await gravada();
    if (atual !== nova) return;
    await chamarAdmin("DELETE", `/admin/tenants/${tenantId}/keys/${encodeURIComponent(k.id)}`).catch((e) =>
      console.error(`[atendys] revogar chave ${k.id} do tenant ${tenantId}`, e),
    );
  }
}

/** Aponta os webhooks do tenant para o ruphus.site (o tenant da plataforma nasceu sem URL). */
export function apontarWebhook(tenantId: string) {
  return chamarAdmin("PATCH", `/admin/tenants/${encodeURIComponent(tenantId)}`, { webhookUrl: WEBHOOK_URL() });
}

/** Cria a instância do número (uma por negócio). O nome vem da resposta do atendys; o 409 diz
 *  que exatamente "{slug}-main" já existe (ele monta {slug do tenant}-{nome}, e o slug do tenant
 *  é o nosso) — listar e pegar "a mais nova" podia prender o negócio a outra instância dele. */
export async function criarInstancia(tenantId: string, slug: string): Promise<{ name: string }> {
  try {
    const r = await chamarAdmin<{ instance?: { name?: string } }>("POST", `/admin/tenants/${tenantId}/instances`, { name: "main" });
    if (r?.instance?.name) return { name: r.instance.name };
  } catch (e) {
    if (!(e instanceof ErroAtendys && e.status === 409)) throw e;
  }
  return { name: `${slug}-main` };
}

/** A chave de administração funciona? Lista os tenants (só leitura) e devolve quantos são. */
export async function verificarChaveAdmin(): Promise<number> {
  return (await chamarAdmin<unknown[]>("GET", "/admin/tenants")).length;
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
// sem evidência o opt-in volta 400 e o envio nunca sai.

/** Consentimento registrado quando o número ainda não tem: origem + evidência. null = não
 *  registra: o gateway recusa (NOT_OPTED_IN) e a mensagem não sai. Consentimento nunca é
 *  presumido: quem fala com cliente passa o opt-in gravado no agendamento (consentimento-whatsapp.ts). */
export type OptIn = { origem: string; evidencia: string; eventId?: string; occurredAt?: string } | null;
/** Aviso para o número do próprio negócio (self-chat) ou o WhatsApp pessoal do dono. */
export const OPTIN_DONO: OptIn = { origem: "ruphus-aviso-dono", evidencia: "Número do próprio negócio ou do dono, cadastrado por ele no painel da Ruphus" };

/**
 * Texto simples (confirmação, lembrete, recibo). O atendys exige o cabeçalho
 * `instance` (qual número do tenant envia) e opt-in do destinatário (LGPD, sempre
 * em produção): quando o número ainda não tem E quem chama passa um optIn (aceite explícito
 * gravado), registramos e repetimos o envio uma vez. Sem optIn, a recusa sobe como está.
 */
/** opcoes.resposta: a pessoa acabou de escrever ou tocar num botão (janela de 24 h): no atendys não
 *  conta na cota por destinatário nem no dedupe de 10 min (replyToInbound). */
export async function enviarTexto(conn: ConexaoAtendys, phone: string, message: string, optIn: OptIn, prazo?: Date, opcoes: { resposta?: boolean } = {}): Promise<Envio> {
  const digits = phone.replace(/\D/g, "");
  return enviarComOptIn(conn, digits, optIn, "/v1/message/send-text", { number: digits, text: message, ...validade(prazo), ...(opcoes.resposta && { replyToInbound: true }) }, message, prazo, opcoes.resposta);
}

/** Até quando o aviso serve (o horário do agendamento): o atendys descarta o que não saiu até lá
 *  (horário silencioso, cota) em vez de entregar "lembrete: hoje às 21:30" no dia seguinte.
 *  Só prazo com folga: o atendys recusa expiresAt no passado. */
function validade(prazo?: Date) {
  return prazo && prazo.getTime() > Date.now() + 60_000 ? { expiresAt: prazo.toISOString() } : {};
}

/** Template aprovado na Meta (API oficial, instância "cloud" do atendys): o único formato que sai
 *  fora da janela de 24 h. parametros vão, em ordem, para {{1}}, {{2}}… do corpo. */
export type Template = { nome: string; idioma?: string; parametros: string[]; /** payload de cada botão de resposta rápida, na ordem do template */ botoes?: string[] };

export async function enviarTemplate(conn: ConexaoAtendys, phone: string, t: Template, optIn: OptIn, prazo?: Date): Promise<Envio> {
  const digits = phone.replace(/\D/g, "");
  const corpo = {
    number: digits,
    name: t.nome,
    language: t.idioma ?? "pt_BR",
    ...(t.parametros.length || t.botoes?.length
      ? { components: [
          ...(t.parametros.length ? [{ type: "body", parameters: t.parametros.map((text) => ({ type: "text", text })) }] : []),
          // o payload volta no message.received (reply.id) quando a pessoa toca no botão
          ...(t.botoes ?? []).map((payload, i) => ({ type: "button", sub_type: "quick_reply", index: String(i), parameters: [{ type: "payload", payload }] })),
        ] }
      : {}),
    ...validade(prazo),
  };
  // texto da parada (painel "Mensagens"): o template com os parâmetros, já que não há texto livre
  return enviarComOptIn(conn, digits, optIn, "/v1/message/send-template", corpo, `[${t.nome}] ${t.parametros.join(" · ")}`, prazo);
}

/** Botões (até 3) ou lista (até 10) pela API oficial, só dentro da janela de 24 h (a pessoa
 *  acabou de escrever ou tocar num botão). A escolha volta no message.received como reply.id. */
export async function enviarInterativo(
  conn: ConexaoAtendys,
  phone: string,
  m: { texto: string; botoes?: { id: string; title: string }[]; lista?: { botao: string; itens: { id: string; title: string; description?: string }[] } },
  optIn: OptIn,
  opcoes: { resposta?: boolean } = {},
): Promise<Envio> {
  const digits = phone.replace(/\D/g, "");
  const corpo = { number: digits, body: m.texto, ...(opcoes.resposta && { replyToInbound: true }), ...(m.botoes ? { buttons: m.botoes } : {}), ...(m.lista ? { listButton: m.lista.botao, list: m.lista.itens } : {}) };
  return enviarComOptIn(conn, digits, optIn, "/v1/message/send-interactive", corpo, m.texto, undefined, opcoes.resposta);
}

/** Prazo em cima (menos de 60 s): sem expiresAt a mensagem sairia atrasada; nem envia. */
const semFolga = (prazo?: Date) => !!prazo && prazo.getTime() <= Date.now() + 60_000;
const NAO_ENVIADA = { messageId: "", status: "not_sent", destino: "nao_sai" as const };

/** enviarTemplate + seguirSemOperador: para quem envia sem ninguém olhando a tela. */
export async function enviarTemplateSemOperador(conn: ConexaoAtendys, phone: string, t: Template, optIn: OptIn, prazo?: Date) {
  if (semFolga(prazo)) return NAO_ENVIADA;
  const envio = await enviarTemplate(conn, phone, t, optIn, prazo);
  return { ...envio, destino: await seguirSemOperador(conn, envio, prazo) };
}

async function enviarComOptIn(conn: ConexaoAtendys, digits: string, optIn: OptIn, caminho: string, corpo: unknown, message: string, prazo?: Date, resposta = false): Promise<Envio> {
  const auth = { ...authTenant(conn), instance: conn.instanceId };
  const enviar = async (): Promise<Envio> => {
    const r = await chamar<{ id: string; status: string } & Omit<Envio, "messageId" | "status">>(auth, "POST", caminho, corpo);
    // os campos da cota só quando vêm: o envio comum continua { messageId, status }
    return {
      messageId: r.id,
      status: r.status,
      ...(r.retryAt && { retryAt: r.retryAt }),
      ...(r.manualHandoffRequired && { manualHandoffRequired: true }),
      ...(r.manualHandoffUrl && { manualHandoffUrl: r.manualHandoffUrl }),
      ...(r.errorCode && { errorCode: r.errorCode }),
    };
  };
  const registrar = async (e: Envio) => {
    if (aguardaDecisao(e) && conn.slug) await registrarParada(conn.slug, { messageId: e.messageId, retryAt: e.retryAt, errorCode: e.errorCode, para: digits, texto: message, prazo });
    // todo envio aceito é vigiado: a falha que vem depois (a Meta recusou, venceu o prazo no
    // atendys) chega ao negócio pelo message.status failed
    else if (conn.slug) {
      await vigiarEnvio(conn.slug, e.messageId, message, prazo);
      // a falha pode ter chegado antes do índice (o webhook não achou o negócio e ficou no ack):
      // confere uma vez agora. Já avisada pelo webhook, a marca da mensagem não deixa repetir.
      // Só no canal oficial (a Meta recusa logo depois do aceite) e fora das respostas: um GET a
      // mais por envio no resto não compensa
      const agora = conn.oficial && !resposta ? await statusDaMensagem(conn, e.messageId).catch(() => null) : null;
      if (agora?.status === "failed") await avisarFalhaDeEnvio(conn.slug, e.messageId, agora.errorCode);
    }
    return e;
  };
  try {
    return await registrar(await enviar());
  } catch (e) {
    if (optIn && e instanceof ErroAtendys && e.codigo === "NOT_OPTED_IN") {
      await registrarOptIn(conn, digits, optIn).catch((r) => {
        // o mesmo aceite (eventId) já está lá: não é erro, segue para o envio
        if (r instanceof ErroAtendys && r.status === 409 && /já foi registrado/i.test(r.message)) return;
        // o cliente respondeu SAIR depois deste aceite: respeita, sem nova tentativa e sem enviar
        if (r instanceof ErroAtendys && r.status === 409 && /posterior à revogação/i.test(r.message)) {
          console.warn(`[atendys] ${optIn.eventId ?? digits}: o cliente saiu (SAIR) depois deste aceite; mensagem não enviada`);
          throw new ErroAtendys("O cliente pediu para não receber mais mensagens (SAIR) depois deste aceite.", 409, "OPT_OUT");
        }
        throw r;
      });
      return registrar(await enviar());
    }
    throw e;
  }
}

/** O cliente pediu SAIR depois do aceite: não é falha a repetir, é a vontade dele. */
export const saiuDepoisDoAceite = (e: unknown) => e instanceof ErroAtendys && e.codigo === "OPT_OUT";

// o id vai no caminho: só o formato que o atendys gera (uuid), nada de "../"
const ID_MENSAGEM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const caminhoDa = (messageId: string, acao: string) => {
  if (!ID_MENSAGEM.test(messageId)) throw new ErroPrevisto("Mensagem inválida.");
  return `/v1/message/${messageId}/${acao}`;
};

/** "Enviar agora" de uma mensagem parada na cota: o atendys marca manual_started (ação manual
 *  iniciada, não enviada) e devolve o wa.me com o número e o texto. A URL tem dados do cliente:
 *  não vai para log. Repetir é seguro (devolve o mesmo fluxo). */
export async function assumirEnvio(conn: ConexaoAtendys, messageId: string) {
  return chamar<{ id: string; status: string; manualHandoffUrl: string; manualHandoffAt: string | null }>(authTenant(conn), "POST", caminhoDa(messageId, "manual-handoff"), {});
}

/** "Manter agendada": volta à fila para sair no retryAt (hora em UTC). */
export async function manterAgendada(conn: ConexaoAtendys, messageId: string) {
  return chamar<{ id: string; status: string; retryAt: string | null }>(authTenant(conn), "POST", caminhoDa(messageId, "resume"), {});
}

/** Estado atual de uma mensagem (queued, awaiting_manual, manual_started, sent, delivered, read, failed). */
export async function statusDaMensagem(conn: ConexaoAtendys, messageId: string) {
  return chamar<{ id: string; status: string; retryAt?: string | null; errorCode?: string | null; errorMessage?: string | null; manualHandoffRequired?: boolean; manualHandoffUrl?: string }>(authTenant(conn), "GET", caminhoDa(messageId, "status"));
}

/** Envio sem ninguém olhando (lembrete, aviso de agendamento, robô): parada na cota, volta à fila
 *  se o retryAt ainda serve (antes do prazo, quando há); senão fica parada para o painel decidir.
 *  Devolve o que aconteceu, para quem chama não registrar como enviada. */
export async function seguirSemOperador(conn: ConexaoAtendys, envio: Envio, prazo?: Date): Promise<"enviada" | "agendada" | "parada" | "nao_sai"> {
  if (!aguardaDecisao(envio)) {
    if (!envio.retryAt) return "enviada";
    // adiada para depois do prazo (horário silencioso, limite): com expiresAt o atendys descarta;
    // não é "agendada" (o dono ouviria "cliente avisado" de um aviso que não vai sair). Só quando
    // o expiresAt foi: sem ele, a mensagem sai atrasada
    const quando = new Date(envio.retryAt);
    if (prazo && "expiresAt" in validade(prazo) && !Number.isNaN(quando.getTime()) && quando >= prazo) {
      console.warn(`[atendys] mensagem ${envio.messageId} adiada para depois do prazo; não sai`);
      return "nao_sai";
    }
    return "agendada";
  }
  const quando = envio.retryAt ? new Date(envio.retryAt) : null;
  // sem prazo, não há como saber se ainda serve amanhã ("confirmado" um dia depois engana): fica parada
  if (prazo && quando && !Number.isNaN(quando.getTime()) && quando < prazo) {
    // a mensagem já foi aceita: falha ao reagendar não é falha de envio (quem chama não reenvia)
    const ok = await manterAgendada(conn, envio.messageId).then(() => true, (e) => (console.error(`[atendys] resume de ${envio.messageId}`, e), false));
    if (ok) {
      // voltou à fila: sai da lista do painel (senão o dono poderia mandar à mão de novo)
      if (conn.slug) await atualizarParada(conn.slug, envio.messageId, "queued", envio.retryAt).catch((e) => console.error(`[mensagens] fila de ${envio.messageId}`, e));
      return "agendada";
    }
  }
  // parada até o horário: depois dele, some da lista do painel
  if (prazo && conn.slug) await prazoDaParada(conn.slug, envio.messageId, prazo);
  console.warn(`[atendys] mensagem ${envio.messageId} parada na cota, sem horário útil para reenviar`);
  return "parada";
}

/** enviarTexto + seguirSemOperador: para quem envia sem ninguém olhando a tela. */
export async function enviarSemOperador(conn: ConexaoAtendys, phone: string, message: string, optIn: OptIn, prazo?: Date, opcoes: { resposta?: boolean } = {}) {
  if (semFolga(prazo)) return NAO_ENVIADA;
  const envio = await enviarTexto(conn, phone, message, optIn, prazo, opcoes);
  return { ...envio, destino: await seguirSemOperador(conn, envio, prazo) };
}

/** Consentimento explícito (quando o fluxo pede, ex.: aceite no agendamento). Com eventId e
 *  occurredAt quando o aceite tem (o atendys exige os dois para reativar quem saiu). */
export function registrarOptIn(conn: ConexaoAtendys, phone: string, optIn: NonNullable<OptIn>) {
  return chamar(authTenant(conn), "POST", "/v1/optin", {
    number: phone.replace(/\D/g, ""),
    source: optIn.origem,
    category: "transactional",
    evidence: optIn.evidencia,
    ...(optIn.eventId && { eventId: optIn.eventId }),
    ...(optIn.occurredAt && { occurredAt: optIn.occurredAt }),
  });
}

/** Webhook do atendys: HMAC-SHA256 do corpo bruto com o segredo do tenant, em hex no cabeçalho
 *  x-atendys-signature. Comparação em tempo constante. */
export function assinaturaValida(segredo: string, bruto: string, assinatura: string) {
  const recebida = Buffer.from(assinatura, "utf8");
  const calculada = Buffer.from(createHmac("sha256", segredo).update(bruto, "utf8").digest("hex"), "utf8");
  return recebida.length === calculada.length && timingSafeEqual(recebida, calculada);
}

/** Janela do timestamp da v2 (anti-replay). Relógios sincronizados por NTP; hoje é o mesmo servidor. */
const JANELA_V2_S = 300;

/** v2: HMAC-SHA256 de "${timestamp}.${corpo}" em x-atendys-signature-v2, timestamp (epoch em
 *  segundos) em x-atendys-timestamp, aceito a até 300 s do relógio daqui. */
export function assinaturaV2Valida(segredo: string, bruto: string, timestamp: string, assinatura: string, agora = Date.now()) {
  if (!/^\d{1,12}$/.test(timestamp) || Math.abs(agora / 1000 - Number(timestamp)) > JANELA_V2_S) return false;
  return assinaturaValida(segredo, `${timestamp}.${bruto}`, assinatura);
}

export type CabecalhosWebhook = { v1: string | null; v2: string | null; timestamp: string | null };

/** Só a v2 vale (desde 2026-11-09 o atendys não manda mais a v1): sem ela, ou fora da janela,
 *  recusa — mesmo com uma v1 válida, que não tem tempo e pode ser reenviada. A v1 fica no tipo só
 *  para o log da recusa dizer que veio. */
export function versaoDaAssinatura(segredo: string, bruto: string, h: CabecalhosWebhook, agora = Date.now()): "v2" | null {
  return h.v2 !== null && h.timestamp !== null && assinaturaV2Valida(segredo, bruto, h.timestamp, h.v2, agora) ? "v2" : null;
}

/** O QR como o atendys devolve (repassado da Evolution) vira um src de imagem. Vem em três formas:
 *  já com "data:image/png;base64," (o comum — prefixar de novo quebrava a imagem), só o base64
 *  do PNG, ou o texto do pareamento ("2@…", quando a Evolution não manda imagem), que vira QR aqui. */
export async function imagemDoQr(valor: string) {
  if (valor.startsWith("data:")) return valor;
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(valor) && valor.startsWith("iVBOR")) return `data:image/png;base64,${valor}`;
  return QRCode.toDataURL(valor, { margin: 1, width: 264 });
}
