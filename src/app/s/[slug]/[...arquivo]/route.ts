import { adminDb } from "@/lib/admin";
import { foraDoAr } from "@/lib/booking.server";
import { doStorage } from "@/lib/site-arquivo.server";

// Imagens, vídeos e demais arquivos dos sites da fábrica publicados no Storage
// (npm run site -- publicar). O que ainda existe em public/s responde antes desta
// rota; index.html e og.jpg têm rota própria, que também olha o Storage primeiro.
// Uma página com 30 fotos lia 30 vezes o mesmo "fora do ar": a resposta vale um minuto, como a
// lista que o proxy guarda. Slug inventado também entra: passou de 5 mil, recomeça do zero.
const vistos = new Map<string, { em: number; fora: Promise<boolean> }>();
const MINUTO = 60_000;
function foraDoArAgora(slug: string) {
  const v = vistos.get(slug);
  if (v && Date.now() - v.em < MINUTO) return v.fora;
  const fora = foraDoAr(adminDb, slug).catch((e) => {
    vistos.delete(slug);
    throw e;
  });
  if (vistos.size >= 5_000) vistos.clear();
  vistos.set(slug, { em: Date.now(), fora });
  return fora;
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string; arquivo: string[] }> }) {
  const { slug, arquivo } = await params;
  // tirado do ar (cobrança): como no index.html, as outras páginas e arquivos também saem
  if (/^[a-z0-9-]{1,63}$/.test(slug) && (await foraDoArAgora(slug))) return new Response("Página não encontrada", { status: 404 });
  return (await doStorage(slug, arquivo, req)) ?? new Response("Arquivo não encontrado", { status: 404 });
}
