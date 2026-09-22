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

/** Próximos horários livres do serviço mais curto, hoje ou no próximo dia de trabalho.
 * Os dias candidatos são consultados juntos (antes era um por vez, até 8 idas ao banco em fila). */
async function proximosHorarios(slug: string, bio: Bio) {
  const curto = [...bio.servicos].sort((a, b) => a.duracao - b.duracao)[0];
  if (!curto || !bio.equipeId || !bio.expediente.length) return null;
  const candidatos = Array.from({ length: 8 }, (_, i) => ({ i, date: addDays(todayIn(), i) }))
    .filter(({ date }) => bio.expediente.some((e) => e.dia === weekday(date)))
    .slice(0, 3); // três dias de trabalho bastam para achar vaga; é o que a frase mostra
  const grades = await Promise.all(
    candidatos.map(({ date }) =>
      availableSlots(adminDb, { tenantId: slug, serviceIds: [curto.id], staffId: bio.equipeId!, date }).catch(() => [] as string[]),
    ),
  );
  const achado = candidatos.findIndex((_, k) => grades[k].length);
  if (achado < 0) return null;
  const { i, date } = candidatos[achado];
  const quando = i === 0 ? "hoje" : i === 1 ? "amanhã" : WEEKDAYS[weekday(date)].toLowerCase();
  return { quando, horarios: grades[achado].slice(0, 3) };
}

// A página vai para o cache e é refeita no máximo a cada minuto: "aberto agora" e
// "livre hoje às…" continuam atuais, sem ir ao banco a cada visita vinda do Instagram.
export const revalidate = 60;
// Nenhum negócio pré-gerado no build: cada um entra no cache na primeira visita
export function generateStaticParams() {
  return [];
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

/** Atalho de contato: ícone grande e rótulo curto, em linha com os outros */
function Atalho({ href, rotulo, icone, fundo, tinta, externo = true }: { href: string; rotulo: string; icone: React.ReactNode; fundo: string; tinta: string; externo?: boolean }) {
  return (
    <a
      href={href}
      {...(externo && { target: "_blank", rel: "noreferrer" })}
      className="flex min-w-0 flex-col items-center gap-1.5 rounded-2xl py-1 transition-transform active:scale-[0.97]"
    >
      <span className="flex size-14 items-center justify-center rounded-2xl" style={{ background: fundo, color: tinta }}>
        {icone}
      </span>
      <span className="truncate text-xs font-medium">{rotulo}</span>
    </a>
  );
}

const Seta = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 18 6-6-6-6" />
  </svg>
);

