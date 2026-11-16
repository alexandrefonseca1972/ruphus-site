import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { lerPreviaBio } from "@/lib/modelos/previa-bio.server";
import type { LayoutBio } from "@/lib/modelos/tipos";
import { aplicarCaso } from "../casos";
import { carregar, proximosHorarios } from "../carregar";
import LayoutDaBio from "../layouts";

// Prévia do Estúdio (F4.6): a bio real do negócio com o layout do modelo do token e o caso de
// teste aplicado. Só lê; o token assinado (10 min) é o que impede modelo inventado de fora.
export const metadata: Metadata = { title: "Prévia da bio", robots: { index: false, follow: false } };

export default async function PreviaBio({ params, searchParams }: PageProps<"/bio/[tenant]/previa">) {
  const [{ tenant }, { t }] = await Promise.all([params, searchParams]);
  const previa = typeof t === "string" ? lerPreviaBio(t, tenant) : null;
  if (!previa) notFound();
  const bio = await carregar(tenant);
  if (!bio) notFound();
  const comCaso = aplicarCaso({ ...bio, layout: previa.def.layout as LayoutBio }, previa.caso);
  const livres = await proximosHorarios(tenant, comCaso);
  return <LayoutDaBio tenant={tenant} bio={comCaso} livres={livres} />;
}
