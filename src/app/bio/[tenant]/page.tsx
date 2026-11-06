import type { Metadata } from "next";
import { type Dominio, urlDoSite } from "@/lib/dominio";
import { notFound } from "next/navigation";
import { cache } from "react";
import { adminDb } from "@/lib/admin";
import { agendaDesligada, agendaDias, foraDoAr } from "@/lib/booking.server";
import { addDays, formatBRL, fusoDaUF, linkWhatsApp, todayIn, weekday, WEEKDAYS, precoDe, type TipoPreco } from "@/lib/datetime";
import { Service, Staff } from "@/lib/scheduling";

const SLUG = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;

type Servico = { id: string; nome: string; duracao: number; preco: number; tipoPreco?: TipoPreco };
type Expediente = { dia: number; inicio: string; fim: string };

type Bio = {
  site: string;
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
  agendaOnline: boolean;
};

/** O que o minisite mostra: tudo já vem do tenant, nada de novo para cadastrar. */
const carregar = cache(async (slug: string): Promise<Bio | null> => {
  if (!SLUG.test(slug)) return null;
  const t = adminDb.collection("tenants").doc(slug);
  // tirado do ar (cobrança): a bio sai junto com o site
  if (await foraDoAr(adminDb, slug)) return null;
  const [tenant, servicos, equipe] = await Promise.all([
    t.get(),
    t.collection("services").where("active", "==", true).get(),
    t.collection("staff").where("active", "==", true).get(),
  ]);
  if (!tenant.exists) return null;

  // o horário do negócio é a união da equipe: abre com o primeiro e fecha com o último
  const horas = new Map<number, { inicio: string; fim: string }>();
  for (const d of equipe.docs) {
    const p = Staff.safeParse(d.data());
    if (!p.success) continue;
    for (const [dia, j] of Object.entries(p.data.hours)) {
      if (!j) continue;
      const atual = horas.get(Number(dia));
      horas.set(Number(dia), atual ? { inicio: j.start < atual.inicio ? j.start : atual.inicio, fim: j.end > atual.fim ? j.end : atual.fim } : { inicio: j.start, fim: j.end });
    }
  }
  return {
    // o endereço do site: o domínio próprio do cliente, quando ativo, senão o subdomínio
    site: urlDoSite(slug, tenant.get("dominio") as Dominio | undefined),
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
      return s.success ? [{ id: d.id, nome: s.data.name, duracao: s.data.durationMin, preco: s.data.priceCents, tipoPreco: s.data.tipoPreco }] : [];
    }),
    expediente: [...horas].map(([dia, j]) => ({ dia, ...j })),
    agendaOnline: !agendaDesligada(tenant),
  };
});

/** Horários livres do serviço mais curto nos próximos três dias de trabalho (até 8 por dia).
 * Os dias candidatos são consultados juntos (antes era um por vez, até 8 idas ao banco em fila). */
async function proximosHorarios(slug: string, bio: Bio) {
  const curto = [...bio.servicos].sort((a, b) => a.duracao - b.duracao)[0];
  if (!curto || !bio.expediente.length || !bio.agendaOnline) return null;
  const candidatos = Array.from({ length: 8 }, (_, i) => ({ i, date: addDays(todayIn(fusoDaUF(bio.uf)), i) }))
    .filter(({ date }) => bio.expediente.some((e) => e.dia === weekday(date)))
    .slice(0, 3); // três dias de trabalho: são as abas da bio
  // staffId vazio: qualquer profissional, como na página de agendamento
  const dias = await agendaDias(adminDb, { tenantId: slug, serviceIds: [curto.id], staffId: "", from: candidatos[0]?.date ?? todayIn() }, candidatos.map((c) => c.date)).catch(() => []);
  const abas = candidatos
    .map(({ i, date }) => ({
      date,
      rotulo: i === 0 ? "Hoje" : i === 1 ? "Amanhã" : WEEKDAYS[weekday(date)],
      horarios: (dias.find((d) => d.date === date)?.horarios.map((h) => h.hora) ?? []).slice(0, 8),
    }))
    .filter((d) => d.horarios.length);
  return abas.length ? { servico: curto, dias: abas } : null;
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
      images: [`${bio.site}og.jpg`],
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

const Seta = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 18 6-6-6-6" />
  </svg>
);

const ROTULO = "text-xs font-semibold uppercase tracking-[0.1em] text-[#6F6A5E]";
const CARTAO = "rounded-[18px] border border-[#E2DDD3] bg-white";

/* Abas dos dias sem JavaScript: rádios irmãos dos rótulos e das grades; o rádio marcado
   (n-ésimo) mostra a n-ésima grade. São no máximo três dias. */