/** Bloco que abre e fecha: <details> nativo, sem JavaScript, com teclado e leitor de tela de graça */
function Recolhivel({ titulo, resumo, children }: { titulo: string; resumo: string; children: React.ReactNode }) {
  return (
    <details className="group overflow-hidden rounded-[18px] border border-[#E2DDD3] bg-white">
      <summary className="flex min-h-15 cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 grow">
          <span className="block text-[15px] font-semibold leading-tight">{titulo}</span>
          <span className="block truncate text-[13px] leading-snug text-[#6F6A5E]">{resumo}</span>
        </span>
        <svg className="shrink-0 text-[#6F6A5E] transition-transform group-open:rotate-180" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="border-t border-[#E2DDD3]">{children}</div>
    </details>
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
  const { aberto, ate } = situacao(bio.expediente);
  const dias = [...bio.expediente].sort((a, b) => ((a.dia + 6) % 7) - ((b.dia + 6) % 7));
  // Caminho completo nos dois endereços: em www é o arquivo; no subdomínio o proxy o deixa
  // passar sem prefixar de novo. Sem ler o host, a página inteira pode ficar em cache.
  const fotoSrc = bio.foto && `/s/${tenant}${bio.foto}`;
  // Cor clara demais some sobre o fundo creme (#faf3f1 no Amanda): o destaque vira tinta
  const acento = claro(bio.cor) ? "#17150F" : bio.cor;

  const hoje = weekday(todayIn());
  const precos = bio.servicos.map((x) => x.preco).filter(Boolean);
  const aPartir = precos.length ? ` · a partir de ${formatBRL(Math.min(...precos))}` : "";
  const jornadaHoje = bio.expediente.find((e) => e.dia === hoje);
  const ligar = bio.telefone ? `tel:+${bio.telefone.replace(/\D/g, "").replace(/^(?!55)/, "55")}` : null;
  const atalhos = [
    zap && { href: zap, rotulo: "WhatsApp", fundo: "#E7EEE9", tinta: "#2C6A53", icone: <IconeZap /> },
    bio.instagram && { href: `https://instagram.com/${bio.instagram}`, rotulo: "Instagram", fundo: "#F5EBF0", tinta: "#8A3A63", icone: <IconeInsta /> },
    mapa && { href: mapa, rotulo: "Como chegar", fundo: "#F0E6DE", tinta: "#8A4520", icone: <IconeMapa /> },
    ligar && { href: ligar, rotulo: "Ligar", fundo: "#ECEAE4", tinta: "#17150F", icone: <IconeFone />, externo: false },
  ].filter(Boolean) as { href: string; rotulo: string; fundo: string; tinta: string; icone: React.ReactNode; externo?: boolean }[];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col gap-5 px-4 pb-32">
      <div className="relative -mx-4 h-56 overflow-hidden" style={{ background: bio.cor }}>
        {fotoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- foto do site do cliente, fora do otimizador
          <img src={fotoSrc} alt="" width={520} height={224} fetchPriority="high" decoding="async" className="size-full object-cover" />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-full items-center justify-center font-[family-name:var(--fonte-serifa)] text-[150px] leading-none"
            style={{ color: claro(bio.cor) ? "rgba(23,21,15,.12)" : "rgba(255,255,255,.12)" }}
          >
            {bio.nome.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="absolute inset-x-0 bottom-0 h-24" style={{ background: "linear-gradient(to top, #F7F5F1 8%, rgba(247,245,241,0))" }} />
      </div>

      <header className="relative -mt-14 flex flex-col items-center gap-2 text-center">
        <span
          aria-hidden="true"
          className="flex size-20 items-center justify-center rounded-full text-3xl font-semibold shadow-[0_0_0_4px_#F7F5F1]"
          style={{ background: acento, color: "#FFFFFF" }}
        >
          {bio.nome.slice(0, 1).toUpperCase()}
        </span>
        <h1 className="mt-1 text-balance text-[26px] font-semibold leading-tight tracking-[-0.02em]">{bio.nome}</h1>
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[13px] text-[#6F6A5E]">
          {local && <span>{local}</span>}
          {local && bio.nota && <span aria-hidden="true">·</span>}
          {bio.nota && (
            <span className="inline-flex items-center gap-1">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="#E8A33D" aria-hidden="true">
                <path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.2 6.1L12 16.9 6.5 19.7l1.2-6.1L3.2 9.4l6.1-.8z" />
              </svg>
              <b className="font-semibold text-[#17150F]">{bio.nota.toFixed(1).replace(".", ",")}</b>
              {bio.avaliacoes ? <span>· {bio.avaliacoes.toLocaleString("pt-BR")} avaliações</span> : null}
            </span>
          )}
        </div>
        {bio.expediente.length > 0 && (
          <span
            className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[13px] font-semibold"
            style={aberto ? { background: "#E7EEE9", color: "#2C6A53" } : { background: "#F3EDE4", color: "#7A5A2E" }}
          >
            <span aria-hidden="true" className="size-1.5 rounded-full" style={{ background: aberto ? "#2C6A53" : "#B08434" }} />
            {aberto && ate ? `Aberto agora · até ${hhmm(ate)}` : "Fechado agora"}
          </span>
        )}
      </header>

      {atalhos.length > 0 && (
        <nav aria-label="Contato" className="grid gap-2" style={{ gridTemplateColumns: `repeat(${atalhos.length}, minmax(0, 1fr))` }}>
          {atalhos.map((a) => (
            <Atalho key={a.rotulo} {...a} />
          ))}
        </nav>
      )}

      {bio.servicos.length > 0 && (
        <Recolhivel titulo="Serviços" resumo={`${bio.servicos.length} ${bio.servicos.length === 1 ? "serviço" : "serviços"}${aPartir}`}>
          <ul>
            {bio.servicos.map((sv, i) => (
              <li key={sv.id}>
                <a href={agendar} className={`flex min-h-15 items-center gap-3 px-4 py-2.5 hover:bg-[#FAF8F4] ${i ? "border-t border-[#EFEBE3]" : ""}`}>
                  <span className="min-w-0 grow">
                    <span className="block text-[15px] font-semibold leading-tight">{sv.nome}</span>
                    <span className="block text-[13px] leading-snug text-[#6F6A5E]">{duracao(sv.duracao)}</span>
                  </span>
                  {sv.preco ? <span className="shrink-0 text-sm font-semibold">{formatBRL(sv.preco)}</span> : null}
                  <Seta className="shrink-0 text-[#A9A396]" />
                </a>
              </li>
            ))}
          </ul>
        </Recolhivel>
      )}

      {dias.length > 0 && (
        <Recolhivel titulo="Horário" resumo={jornadaHoje ? `Hoje: ${hhmm(jornadaHoje.inicio)} — ${hhmm(jornadaHoje.fim)}` : "Hoje: fechado"}>
          <div className="px-4 py-2.5">
            {dias.map((d) => (
              <div key={d.dia} className={`flex justify-between py-1.5 text-sm ${d.dia === hoje ? "font-semibold" : ""}`}>
                <span>
                  {WEEKDAYS[d.dia]}
                  {d.dia === hoje && <span className="font-normal text-[#6F6A5E]"> · hoje</span>}
                </span>
                <span>
                  {hhmm(d.inicio)} — {hhmm(d.fim)}
                </span>
              </div>
            ))}
            {!bio.expediente.some((e) => e.dia === 0) && (
              <div className="flex justify-between py-1.5 text-sm text-[#8B8578]">
                <span>Domingo</span>
                <span>fechado</span>
              </div>
            )}
          </div>
        </Recolhivel>
      )}

      <a
        href={`https://${tenant}.ruphus.site/`}
        className="flex min-h-13 items-center justify-between rounded-[18px] border border-dashed border-[#C8C1B3] px-4 text-sm font-semibold text-[#4A4639]"
      >
        Ver o site completo
        <Seta className="text-[#A9A396]" />
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
          <div className="mx-auto w-full max-w-[520px] px-4 pt-2.5 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <a
              href={bio.servicos.length > 0 ? agendar : zap!}
              className="flex min-h-[54px] flex-col items-center justify-center rounded-2xl px-5 py-2.5 text-center"
              style={{ background: acento, color: "#FFFFFF" }}
            >
              <span className="text-[15px] font-bold">{bio.servicos.length > 0 ? "Agendar online" : "Falar no WhatsApp"}</span>
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

const IconeZap = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
    <path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1 1 12 20.2z" />
  </svg>
);
const IconeInsta = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.2" cy="6.8" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);
const IconeMapa = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" />
    <circle cx="12" cy="10" r="2.6" />
  </svg>
);
const IconeFone = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
  </svg>
);
