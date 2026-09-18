import "server-only";
import { adminDb } from "@/lib/admin";
import { verifyFirebaseToken } from "@/lib/verify-token";

// Quem administra a plataforma (não o negócio) está listado em config/admin.
// Fora do Firestore comum: nenhuma regra libera essa coleção, só o Admin SDK lê.
const DOC = "config/admin";

export class SemAcesso extends Error {}

export async function requireAdmin(idToken: string) {
  const user = await verifyFirebaseToken(idToken).catch(() => null);
  if (!user) throw new SemAcesso("Sessão expirada. Entre novamente.");
  const uids = (await adminDb.doc(DOC).get()).get("uids");
  if (!Array.isArray(uids) || !uids.includes(user.uid)) throw new SemAcesso("Área restrita.");
  return user;
}

/** Envolve uma ação do painel: valida o admin e não deixa erro interno vazar. */
export function adminAction<A extends unknown[], R>(run: (user: { uid: string; email?: string }, ...args: A) => Promise<R>) {
  return async (idToken: string, ...args: A) => {
    try {
      return { ok: true as const, dados: await run(await requireAdmin(idToken), ...args) };
    } catch (err) {
      if (err instanceof SemAcesso) return { ok: false as const, error: err.message };
      console.error("[admin] falha na ação", err);
      return { ok: false as const, error: "Não foi possível concluir agora." };
    }
  };
}