const ABAS = [1, 2, 3]
  .map(
    (n) => `.dias>input:nth-of-type(${n}):checked~label:nth-of-type(${n}){background:#17150F;color:#fff}
.dias>input:nth-of-type(${n}):focus-visible~label:nth-of-type(${n}){outline:2px solid #17150F;outline-offset:2px}
.dias>input:nth-of-type(${n}):checked~div:nth-of-type(${n}){display:grid}`,
  )
  .join("\n");

export default async function BioPage({ params }: PageProps<"/bio/[tenant]">) {
  const { tenant } = await params;
  const bio = await carregar(tenant);
  if (!bio) notFound();
  const livres = await proximosHorarios(tenant, bio);

  const local = [bio.cidade, bio.uf].filter(Boolean).join("/");
  const agendar = `${bio.site}agendar`;
  // sem catálogo ou com a agenda desligada pelo dono, a barra leva ao WhatsApp
  const agenda = bio.servicos.length > 0 && bio.agendaOnline;
  const mapa = bio.endereco
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${bio.nome} ${bio.endereco}`)}`
    : null;
  const zap = linkWhatsApp(bio.telefone, `Olá! Vim pelo Instagram do ${bio.nome}.`);
  const { aberto, ate } = situacao(bio.expediente);
  const dias = [...bio.expediente].sort((a, b) => ((a.dia + 6) % 7) - ((b.dia + 6) % 7));
  // Caminho completo nos dois endereços: em www é o arquivo; no subdomínio o proxy o deixa
  // passar sem prefixar de novo. Sem ler o host, a página inteira pode ficar em cache.
  // A foto do banco compartilhado (/assets/…: pets e sites gerados) mora em /s/assets,
  // não na pasta do negócio — prefixar o slug nela dava 404
  const fotoSrc = bio.foto && (bio.foto.startsWith("/assets/") ? `/s${bio.foto}` : `/s/${tenant}${bio.foto}`);
  // Cor clara demais some sobre o fundo creme (#faf3f1 no Amanda): o destaque vira tinta
  const acento = claro(bio.cor) ? "#17150F" : bio.cor;

  const hoje = weekday(todayIn());
  const precos = bio.servicos.map((x) => x.preco).filter(Boolean);
  const jornadaHoje = bio.expediente.find((e) => e.dia === hoje);
  const ligar = bio.telefone ? `tel:+${bio.telefone.replace(/\D/g, "").replace(/^(?!55)/, "55")}` : null;
  const atalhos = [
    zap && { href: zap, rotulo: "WhatsApp", tinta: "#2C6A53", icone: <IconeZap /> },
    ligar && { href: ligar, rotulo: "Ligar", tinta: "#17150F", icone: <IconeFone />, externo: false },
    mapa && { href: mapa, rotulo: "Como chegar", tinta: "#8A4520", icone: <IconeMapa /> },
    bio.instagram && { href: `https://instagram.com/${bio.instagram}`, rotulo: "Instagram", tinta: "#8A3A63", icone: <IconeInsta /> },
  ].filter(Boolean) as { href: string; rotulo: string; tinta: string; icone: React.ReactNode; externo?: boolean }[];

  // tocar num serviço já abre a agenda com ele marcado; sem agenda, pergunta no WhatsApp
  const linkServico = (sv: Servico) =>
    agenda ? `${agendar}?servico=${encodeURIComponent(sv.id)}` : (linkWhatsApp(bio.telefone, `Olá! Quero saber do serviço ${sv.nome}.`) ?? agendar);
  const linhaServico = (sv: Servico, i: number) => (
    <li key={sv.id}>
      <a href={linkServico(sv)} className={`flex min-h-15 items-center gap-3 px-4 py-2.5 hover:bg-[#FAF8F4] ${i ? "border-t border-[#EFEBE3]" : ""}`}>
        <span className="min-w-0 grow">
          <span className="block text-[15px] font-semibold leading-tight">{sv.nome}</span>
          <span className="block text-[13px] leading-snug text-[#6F6A5E]">{duracao(sv.duracao)}</span>
        </span>
        {sv.preco ? <span className="shrink-0 text-right text-sm font-semibold tabular-nums">{precoDe({ priceCents: sv.preco, tipoPreco: sv.tipoPreco })}</span> : null}
        <Seta className="shrink-0 text-[#A9A396]" />
      </a>
    </li>
  );
  const VISIVEIS = 4;
  const primeiro = livres?.dias[0];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col pb-32">
      {/* Capa: a foto é a vitrine, com o nome por cima. Sem foto, a cor do negócio e a inicial. */}
      <header className="relative aspect-[4/4.4] max-h-[68svh] w-full overflow-hidden" style={{ background: bio.cor }}>
        {fotoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- foto do site do cliente, fora do otimizador
          <img src={fotoSrc} alt="" width={520} height={572} fetchPriority="high" decoding="async" className="size-full object-cover" />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-full items-center justify-center pb-24 font-[family-name:var(--fonte-serifa)] text-[180px] leading-none"
            style={{ color: claro(bio.cor) ? "rgba(23,21,15,.14)" : "rgba(255,255,255,.14)" }}
          >
            {bio.nome.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(14,13,10,.92) 4%, rgba(14,13,10,.15) 55%, rgba(14,13,10,0) 75%)" }} />
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-start gap-2 px-4 pb-4 text-white">
          {bio.expediente.length > 0 && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
              style={aberto ? { background: "rgba(231,238,233,.95)", color: "#2C6A53" } : { background: "rgba(243,237,228,.95)", color: "#7A5A2E" }}
            >
              <span aria-hidden="true" className="size-1.5 rounded-full" style={{ background: aberto ? "#2C6A53" : "#B08434" }} />
              {aberto && ate ? `Aberto agora · até ${hhmm(ate)}` : "Fechado agora"}
            </span>
          )}
          <h1 className="text-balance font-[family-name:var(--fonte-serifa)] text-[44px] font-normal leading-[0.95] tracking-[-0.01em]">{bio.nome}</h1>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-white/80">
            {local && <span>{local}</span>}
            {bio.nota && (
              <>
                {local && <span aria-hidden="true">·</span>}
                <span className="inline-flex items-center gap-1">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="#E8A33D" aria-hidden="true">
                    <path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.2 6.1L12 16.9 6.5 19.7l1.2-6.1L3.2 9.4l6.1-.8z" />
                  </svg>
                  <b className="font-semibold text-white">{bio.nota.toFixed(1).replace(".", ",")}</b>
                  {bio.avaliacoes ? <span>({bio.avaliacoes.toLocaleString("pt-BR")})</span> : null}
                </span>
              </>
            )}
            {precos.length > 0 && (
              <>
                {(local || bio.nota) && <span aria-hidden="true">·</span>}
                <span>
                  a partir de <b className="font-semibold text-white">{formatBRL(Math.min(...precos))}</b>
                </span>
              </>
            )}
          </div>
        </div>
      </header>

      {atalhos.length > 0 && (
        <nav aria-label="Contato" className="flex gap-2 overflow-x-auto px-4 pt-3.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {atalhos.map((a) => (
            <a
              key={a.rotulo}
              href={a.href}
              {...(a.externo !== false && { target: "_blank", rel: "noreferrer" })}
              className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border border-[#E2DDD3] bg-white px-3.5 text-[13px] font-semibold active:scale-[0.97]"
            >
              <span style={{ color: a.tinta }}>{a.icone}</span>
              {a.rotulo}
            </a>
          ))}
        </nav>
      )}

      <div className="flex flex-col gap-6 px-4 pt-6">
        {livres && (
          <section aria-labelledby="titulo-horarios" className="flex flex-col gap-2.5">
            <style>{ABAS}</style>
            <h2 id="titulo-horarios" className={`${ROTULO} flex items-baseline justify-between`}>
              Próximos horários
              <span className="text-[13px] font-medium normal-case tracking-normal">
                {livres.servico.nome} · {duracao(livres.servico.duracao)}
              </span>
            </h2>
            <div className="dias flex flex-wrap gap-x-1.5 gap-y-2.5">
              {livres.dias.map((d, k) => (
                <input key={d.date} type="radio" name="dia" id={`dia-${k}`} defaultChecked={k === 0} className="sr-only" />
              ))}
              {livres.dias.map((d, k) => (
                <label key={d.date} htmlFor={`dia-${k}`} className="inline-flex min-h-10 cursor-pointer items-center rounded-full px-3.5 text-[13px] font-semibold text-[#6F6A5E]">
                  {d.rotulo}
                </label>
              ))}
              {livres.dias.map((d) => (
                <div key={d.date} className="hidden w-full grid-cols-4 gap-1.5">
                  {d.horarios.map((h) => (
                    <a
                      key={h}
                      href={`${agendar}?servico=${encodeURIComponent(livres.servico.id)}&data=${d.date}&hora=${h}`}
                      className={`rounded-xl border py-2.5 text-center text-sm font-semibold tabular-nums ${d === primeiro && h === primeiro.horarios[0] ? "border-[#17150F] bg-[#17150F] text-white" : "border-[#E2DDD3] bg-white"}`}
                    >
                      {hhmm(h)}
                    </a>
                  ))}
                </div>
              ))}
            </div>
          </section>
        )}

        {bio.servicos.length > 0 && (
          <section aria-labelledby="titulo-servicos" className="flex flex-col gap-2.5">
            <h2 id="titulo-servicos" className={`${ROTULO} flex items-baseline justify-between`}>
              Serviços
              <span className="text-[13px] font-medium normal-case tracking-normal">{bio.servicos.length}</span>
            </h2>
            <div className={`${CARTAO} overflow-hidden`}>
              <ul>{bio.servicos.slice(0, VISIVEIS).map(linhaServico)}</ul>
              {bio.servicos.length > VISIVEIS && (
                // <details> nativo: o resto da lista sem JavaScript; o "ver os N" some ao abrir
                <details className="group">
                  <summary className="cursor-pointer list-none border-t border-[#EFEBE3] py-3 text-center text-[13px] font-semibold text-[#6F6A5E] group-open:hidden [&::-webkit-details-marker]:hidden">
                    Ver os {bio.servicos.length} serviços
                  </summary>
                  <ul className="border-t border-[#EFEBE3]">{bio.servicos.slice(VISIVEIS).map(linhaServico)}</ul>
                </details>
              )}
            </div>
          </section>
        )}

        {(dias.length > 0 || mapa) && (
          <section aria-labelledby="titulo-onde" className="flex flex-col gap-2.5">
            <h2 id="titulo-onde" className={ROTULO}>
              Onde e quando
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {dias.length > 0 && (
                <details className={`${CARTAO} group open:col-span-2 ${mapa ? "" : "col-span-2"}`}>
                  <summary className="cursor-pointer list-none px-3.5 py-3 text-[13px] text-[#6F6A5E] [&::-webkit-details-marker]:hidden">
                    <b className="block text-sm text-[#17150F]">{jornadaHoje ? `Hoje ${hhmm(jornadaHoje.inicio)}–${hhmm(jornadaHoje.fim)}` : "Hoje fechado"}</b>
                    <span className="group-open:hidden">Ver a semana</span>
                    <span className="hidden group-open:inline">Horário da semana</span>
                  </summary>
                  <div className="border-t border-[#EFEBE3] px-3.5 py-2">
                    {dias.map((d) => (
                      <div key={d.dia} className={`flex justify-between py-1.5 text-sm ${d.dia === hoje ? "font-semibold" : ""}`}>
                        <span>
                          {WEEKDAYS[d.dia]}
                          {d.dia === hoje && <span className="font-normal text-[#6F6A5E]"> · hoje</span>}
                        </span>
                        <span className="tabular-nums">
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
                </details>
              )}
              {/* a cidade já está na capa: o cartão só aparece com endereço, que abre no mapa */}
              {mapa && (
                <a href={mapa} target="_blank" rel="noreferrer" className={`${CARTAO} min-w-0 self-start px-3.5 py-3 text-[13px] text-[#6F6A5E] ${dias.length ? "" : "col-span-2"}`}>
                  <b className="block truncate text-sm text-[#17150F]">{bio.endereco}</b>
                  Abrir no mapa
                </a>
              )}
            </div>
          </section>
        )}

        <footer className="flex flex-col items-center gap-2.5 pt-2 text-center text-xs text-[#8B8578]">
          <a href={bio.site} className="inline-flex items-center gap-1 text-sm font-semibold text-[#17150F]">
            Ver o site completo
            <Seta className="text-[#A9A396]" />
          </a>
          <p>
            {bio.nome} · feito com{" "}
            <a href="https://www.ruphus.site/sobre" className="underline underline-offset-2">
              Ruphus
            </a>
          </p>
        </footer>
      </div>

      {/* a barra fica à vista o tempo todo: agendar é o motivo de a pessoa ter vindo do Instagram.
          Sem catálogo não há o que marcar, e prometer agendamento levaria a pessoa a uma página
          vazia — nesse caso a barra leva ao WhatsApp, que é o que o negócio tem para oferecer. */}
      {(agenda ? agendar : zap) && (
        <div className="fixed inset-x-0 bottom-0 border-t border-[#E7E2D8] bg-[#F7F5F1]/95 backdrop-blur">
          <div className="mx-auto w-full max-w-[520px] px-4 pt-2.5 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <a
              href={agenda ? agendar : zap!}
              className="flex min-h-[54px] items-center justify-between gap-3 rounded-2xl px-5 py-2.5"
              style={{ background: acento, color: "#FFFFFF" }}
            >
              <span className="text-[15px] font-bold">{agenda ? "Agendar online" : "Falar no WhatsApp"}</span>
              {agenda && primeiro && (
                <span className="text-xs opacity-85">
                  livre {primeiro.rotulo.toLowerCase()} {hhmm(primeiro.horarios[0])}
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
