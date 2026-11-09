import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { AtendysForaDoAr, type ConexaoAtendys, type ConversaInbox, ErroAtendys, ID_INBOX, midiaDaMensagem } from "@/lib/atendys";
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
  return { conn, gestor, ocultos };
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
