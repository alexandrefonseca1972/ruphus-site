// Monta o índice do /admin assim que o servidor sobe, em segundo plano: eram ~11 s de espera
// na primeira tela depois de cada deploy. Só no servidor de produção (no build não há quem use).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production" || process.env.NEXT_PHASE === "phase-production-build") return;
  const [{ adminDb }, { indiceDoPainel }] = await Promise.all([import("@/lib/admin"), import("@/lib/painel-indice.server")]);
  indiceDoPainel(adminDb)
    .pronto()
    .catch((e) => console.error("[admin] índice no boot", e));
}
