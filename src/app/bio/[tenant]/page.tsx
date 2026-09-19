import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { adminDb } from "@/lib/admin";
import { availableSlots } from "@/lib/booking.server";
import { addDays, formatBRL, linkWhatsApp, todayIn, weekday, WEEKDAYS } from "@/lib/datetime";
import { Service, Staff } from "@/lib/scheduling";

const SLUG = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;

type Servico = { id: string; nome: string; duracao: number; preco: number };
type Expediente = { dia: number; inicio: string; fim: string };

type Bio = {
  nome: string;
  cidade: string | null;
  uf: string | null;
  telefone: string | null;
  instagram: string | null;
  endereco: string | null;
  nota: number | null;
  avaliacoes: number | null;
  cor: string;
  foto: string | null;
  servicos: Servico[];
  expediente: Expediente[];
  equipeId: string | null;
};

/** O que o minisite mostra: tudo já vem do tenant, nada de novo para cadastrar. */
const carregar = cache(async (slug: string): Promise<Bio | null> => {
  if (!SLUG.test(slug)) return null;
  const t = adminDb.collection("tenants").doc(slug);
  const [tenant, servicos, equipe] = await Promise.all([
    t.get(),
    t.collection("services").where("active", "==", true).get(),
    t.collection("staff").where("active", "==", true).limit(1).get(),
  ]);
  if (!tenant.exists) return null;

  const staff = equipe.docs[0] && Staff.safeParse(equipe.docs[0].data());
  const horas = staff && staff.success ? staff.data.hours : {};
  return {
    nome: String(tenant.get("name")),
    cidade: tenant.get("site.city") ?? null,
    uf: tenant.get("site.uf") ?? null,
    telefone: tenant.get("site.phone") ?? null,
    instagram: tenant.get("site.instagram") ?? null,
    endereco: tenant.get("site.address") ?? null,
    nota: tenant.get("site.rating") ?? null,
    avaliacoes: tenant.get("site.reviews") ?? null,
    cor: tenant.get("site.color") ?? "#17150F",
    foto: tenant.get("site.photo") ?? null,
    servicos: servicos.docs.flatMap((d) => {
      const s = Service.safeParse(d.data());
      return s.success ? [{ id: d.id, nome: s.data.name, duracao: s.data.durationMin, preco: s.data.priceCents }] : [];
    }),
    expediente: Object.entries(horas).flatMap(([dia, j]) => (j ? [{ dia: Number(dia), inicio: j.start, fim: j.end }] : [])),
    equipeId: equipe.docs[0]?.id ?? null,
  };
});

/** Próximos horários livres do serviço mais curto, hoje ou no próximo dia de trabalho. */
async function proximosHorarios(slug: string, bio: Bio) {
  const curto = [...bio.servicos].sort((a, b) => a.duracao - b.duracao)[0];
  if (!curto || !bio.equipeId || !bio.expediente.length) return null;
  for (let i = 0; i < 8; i++) {
    const date = addDays(todayIn(), i);
    if (!bio.expediente.some((e) => e.dia === weekday(date))) continue;
    const slots = await availableSlots(adminDb, {
      tenantId: slug,
      serviceIds: [curto.id],
      staffId: bio.equipeId,
      date,
    }).catch(() => [] as string[]);
    if (slots.length) {
      const quando = i === 0 ? "hoje" : i === 1 ? "amanhã" : WEEKDAYS[weekday(date)].toLowerCase();
      return { quando, horarios: slots.slice(0, 3) };
    }
  }
  return null;
}

export async function generateMetadata({ params }: PageProps<"/bio/[tenant]">): Promise<Metadata> {
  const { tenant } = await params;
  const bio = await carregar(tenant);
  if (!bio) return { title: "Minisite" };
  const local = bio.cidade ? ` · ${bio.cidade}${bio.uf ? `/${bio.uf}` : ""}` : "";
  return {
    title: `${bio.nome}${local}`,
    description: `Agende online, fale no WhatsApp e veja onde fica ${bio.nome}.`,
    robots: { index: false, follow: false },
    // o ícone é gerado em /bio/<slug>/icon; no subdomínio do site o caminho precisa ser absoluto
    icons: { icon: `https://www.ruphus.site/bio/${tenant}/icon` },
    openGraph: {
      title: bio.nome,
      description: `Agende online, fale no WhatsApp e veja onde fica ${bio.nome}.`,
      images: [`https://${tenant}.ruphus.site/og.jpg`],
      type: "website",
      locale: "pt_BR",
    },
  };
}

// contraste: sobre cor escura o texto é claro, sobre clara é escuro
function claro(hex: string) {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) || 0);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

const hhmm = (t: string) => t.replace(":00", "h").replace(":", "h");
const duracao = (min: number) =>
  min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}min` : ""}` : `${min} min`;

