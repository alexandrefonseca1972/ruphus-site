import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { adminDb } from "@/lib/admin";
import { loadCatalog } from "@/lib/booking.server";
import { todayIn, fusoDaUF, linkWhatsApp, precoDe } from "@/lib/datetime";
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
  if (!catalog.agendaOnline) return <SemAgenda {...catalog} />;
  const fuso = fusoDaUF(catalog.uf);
  return <BookingForm tenantId={tenant} today={todayIn(fuso)} fuso={fuso} {...catalog} />;
}

type Catalogo = NonNullable<Awaited<ReturnType<typeof loadCatalog>>>;

/** O dono desligou a agenda pelo link: o site e a bio ainda apontam para cá, então a página
 *  mostra os serviços e leva ao WhatsApp, no lugar de uma grade que ninguém atende. */
function SemAgenda({ name, phone, services, siteUrl, temSite }: Catalogo) {
  const zap = linkWhatsApp(phone, `Olá! Quero marcar um horário no ${name}.`);
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-[520px] content-center gap-5 bg-[#F7F5F1] px-4 py-10 text-[#17150F]">
      <h1 className="text-2xl font-semibold">{name}</h1>
      <p className="text-[15px] leading-relaxed text-[#4A4639]">
        {zap ? "Para marcar um horário, fale direto com o negócio pelo WhatsApp." : "Este negócio não marca horário pelo link."}
      </p>
      {services.length > 0 && (
        <ul className="grid divide-y divide-[#E7E2D8] rounded-2xl border border-[#E7E2D8] bg-white">
          {services.map((s) => (
            <li key={s.id} className="flex items-baseline justify-between gap-3 px-4 py-3 text-[15px]">
              <span>{s.name}</span>
              {s.priceCents ? <span className="shrink-0 font-semibold">{precoDe(s)}</span> : null}
            </li>
          ))}
        </ul>
      )}
      {zap && (
        <a href={zap} className="inline-flex min-h-[54px] items-center justify-center rounded-2xl bg-[#17150F] px-5 text-[15px] font-bold text-white">
          Falar no WhatsApp
        </a>
      )}
      {temSite && (
        <a href={siteUrl} className="text-center text-sm text-[#5C5747] underline underline-offset-2">
          Ver o site
        </a>
      )}
    </main>
  );
}
