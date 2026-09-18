"use server";

import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/admin";
import { lerConvite } from "@/lib/convite";
import { verifyFirebaseToken } from "@/lib/verify-token";

/** Aceita o convite: quem está logado vira admin do espaço do link. */
export async function aceitarConvite(idToken: string, token: string) {
  const user = await verifyFirebaseToken(idToken).catch(() => null);
  if (!user) return { ok: false as const, error: "Sessão expirada. Entre novamente." };

  const tenantId = await lerConvite(adminDb, token);
  if (!tenantId) return { ok: false as const, error: "Convite inválido ou vencido. Peça um link novo." };

  const tenant = await adminDb.collection("tenants").doc(tenantId).get();
  if (!tenant.exists) return { ok: false as const, error: "Esse negócio não existe mais." };

  const membro = adminDb.doc(`tenants/${tenantId}/members/${user.uid}`);
  // Convite não rebaixa quem já é dono: só cria o acesso de quem ainda não tem
  if (!(await membro.get()).exists) {
    await membro.set({ uid: user.uid, role: "admin", createdAt: FieldValue.serverTimestamp() });
  }
  return { ok: true as const, tenantId, nome: String(tenant.get("name")) };
}
