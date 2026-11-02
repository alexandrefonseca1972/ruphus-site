import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// O link "Pedir remoção" leva uma assinatura do slug: sem ela, qualquer um que soubesse os
// subdomínios (públicos) tiraria as propostas do ar em lote, por script. Com ela, só quem abriu a
// página. A chave é o CRON_SECRET, com um prefixo só desta função; sem ele, ninguém remove.
const chave = () => (process.env.CRON_SECRET ? `remocao:${process.env.CRON_SECRET}` : null);

export function assinaturaDeRemocao(slug: string) {
  const k = chave();
  return k ? createHmac("sha256", k).update(slug).digest("base64url").slice(0, 22) : null;
}

export function assinaturaValida(slug: string, recebida: unknown) {
  const esperada = assinaturaDeRemocao(slug);
  return !!esperada && typeof recebida === "string" && recebida.length === esperada.length && timingSafeEqual(Buffer.from(recebida), Buffer.from(esperada));
}
