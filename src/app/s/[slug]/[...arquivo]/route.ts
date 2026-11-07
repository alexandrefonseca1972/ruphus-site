import { adminDb } from "@/lib/admin";
import { foraDoAr } from "@/lib/booking.server";
import { doStorage } from "@/lib/site-arquivo.server";
import { esc, type DadosSite } from "@/lib/gerador";
import { lerSite } from "@/lib/gerador.server";
import { ehClaro, tintaSobre, visualClaro } from "@/lib/site-claro";
import { visualEditorial } from "@/lib/site-editorial";

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

// Link errado aberto no navegador: página de 404 com a cara do negócio (nome, cores e fonte do
// site dele) e caminho de volta para o início e para a agenda. Sem os dados do site (slug que não
// é do gerador, banco fora), a mesma página com o visual neutro da plataforma.
// Imagem e script que faltam continuam com o texto curto.
function pagina404(d: DadosSite | null) {
  // tinta: a cor dos botões do site (texto calculado pelo contraste); destaque só na faixa
  let tinta = "#17150F";
  let destaque = tinta;
  let fonte: [string, string] | null = null;
  if (d && ehClaro(d.sub)) {
    const v = visualClaro(d.slug, d.sub, d.escolha, d.personal);
    [tinta, destaque, fonte] = [v.cor, v.gold, v.fonte];
  } else if (d) {
    const v = visualEditorial(d.slug, d.sub, d.escolha, d.personal);
    [tinta, destaque, fonte] = [v.ink, v.acc, v.fonte];
  }
  const texto = tintaSobre(tinta);
  const titulo = fonte ? `'${fonte[0]}',Georgia,serif` : "system-ui,-apple-system,sans-serif";
  const botao = "display:flex;height:48px;align-items:center;justify-content:center;border-radius:12px;padding:0 20px;font-size:15px;font-weight:600;text-decoration:none";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Página não encontrada${d ? ` · ${esc(d.nome)}` : ""}</title>${fonte ? `<link href="https://fonts.googleapis.com/css2?family=${fonte[1]}&display=swap" rel="stylesheet">` : ""}</head>
<body style="margin:0;background:#fff;color:#17150F;font-family:system-ui,-apple-system,sans-serif"><main style="max-width:28rem;min-height:100dvh;margin:0 auto;padding:0 24px;display:flex;flex-direction:column;justify-content:center;gap:16px">
${d ? `<p style="margin:0 0 8px;padding-top:12px;border-top:4px solid ${destaque};font-family:${titulo};font-size:22px;color:${tinta}">${esc(d.nome)}</p>` : ""}<p style="margin:0;font-size:14px;font-weight:500;color:#6F6A5E">Erro 404</p><h1 style="margin:0;font-family:${titulo};font-size:28px;font-weight:600">Página não encontrada</h1>
<p style="margin:0;font-size:15px;line-height:1.6;color:#4A4639">O endereço pode ter mudado ou o link veio incompleto.</p>
<a href="/" style="${botao};background:${tinta};color:${texto}">Ir para o início do site</a>${d ? `
<a href="/agendar" style="${botao};border:1px solid ${tinta};color:${tinta}">Agendar horário</a>` : ""}</main></body></html>`;
}

async function naoAchou(req: Request, slug: string) {
  if (req.headers.get("sec-fetch-dest") !== "document") return new Response("Arquivo não encontrado", { status: 404 });
  // ponytail: lê o site a cada 404 de página (robôs atrás de /wp-admin também); cache por slug se pesar
  const dados = await lerSite(adminDb, slug).catch(() => null);
  return new Response(pagina404(dados), { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string; arquivo: string[] }> }) {
  const { slug, arquivo } = await params;
  // tirado do ar (cobrança): como no index.html, as outras páginas e arquivos também saem
  if (/^[a-z0-9-]{1,63}$/.test(slug) && (await foraDoArAgora(slug))) return new Response("Página não encontrada", { status: 404 });
  return (await doStorage(slug, arquivo, req)) ?? naoAchou(req, slug);
}
