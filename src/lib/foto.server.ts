import "server-only";
import sharp from "sharp";
import { adminBucket, adminDb } from "@/lib/admin";
import { ErroPrevisto } from "@/lib/erro-previsto";
import type { Sub } from "@/lib/gerador";
import { objetoDoSite, SLUG_SITE } from "@/lib/site-arquivo";
import { ehClaro } from "@/lib/site-claro";

// Fotos próprias do negócio, enviadas pelo /admin: uma por posição do site editorial, com
// nome fixo em sites/{slug}/fotos/{posição}.jpg (a rota [...arquivo] já serve). Nunca
// index.html nem og.jpg, que substituiriam o site e a imagem de compartilhamento.

export const SLOTS = ["hero", "ga1", "ga2", "ga3", "bio"] as const;
export type Slot = (typeof SLOTS)[number];
/** Teto do arquivo enviado (foto de celular tem 3 a 8 MB). */
export const TETO_FOTO = 12 * 1024 * 1024;
export const TIPOS_FOTO = ["image/jpeg", "image/png", "image/webp"];

// largura máxima por posição; a bio é recortada no formato da faixa dela
const MEDIDA: Record<Slot, { width: number; height?: number }> = {
  hero: { width: 1600 },
  ga1: { width: 1200 },
  ga2: { width: 1200 },
  ga3: { width: 1200 },
  bio: { width: 1040, height: 448 },
};

/** Só site do gerador no modelo editorial tem personalização; devolve o tenant conferido. */
export async function tenantEditorial(slug: string) {
  if (!SLUG_SITE.test(slug)) throw new ErroPrevisto("Negócio inválido.");
  const tenant = await adminDb.doc(`tenants/${slug}`).get();
  const sub = tenant.get("gerado.sub") as Sub | undefined;
  if (!tenant.exists || !sub || ehClaro(sub)) throw new ErroPrevisto("Este site não tem personalização.");
  return { tenant, sub };
}

const objeto = (slug: string, slot: Slot) => {
  const nome = objetoDoSite(slug, ["fotos", `${slot}.jpg`]);
  if (!nome) throw new ErroPrevisto("Negócio inválido.");
  return adminBucket().file(nome);
};

/** Redimensiona (e endireita, pelo EXIF do celular) e grava a foto; devolve a referência que
 *  vai em gerado.personal.fotos e o tamanho gravado. */
/** Teto de pixels da foto enviada (40 MP): um PNG de cor lisa de 16k×16k pesa poucos KB e
 *  viraria 1 GB em memória ao decodificar. */
const MAX_PIXELS = 40_000_000;
const FORMATOS = ["jpeg", "png", "webp"];

export async function processarFoto(slug: string, slot: Slot, corpo: Buffer) {
  const m = MEDIDA[slot];
  let jpeg: Buffer;
  try {
    // o tipo declarado pelo navegador não vale: o formato é o que o sharp lê do arquivo
    const img = sharp(corpo, { limitInputPixels: MAX_PIXELS });
    const { format } = await img.metadata();
    if (!FORMATOS.includes(format ?? "")) throw new ErroPrevisto("Formato não aceito. Envie JPG, PNG ou WebP.");
    jpeg = await img
      .rotate()
      .resize({ width: m.width, height: m.height, fit: m.height ? "cover" : "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch (err) {
    if (err instanceof ErroPrevisto) throw err;
    throw new ErroPrevisto("Não consegui ler a imagem. Envie JPG, PNG ou WebP de até 40 megapixels.");
  }
  await objeto(slug, slot).save(jpeg, { contentType: "image/jpeg", resumable: false });
  return { ref: `fotos/${slot}.jpg` as const, bytes: jpeg.length };
}

/** A foto própria gravada, ou null se a posição não tem arquivo. */
export async function lerFoto(slug: string, slot: Slot): Promise<Buffer | null> {
  const f = objeto(slug, slot);
  if (!(await f.exists())[0]) return null;
  return (await f.download())[0];
}

/** As posições do rascunho que apontam para um arquivo que não está no Storage. */
export async function fotosFaltando(slug: string, fotos: Partial<Record<Slot, string>> | undefined) {
  const slots = SLOTS.filter((s) => fotos?.[s]);
  const existem = await Promise.all(slots.map((s) => objeto(slug, s).exists().then(([e]) => e)));
  return slots.filter((_, i) => !existem[i]);
}

export async function apagarFoto(slug: string, slot: Slot) {
  await objeto(slug, slot).delete({ ignoreNotFound: true });
}

/** Ao publicar: apaga do Storage as posições que o visual publicado não usa mais. Até lá o
 *  arquivo fica, porque um `gerado.personal` já publicado pode apontar para ele. */
export async function apagarFotosFora(slug: string, emUso: Partial<Record<Slot, string>> | undefined) {
  await Promise.all(SLOTS.filter((s) => !emUso?.[s]).map((s) => apagarFoto(slug, s)));
}
