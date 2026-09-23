/** Sessões encerradas à força pelo admin da plataforma.
 *
 * O verificador de token não consulta o Firebase Auth (o Admin Auth não carrega
 * na Vercel), então um token roubado valeria até expirar, cerca de uma hora.
 * A marca de revogação mora em config/admin — documento que os dois guardas já
 * leem em toda chamada — e o token é recusado quando o login aconteceu antes
 * dela. Custo: nenhuma leitura nova. */

/** `revogados` é { uid: quando } em milissegundos. */
export function sessaoRevogada(revogados: unknown, uid: string, authTimeMs: number) {
  if (!revogados || typeof revogados !== "object") return false;
  const quando = (revogados as Record<string, unknown>)[uid];
  return typeof quando === "number" && authTimeMs < quando;
}
