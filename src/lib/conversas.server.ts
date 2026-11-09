import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { AtendysForaDoAr, CHAVE_IDEMPOTENCIA, type ConexaoAtendys, type ConversaInbox, ErroAtendys, ID_INBOX, listarConversas, midiaDaMensagem, responderComMidia } from "@/lib/atendys";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { requireMember, UserError } from "@/lib/booking.server";
import { soDigitosComDDI } from "@/lib/telefone";
import type { verifyFirebaseToken } from "@/lib/verify-token";
import { lerConexao } from "@/lib/whatsapp.server";

// Central de conversas: quem pode atender os clientes pelo WhatsApp do negócio no painel.
// Dono, admin do negócio e admin da plataforma sempre; a equipe (role member) só com
// conversas.equipeAtende ligado pelo dono. Conferido no servidor a cada ação: a tela só esconde.

/** Recusa de permissão (403), separada da sessão vencida (401) e da falta de conexão (409). */
export class SemAcessoConversas extends UserError {}
export class SemConexaoConversas extends UserError {}

type Papel = "gestor" | "equipe";

export async function papelNasConversas(db: Firestore, tenantId: string, uid: string): Promise<Papel | null> {
  const [membro, plataforma, negocio] = await Promise.all([
    db.doc(`tenants/${tenantId}/members/${uid}`).get(),
    db.doc("config/admin").get(),
    db.doc(`tenants/${tenantId}`).get(),
  ]);
  if (!negocio.exists) return null;
  if ((plataforma.get("uids") as unknown[] | undefined)?.includes(uid)) return "gestor";
  if (!membro.exists) return null;
  if (["owner", "admin"].includes(membro.get("role"))) return "gestor";
  return negocio.get("conversas.equipeAtende") === true ? "equipe" : null;
}

export const podeAtenderConversas = async (db: Firestore, tenantId: string, uid: string) => (await papelNasConversas(db, tenantId, uid)) !== null;

export type Atendimento = {
  tenantId: string;
  conn: ConexaoAtendys;
  gestor: boolean;
  /** Números que a equipe não vê: o WhatsApp pessoal do dono (recebe os avisos do negócio) e o
   *  próprio número do negócio (self-chat). Vazio para quem gere. */
  ocultos: string[];
};

/** A conexão do negócio para falar com a Central, depois de conferir quem pede. */
export async function conexaoParaAtender(db: Firestore, tenantId: string, uid: string): Promise<Atendimento> {
  const papel = await papelNasConversas(db, tenantId, uid);
  if (!papel) throw new SemAcessoConversas("Só o dono atende as conversas deste negócio. Peça a ele para liberar a equipe.");
  const conn = await lerConexao(db, tenantId);
  if (!conn) throw new SemConexaoConversas("Conecte o WhatsApp do negócio para ver as conversas.");
  const gestor = papel === "gestor";
  const ocultos = gestor ? [] : [conn.ownerPhone, conn.phone].map((p) => (p ? soDigitosComDDI(p) : null)).filter((p): p is string => !!p);
  return { tenantId, conn, gestor, ocultos };
}

/** Sessão (token, membro, revogação) e permissão de atender, numa chamada: as ações e a rota de mídia. */
export async function atenderComo(verify: typeof verifyFirebaseToken, db: Firestore, idToken: string, tenantId: string) {
  const user = await requireMember(verify, db, idToken, tenantId);
  return { user, ...(await conexaoParaAtender(db, tenantId, user.uid)) };
}

/** Tira da lista o que a equipe não vê (ver Atendimento.ocultos). */
export function visiveis(a: Pick<Atendimento, "ocultos">, conversas: ConversaInbox[]) {
  if (!a.ocultos.length) return conversas;
  return conversas.filter((c) => !c.contactPhone || !a.ocultos.includes(soDigitosComDDI(c.contactPhone) ?? c.contactPhone));
}

// A conversa do dono some da lista da equipe, mas o id dela (selado, estável) podia chegar por um
// link antigo ou por quem foi gestor. O atendys não tem busca por id: varre a lista uma vez e
// guarda por alguns minutos os ids que a equipe não vê.
// ponytail: até 5 páginas de 100 por filtro; filtro de número excluído no atendys resolve de vez
const OCULTAS_TTL_MS = 5 * 60_000;
const ocultasCache = new Map<string, { ids: Set<string>; ate: number }>();

