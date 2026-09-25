import { NextResponse } from "next/server";
import { adminDb } from "@/lib/admin";

// O que a landing (HTML estático) e o cadastro precisam para medir anúncios: o ID do
// Pixel da Meta, cadastrado nos Ajustes do /admin. O ID é público (vai no HTML de
// qualquer site com Pixel); cinco minutos de cache poupam leitura a cada visita.
export const revalidate = 300;

export async function GET() {
  const doc = await adminDb.doc("config/marketing").get().catch(() => null);
  const metaPixel = String(doc?.get("metaPixel") ?? "");
  return NextResponse.json({ metaPixel }, { headers: { "cache-control": "public, max-age=300, stale-while-revalidate=3600" } });
}
