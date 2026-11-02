import { adminDb } from "@/lib/admin";
import { foraDoAr } from "@/lib/booking.server";
import { doStorage } from "@/lib/site-arquivo.server";

// Imagens, vídeos e demais arquivos dos sites da fábrica publicados no Storage
// (npm run site -- publicar). O que ainda existe em public/s responde antes desta
// rota; index.html e og.jpg têm rota própria, que também olha o Storage primeiro.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string; arquivo: string[] }> }) {
  const { slug, arquivo } = await params;
  // tirado do ar (cobrança): como no index.html, as outras páginas e arquivos também saem
  if (/^[a-z0-9-]{1,63}$/.test(slug) && (await foraDoAr(adminDb, slug))) return new Response("Página não encontrada", { status: 404 });
  return (await doStorage(slug, arquivo, req)) ?? new Response("Arquivo não encontrado", { status: 404 });
}
