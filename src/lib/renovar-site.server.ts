import "server-only";
import { revalidatePath } from "next/cache";
import { after } from "next/server";

// O www serve /s/{slug}/… e /bio/{slug}; o mesmo endereço que a rota do og.jpg usa
const BASE = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://www.ruphus.site";

/** Depois de gravar algo que muda o site de um negócio: o site, a imagem do link e a bio.
 *  No Next 16 o revalidatePath só marca a página como velha: a primeira visita ainda recebe a
 *  cópia antiga enquanto a nova é montada (era o "apliquei o modelo e o site não mudou").
 *  Essa primeira visita passa a ser nossa, logo depois da resposta: quem abre o site em
 *  seguida já recebe a página nova. */
export function renovarSite(slug: string) {
  const caminhos = [`/s/${slug}/index.html`, `/s/${slug}/og.jpg`, `/bio/${slug}`];
  for (const p of caminhos) revalidatePath(p);
  after(async () => {
    await Promise.all(caminhos.map((p) => fetch(`${BASE}${p}`, { cache: "no-store" }).then((r) => r.arrayBuffer()).catch(() => null)));
  });
}
