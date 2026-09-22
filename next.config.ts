import type { NextConfig } from "next";
import { version } from "./package.json";

// Versão no rodapé do /admin: o número vem do package.json e o commit da Vercel,
// que só existe no build lá. Em desenvolvimento fica "local", sem enfeite.
const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_VERSAO: version,
    NEXT_PUBLIC_COMMIT: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
  },
};

export default nextConfig;
