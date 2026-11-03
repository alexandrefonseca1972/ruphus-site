import "server-only";
import sharp from "sharp";
import { adminBucket } from "@/lib/admin";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { objetoDoSite } from "@/lib/site-arquivo";

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

const objeto = (slug: string, slot: Slot) => {
  const nome = objetoDoSite(slug, ["fotos", `${slot}.jpg`]);
  if (!nome) throw new ErroPrevisto("Negócio inválido.");
  return adminBucket().file(nome);
};

/** Redimensiona (e endireita, pelo EXIF do celular) e grava a foto; devolve a referência que
 *  vai em gerado.personal.fotos e o tamanho gravado. */
export async function processarFoto(slug: string, slot: Slot, corpo: Buffer) {
  const m = MEDIDA[slot];
  let jpeg: Buffer;
  try {
    jpeg = await sharp(corpo)
      .rotate()
      .resize({ width: m.width, height: m.height, fit: m.height ? "cover" : "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new ErroPrevisto("Não consegui ler a imagem. Envie JPG, PNG ou WebP.");
  }
  await objeto(slug, slot).save(jpeg, { contentType: "image/jpeg", resumable: false });
  return { ref: `fotos/${slot}.jpg` as const, bytes: jpeg.length };
}

export async function apagarFoto(slug: string, slot: Slot) {
  await objeto(slug, slot).delete({ ignoreNotFound: true });
}
