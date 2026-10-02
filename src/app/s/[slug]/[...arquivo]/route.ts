import { doStorage } from "@/lib/site-arquivo.server";

// Imagens, vídeos e demais arquivos dos sites da fábrica publicados no Storage
// (npm run site -- publicar). O que ainda existe em public/s responde antes desta
// rota; index.html e og.jpg têm rota própria, que também olha o Storage primeiro.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string; arquivo: string[] }> }) {
  const { slug, arquivo } = await params;
  return (await doStorage(slug, arquivo, req)) ?? new Response("Arquivo não encontrado", { status: 404 });
}
