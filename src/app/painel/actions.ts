"use server";

import { adminDb } from "@/lib/admin";
import { UserError } from "@/lib/booking.server";
import { cotaDe, criarNegocio } from "@/lib/negocios.server";
import { TenantInput } from "@/lib/tenant-input";
import { verifyFirebaseToken } from "@/lib/verify-token";

/** O endereço está livre? As regras só deixam membro ler um negócio, então quem
 * ainda não é membro de nenhum não teria como saber: pergunta ao servidor.
 * O endereço é público (é o link de agendamento), então dizer que existe não expõe nada. */
export async function slugLivre(slug: unknown) {
  const s = TenantInput.shape.slug.safeParse(slug);
  if (!s.success) return false;
  return !(await adminDb.doc(`tenants/${s.data}`).get()).exists;
}

async function quem(idToken: string) {
  const user = await verifyFirebaseToken(idToken).catch(() => null);
  if (!user) throw new UserError("Sessão expirada. Entre novamente.");
  return user;
}

/** Quantos negócios a conta tem e pode ter, para a tela saber se oferece "Cadastrar outro". */
export async function minhaCota(idToken: string) {
  try {
    return { ok: true as const, ...(await cotaDe(adminDb, (await quem(idToken)).uid)) };
  } catch {
    return { ok: false as const };
  }
}

/** Cria o negócio no servidor: é aqui que o limite por conta vale (as regras não contam negócios). */
export async function criarNegocioAction(idToken: string, input: unknown) {
  try {
    return { ok: true as const, slug: await criarNegocio(adminDb, await quem(idToken), input) };
  } catch (err) {
    if (err instanceof UserError) return { ok: false as const, error: err.message };
    console.error("[painel] falha ao criar negócio", err);
    return { ok: false as const, error: "Não foi possível criar agora. Tente de novo." };
  }
}
