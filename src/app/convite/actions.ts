"use server";

import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/admin";
import { consumirConvite, lerConvite } from "@/lib/convite";
import { verifyFirebaseToken } from "@/lib/verify-token";

/** Aceita o convite: quem está logado vira admin do espaço do link. */
export async function aceitarConvite(idToken: string, token: string) {
  const user = await verifyFirebaseToken(idToken).catch(() => null);
  if (!user) return { ok: false as const, error: "Sessão expirada. Entre novamente." };

  const convite = await lerConvite(adminDb, token);
  if (!convite) return { ok: false as const, error: "Convite inválido ou vencido. Peça um link novo." };

  const tenant = await adminDb.collection("tenants").doc(convite.tenantId).get();
  if (!tenant.exists) return { ok: false as const, error: "Esse negócio não existe mais." };

  const membro = adminDb.doc(`tenants/${convite.tenantId}/members/${user.uid}`);
  // Convite não rebaixa quem já é dono: só cria o acesso de quem ainda não tem
  if (!(await membro.get()).exists) {
    // Uso único: quem recebeu entra; o mesmo link repassado depois não abre nada
    if (!(await consumirConvite(adminDb, convite.jti, user.uid))) {
      return { ok: false as const, error: "Este convite já foi usado. Peça um link novo." };
    }
    // o e-mail fica no membro para o /admin saber quem é (o Admin Auth não roda na Vercel)
    await membro.set({ uid: user.uid, role: "admin", ...(user.email && { email: user.email }), ...(user.name && { nome: user.name }), createdAt: FieldValue.serverTimestamp() });
  }
  return { ok: true as const, tenantId: convite.tenantId, nome: String(tenant.get("name")) };
}

/** De quem é o convite, para a tela de entrada dizer o nome do negócio.
 *
 * O token é a própria credencial: quem o tem já podia aceitar o convite. E o
 * nome do negócio é público — está no site que já está no ar — então isto não
 * expõe nada novo. */
export async function negocioDoConvite(token: string) {
  const convite = await lerConvite(adminDb, token);
  if (!convite) return { ok: false as const };
  const tenant = await adminDb.collection("tenants").doc(convite.tenantId).get();
  if (!tenant.exists) return { ok: false as const };
  return { ok: true as const, slug: tenant.id, nome: String(tenant.get("name") ?? tenant.id) };
}