async function idsOcultos(a: Atendimento): Promise<Set<string>> {
  const guardado = ocultasCache.get(a.tenantId);
  if (guardado && guardado.ate > Date.now()) return guardado.ids;
  const ids = new Set<string>();
  for (const filtro of ["active", "archived"] as const) {
    let cursor: string | undefined;
    for (let pagina = 0; pagina < 5; pagina++) {
      const p = await listarConversas(a.conn, { filtro, cursor, limite: 100 });
      for (const c of p.items) if (c.contactPhone && !visiveis(a, [c]).length) ids.add(c.id);
      if (!p.nextCursor) break;
      cursor = p.nextCursor;
    }
  }
  ocultasCache.set(a.tenantId, { ids, ate: Date.now() + OCULTAS_TTL_MS });
  return ids;
}

/** Antes de qualquer ação numa conversa: a equipe não abre nem responde a conversa do dono. */
export async function exigeConversaVisivel(a: Atendimento, conversa: string) {
  if (!a.ocultos.length) return;
  if ((await idsOcultos(a)).has(conversa)) throw new SemAcessoConversas("Essa conversa é só do dono do negócio.");
}

/** Liga ou desliga a equipe na Central. Só quem gere; negócio que não existe não é criado. */
export async function permitirEquipeNasConversas(db: Firestore, tenantId: string, uid: string, equipeAtende: boolean) {
  if ((await papelNasConversas(db, tenantId, uid)) !== "gestor") throw new SemAcessoConversas("Só o dono ou um administrador do negócio pode liberar a equipe.");
  // update, não set: um slug errado não pode virar um negócio fantasma
  await db.doc(`tenants/${tenantId}`).update({ "conversas.equipeAtende": equipeAtende });
}

// ─── Mídia recebida: bytes do atendys para o navegador de quem atende ───────

const TENANT = /^[^/]{1,128}$/;
// Só imagem (sem SVG), áudio e vídeo abrem no navegador; o resto vai como arquivo para baixar.
// O atendys já faz isso; repetido aqui porque blob/object URL não leva o CSP desta resposta.
const INLINE = /^(image\/(?!svg)[\w.+-]+|audio\/[\w.+-]+|video\/[\w.+-]+)$/i;

const falha = (error: string, status: number, retryAfter?: number | null) =>
  Response.json({ ok: false, error }, { status, headers: { "cache-control": "no-store", ...(retryAfter && { "retry-after": String(retryAfter) }) } });

/** Status por tipo de falha: o painel renova o token no 401 e não confunde atendys fora do ar com "sem acesso". */
function statusDe(e: unknown) {
  if (e instanceof ErroAtendys) return falha(e.message, [404, 410, 429].includes(e.status) ? e.status : 502, e.retryAfter);
  if (e instanceof AtendysForaDoAr) return falha(e.message, e.demorou ? 504 : 502);
  if (e instanceof SemConexaoConversas) return falha(e.message, 409);
  if (e instanceof SemAcessoConversas) return falha(e.message, 403);
  // de requireMember: sessão vencida/encerrada é 401; quem não é membro, 403
  if (e instanceof ErroPrevisto) return falha(e.message, /sess[aã]o/i.test(e.message) ? 401 : 403);
  console.error("[conversas] falha ao buscar mídia", e);
  return falha("Não foi possível abrir o arquivo agora.", 500);
}

/** A resposta inteira da rota de mídia (rota em src/app/api/conversas/…), aqui para ser testada
 *  com um verificador de token simulado. */
export async function midiaParaNavegador(verify: typeof verifyFirebaseToken, db: Firestore, token: string, tenant: string, mensagem: string) {
  if (!TENANT.test(tenant) || !ID_INBOX.test(mensagem)) return falha("Pedido inválido.", 400);
  try {
    const { conn } = await atenderComo(verify, db, token, tenant);
    const res = await midiaDaMensagem(conn, mensagem);
    const tipo = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    const inline = INLINE.test(tipo);
    return new Response(res.body, {
      status: 200,
      headers: {
        "content-type": inline ? tipo : "application/octet-stream",
        "content-disposition": inline ? "inline" : "attachment",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox",
      },
    });
  } catch (e) {
    return statusDe(e);
  }
}

