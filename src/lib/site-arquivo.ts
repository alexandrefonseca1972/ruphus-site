// Sites da fábrica publicados sem deploy: os arquivos ficam no Storage em
// sites/{slug}/{caminho}, e as rotas de /s/{slug}/ os servem quando não há a pasta
// em public/s (que, enquanto existir, responde antes). As miniaturas do painel
// seguem o mesmo caminho em sites/_p/{slug}.webp.
//
// Só regras puras aqui, sem Firebase: o teste roda sem credencial.

export const PREFIXO = "sites";

const SLUG = /^([a-z0-9][a-z0-9-]{0,61}[a-z0-9]|_p)$/;
// Nada de "..", barra, espaço ou acento: os sites só têm nomes assim, e o caminho vira chave do bucket
const PARTE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/;

/** O objeto do bucket que responde a /s/{slug}/{partes}, ou null se não é caminho de site. */
export function objetoDoSite(slug: string, partes: string[]): string | null {
  if (!SLUG.test(slug) || !partes.length || partes.length > 4) return null;
  if (partes.some((p) => !PARTE.test(p) || p.includes(".."))) return null;
  return `${PREFIXO}/${slug}/${partes.join("/")}`;
}

/** "bytes=a-b" em posições inclusivas. null: sem cabeçalho (ou formato que não tratamos,
 *  e aí vai o arquivo inteiro); "fora": pedido além do fim, que é 416. */
export function faixa(range: string | null, tamanho: number): { inicio: number; fim: number } | null | "fora" {
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m || (!m[1] && !m[2])) return null;
  // "bytes=-500": os últimos 500
  if (!m[1]) return { inicio: Math.max(0, tamanho - Number(m[2])), fim: tamanho - 1 };
  const inicio = Number(m[1]);
  const fim = m[2] ? Math.min(Number(m[2]), tamanho - 1) : tamanho - 1;
  return inicio >= tamanho || fim < inicio ? "fora" : { inicio, fim };
}

const TIPOS: Record<string, string> = {
  html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8",
  json: "application/json", txt: "text/plain; charset=utf-8", pdf: "application/pdf",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif",
  gif: "image/gif", svg: "image/svg+xml", ico: "image/x-icon",
  mp4: "video/mp4", webm: "video/webm", woff2: "font/woff2",
};
export const tipoDe = (nome: string) => TIPOS[nome.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";

/** Um minuto na CDN para tudo: publicar aparece em até um minuto sem limpar cache.
 *  O HTML o navegador sempre confere; o resto ele guarda cinco minutos. */
export const cacheDe = (nome: string) =>
  `public, max-age=${nome.endsWith(".html") ? 0 : 300}, s-maxage=60, stale-while-revalidate=86400`;
