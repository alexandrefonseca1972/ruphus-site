import type { NextConfig } from "next";
import { version } from "./package.json";

// Versão no rodapé do /admin: o número vem do package.json e o commit do deploy na VPS (GIT_COMMIT_SHA),
// que só existe no build lá. Em desenvolvimento fica "local", sem enfeite.
const nextConfig: NextConfig = {
  async headers() {
    return [
      // Em toda resposta: sem adivinhar tipo de arquivo, e /admin e /painel fora de
      // iframe de outro site (clickjacking). SAMEORIGIN porque a landing mostra os sites em iframe.
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      // HSTS só nos nossos: no domínio próprio do cliente o includeSubDomains prenderia em HTTPS
      // por um ano o webmail e o resto do domínio dele
      {
        source: "/:path*",
        has: [{ type: "host", value: "(?:.+\\.)?ruphus\\.site" }],
        headers: [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }],
      },
      // As fotos e fontes compartilhadas dos sites (66 MB em public/s/assets) saíam com max-age=0:
      // cada visita conferia tudo de novo. Mudam pouco e com o mesmo nome: um dia.
      // /assets/… é como os sites pedem (../assets no subdomínio); o proxy reescreve para /s/assets
      // depois que estes cabeçalhos já foram escolhidos pelo caminho de entrada
      ...["/s/assets/:path*", "/assets/:path*"].map((source) => ({
        source,
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      })),
      // O service worker não pode ficar em cache: é por ele que uma versão nova chega
      // ao painel instalado. Só scripts da própria origem.
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
  // O cache do Turbopack no build (ligado por padrão desde o 16.3)
  // deixava o CSS do Tailwind velho: classes de componentes novos não entravam e o modal
  // do Caixa abria sem posição no computador. Build frio custa ~1 min a mais.
  experimental: {
    turbopackFileSystemCacheForBuild: false,
    // o proxy guarda o corpo em memória até este teto: acima dele o upload de foto do /admin
    // (até 12 MB, src/lib/foto.server.ts) chegava cortado e virava "Pedido inválido"
    proxyClientMaxBodySize: "13mb",
  },
  // deploymentId: vem de NEXT_DEPLOYMENT_ID, que o scripts/deploy-vps.sh grava no .env.production
  // de cada versão. Não sai daqui (GIT_COMMIT_SHA só existe no build): o `next start` relê este
  // arquivo, ficava sem o id, e a página pedia cada fonte e chunk duas vezes (com e sem ?dpl=).
  env: {
    NEXT_PUBLIC_VERSAO: version,
    NEXT_PUBLIC_COMMIT: process.env.GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
  },
};

export default nextConfig;
