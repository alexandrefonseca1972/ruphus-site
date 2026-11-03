import { NextResponse } from "next/server";
import { z } from "zod";
import { adminDb } from "@/lib/admin";
import { adminAction, ErroPrevisto } from "@/lib/admin-guard";
import { apagarFoto, processarFoto, SLOTS, TETO_FOTO, TIPOS_FOTO } from "@/lib/foto.server";
import { ehClaro } from "@/lib/site-claro";

// Upload das fotos próprias do site (aba Site da gaveta). Rota, não server action: a action
// tem teto de 1 MB por padrão, e foto de celular passa disso. A autorização e o formato da
// resposta são os mesmos das actions (adminAction), com o token no cabeçalho Authorization.

const Pedido = z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/), slot: z.enum(SLOTS) });

/** Só site do gerador no modelo editorial tem fotos próprias. */
async function conferirSite(slug: string) {
  const sub = (await adminDb.doc(`tenants/${slug}`).get()).get("gerado.sub");
  if (!sub || ehClaro(sub)) throw new ErroPrevisto("Este site não aceita fotos próprias.");
}

const subir = adminAction(async (_user, slug: string, slot: (typeof SLOTS)[number], arquivo: File) => {
  if (arquivo.size > TETO_FOTO) throw new ErroPrevisto("Foto acima de 12 MB. Envie uma menor.");
  if (!TIPOS_FOTO.includes(arquivo.type)) throw new ErroPrevisto("Formato não aceito. Envie JPG, PNG ou WebP (o iPhone converte HEIC ao escolher a foto).");
  await conferirSite(slug);
  return processarFoto(slug, slot, Buffer.from(await arquivo.arrayBuffer()));
});

const apagar = adminAction(async (_user, slug: string, slot: (typeof SLOTS)[number]) => {
  await conferirSite(slug);
  await apagarFoto(slug, slot);
  return true;
});

const token = (req: Request) => req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
const invalido = () => NextResponse.json({ ok: false, error: "Pedido inválido." }, { status: 400 });

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const p = Pedido.safeParse({ slug: form?.get("slug"), slot: form?.get("slot") });
  const arquivo = form?.get("arquivo");
  if (!p.success || !(arquivo instanceof File)) return invalido();
  return NextResponse.json(await subir(token(req), p.data.slug, p.data.slot, arquivo));
}

export async function DELETE(req: Request) {
  const p = Pedido.safeParse(await req.json().catch(() => null));
  if (!p.success) return invalido();
  return NextResponse.json(await apagar(token(req), p.data.slug, p.data.slot));
}
