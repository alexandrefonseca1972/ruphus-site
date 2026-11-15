import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { after } from "next/server";
import { headers } from "next/headers";
import { CONTRATO_VERSAO, emailDoAceite } from "@/lib/contrato";
import { adminDb } from "@/lib/admin";
import { enviarEmail } from "@/lib/email.server";

type Quem = { uid: string; email?: string; emailPendente?: string; name?: string };

/** O registro do aceite (aceites/{id}, mais o slug do negócio): quem, quando, de onde e qual versão.
 *
 * Coleção à parte, só do servidor: o doc do negócio a equipe lê, e IP e e-mail do
 * dono não são da conta dela. Cada aceite é um registro novo, nada é sobrescrito. */
export async function dadosDoAceite(user: Quem, origem: "cadastro" | "convite") {
  const h = await headers();
  return {
    versao: CONTRATO_VERSAO,
    origem,
    uid: user.uid,
    // e-mail ainda não confirmado também serve: é o da conta que clicou
    email: user.email ?? user.emailPendente ?? null,
    // X-Real-IP é o que o proxy de borda escreve; o X-Forwarded-For o visitante pode
    // trazer preenchido, então só serve de reserva
    ip: h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0].trim() || null,
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
    em: FieldValue.serverTimestamp(),
  };
}

/** Manda a confirmação do aceite por e-mail depois da resposta: falha de e-mail não
 *  desfaz o aceite nem trava a tela, só fica no log. */
export function confirmarAceite(user: Quem, slug: string) {
  const para = user.email ?? user.emailPendente;
  if (!para) return;
  // o endereço canônico dos Termos: o link do e-mail tem de abrir em qualquer ambiente
  const quando = new Date();
  after(async () => {
    try {
      // o nome do negócio é o que o dono reconhece; sem ele, fica o endereço
      const negocio = await adminDb.doc(`tenants/${slug}`).get().then((t) => t.get("name") as string | undefined, () => undefined);
      await enviarEmail({ para, ...emailDoAceite({ slug, versao: CONTRATO_VERSAO, quando, site: "https://www.ruphus.site", negocio, dono: user.name }) });
    } catch (err) {
      console.error("[contrato] confirmação do aceite não saiu", slug, err);
    }
  });
}
