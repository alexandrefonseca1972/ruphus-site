import { NextResponse, type NextRequest } from "next/server";

// {slug}.ruphus.site serve o site estático em public/s/{slug}; www e apex são o app.
const SITE_HOST = /^([a-z0-9][a-z0-9-]*)\.ruphus\.site$/;
const APP_HOSTS = ["www", "app"];

export function siteSlug(host: string) {
  const slug = SITE_HOST.exec(host.split(":")[0])?.[1];
  return slug && !APP_HOSTS.includes(slug) ? slug : null;
}

export function proxy(request: NextRequest) {
  const slug = siteSlug(request.headers.get("host") ?? "");
  if (!slug) return NextResponse.next();
  const url = request.nextUrl.clone();
  // public/ não serve índice de diretório: a raiz do site aponta direto para o arquivo
  url.pathname = `/s/${slug}${url.pathname === "/" ? "/index.html" : url.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = { matcher: "/((?!_next/).*)" };
