import { adminDb } from "@/lib/admin";
import { foraDoAr } from "@/lib/booking.server";
import { lerSite } from "@/lib/gerador.server";
import { SLUG_SITE } from "@/lib/site-arquivo";
import { doStorage } from "@/lib/site-arquivo.server";
import { renderEditorial } from "@/lib/site-editorial";
import { ehClaro, renderClaro } from "@/lib/site-claro";

// O proxy reescreve {slug}.ruphus.site/ para /s/{slug}/index.html. Quando a pasta
// existe em public/s (os sites da fábrica), o arquivo responde antes desta rota.
// Sem pasta: primeiro o site da fábrica publicado no Storage, depois o do gerador,
// montado aqui com os dados do tenant.

// Montado a cada visita. Com cache (revalidate = 60) a troca de modelo e as edições não
// apareciam: no Next 16 o revalidatePath não derruba a resposta guardada de uma Route Handler,
// só os dados lidos por fetch dentro dela, e o site seguia com a versão velha até o minuto
// vencer (e a primeira visita depois disso ainda recebia a velha). Um site de prospecção tem
// pouca visita: duas leituras por acesso custam menos do que um site que não muda.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  if (!SLUG_SITE.test(slug)) return new Response("Página não encontrada", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  // tirado do ar (cobrança) e o index.html publicado, juntos: o proxy barra o subdomínio, e isto
  // barra www.ruphus.site/s/{slug}. A ordem continua Storage → gerador (a fábrica publicada por cima vence)
  const [fora, publicado] = await Promise.all([foraDoAr(adminDb, slug), doStorage(slug, ["index.html"])]);
  if (fora) return new Response("Página não encontrada", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  if (publicado) return publicado;
  const dados = await lerSite(adminDb, slug);
  if (!dados) return new Response("Página não encontrada", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const html = ehClaro(dados.sub) ? renderClaro(dados) : renderEditorial(dados);
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
