import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { adminDb } from "@/lib/admin";
import { loadCatalog } from "@/lib/booking.server";
import { donoRecebePelaApi } from "@/lib/canal-oficial.server";
import { todayIn, precoDe } from "@/lib/datetime";
import { telefoneDoNegocio, telefoneFixo, whatsappDoNegocio } from "@/lib/contato";
import { BookingForm } from "./booking-form";

// Metadata e página compartilham a mesma leitura
const getCatalog = cache((tenant: string) => loadCatalog(adminDb, tenant));

export async function generateMetadata({ params }: PageProps<"/agendar/[tenant]">): Promise<Metadata> {
  const { tenant } = await params;
  const catalog = await getCatalog(tenant);
  if (!catalog) return { title: "Agendamento" };
  // Agenda desligada: a página lista preços e oferece o canal que o negócio atende.
  if (!catalog.agendaOnline) {
    const contato = telefoneFixo(catalog.phone) ? "ligue para o negócio" : "fale pelo WhatsApp";
    return { title: `Serviços e preços · ${catalog.name}`, description: `Serviços e preços de ${catalog.name}. Para marcar, ${contato}.` };
  }
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

export default async function BookingPage({ params, searchParams }: PageProps<"/agendar/[tenant]">) {
  const { tenant } = await params;
  const catalog = await getCatalog(tenant);
  if (!catalog) notFound();
  if (!catalog.agendaOnline) return <SemAgenda {...catalog} />;
  const fuso = catalog.fuso;
  const today = todayIn(fuso);
  // sem o pedido pela API, o WhatsApp do cliente é o único aviso imediato: a tela pede que ele avise.
  // Falha na leitura: fica o texto de sempre (o pedido chega pelo painel de qualquer jeito)
  const { canalOficial, ...publico } = catalog;
  const donoAvisado = await donoRecebePelaApi(adminDb, tenant, canalOficial).catch(() => true);
  return <BookingForm tenantId={tenant} today={today} inicial={inicial(await searchParams, catalog.services, today)} donoAvisado={donoAvisado} {...publico} />;
}

const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Link da bio: ?servico=<id>&data=AAAA-MM-DD&hora=HH:MM. Só vale serviço do catálogo e dia
 *  de hoje em diante; o resto é ignorado e a página abre como sempre. */
function inicial(q: Record<string, string | string[] | undefined>, services: { id: string }[], today: string) {
  const servico = um(q.servico);
  if (!servico || !services.some((s) => s.id === servico)) return null;
  const data = um(q.data);
  const hora = um(q.hora);
  if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data) || data < today) return { servico };
  return { servico, data, hora: hora && /^\d{2}:\d{2}$/.test(hora) ? hora : undefined };
}

type Catalogo = NonNullable<Awaited<ReturnType<typeof loadCatalog>>>;

/** Sem agenda online: serviços, preços e o canal de contato que o negócio atende. */
function SemAgenda({ name, phone, services, siteUrl, temSite }: Catalogo) {
  const zap = whatsappDoNegocio(phone, `Olá! Quero marcar um horário no ${name}.`);
  const ligar = telefoneDoNegocio(phone);
  const contato = zap ?? ligar;
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-[520px] content-center gap-5 bg-[#F7F5F1] px-4 py-10 text-[#17150F]">
      <h1 className="text-2xl font-semibold">{name}</h1>
      <p className="text-[15px] leading-relaxed text-[#4A4639]">
        {zap ? "Para marcar um horário, fale direto com o negócio pelo WhatsApp." : ligar ? "Para marcar um horário, ligue direto para o negócio." : "Este negócio não marca horário pelo link."}
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
      {contato && (
        <a href={contato} className="inline-flex min-h-[54px] items-center justify-center rounded-2xl bg-[#17150F] px-5 text-[15px] font-bold text-white">
          {zap ? "Falar no WhatsApp" : "Ligar para o negócio"}
        </a>
      )}
      {temSite && (
        <a href={siteUrl} className="inline-flex min-h-11 items-center justify-center text-center text-sm text-[#5C5747] underline underline-offset-2">
          Ver o site
        </a>
      )}
    </main>
  );
}
