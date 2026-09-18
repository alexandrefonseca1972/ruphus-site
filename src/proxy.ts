import { NextResponse, type NextRequest } from "next/server";

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
  const nome = pathname.replace(/^\/|\/$/g, "");
  return PAGINAS.includes(nome) ? `/${nome}/index.html` : null;
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

export function proxy(request: NextRequest) {
  const slug = siteSlug(request.headers.get("host") ?? "");
  if (!slug) {
    const pagina = paginaEstatica(request.nextUrl.pathname);
    if (!pagina) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = pagina;
    return NextResponse.rewrite(url);
  }
  const url = request.nextUrl.clone();
  url.pathname = sitePath(slug, url.pathname);
  return NextResponse.rewrite(url);
}

export const config = { matcher: "/((?!_next/).*)" };