/** Aberto agora? Compara o relógio de Brasília com o expediente do dia. */
function situacao(expediente: Expediente[]) {
  const jornada = expediente.find((e) => e.dia === weekday(todayIn()));
  const hora = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  return jornada && hora >= jornada.inicio && hora < jornada.fim
    ? { aberto: true, ate: jornada.fim }
    : { aberto: false, ate: null };
}

function Linha({
  href,
  titulo,
  detalhe,
  icone,
  fundo,
  tinta,
}: {
  href: string;
  titulo: string;
  detalhe: string;
  icone: React.ReactNode;
  fundo: string;
  tinta: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex min-h-14 items-center gap-3 rounded-2xl border border-[#E2DDD3] bg-white px-3.5 py-3 transition-transform active:scale-[0.99]"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px]" style={{ background: fundo, color: tinta }}>
        {icone}
      </span>
      <span className="min-w-0 grow">
        <span className="block text-[15px] font-semibold leading-tight">{titulo}</span>
        <span className="block truncate text-[13px] leading-tight text-[#6F6A5E]">{detalhe}</span>
      </span>
      <span aria-hidden="true" className="text-lg text-[#A9A396]">
        ›
      </span>
    </a>
  );
}

export default async function BioPage({ params }: PageProps<"/bio/[tenant]">) {
  const { tenant } = await params;
  const bio = await carregar(tenant);
  if (!bio) notFound();
  const livres = await proximosHorarios(tenant, bio);

  const local = [bio.cidade, bio.uf].filter(Boolean).join("/");
  const agendar = `https://${tenant}.ruphus.site/agendar`;
  const mapa = bio.endereco
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${bio.nome} ${bio.endereco}`)}`
    : null;
  const zap = linkWhatsApp(bio.telefone, `Olá! Vim pelo Instagram do ${bio.nome}.`);
  const telefone = bio.telefone?.replace(/^55(\d{2})(\d{4,5})(\d{4})$/, "($1) $2-$3") ?? "";
  const { aberto, ate } = situacao(bio.expediente);
  const dias = [...bio.expediente].sort((a, b) => ((a.dia + 6) % 7) - ((b.dia + 6) % 7));

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col gap-4 px-5 pb-32">
      <div className="relative -mx-5 h-52 overflow-hidden" style={{ background: bio.cor }}>
        {bio.foto ? (
          /* A foto sai da cópia local em public/s, servida pelo mesmo host: o subdomínio
             {slug}.ruphus.site só existe depois do deploy, e até lá a capa de toda proposta
             nova aparecia quebrada. Mesma imagem, sem depender de publicação.
             eslint-disable-next-line @next/next/no-img-element -- foto do site do cliente, fora do otimizador */
          <img src={`/s/${tenant}${bio.foto}`} alt="" className="size-full object-cover" />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-full items-center justify-center font-[family-name:var(--fonte-serifa)] text-[150px] leading-none"
            style={{ color: claro(bio.cor) ? "rgba(23,21,15,.12)" : "rgba(255,255,255,.12)" }}
          >
            {bio.nome.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div
          className="absolute inset-x-0 bottom-0 h-16"
          style={{ background: "linear-gradient(to top, #F7F5F1 6%, rgba(247,245,241,0))" }}
        />
      </div>

      <header className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-balance text-2xl font-semibold leading-tight">{bio.nome}</h1>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {local && <span className="text-sm text-[#6F6A5E]">{local}</span>}
          {bio.nota && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E2DDD3] bg-white px-2.5 py-0.5 text-[13px]">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="#E8A33D" aria-hidden="true">
                <path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.2 6.1L12 16.9 6.5 19.7l1.2-6.1L3.2 9.4l6.1-.8z" />
              </svg>
              {bio.nota.toFixed(1).replace(".", ",")}
              {bio.avaliacoes ? (
                <span className="text-[#6F6A5E]">· {bio.avaliacoes.toLocaleString("pt-BR")} avaliações</span>
              ) : null}
            </span>
          )}
        </div>
        {bio.expediente.length > 0 && (
          <span
            className="mt-0.5 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[13px] font-semibold"
            style={aberto ? { background: "#E7EEE9", color: "#2C6A53" } : { background: "#F3EDE4", color: "#7A5A2E" }}
          >
            <span aria-hidden="true" className="size-1.5 rounded-full" style={{ background: aberto ? "#2C6A53" : "#B08434" }} />
            {aberto && ate ? `Aberto agora · até ${hhmm(ate)}` : "Fechado agora"}
          </span>
        )}
      </header>

      {bio.servicos.length > 0 && (
        <section aria-label="Serviços" className="flex flex-col gap-2">
          <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-[#6F6A5E]">Serviços</h2>
          {bio.servicos.slice(0, 4).map((s) => (
            <a
              key={s.id}
              href={agendar}
              className="flex min-h-14 items-center gap-3 rounded-2xl border border-[#E2DDD3] bg-white px-3.5 py-3 transition-transform active:scale-[0.99]"
            >
              <span className="min-w-0 grow">
                <span className="block text-[15px] font-semibold leading-tight">{s.nome}</span>
                <span className="block text-[13px] leading-tight text-[#6F6A5E]">
                  {duracao(s.duracao)}
                  {s.preco ? ` · ${formatBRL(s.preco)}` : ""}
                </span>
              </span>
              <span
                className="shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold"
                style={{ borderColor: bio.cor, color: claro(bio.cor) ? "#17150F" : bio.cor }}
              >
                Agendar
              </span>
            </a>
          ))}
          {bio.servicos.length > 4 && (
            <a href={agendar} className="text-center text-[13px] font-semibold text-[#6F6A5E] underline underline-offset-4">
              ver todos os {bio.servicos.length} serviços
            </a>
          )}
        </section>
      )}

      <section aria-label="Contato" className="flex flex-col gap-2">
        {zap && (
          <Linha
            href={zap}
            titulo="Falar no WhatsApp"
            detalhe={telefone || "mandar mensagem"}
            fundo="#E7EEE9"
            tinta="#2C6A53"
            icone={
              <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true">
                <path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1 1 12 20.2z" />
              </svg>
            }
          />
        )}
        {bio.instagram && (
          <Linha
            href={`https://instagram.com/${bio.instagram}`}
            titulo="Instagram"
            detalhe={`@${bio.instagram}`}
            fundo="#F5EBF0"
            tinta="#8A3A63"
            icone={
              <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="17.2" cy="6.8" r="1.2" fill="currentColor" stroke="none" />
              </svg>
            }
          />
        )}
        {mapa && (
          <Linha
            href={mapa}
            titulo="Como chegar"
            detalhe={bio.endereco ?? "ver no mapa"}
            fundo="#F0E6DE"
            tinta="#8A4520"
            icone={
              <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" />
                <circle cx="12" cy="10" r="2.6" />
              </svg>
            }
          />
        )}
      </section>

      {dias.length > 0 && (
        <section aria-label="Horário" className="flex flex-col gap-1.5 rounded-2xl border border-[#E2DDD3] bg-white px-4 py-3.5">
          <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-[#6F6A5E]">Horário</h2>
          {dias.map((d) => (
            <div key={d.dia} className="flex justify-between text-sm">
              <span>{WEEKDAYS[d.dia]}</span>
              <span className="text-[#4A4639]">
                {hhmm(d.inicio)} — {hhmm(d.fim)}
              </span>
            </div>
          ))}
          {!bio.expediente.some((e) => e.dia === 0) && (
            <div className="flex justify-between text-sm text-[#8B8578]">
              <span>Domingo</span>
              <span>fechado</span>
            </div>
          )}
        </section>
      )}

      <a
        href={`https://${tenant}.ruphus.site/`}
        className="flex min-h-14 items-center justify-between rounded-2xl border border-dashed border-[#C8C1B3] px-4 py-3.5 text-sm font-semibold text-[#4A4639]"
      >
        Ver o site completo
        <span aria-hidden="true" className="text-lg text-[#A9A396]">
          ›
        </span>
      </a>

      <p className="text-center text-xs text-[#8B8578]">
        {bio.nome} · feito com{" "}
        <a href="https://www.ruphus.site/sobre" className="underline underline-offset-2">
          Ruphus
        </a>
      </p>

      {/* a barra fica à vista o tempo todo: agendar é o motivo de a pessoa ter vindo do Instagram.
          Sem catálogo não há o que marcar, e prometer agendamento levaria a pessoa a uma página
          vazia — nesse caso a barra leva ao WhatsApp, que é o que o negócio tem para oferecer. */}
      {(bio.servicos.length > 0 ? agendar : zap) && (
        <div className="fixed inset-x-0 bottom-0 border-t border-[#E7E2D8] bg-[#F7F5F1]/95 backdrop-blur">
          <div className="mx-auto w-full max-w-[520px] px-5 pb-4 pt-3">
            <a
              href={bio.servicos.length > 0 ? agendar : zap!}
              className="flex min-h-[52px] flex-col items-center justify-center rounded-2xl px-5 py-2.5 text-center"
              style={{ background: bio.cor, color: claro(bio.cor) ? "#17150F" : "#FFFFFF" }}
            >
              <span className="text-[15px] font-bold">
                {bio.servicos.length > 0 ? "Agendar online" : "Falar no WhatsApp"}
              </span>
              {bio.servicos.length > 0 && livres && (
                <span className="text-xs opacity-85">
                  livre {livres.quando} às {livres.horarios.join(", ")}
                </span>
              )}
            </a>
          </div>
        </div>
      )}
    </main>
  );
}
