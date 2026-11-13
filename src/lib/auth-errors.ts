import { FirebaseError } from "firebase/app";
import { z } from "zod";
import { ErroPrevisto } from "@/lib/erro-previsto";

const messages: Record<string, string> = {
  "auth/invalid-credential": "E-mail ou senha incorretos. Confira os dados e tente de novo.",
  "auth/invalid-email": "O e-mail está incompleto. Confira o @ e o domínio.",
  "auth/email-already-in-use": "Este e-mail já tem conta. Entre em vez de criar.",
  "auth/weak-password": "Senha fraca: use pelo menos 6 caracteres.",
  "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos antes de tentar de novo.",
  "auth/network-request-failed": "Sem conexão com o servidor. Confira a internet e tente de novo.",
  "auth/popup-blocked": "O navegador bloqueou a janela do Google. Libere pop-ups e tente de novo.",
  "auth/requires-recent-login": "Por segurança, entre novamente para concluir esta ação.",
  "auth/account-exists-with-different-credential": "Este e-mail já entra por outra forma de acesso.",
  "auth/expired-action-code": "Este link venceu. Peça um novo.",
  "auth/invalid-action-code": "Este link já foi usado ou não vale mais. Peça um novo.",
  "auth/user-disabled": "Esta conta está desativada. Fale com quem administra o negócio.",
  "auth/user-not-found": "Esta conta não existe mais.",
  "permission-denied": "Sem permissão para isso. Entre de novo ou peça acesso ao dono do negócio.",
  unauthenticated: "Sua sessão expirou. Entre novamente para continuar.",
  unavailable: "Sem conexão com o servidor. Confira a internet e tente de novo.",
  "deadline-exceeded": "O servidor demorou para responder. Confira sua conexão e tente de novo.",
  "not-found": "Este item não existe mais. Atualize a página e tente de novo.",
  "already-exists": "Este item já foi criado. Atualize a página para ver os dados atuais.",
  aborted: "Os dados mudaram enquanto você trabalhava. Revise as informações e tente de novo.",
  "failed-precondition": "Não foi possível concluir com os dados atuais. Atualize a página e tente de novo.",
  "resource-exhausted": "Muitas operações em sequência. Aguarde um pouco e tente de novo.",
  internal: "O servidor encontrou um erro. Tente de novo em alguns instantes.",
};

export function errorMessage(err: unknown) {
  if (err instanceof z.ZodError) return err.issues[0].message;
  if (err instanceof ErroPrevisto) return err.message;
  if (err instanceof FirebaseError) return messages[err.code] ?? "Não foi possível concluir agora. Tente de novo em alguns instantes.";
  return "Algo deu errado. Tente de novo. Se o problema continuar, fale com a Ruphus.";
}
