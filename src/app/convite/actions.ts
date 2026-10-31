"use server";

import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/admin";
import { assumirNegocio, conviteAbrePara, entrarNaEquipe, lerConvite } from "@/lib/convite";
import { verifyFirebaseToken } from "@/lib/verify-token";

/** Aceita o convite: quem está logado vira admin do espaço do link, ou funcionário se o convite for da equipe. */
export async function aceitarConvite(idToken: string, token: string) {
  const user = await verifyFirebaseToken(idToken).catch(() => null);
  if (!user) return { ok: false as const, error: "Sessão expirada. Entre novamente." };

  const convite = await lerConvite(adminDb, token);
  if (!convite) return { ok: false as const, error: "Convite inválido ou vencido. Peça um link novo." };

  const tenant = await adminDb.collection("tenants").doc(convite.tenantId).get();
  if (!tenant.exists) return { ok: false as const, error: "Esse negócio não existe mais." };

  // Convite preso a um e-mail só abre para aquela conta, com o endereço confirmado
  const permissao = conviteAbrePara(convite, user);
  if (!permissao.ok) return { ok: false as const, error: permissao.error };

  // o e-mail fica no membro para o /admin saber quem é (o Admin Auth não roda na Vercel)
  const quem = { ...(user.email && { email: user.email }), ...(user.name && { nome: user.name }), createdAt: FieldValue.serverTimestamp() };
  // Quem já tem acesso entra sem mudar de papel. Senão: uso único, corte do dono ou da
  // equipe e o resto da checagem acontecem na mesma transação que grava o acesso
  const recusa = convite.papel === "member"
    ? await entrarNaEquipe(adminDb, convite, user.uid, quem)
    : await assumirNegocio(adminDb, convite, user.uid, quem);
  if (recusa) return { ok: false as const, error: recusa };
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
