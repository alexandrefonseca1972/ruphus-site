import "server-only";
import { adminBucket } from "@/lib/admin";
import { cacheDe, faixa, objetoDoSite, tipoDe } from "@/lib/site-arquivo";

/** O arquivo do site publicado no Storage como resposta, ou null se não está lá
 *  (quem chamou decide o próximo: o site do gerador ou o 404).
 *
 *  Sem `req` (rotas em cache, que não podem ler cabeçalhos) vai sempre o arquivo
 *  inteiro; com ele, responde Range (o <video> do Safari exige) e If-None-Match. */
export async function doStorage(slug: string, partes: string[], req?: Request): Promise<Response | null> {
  const nome = objetoDoSite(slug, partes);
  if (!nome) return null;
  const arquivo = adminBucket.file(nome);
  let meta;
  try {
    [meta] = await arquivo.getMetadata();
  } catch (e) {
    // não publicado é o caso comum; sem permissão ou bucket errado tem que aparecer no log
    if ((e as { code?: number }).code === 404) return null;
    throw e;
  }
  const tamanho = Number(meta.size);
  const etag = `"${meta.md5Hash}"`;
  const cabecalhos = {
    "content-type": meta.contentType || tipoDe(nome),
    "cache-control": cacheDe(nome),
    etag,
    "accept-ranges": "bytes",
  };
  if (req?.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: cabecalhos });

  const f = faixa(req?.headers.get("range") ?? null, tamanho);
  if (f === "fora") return new Response(null, { status: 416, headers: { ...cabecalhos, "content-range": `bytes */${tamanho}` } });
  const [corpo] = await arquivo.download(f ? { start: f.inicio, end: f.fim } : {});
  return new Response(new Uint8Array(corpo), {
    status: f ? 206 : 200,
    headers: {
      ...cabecalhos,
      "content-length": String(corpo.length),
      ...(f && { "content-range": `bytes ${f.inicio}-${f.fim}/${tamanho}` }),
    },
  });
}
