import "server-only";
import { ZodError } from "zod";
import { adminDb } from "@/lib/admin";
import { sessaoRevogada } from "@/lib/revogacao";
import { verifyFirebaseToken } from "@/lib/verify-token";

// Quem administra a plataforma (não o negócio) está listado em config/admin.
// Fora do Firestore comum: nenhuma regra libera essa coleção, só o Admin SDK lê.
const DOC = "config/admin";

import { ErroPrevisto } from "@/lib/erro-previsto";

export { ErroPrevisto };
export class SemAcesso extends ErroPrevisto {}

/** Por que quem tem este token não entra, ou null se entra. Os campos vêm de config/admin:
 *  lidos na hora (requireAdmin) ou da cópia que o índice do painel mantém. */
export function semPermissao(uids: unknown, revogados: unknown, user: { uid: string; authTimeMs: number }) {
  if (!Array.isArray(uids) || !uids.includes(user.uid)) return "Área restrita.";
  if (sessaoRevogada(revogados, user.uid, user.authTimeMs)) return "Sua sessão foi encerrada. Entre novamente.";
  return null;
}

export async function requireAdmin(idToken: string) {
  const user = await verifyFirebaseToken(idToken).catch(() => null);
  if (!user) throw new SemAcesso("Sessão expirada. Entre novamente.");
  const doc = await adminDb.doc(DOC).get();
  const motivo = semPermissao(doc.get("uids"), doc.get("revogados"), user);
  if (motivo) throw new SemAcesso(motivo);
  return user;
}

/** Entrada recusada pela validação: diz o campo e o limite, em vez de "não foi possível". */
export function invalido(err: ZodError) {
  const i = err.issues[0];
  const campo = i?.path.join(" › ") || "dados";
  const itens = i && "origin" in i && i.origin === "array" ? "itens" : "letras";
  const motivo =
    i?.code === "too_big" ? `no máximo ${i.maximum} ${itens}` :
    i?.code === "too_small" ? `no mínimo ${i.minimum} ${itens}` :
    "valor inválido";
  return `Confira ${campo}: ${motivo}.`;
}

/** Envolve uma ação do painel: valida o admin e não deixa erro interno vazar. */
export function adminAction<A extends unknown[], R>(run: (user: { uid: string; email?: string }, ...args: A) => Promise<R>) {
  return async (idToken: string, ...args: A) => {
    try {
      return { ok: true as const, dados: await run(await requireAdmin(idToken), ...args) };
    } catch (err) {
      if (err instanceof ErroPrevisto) return { ok: false as const, error: err.message };
      if (err instanceof ZodError) return { ok: false as const, error: invalido(err) };
      console.error("[admin] falha na ação", err);
      return { ok: false as const, error: "Não foi possível concluir agora." };
    }
  };
}
