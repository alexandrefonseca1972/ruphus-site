import "server-only";
import { timingSafeEqual } from "node:crypto";

/** Compara um segredo recebido (cabeçalho) com o esperado em tempo constante: `!==` responde mais
 *  rápido quanto antes a diferença aparece, e isso vaza o segredo aos poucos. Sem esperado: falso. */
export function segredoIgual(recebido: string | null | undefined, esperado: string | null | undefined) {
  if (!esperado || typeof recebido !== "string") return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}
