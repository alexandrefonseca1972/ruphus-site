import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import type { ConexaoAtendys } from "@/lib/atendys";
import { UserError } from "@/lib/booking.server";
import { lerConexao } from "@/lib/whatsapp.server";

// Central de conversas: quem pode atender os clientes pelo WhatsApp do negócio no painel.
// Dono, admin do negócio e admin da plataforma sempre; a equipe (role member) só com
// conversas.equipeAtende ligado pelo dono. Conferido no servidor a cada ação: a tela só esconde.

export async function podeAtenderConversas(db: Firestore, tenantId: string, uid: string) {
  const [membro, plataforma, negocio] = await Promise.all([
    db.doc(`tenants/${tenantId}/members/${uid}`).get(),
    db.doc("config/admin").get(),
    db.doc(`tenants/${tenantId}`).get(),
  ]);
  if (!negocio.exists) return false;
  if ((plataforma.get("uids") as unknown[] | undefined)?.includes(uid)) return true;
  if (!membro.exists) return false;
  if (["owner", "admin"].includes(membro.get("role"))) return true;
  return negocio.get("conversas.equipeAtende") === true;
}

/** A conexão do negócio para falar com a Central, depois de conferir quem pede. */
export async function conexaoParaAtender(db: Firestore, tenantId: string, uid: string): Promise<ConexaoAtendys> {
  if (!(await podeAtenderConversas(db, tenantId, uid))) {
    throw new UserError("Só o dono atende as conversas deste negócio. Peça a ele para liberar a equipe.");
  }
  const conn = await lerConexao(db, tenantId);
  if (!conn) throw new UserError("Conecte o WhatsApp do negócio para ver as conversas.");
  return conn;
}

/** Liga ou desliga a equipe na Central. Quem chama já conferiu que é dono ou admin (exigeGestor). */
export async function permitirEquipeNasConversas(db: Firestore, tenantId: string, equipeAtende: boolean) {
  await db.doc(`tenants/${tenantId}`).set({ conversas: { equipeAtende } }, { merge: true });
}
