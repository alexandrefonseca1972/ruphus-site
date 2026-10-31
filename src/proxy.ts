import { NextResponse, type NextRequest } from "next/server";
import { type MapaDominios, resolverDominio } from "@/lib/dominio";

// Lista de sites fora do ar, guardada em memória por um minuto: o proxy roda em
// toda visita e não pode consultar o banco a cada uma.
let fechados: { slugs: Set<string>; ate: number } = { slugs: new Set(), ate: 0 };

// A origem vem do ambiente, não do pedido: o Host chega de fora e não decide
// para onde o servidor busca a lista de sites fechados.
const ORIGEM = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "";
const SEGREDO = process.env.DESATIVADOS_TOKEN || "";

async function foraDoAr(slug: string, origem: string) {
  if (Date.now() > fechados.ate) {
    fechados = { slugs: fechados.slugs, ate: Date.now() + 60_000 };
    try {
      const r = await fetch(new URL("/api/desativados", ORIGEM || origem), {
        cache: "no-store",
        ...(SEGREDO && { headers: { "x-ruphus": SEGREDO } }),
      });
      if (r.ok) fechados = { slugs: new Set(await r.json()), ate: Date.now() + 60_000 };
    } catch {
      // sem resposta, vale a lista anterior: melhor servir o site do que derrubar todos
    }
  }
  return fechados.slugs.has(slug);
}

// Domínios próprios ativos (www.salaodaana.com.br → site), na mesma toada: um minuto em
// memória, e sem resposta vale o mapa anterior.
let dominios: { mapa: MapaDominios; ate: number } = { mapa: { hosts: {}, porSlug: {} }, ate: 0 };

async function mapaDominios(origem: string) {
  if (Date.now() > dominios.ate) {
    dominios = { mapa: dominios.mapa, ate: Date.now() + 60_000 };
    try {
      const r = await fetch(new URL("/api/dominios", ORIGEM || origem), {
        cache: "no-store",
        ...(SEGREDO && { headers: { "x-ruphus": SEGREDO } }),
      });
      if (r.ok) dominios = { mapa: await r.json(), ate: Date.now() + 60_000 };
    } catch {
      // sem resposta, vale o mapa anterior
    }
  }
  return dominios.mapa;
}

const ehDaRuphus = (host: string) => /(^|\.)ruphus\.site$/.test(host.split(":")[0]);

// {slug}.ruphus.site serve o site em /s/{slug}/ (Storage ou gerador; public/s, se a pasta
// ainda existir); www e apex são o app.
const SITE_HOST = /^([a-z0-9][a-z0-9-]*)\.ruphus\.site$/;
const APP_HOSTS = ["www", "app"];

export function siteSlug(host: string) {
  const slug = SITE_HOST.exec(host.split(":")[0])?.[1];
  return slug && !APP_HOSTS.includes(slug) ? slug : null;
}

// páginas estáticas da marca em public/: public/ não serve índice de diretório
const PAGINAS = ["sobre", "privacidade"];

export function paginaEstatica(pathname: string) {
  // a raiz do domínio é a landing; o painel de quem tem negócio fica em /painel
  if (pathname === "/") return "/sobre/index.html";
  const nome = pathname.replace(/^\/|\/$/g, "");
  if (PAGINAS.includes(nome)) return `/${nome}/index.html`;
  // A prévia da landing aponta para /s/{slug}: em produção o servidor estático
  // acha o index sozinho, o next dev não — e a vitrine aparecia 404 na máquina
  // de quem desenvolve. Apontar para o arquivo resolve nos dois.
  // As páginas pedem "../assets/…": em /s/{slug} (sem barra no fim) isso vira /assets/…,
  // e a vitrine da landing abria sem nenhuma foto. É a pasta compartilhada, como no subdomínio.
  if (pathname.startsWith("/assets/")) return `/s${pathname}`;
  const site = /^\/s\/([a-z0-9][a-z0-9-]*)\/?$/.exec(pathname);
  return site ? `/s/${site[1]}/index.html` : null;
}