// ─── Resposta com arquivo: do navegador ao atendys ──────────────────────────
// Rota (multipart), não server action: a action tem teto de 1 MB. O teto daqui cabe no
// proxyClientMaxBodySize (13 MB, next.config) e no corpo de 25 MB do atendys depois do base64.
// ponytail: 12 MB por arquivo; vídeo maior pede subir o proxyClientMaxBodySize junto
const RECUSA_403 = new Set(["REPLY_WINDOW_CLOSED", "RECIPIENT_OPTED_OUT", "MESSAGE_TYPE_NOT_ALLOWED"]);
export const TETO_ARQUIVO = 12 * 1024 * 1024;
// imagem, áudio, vídeo e documentos de escritório: o tipo vem do navegador, então nada de executável
const TIPO_ARQUIVO =
  /^(image\/(?!svg)[\w.+-]+|audio\/[\w.+-]+|video\/[\w.+-]+|application\/(pdf|msword|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)|vnd\.ms-excel|vnd\.ms-powerpoint))$/;

/** A resposta inteira da rota de envio de arquivo, testável com verificador simulado. */
export async function responderArquivoDoNavegador(verify: typeof verifyFirebaseToken, db: Firestore, token: string, tenant: string, lerForm: () => Promise<FormData | null>) {
  if (!TENANT.test(tenant)) return falha("Pedido inválido.", 400);
  try {
    // quem não pode atender não faz o servidor ler o arquivo
    const a = await atenderComo(verify, db, token, tenant);
    const form = await lerForm();
    // corpo cortado pelo teto do proxy (sem content-length, chunked) chega como form ilegível
    if (!form) return falha("Arquivo grande demais ou corrompido. Envie um de até 12 MB.", 400);
    const conversa = form?.get("conversa");
    const chave = form?.get("chave");
    const arquivo = form?.get("arquivo");
    const legenda = form?.get("legenda");
    const citada = form?.get("citada");
    if (typeof conversa !== "string" || !ID_INBOX.test(conversa) || typeof chave !== "string" || !CHAVE_IDEMPOTENCIA.test(chave) || !(arquivo instanceof File)) {
      return falha("Pedido inválido.", 400);
    }
    await exigeConversaVisivel(a, conversa);
    if (citada !== null && (typeof citada !== "string" || !ID_INBOX.test(citada))) return falha("Pedido inválido.", 400);
    if (legenda !== null && (typeof legenda !== "string" || legenda.length > 1024)) return falha("Legenda longa demais.", 400);
    if (!arquivo.size) return falha("Arquivo vazio.", 400);
    if (arquivo.size > TETO_ARQUIVO) return falha("Arquivo acima de 12 MB. Envie um menor.", 413);
    const tipo = arquivo.type || "application/octet-stream";
    if (!TIPO_ARQUIVO.test(tipo)) return falha("Tipo de arquivo não aceito.", 415);
    const media = `data:${tipo};base64,${Buffer.from(await arquivo.arrayBuffer()).toString("base64")}`;
    const envio = await responderComMidia(
      a.conn,
      conversa,
      {
        media,
        mimetype: tipo,
        fileName: arquivo.name ? arquivo.name.slice(0, 200) : undefined,
        caption: typeof legenda === "string" && legenda.trim() ? legenda.trim() : undefined,
        voice: form?.get("voz") === "1" || undefined,
        quotedMessageId: typeof citada === "string" ? citada : undefined,
      },
      chave,
    );
    return Response.json({ ok: true, envio }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof ErroAtendys) {
      // a tela decide pelo código (janela fechada, opt-out…), como nas ações
      return Response.json(
        { ok: false, error: e.message, codigo: e.codigo, retryAfter: e.retryAfter },
        // 401/403 de credencial do negócio não são "sua sessão": como na rota de mídia, 502
        { status: e.status >= 400 && e.status < 500 && ![401, 403].includes(e.status) ? e.status : e.codigo && RECUSA_403.has(e.codigo) ? 403 : 502, headers: { "cache-control": "no-store", ...(e.retryAfter && { "retry-after": String(e.retryAfter) }) } },
      );
    }
    return statusDe(e);
  }
}
