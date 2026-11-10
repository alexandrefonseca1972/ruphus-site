import { ImageResponse } from "next/og";
import sharp from "sharp";
import { adminDb } from "@/lib/admin";
import { foraDoAr } from "@/lib/booking.server";
import { lerSite } from "@/lib/gerador.server";
import { SLUG_SITE } from "@/lib/site-arquivo";
import { doStorage } from "@/lib/site-arquivo.server";
import { capaEditorial } from "@/lib/site-editorial";
import { capaClaro, ehClaro } from "@/lib/site-claro";

// A imagem que aparece quando o link de um site gerado é enviado no WhatsApp: a
// mesma composição dos og.jpg da fábrica (foto do topo escurecida, traço na cor
// do site, nome na fonte de título, ramo e cidade, "ruphus.site" no canto).
// Os sites da fábrica têm o arquivo em public/s/{slug}/og.jpg, que responde antes,
// ou publicado no Storage, que esta rota devolve antes de montar a imagem.

// Montada a cada pedido, como o site: o revalidatePath do Next 16 não derruba a resposta
// guardada de uma Route Handler, e a prévia do WhatsApp ficava até uma hora com o modelo velho.
// Quem pede é o WhatsApp/Google ao ler o link e a gaveta do admin: pouca coisa.
export const dynamic = "force-dynamic";

// A mesma fonte com o mesmo texto não é baixada de novo. Com teto: o texto muda por site, e o
// mapa não pode crescer sem fim (cada TTF recortado tem poucos KB).
// ponytail: limpa tudo ao bater o teto; LRU se o acerto ficar baixo
const fontes = new Map<string, Promise<ArrayBuffer>>();
const TETO_FONTES = 200;

/** A fonte em TTF, só com as letras do texto (o ImageResponse não lê woff2). */
function fonte(familia: string, texto: string) {
  const chave = `${familia}|${texto}`;
  const guardada = fontes.get(chave);
  if (guardada) return guardada;
  const baixando = (async () => {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${familia.replace(/ /g, "+")}&text=${encodeURIComponent(texto)}`, { signal: AbortSignal.timeout(5000) })).text();
    const url = /src: url\((.+?)\) format\('(?:opentype|truetype)'\)/.exec(css)?.[1];
    if (!url) throw new Error(`Fonte ${familia} não veio em TTF`);
    return (await fetch(url, { signal: AbortSignal.timeout(5000) })).arrayBuffer();
  })();
  if (fontes.size >= TETO_FONTES) fontes.clear();
  fontes.set(chave, baixando);
  // falha não fica guardada: a próxima prévia tenta de novo
  baixando.catch(() => fontes.delete(chave));
  return baixando;
}

// De onde a foto é buscada. Não do pedido: rota em cache (revalidate) não pode ler
// request.url nem headers — na Vercel isso é erro 500, e no next dev passa calado.
// O www serve /s/assets; o SITE_URL é o mesmo que o proxy usa.
const BASE =
  process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.NODE_ENV === "development" ? `http://localhost:${process.env.PORT ?? 3000}` : "https://www.ruphus.site");

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  if (!SLUG_SITE.test(slug)) return new Response("Imagem não encontrada", { status: 404 });
  // site do gerador: a imagem sai do modelo. O og.jpg guardado no Storage é o da fábrica,
  // que ficou lá depois da conversão e mostrava a foto velha no WhatsApp (645 sites).
  // Fora do ar (cobrança): sem prévia, como o site
  const [fora, d] = await Promise.all([foraDoAr(adminDb, slug), lerSite(adminDb, slug)]);
  if (fora) return new Response("Imagem não encontrada", { status: 404 });
  if (!d) return (await doStorage(slug, ["og.jpg"])) ?? new Response("Imagem não encontrada", { status: 404 });
  const capa = ehClaro(d.sub) ? capaClaro(d) : capaEditorial(d);

  const foto = `${BASE}/s${capa.foto}`;

  const [titulo, texto] = await Promise.all([fonte(capa.fonte, d.nome), fonte("Inter", `${capa.linha}ruphus.site`)]);
  const png = await new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: "#140e10" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- dentro do ImageResponse não existe next/image */}
        <img src={foto} alt="" width={1200} height={630} style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 30%" }} />
        <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", display: "flex", background: "linear-gradient(180deg, rgba(20,14,16,.5) 0%, rgba(20,14,16,.62) 45%, rgba(20,14,16,.94) 100%)" }} />
        <div style={{ position: "absolute", top: 40, right: 44, display: "flex", fontFamily: "Texto", fontSize: 22, color: "rgba(255,255,255,.9)" }}>ruphus.site</div>
        <div style={{ position: "absolute", left: 72, right: 72, bottom: 64, display: "flex", flexDirection: "column" }}>
          <div style={{ width: 56, height: 4, background: capa.cor, marginBottom: 30 }} />
          <div style={{ fontFamily: "Titulo", fontSize: d.nome.length > 32 ? 54 : 68, lineHeight: 1.05, color: "#fff" }}>{d.nome}</div>
          {capa.linha && <div style={{ fontFamily: "Texto", fontSize: 28, color: "rgba(255,255,255,.78)", marginTop: 18 }}>{capa.linha}</div>}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Titulo", data: titulo, weight: 400, style: "normal" },
        { name: "Texto", data: texto, weight: 400, style: "normal" },
      ],
    },
  ).arrayBuffer();
  // JPEG: o PNG de uma foto passa de 1 MB, e o WhatsApp não mostra prévia de imagem pesada
  const jpg = await sharp(Buffer.from(png)).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
  // sem Cache-Control, a Cloudflare guarda .jpg sozinha por horas e a troca de modelo não chegava
  // à prévia: um minuto na borda, cinco no navegador
  return new Response(new Uint8Array(jpg), { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=300, s-maxage=60" } });
}
