import { NextResponse } from "next/server";
import { z } from "zod";
import { adminAction, ErroPrevisto, requireAdmin } from "@/lib/admin-guard";
import { processarFoto, SLOTS, tenantEditorial, TETO_FOTO, TIPOS_FOTO } from "@/lib/foto.server";
import { SLUG_SITE } from "@/lib/site-arquivo";

// Upload das fotos próprias do site (aba Site da gaveta). Rota, não server action: a action
// tem teto de 1 MB por padrão, e foto de celular passa disso. A autorização e o formato da
// resposta são os mesmos das actions (adminAction), com o token no cabeçalho Authorization.

const Pedido = z.object({ slug: z.string().regex(SLUG_SITE), slot: z.enum(SLOTS) });

const subir = adminAction(async (_user, slug: string, slot: (typeof SLOTS)[number], arquivo: File) => {
  if (arquivo.size > TETO_FOTO) throw new ErroPrevisto("Foto acima de 12 MB. Envie uma menor.");
  if (!TIPOS_FOTO.includes(arquivo.type)) throw new ErroPrevisto("Formato não aceito. Envie JPG, PNG ou WebP (o iPhone converte HEIC ao escolher a foto).");
  await tenantEditorial(slug);
  return processarFoto(slug, slot, Buffer.from(await arquivo.arrayBuffer()));
});

const token = (req: Request) => req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
const invalido = () => NextResponse.json({ ok: false, error: "Pedido inválido." }, { status: 400 });

export async function POST(req: Request) {
  // corpo acima do teto é recusado pelo cabeçalho, antes de ler o arquivo para a memória
  if (Number(req.headers.get("content-length") ?? 0) > TETO_FOTO + 64 * 1024) {
    return NextResponse.json({ ok: false, error: "Foto acima de 12 MB. Envie uma menor." }, { status: 413 });
  }
  // quem não é admin não faz o servidor ler o arquivo: a autorização vem antes do corpo
  if (!(await requireAdmin(token(req)).catch(() => null))) {
    return NextResponse.json({ ok: false, error: "Sessão expirada. Entre novamente." }, { status: 401 });
  }
  const form = await req.formData().catch(() => null);
  const p = Pedido.safeParse({ slug: form?.get("slug"), slot: form?.get("slot") });
  const arquivo = form?.get("arquivo");
  if (!p.success || !(arquivo instanceof File)) return invalido();
  return NextResponse.json(await subir(token(req), p.data.slug, p.data.slot, arquivo));
}
