"use server";

import { adminDb } from "@/lib/admin";
import { TenantInput } from "@/lib/tenants";

/** O endereço está livre? As regras só deixam membro ler um negócio, então quem
 * ainda não é membro de nenhum não teria como saber: pergunta ao servidor.
 * O endereço é público (é o link de agendamento), então dizer que existe não expõe nada. */
export async function slugLivre(slug: unknown) {
  const s = TenantInput.shape.slug.safeParse(slug);
  if (!s.success) return false;
  return !(await adminDb.doc(`tenants/${s.data}`).get()).exists;
}
