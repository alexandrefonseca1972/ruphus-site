"use server";

import { adminDb } from "@/lib/admin";
import { UserError } from "@/lib/booking.server";
import { CONTRATO_RECUSADO } from "@/lib/contrato";
import { confirmarAceite, dadosDoAceite } from "@/lib/contrato.server";
import { cotaDe, criarNegocio, negociosDe } from "@/lib/negocios.server";
import { TenantInput } from "@/lib/tenant-input";
import { verifyFirebaseToken } from "@/lib/verify-token";
import { sessaoRevogada } from "@/lib/revogacao";

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

/** Os negócios de quem entrou, com o nome e o papel de cada um. Pelo servidor, não pelo
 *  Firestore do navegador: o cache local dele (IndexedDB, várias abas) às vezes recusa com
 *  failed-precondition, e o /painel parava em "Não foi possível carregar os seus negócios". */
export async function meusNegocios(idToken: string) {
  try {
    const { uid, authTimeMs } = await quem(idToken);
    const plataforma = await adminDb.doc("config/admin").get();
    // "encerrar sessões" vale aqui como nas regras: token antigo não lista nada
    // a tela sai da conta (tentar de novo não adiantaria)
    if (sessaoRevogada(plataforma.get("revogados"), uid, authTimeMs)) return { ok: false as const, error: "Sua sessão foi encerrada. Entre novamente.", sair: true };
    const negocios = await negociosDe(adminDb, uid);
    return { ok: true as const, negocios };
  } catch (err) {
    if (err instanceof UserError) return { ok: false as const, error: err.message };
    console.error("[painel] falha ao ler os negócios", err);
    return { ok: false as const, error: "Confira a internet e tente de novo." };
  }
}

/** Cria o negócio no servidor: é aqui que o limite por conta vale (as regras não contam negócios). */
export async function criarNegocioAction(idToken: string, input: unknown, utm: unknown, aceitouContrato: boolean) {
  try {
    if (aceitouContrato !== true) throw new UserError(CONTRATO_RECUSADO);
    const user = await quem(idToken);
    const slug = await criarNegocio(adminDb, user, input, utm, await dadosDoAceite(user, "cadastro"));
    confirmarAceite(user, slug);
    return { ok: true as const, slug };
  } catch (err) {
    if (err instanceof UserError) return { ok: false as const, error: err.message };
    console.error("[painel] falha ao criar negócio", err);
    return { ok: false as const, error: "Não foi possível criar agora. Tente de novo." };
  }
}
