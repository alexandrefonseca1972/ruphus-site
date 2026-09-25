import { adminDb } from "@/lib/admin";
import { lerSite } from "@/lib/gerador.server";
import { renderEditorial } from "@/lib/site-editorial";
import { ehClaro, renderClaro } from "@/lib/site-claro";

// Sites do gerador. O proxy reescreve {slug}.ruphus.site/ para /s/{slug}/index.html:
// quando a pasta existe em public/s (os sites da fábrica), o arquivo responde antes
// desta rota; sem pasta, a página é montada aqui com os dados do tenant.

// cache de um minuto, como a /bio; o gerador chama revalidatePath ao gravar,
// então um site novo ou editado aparece na hora
export const revalidate = 60;
export function generateStaticParams() {
  return [];
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const dados = await lerSite(adminDb, (await params).slug);
  if (!dados) return new Response("Página não encontrada", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const html = ehClaro(dados.sub) ? renderClaro(dados) : renderEditorial(dados);
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
