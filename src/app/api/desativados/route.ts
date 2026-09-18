import { NextResponse } from "next/server";
import { adminDb } from "@/lib/admin";
import { desativados } from "@/lib/crm";

// O proxy consulta esta lista para tirar um site do ar sem precisar de deploy.
// Curta e pública de propósito: são só os endereços que estão fechados.
export const revalidate = 30;

export async function GET() {
  const slugs = await desativados(adminDb).catch(() => [] as string[]);
  return NextResponse.json(slugs, {
    headers: { "cache-control": "public, max-age=30, stale-while-revalidate=300" },
  });
}
