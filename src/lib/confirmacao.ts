"use client";

import { sendEmailVerification, type User } from "firebase/auth";
import { enviarConfirmacaoAction } from "@/app/conta/actions";

/** Envia a confirmação de e-mail no modelo da Ruphus; se o servidor não conseguir, usa o envio
 *  padrão do Firebase (a pessoa não fica sem link). O limite de envios vale como erro. */
export async function enviarConfirmacao(user: User, destino: string) {
  const r = await enviarConfirmacaoAction(await user.getIdToken(), destino).catch(() => null);
  if (r?.ok) return;
  if (r && "limite" in r && r.limite) throw new Error(r.error);
  await sendEmailVerification(user, { url: new URL(destino, location.origin).toString() });
}
