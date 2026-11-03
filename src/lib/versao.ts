/** O que está no ar, para o rodapé do /admin: "v0.2.0 · a1b2c3d". */
export const VERSAO = `v${process.env.NEXT_PUBLIC_VERSAO ?? "0.0.0"}`;
export const COMMIT = process.env.NEXT_PUBLIC_COMMIT ?? "local";

/** Registra o service worker do painel instalado. O commit vai no endereço: cada deploy instala um
 *  SW novo, que apaga os caches da versão anterior (com nome fixo, /_next/static crescia sem fim). */
export function registrarServiceWorker() {
  // em desenvolvimento o cache do service worker esconderia as mudanças do código
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
  navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(COMMIT)}`).catch(() => {});
}
