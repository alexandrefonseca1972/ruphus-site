import { NextResponse, type NextRequest } from "next/server";

// Lista de sites fora do ar, guardada em memória por um minuto: o proxy roda em
// toda visita e não pode consultar o banco a cada uma.
let fechados: { slugs: Set<string>; ate: number } = { slugs: new Set(), ate: 0 };

async function foraDoAr(slug: string, origem: string) {
  if (Date.now() > fechados.ate) {
    fechados = { slugs: fechados.slugs, ate: Date.now() + 60_000 };
    try {
      const r = await fetch(new URL("/api/desativados", origem), { cache: "no-store" });
      if (r.ok) fechados = { slugs: new Set(await r.json()), ate: Date.now() + 60_000 };
    } catch {
      // sem resposta, vale a lista anterior: melhor servir o site do que derrubar todos
    }
  }
  return fechados.slugs.has(slug);
}

// {slug}.ruphus.site serve o site estático em public/s/{slug}; www e apex são o app.
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
  const site = /^\/s\/([a-z0-9][a-z0-9-]*)\/?$/.exec(pathname);
  return site ? `/s/${site[1]}/index.html` : null;
}

export function sitePath(slug: string, pathname: string) {
  // agendamento e minisite do próprio negócio, servidos pelo app sem sair do subdomínio
  if (pathname === "/agendar" || pathname === "/agendar/") return `/agendar/${slug}`;
  if (pathname === "/bio" || pathname === "/bio/") return `/bio/${slug}`;
  // o navegador pede /favicon.ico sozinho e quase nenhum site tem o arquivo: usa o do app
  if (pathname === "/favicon.ico") return pathname;
  // as páginas pedem "../assets/…", que na raiz do subdomínio vira /assets/…: é a pasta compartilhada
  if (pathname === "/assets" || pathname.startsWith("/assets/")) return `/s${pathname}`;
  // public/ não serve índice de diretório: a raiz do site aponta direto para o arquivo
  return `/s/${slug}${pathname === "/" ? "/index.html" : pathname}`;
}

export async function proxy(request: NextRequest) {
  const slug = siteSlug(request.headers.get("host") ?? "");
  if (!slug) {
    const pagina = paginaEstatica(request.nextUrl.pathname);
    if (!pagina) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = pagina;
    return NextResponse.rewrite(url);
  }
  const url = request.nextUrl.clone();
  if (await foraDoAr(slug, request.url)) {
    url.pathname = "/indisponivel";
    return NextResponse.rewrite(url, { status: 404 });
  }
  url.pathname = sitePath(slug, url.pathname);
  return NextResponse.rewrite(url);
}

export const config = { matcher: "/((?!_next/).*)" };