export function sitePath(slug: string, pathname: string) {
  // agendamento e minisite do próprio negócio, servidos pelo app sem sair do subdomínio
  if (pathname === "/agendar" || pathname === "/agendar/") return `/agendar/${slug}`;
  if (pathname === "/bio" || pathname === "/bio/") return `/bio/${slug}`;
  // o navegador pede /favicon.ico sozinho e quase nenhum site tem o arquivo: usa o do app
  if (pathname === "/favicon.ico") return pathname;
  // já endereçado ao próprio site (a /bio pede /s/{slug}/img/… para funcionar em www e no
  // subdomínio com o mesmo HTML em cache): não prefixa de novo, senão vira /s/{slug}/s/{slug}/…
  if (pathname.startsWith(`/s/${slug}/`)) return pathname;
  // a foto do banco compartilhado na /bio (/s/assets/…, o mesmo caminho em www): já é o
  // endereço final. Sem isto virava /s/{slug}/s/assets/… e a bio abria com a imagem quebrada
  if (pathname.startsWith("/s/assets/")) return pathname;
  // as páginas pedem "../assets/…", que na raiz do subdomínio vira /assets/…: é a pasta compartilhada
  if (pathname === "/assets" || pathname.startsWith("/assets/")) return `/s${pathname}`;
  // public/ não serve índice de diretório: a raiz do site aponta direto para o arquivo
  return `/s/${slug}${pathname === "/" ? "/index.html" : pathname}`;
}

/** Um endereço só para cada página, para o Google não dividir a landing em três:
 *  ruphus.site vai para www (o domínio de todos os links) e /sobre para a raiz. */
export function enderecoCanonico(host: string, pathname: string) {
  // API não entra na busca, e o Cron da Vercel não segue redirecionamento
  if (pathname.startsWith("/api/")) return null;
  const h = host.split(":")[0];
  const caminho = /^\/sobre\/?$/.test(pathname) ? "/" : pathname;
  if (h === "ruphus.site") return { host: "www.ruphus.site", pathname: caminho };
  return caminho !== pathname ? { host: null, pathname: caminho } : null;
}

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const caminho = request.nextUrl.pathname;
  // as listas que o próprio proxy pede, em qualquer host: sem SITE_URL elas são buscadas no
  // host visitado (subdomínio ou domínio do cliente), e reescritas para o site davam 404
  if (caminho === "/api/desativados" || caminho === "/api/dominios") return NextResponse.next();
  let slug = siteSlug(host);
  const paraOutroHost = (destino: string) => {
    const url = request.nextUrl.clone();
    url.host = destino;
    url.port = "";
    url.protocol = "https:";
    return NextResponse.redirect(url, 308);
  };
  if (slug) {
    // site com domínio próprio ativo: o subdomínio leva para lá, links antigos e QR inclusive.
    // A reserva fica: a página já aberta no subdomínio ainda confirma o horário
    const proprio = caminho === "/api/agendar" ? null : (await mapaDominios(request.url)).porSlug[slug];
    if (proprio) return paraOutroHost(proprio);
  } else if (!ehDaRuphus(host)) {
    const r = resolverDominio(host, await mapaDominios(request.url));
    if (r && "redirecionar" in r) return paraOutroHost(r.redirecionar);
    if (r) slug = r.slug;
  }
  const canonico = slug ? null : enderecoCanonico(host, request.nextUrl.pathname);
  if (canonico) {
    const url = request.nextUrl.clone();
    if (canonico.host) {
      url.host = canonico.host;
      url.port = "";
      url.protocol = "https:";
    }
    url.pathname = canonico.pathname;
    return NextResponse.redirect(url, 308);
  }
  if (!slug) {
    const pagina = paginaEstatica(request.nextUrl.pathname);
    if (!pagina) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = pagina;
    return NextResponse.rewrite(url);
  }
  // a reserva da página de agendamento, pedida do próprio subdomínio: vai direto para a rota
  // (e antes do "fora do ar": quem já reservou e repete a confirmação ainda recebe a reserva)
  if (request.nextUrl.pathname === "/api/agendar") return NextResponse.next();
  const url = request.nextUrl.clone();
  if (await foraDoAr(slug, request.url)) {
    url.pathname = "/indisponivel";
    return NextResponse.rewrite(url, { status: 404 });
  }
  url.pathname = sitePath(slug, url.pathname);
  return NextResponse.rewrite(url);
}

export const config = { matcher: "/((?!_next/).*)" };
