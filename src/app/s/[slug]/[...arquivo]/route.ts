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

// Link errado aberto no navegador: a mesma página do 404 do resto da plataforma, com caminho de
// volta para o início do site. Imagem e script que faltam continuam com o texto curto.
const PAGINA_404 = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Página não encontrada</title></head>
<body style="margin:0;background:#fff;color:#17150F;font-family:system-ui,-apple-system,sans-serif"><main style="max-width:28rem;min-height:100dvh;margin:0 auto;padding:0 24px;display:flex;flex-direction:column;justify-content:center;gap:16px">
<p style="margin:0;font-size:14px;font-weight:500;color:#6F6A5E">Erro 404</p><h1 style="margin:0;font-size:24px;font-weight:600">Página não encontrada</h1>
<p style="margin:0;font-size:15px;line-height:1.6;color:#4A4639">O endereço pode ter mudado ou o link veio incompleto.</p>
<a href="/" style="display:inline-flex;height:48px;align-items:center;justify-content:center;border-radius:12px;background:#17150F;padding:0 20px;font-size:15px;font-weight:600;color:#fff;text-decoration:none">Ir para o início do site</a></main></body></html>`;

function naoAchou(req: Request) {
  return req.headers.get("sec-fetch-dest") === "document"
    ? new Response(PAGINA_404, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } })
    : new Response("Arquivo não encontrado", { status: 404 });
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string; arquivo: string[] }> }) {
  const { slug, arquivo } = await params;
  // tirado do ar (cobrança): como no index.html, as outras páginas e arquivos também saem
  if (/^[a-z0-9-]{1,63}$/.test(slug) && (await foraDoArAgora(slug))) return new Response("Página não encontrada", { status: 404 });
  return (await doStorage(slug, arquivo, req)) ?? naoAchou(req);
}
