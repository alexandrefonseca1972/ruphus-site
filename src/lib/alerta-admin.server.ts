import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { enviarEmail, type EmailSaida } from "@/lib/email.server";
import { integracao } from "@/lib/integracoes.server";

// Falha que o cliente final não deve ver (SMS que não saiu, por exemplo) vira e-mail para o admin
// da Ruphus. No máximo um e-mail por assunto a cada 6 h: sem crédito na Comtele, todo SMS falha e a
// caixa lotaria. O que repetiu no intervalo é contado em config/alertas e entra no próximo e-mail.
// Nunca lança: quem chama está no meio de um fluxo do cliente e não pode quebrar por causa do aviso.

const JANELA_MS = 6 * 3_600_000;

type Opcoes = { enviar?: (e: EmailSaida) => Promise<unknown>; agora?: number };

/** Avisa o admin por e-mail. Devolve true se o e-mail saiu, false se ficou para a próxima janela
 *  (ou não havia para quem mandar). */
export async function alertarAdmin(db: Firestore, chave: string, assunto: string, texto: string, { enviar = enviarEmail, agora = Date.now() }: Opcoes = {}) {
  try {
    const ref = db.doc("config/alertas");
    const repetidos = await db.runTransaction(async (tx) => {
      const ultimo = (await tx.get(ref)).get(chave) as { em?: number; repetidos?: number } | undefined;
      if (typeof ultimo?.em === "number" && agora - ultimo.em < JANELA_MS) {
        tx.set(ref, { [chave]: { repetidos: FieldValue.increment(1) } }, { merge: true });
        return null;
      }
      tx.set(ref, { [chave]: { em: agora, repetidos: 0 } }, { merge: true });
      return ultimo?.repetidos ?? 0;
    });
    if (repetidos === null) return false;
    const para = (await integracao("ALERTA_EMAIL")) || (await integracao("GMAIL_USER"));
    if (!para) {
      console.error(`[alerta] sem e-mail para avisar: ${assunto}`);
      return false;
    }
    const antes = repetidos ? `\n\nDesde o último aviso, a mesma falha aconteceu mais ${repetidos} vez(es).` : "";
    await enviar({ para, assunto: `[Ruphus] ${assunto}`, texto: `${texto}${antes}\n\nPróximo aviso deste tipo em no mínimo 6 h.` });
    return true;
  } catch (e) {
    console.error(`[alerta] não avisei o admin: ${assunto}`, e);
    return false;
  }
}
