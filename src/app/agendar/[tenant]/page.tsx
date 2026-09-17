import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { adminDb } from "@/lib/admin";
import { loadCatalog } from "@/lib/booking.server";
import { todayIn } from "@/lib/scheduling";
import { BookingForm } from "./booking-form";

// Metadata e página compartilham a mesma leitura
const getCatalog = cache((tenant: string) => loadCatalog(adminDb, tenant));

export async function generateMetadata({ params }: PageProps<"/agendar/[tenant]">): Promise<Metadata> {
  const { tenant } = await params;
  const catalog = await getCatalog(tenant);
  if (!catalog) return { title: "Agendamento" };
  const title = `Agendar online · ${catalog.name}`;
  const description = catalog.services.length
    ? `Escolha ${catalog.services.slice(0, 3).map((s) => s.name.toLowerCase()).join(", ")} e veja os horários livres. Sem cadastro, direto do celular.`
    : "Veja os horários livres e agende pelo celular.";
  // Prévia que aparece ao colar o link no WhatsApp, Instagram e Facebook
  return {
    title,
    description,
    openGraph: { title, description, type: "website", locale: "pt_BR", siteName: catalog.name, url: `/agendar/${tenant}` },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function BookingPage({ params }: PageProps<"/agendar/[tenant]">) {
  const { tenant } = await params;
  const catalog = await getCatalog(tenant);
  if (!catalog) notFound();
  return <BookingForm tenantId={tenant} today={todayIn()} {...catalog} />;
}
