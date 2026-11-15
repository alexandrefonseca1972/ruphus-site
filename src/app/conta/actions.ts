"use server";

import { getAuth } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/admin";
import { emailDeConfirmacao } from "@/lib/conta-email";
import { SITE_BASE } from "@/lib/dominio";
import { enviarEmail } from "@/lib/email.server";
import { destinoInterno } from "@/lib/retorno";
import { verifyFirebaseToken } from "@/lib/verify-token";

const ESPERA_MS = 55_000;
const MAX_POR_DIA = 8;

/** Manda a confirmação de e-mail no modelo da Ruphus. O link é gerado pelo Admin SDK e montado em
 *  ruphus.site/conta (a tela que já aplica o código). Uma por minuto e 8 por dia por conta: o
 *  remetente é o nosso domínio, e um botão apertado sem parar não pode virar spam em nome dele.
 *  Falhou (sem e-mail configurado, limite do Firebase), a tela cai no envio padrão do Firebase. */
export async function enviarConfirmacaoAction(idToken: string, destino: string) {
  try {
    const { uid } = await verifyFirebaseToken(idToken);
    const conta = await getAuth().getUser(uid);
    if (!conta.email) return { ok: false as const, error: "Esta conta não tem e-mail." };
    if (conta.emailVerified) return { ok: true as const, jaConfirmado: true };

    const ref = adminDb.doc(`confirmacoesEmail/${uid}`);
    const hoje = new Date().toISOString().slice(0, 10);
    const barrado = await adminDb.runTransaction(async (tx) => {
      const d = await tx.get(ref);
      const n = d.get("dia") === hoje ? Number(d.get("n") ?? 0) : 0;
      if (Date.now() - Number(d.get("ultimo") ?? 0) < ESPERA_MS) return "Já enviamos agora há pouco. Espere um minuto para pedir de novo.";
      if (n >= MAX_POR_DIA) return "Muitos envios hoje. Confira a caixa de spam ou tente amanhã.";
      tx.set(ref, { ultimo: Date.now(), dia: hoje, n: n + 1, em: FieldValue.serverTimestamp() });
      return null;
    });
    if (barrado) return { ok: false as const, error: barrado, limite: true };

    const voltar = destinoInterno(destino, SITE_BASE) || "/painel";
    const continueUrl = new URL(voltar, SITE_BASE).toString();
    const link = new URL(await getAuth().generateEmailVerificationLink(conta.email, { url: continueUrl }));
    const oob = link.searchParams.get("oobCode");
    if (!oob) throw new Error("link sem oobCode");
    const url = new URL("/conta", SITE_BASE);
    url.search = new URLSearchParams({ mode: "verifyEmail", oobCode: oob, continueUrl, lang: "pt-BR" }).toString();
    await enviarEmail({ para: conta.email, ...emailDeConfirmacao({ nome: conta.displayName, email: conta.email, url: url.toString() }) });
    return { ok: true as const, jaConfirmado: false };
  } catch (err) {
    console.error("[conta] confirmação de e-mail não saiu pelo modelo da Ruphus", err);
    return { ok: false as const, error: "Não foi possível enviar agora." };
  }
}
