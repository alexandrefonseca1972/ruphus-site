import type { Instrumentation } from "next";

// Só no servidor de produção: no build e no next dev não há cron nem quem avisar.
const producao = () => process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build";

// O índice do /admin não é mais montado no boot: ele monta na primeira consulta
// (painel-indice.server.ts), e um reinício sem ninguém no admin não segura ~120 MB.
export async function register() {
  if (!producao()) return;
  const [{ adminDb }, { vigiarCron }] = await Promise.all([import("@/lib/admin"), import("@/lib/alerta-admin.server")]);
  // o cron da VPS parou (crontab apagado, CRON_SECRET trocado): os lembretes param calados
  setInterval(() => void vigiarCron(adminDb).catch((e) => console.error("[cron] vigia", e)), 10 * 60_000).unref();
}

// Erro de servidor (página, rota, action, proxy) vira e-mail para o admin: no máximo um a cada 6 h
// por rota (alertarAdmin). O caminho vai sem a query, que pode levar token (convite, cobrança).
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (!producao()) return;
  try {
    const [{ adminDb }, { alertarAdmin }] = await Promise.all([import("@/lib/admin"), import("@/lib/alerta-admin.server")]);
    const mensagem = err instanceof Error ? err.message : String(err);
    const digest = typeof err === "object" && err !== null && "digest" in err ? ` · digest ${String(err.digest)}` : "";
    const caminho = request.path.split("?")[0];
    await alertarAdmin(
      adminDb,
      `erro-${context.routePath.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 100)}`,
      `Erro em ${context.routePath}`,
      `${request.method} ${caminho} (${context.routeType})${digest}\n\n${mensagem.slice(0, 1000)}\n\nDetalhes: journalctl -u ruphus-site -n 100`,
    );
  } catch (e) {
    console.error("[onRequestError]", e);
  }
};
