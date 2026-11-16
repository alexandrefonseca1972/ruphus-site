import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { Caso, DefModelo } from "@/lib/modelos/tipos";

// Prévia de um modelo de bio no Estúdio (F4.6): o admin vê a bio de um negócio real com um
// modelo que ainda não está gravado. O link leva o modelo num token assinado de 10 minutos, então
// a rota pública /bio/{slug}/previa não aceita modelo inventado por quem não é admin.
// Token = base64url(JSON) + "." + HMAC-SHA256; a chave segue src/lib/remocao.server.ts.
const VALIDADE = 10 * 60 * 1000;
const chave = () => (process.env.CRON_SECRET ? `previa-bio:${process.env.CRON_SECRET}` : null);
const assinar = (k: string, dados: string) => createHmac("sha256", k).update(dados).digest("base64url");

const Carga = z.object({
  slug: z.string().min(1),
  def: DefModelo.refine((d) => d.tipo === "bio", "modelo de bio"),
  caso: Caso.optional(),
  exp: z.number(),
});

/** Token da prévia. Sem CRON_SECRET não há como assinar: lança ErroPrevisto, que o admin vê como está. */
export function assinarPreviaBio({ slug, def, caso }: { slug: string; def: DefModelo; caso?: Caso }): string {
  const k = chave();
  if (!k) throw new ErroPrevisto("Prévia da bio indisponível: falta configurar CRON_SECRET.");
  const dados = Buffer.from(JSON.stringify({ slug, def, caso, exp: Date.now() + VALIDADE })).toString("base64url");
  return `${dados}.${assinar(k, dados)}`;
}

/** O que o token leva, ou null se a assinatura não bate, venceu, o modelo não valida ou (com
 *  `slug`) o token é de outro negócio. */
export function lerPreviaBio(token: string, slug?: string): { slug: string; def: DefModelo; caso?: Caso } | null {
  const k = chave();
  const [dados, assinatura, ...resto] = token.split(".");
  if (!k || !dados || !assinatura || resto.length) return null;
  const esperada = Buffer.from(assinar(k, dados));
  const recebida = Buffer.from(assinatura);
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return null;
  try {
    const r = Carga.safeParse(JSON.parse(Buffer.from(dados, "base64url").toString()));
    if (!r.success || r.data.exp < Date.now() || (slug !== undefined && r.data.slug !== slug)) return null;
    return { slug: r.data.slug, def: r.data.def, ...(r.data.caso && { caso: r.data.caso }) };
  } catch {
    return null;
  }
}
