import type { NextConfig } from "next";
import { version } from "./package.json";

// Versão no rodapé do /admin: o número vem do package.json e o commit da Vercel,
// que só existe no build lá. Em desenvolvimento fica "local", sem enfeite.
const nextConfig: NextConfig = {
  // O service worker não pode ficar em cache: é por ele que uma versão nova chega
  // ao painel instalado. Só scripts da própria origem.
  async headers() {
    return [
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
  // O cache do Turbopack no build (ligado por padrão desde o 16.3, restaurado pela Vercel)
  // deixava o CSS do Tailwind velho: classes de componentes novos não entravam e o modal
  // do Caixa abria sem posição no computador. Build frio custa ~1 min a mais.
  experimental: { turbopackFileSystemCacheForBuild: false },
  env: {
    NEXT_PUBLIC_VERSAO: version,
    NEXT_PUBLIC_COMMIT: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
  },
};

export default nextConfig;
