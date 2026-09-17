import { FirebaseError } from "firebase/app";
import { z } from "zod";

const messages: Record<string, string> = {
  "auth/invalid-credential": "E-mail ou senha incorretos.",
  "auth/email-already-in-use": "Este e-mail já tem conta. Entre em vez de criar.",
  "auth/weak-password": "Senha fraca: use pelo menos 6 caracteres.",
  "auth/too-many-requests": "Muitas tentativas. Tente de novo em alguns minutos.",
  "auth/popup-blocked": "O navegador bloqueou a janela do Google. Libere pop-ups e tente de novo.",
  "auth/account-exists-with-different-credential": "Este e-mail já entra com outro método.",
  "permission-denied": "Sem permissão (esse endereço já pode estar em uso).",
};

export function errorMessage(err: unknown) {
  if (err instanceof z.ZodError) return err.issues[0].message;
  if (err instanceof FirebaseError) return messages[err.code] ?? `Erro: ${err.code}`;
  return "Algo deu errado. Tente de novo.";
}
