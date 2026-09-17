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
  const catalog = await getCatalog((await params).tenant);
  return { title: catalog ? `Agendar · ${catalog.name}` : "Agendamento" };
}

export default async function BookingPage({ params }: PageProps<"/agendar/[tenant]">) {
  const { tenant } = await params;
  const catalog = await getCatalog(tenant);
  if (!catalog) notFound();
  return <BookingForm tenantId={tenant} today={todayIn()} {...catalog} />;
}
