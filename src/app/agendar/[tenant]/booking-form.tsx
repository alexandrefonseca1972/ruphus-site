"use client";

import dynamic from "next/dynamic";
import { Fragment, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  addDays,
  formatBRL,
  formatDuration,
  formatLongDate,
  formatTime,
  formatPhone,
  linkWhatsApp,
  MAX_DAYS_AHEAD,
  phoneError,
  TIMEZONE,
  zonedTime,
  precoDe,
  type TipoPreco,
} from "@/lib/datetime";
import { ics, linkGoogleAgenda, mapas } from "@/lib/lembrete";
import { erroNome, mascaraNome } from "@/lib/nome";
import { cn } from "@/lib/utils";
import type { book } from "@/lib/booking.server";
import { getAgenda } from "./actions";
import { textoDoSinal, valorDoSinal } from "@/lib/sinal";
import type { ConfigSinal } from "@/lib/sinal-config";
import { foraDoLimite, limitesDe, type LimitesAgenda } from "@/lib/scheduling";

type Resposta = Awaited<ReturnType<typeof book>>;

type Props = {
  tenantId: string;
  today: string;
  name: string;
  phone: string | null;
  rating?: number | null;
  reviews?: number | null;
  city?: string | null;
  uf?: string | null;
  address?: string | null;
  bairro?: string | null;
  temSite?: boolean;
  /** endereço do site com barra no fim (domínio próprio ou {slug}.ruphus.site) */
  siteUrl?: string;
  /** recado do dono para quem acabou de agendar; null = texto padrão */
  recadoDono?: string | null;
  /** sinal por Pix para reservar; null = paga tudo no local */
  sinal?: Pick<ConfigSinal, "tipo" | "valor" | "prazoMin"> | null;
  /** quantos serviços e quanto tempo somado cabem num horário (o dono ajusta) */
  limites?: LimitesAgenda;
  /** Fuso real do negócio: o "Salvar na agenda" do cliente precisa do instante certo */
  fuso?: string;
  services: { id: string; name: string; durationMin: number; priceCents: number; tipoPreco?: TipoPreco }[];
  staff: { id: string; name: string; serviceIds: string[]; workDays: number[] }[];
  /** vindo da bio (?servico=&data=&hora=): serviço marcado e, se ainda livre, o horário */
  inicial?: { servico: string; data?: string; hora?: string } | null;
};

type Dia = { date: string; horarios: { hora: string; staffId: string }[]; fechado?: boolean };

const CONTACT_KEY = "siteflow:contato"; // lembrado só neste navegador

// A mesma paleta dos sites dos negócios e da tela de entrada: esta página é a
// vitrine do cliente, não o painel.
const ROTULO = "font-[family-name:var(--font-geist-mono)] text-[11px] font-medium tracking-[0.14em] text-[#6B6555] uppercase";
// o QR (biblioteca qrcode) só aparece depois de reservar com sinal: fora do JS de quem só olha horários
const PixQr = dynamic(() => import("@/components/pix-qr").then((m) => m.PixQr));

const MONO = "font-[family-name:var(--font-geist-mono)]";
const PAINEL = "rounded-[14px] border border-[#E0DCCE] bg-[#FAF9F5]";
const CAMPO =
  "h-12 rounded-[10px] border-[#D5D0C1] bg-white px-3.5 text-base text-[#17150F] focus-visible:border-[#17150F] focus-visible:ring-[3px] focus-visible:ring-[#17150F]/8";
const PRIMARIO =
  "flex h-13 items-center justify-center gap-2.5 rounded-[10px] bg-[#17150F] px-4 text-[15px] font-semibold text-[#FAF9F5] disabled:cursor-not-allowed disabled:bg-[#B8B3A4]";

const longDate = (date: string) => formatLongDate(zonedTime(date, "12:00"));
const parte = (date: string, opcoes: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("pt-BR", { ...opcoes, timeZone: TIMEZONE }).format(zonedTime(date, "12:00")).replace(".", "");
const iniciais = (nome: string) =>
  nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
// Enquanto faltam dígitos a dica conta, não acusa: acusar quem ainda digita é ruído.
const faltamDigitos = (v: string) => {
  const d = v.replace(/\D/g, "");
  return d.length && d.length < 10 ? `faltam ${10 - d.length} dígito${10 - d.length > 1 ? "s" : ""}` : "";
};
const fimDe = (date: string, hora: string, min: number) => {
  const fim = new Date(zonedTime(date, hora).getTime() + min * 60_000);
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TIMEZONE }).format(fim);
};

function Zap({ className }: { className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.9-.9L3 20.5l1.6-4.9A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z" />
    </svg>
  );
}

/** Nome, nota e cidade do negócio, no topo das telas da agenda. */
function Identidade({ name, rating, reviews, city }: Pick<Props, "name" | "rating" | "reviews" | "city">) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <h1 className="truncate text-base leading-tight font-semibold tracking-[-0.02em]">{name}</h1>
      {(rating || city) && (
        <p className="flex items-center gap-1.5 text-[11px] text-[#5C5747]">
          {rating ? (
            <>
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="size-3 text-[#C9962F]">
                <path d="M12 2l2.9 6.3 6.6.7-4.9 4.5 1.3 6.5L12 16.8 6.1 20l1.3-6.5L2.5 9l6.6-.7z" />
              </svg>
              <span className={cn(MONO, "text-[11px] text-[#17150F]")}>
                {rating.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
              </span>
              {reviews ? <span className="truncate">· {reviews.toLocaleString("pt-BR")} no Google</span> : null}
            </>
          ) : null}
          {rating && city ? <span aria-hidden="true">·</span> : null}
          {city ? <span className="truncate">{city}</span> : null}
        </p>
      )}
    </div>
  );
}

function Cabecalho({ tenantId, temSite, siteUrl, name, rating, reviews, city, phone }: Pick<Props, "tenantId" | "temSite" | "siteUrl" | "name" | "rating" | "reviews" | "city" | "phone">) {
  const falar = linkWhatsApp(phone, `Olá! Quero marcar um horário no ${name}.`);
  // O nome leva ao negócio: no computador, o site inteiro; no celular, a bio, que cabe na
  // tela e já tem os botões. Endereço completo: esta página também abre em www.ruphus.site.
  const base = (siteUrl ?? `https://${tenantId}.ruphus.site/`).replace(/\/$/, "");
  const destinos = [
    { href: temSite ? `${base}/` : `${base}/bio`, className: "hidden sm:flex" },
    { href: `${base}/bio`, className: "flex sm:hidden" },
  ];
  return (
    <header className={cn("flex items-center gap-3 p-3.5", PAINEL)}>
      {destinos.map((d) => (
        <a
          key={d.className}
          href={d.href}
          target="_blank"
          rel="noreferrer"
          title={`Ver a página de ${name}`}
          className={cn("min-w-0 flex-1 items-center gap-3 rounded-[11px] hover:[&_h1]:underline", d.className)}
        >
          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-[#17150F] text-[12px] text-[#FAF9F5]", MONO)}>
            {iniciais(name)}
          </span>
          <Identidade name={name} rating={rating} reviews={reviews} city={city} />
        </a>
      ))}
      {falar && (
        <a
          href={falar}
          target="_blank"
          rel="noreferrer"
          aria-label={`Falar com ${name} no WhatsApp`}
          className="flex size-11 shrink-0 items-center justify-center rounded-[11px] border border-[#D5D0C1] bg-white text-[#2C6A53] hover:bg-[#F6F4EB]"
        >
          <Zap />
        </a>
      )}
    </header>
  );
}

function Rodape() {
  return (
    <p className={cn("flex items-center justify-center gap-2 text-[11px] tracking-[0.12em] text-[#6B6555] uppercase", MONO)}>
      ruphus · agenda deste negócio
    </p>
  );
}

/** Um passo da lista "o que falta": feito (✓), o de agora (destacado) e os que vêm depois. */
function Passo({ estado, ultimo, children }: { estado: "feito" | "agora" | "depois"; ultimo: boolean; children: React.ReactNode }) {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0" aria-current={estado === "agora" ? "step" : undefined}>
      {!ultimo && <span aria-hidden="true" className="absolute top-6 bottom-0 left-[11px] w-px bg-[#D5D0C1]" />}
      <span
        aria-hidden="true"
        className={cn(
          "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full text-[#FAF9F5]",
          estado === "feito" && "bg-[#2C6A53]",
          estado === "agora" && "bg-[#17150F] ring-4 ring-[#17150F]/10",
          estado === "depois" && "border border-[#B8B2A2] bg-white",
        )}
      >
        {estado === "feito" && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 13l4 4L19 7" />
          </svg>
        )}
        {estado === "agora" && <span className="size-2 rounded-full bg-[#FAF9F5]" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-[15px] leading-snug">
        <span className="sr-only">{estado === "feito" ? "Feito: " : estado === "agora" ? "Agora: " : "Depois: "}</span>
        {children}
      </div>
    </li>
  );
}

type Vaga = { date: string; hora: string; staffId: string };
// staffId: a escolha do cliente ("" = qualquer); atendeu: quem ficou com o horário
type Ultimo = { serviceIds: string[]; staffId: string; atendeu: string };

/** "Hoje", "Amanhã" ou "Seg 9": o rótulo curto de um dia nos botões de horário. */
const rotuloDia = (date: string, today: string) =>
  date === today ? "Hoje" : date === addDays(today, 1) ? "Amanhã" : `${parte(date, { weekday: "short" }).replace(/^./, (c) => c.toUpperCase())} ${parte(date, { day: "numeric" })}`;
const PERIODOS = [
  { nome: "Manhã", ate: "12:00" },
  { nome: "Tarde", ate: "18:00" },
  { nome: "Noite", ate: "24:00" },
];

/** Folha que sobe de baixo no celular (janela no meio no computador). <dialog> nativo: prende
 *  o foco, fecha no Esc e deixa o fundo inerte para o leitor de tela, sem biblioteca. */
function Folha({ aberta, aoFechar, titulo, bloqueada, children }: { aberta: boolean; aoFechar: () => void; titulo: string; bloqueada?: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberta && !d.open) {
      // Safari < 15.4 não tem showModal: abre como bloco comum, que ainda funciona
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
      // o foco vai ao título: no celular, cair no campo de busca abria o teclado sem pedir
      d.querySelector<HTMLElement>("[data-titulo]")?.focus();
    }
    if (!aberta && d.hasAttribute("open")) {
      if (typeof d.close === "function") d.close();
      else d.removeAttribute("open");
    }
  }, [aberta]);
  return (
    <dialog
      ref={ref}
      aria-label={titulo}
      onClose={aoFechar}
      // enviando: Esc e toque fora não fecham, senão a resposta (ocupado, erro) chegava numa folha fechada
      onCancel={(e) => bloqueada && e.preventDefault()}
      onClick={(e) => !bloqueada && e.target === e.currentTarget && aoFechar()}
      className="fixed inset-0 m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto overscroll-contain rounded-t-[22px] bg-white p-0 text-[#17150F] shadow-[0_-12px_32px_rgba(23,21,15,0.18)] backdrop:bg-[#17150F]/45 sm:m-auto sm:max-w-[440px] sm:rounded-[22px]"
    >
      {aberta && (
        <div className="flex flex-col gap-4 px-4 pt-2.5 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pt-5">
          <span aria-hidden="true" className="mx-auto h-[5px] w-10 shrink-0 rounded-full bg-[#D9D3C6] sm:hidden" />
          {children}
        </div>
      )}
    </dialog>
  );
}

function Fechar({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Fechar" className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-[#F2F0E7]">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    </button>
  );
}

const Seta = ({ d = "M9 6l6 6-6 6", size = 16 }: { d?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

export function BookingForm({ tenantId, today, name, phone, rating, reviews, city, uf, address, bairro, temSite, siteUrl, recadoDono, sinal, fuso, services, staff, inicial, limites = limitesDe(null) }: Props) {
  // Nada vem marcado: quem agenda diz o que quer, e só então os horários aparecem.
  // Os serviços chegam do servidor na ordem do que mais se agenda.
  // A exceção é quem tocou num serviço ou num horário da bio: chega com ele escolhido.
  const [serviceIds, setServiceIds] = useState<string[]>(inicial ? [inicial.servico] : []);
  const [staffId, setStaffId] = useState("");
  // a faixa mostra 7 dias a partir de hoje: um dia da bio além dela abre a faixa nele
  const [from, setFrom] = useState(inicial?.data && inicial.data > addDays(today, 6) && inicial.data <= addDays(today, MAX_DAYS_AHEAD) ? inicial.data : today);
  const [versao, setVersao] = useState(0);
  const chave = `${serviceIds.join(",")}|${staffId}|${from}|${versao}`;
  const [buscado, setBuscado] = useState<{ para: string; dias: Dia[] } | null>(null);
  const agenda = buscado?.para === chave ? buscado.dias : null;
  const [date, setDate] = useState(inicial?.data ?? "");
  // o horário da bio é aplicado uma vez, na primeira agenda que chegar
  const horaInicial = useRef(inicial?.data ? { data: inicial.data, hora: inicial.hora } : null);
  const [escolha, setEscolha] = useState<{ hora: string; staffId: string } | null>(null);
  // a folha aberta por cima da página: com quem, outro dia, ou a confirmação
  const [folha, setFolha] = useState<"quem" | "quando" | "confirmar" | null>(null);
  // o horário que outra pessoa pegou enquanto este cliente confirmava
  const [tomado, setTomado] = useState<{ date: string; hora: string; msg: string } | null>(null);
  const [busca, setBusca] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [lembrado, setLembrado] = useState(false);
  const [ultimo, setUltimo] = useState<Ultimo | null>(null);
  // enviou: depois de tentar confirmar, o "faltam N dígitos" também acusa (antes só informava)
  const [touched, setTouched] = useState({ name: false, phone: false, enviou: false });
  // falha ao carregar a semana: separado do "ocupado", some quando a próxima busca dá certo
  const [erroAgenda, setErroAgenda] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [busy, setBusy] = useState(false);
  // o que o servidor gravou: a confirmação mostra isso, não a escolha atual da tela
  // (uma resposta atrasada chega depois de o cliente mexer na grade)
  const [reserva, setReserva] = useState<Extract<Resposta, { ok: true }> | null>(null);
  const pedido = useRef<string | undefined>(undefined);
  const [copiado, setCopiado] = useState(false);
  const [blocoVisivel, setBlocoVisivel] = useState(true);

  const escolhidos = services.filter((s) => serviceIds.includes(s.id));
  const totalMin = escolhidos.reduce((sum, s) => sum + s.durationMin, 0);
  const total = precoDe(...escolhidos);
  const precoEscolhido = escolhidos.reduce((soma, s) => soma + s.priceCents, 0);
  const valorSinal = sinal ? valorDoSinal(sinal, precoEscolhido) : 0;
  const fazTudo = (p: Props["staff"][number]) => serviceIds.every((id) => p.serviceIds.includes(id));
  const profissionais = staff.filter(fazTudo);
  const escolhido = staff.find((p) => p.id === staffId);
  const atendente = staff.find((p) => p.id === escolha?.staffId);
  const errors = { name: erroNome(customerName), phone: phoneError(customerPhone) };
  const contatoOk = !errors.name && !errors.phone;
  const foneInvalido = touched.phone && !!errors.phone && (touched.enviou || !faltamDigitos(customerPhone));
  const dia = agenda?.find((d) => d.date === date);
  // todos os horários livres da semana em ordem: "mais cedo" e "próximos livres" saem daqui
  const livres: Vaga[] = agenda?.flatMap((d) => d.horarios.map((h) => ({ date: d.date, ...h }))) ?? [];
  const semanaCheia = !!agenda && !livres.length;
  const proximaSemana = addDays(from, 7);
  const temProxima = proximaSemana <= addDays(today, MAX_DAYS_AHEAD);
  // o último que passa do limite de hoje (o dono baixou) não é oferecido para repetir
  const ultimoValido = ultimo && ultimo.serviceIds.length && ultimo.serviceIds.every((id) => services.some((s) => s.id === id)) && !foraDoLimite(services.filter((s) => ultimo.serviceIds.includes(s.id)), limites) ? ultimo : null;
  // o serviço que, somado ao que já está marcado, passaria do limite: fica apagado e diz por quê
  const [avisoLimite, setAvisoLimite] = useState("");
  const travado = (s: { id: string; durationMin: number }) => !serviceIds.includes(s.id) && foraDoLimite([...escolhidos, s], limites);

  // Contato e último pedido lembrados neste navegador
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CONTACT_KEY) ?? "null");
      if (saved?.name && saved?.phone) {
        const nome = String(saved.name);
        const fone = formatPhone(String(saved.phone));
        setCustomerName(nome); // eslint-disable-line react-hooks/set-state-in-effect -- leitura única do localStorage
        setCustomerPhone(fone);
        // Só esconde o formulário se o contato guardado ainda vale: um nome de antes da regra
        // atual deixava o botão desligado, o formulário escondido e nenhum aviso — a tela travava
        setLembrado(!erroNome(nome) && !phoneError(fone));
      }
      if (Array.isArray(saved?.ultimo?.serviceIds)) setUltimo({ serviceIds: saved.ultimo.serviceIds.map(String), staffId: String(saved.ultimo.staffId ?? ""), atendeu: String(saved.ultimo.atendeu ?? "") });
    } catch {}
  }, []);

  useEffect(() => {
    if (!serviceIds.length) return;
    let atual = true;
    getAgenda({ tenantId, serviceIds, staffId, from })
      .then((dias) => {
        if (atual) setErroAgenda(false);
        return dias;
      })
      .catch(() => {
        if (atual) setErroAgenda(true);
        return [] as Dia[];
      })
      .then((dias) => atual && setBuscado({ para: chave, dias }));
    return () => {
      atual = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- serviceIds e from já estão em chave
  }, [tenantId, staffId, chave]);

  // O primeiro dia com horário é o dia aberto na folha "outro dia": ninguém caça um que tenha vaga
  useEffect(() => {
    if (!agenda) return;
    const pedido = horaInicial.current;
    if (pedido) {
      horaInicial.current = null;
      // ocupado desde que a bio foi gerada (cache de 1 min): abre o dia, sem horário marcado
      const vaga = pedido.hora && agenda.find((d) => d.date === pedido.data)?.horarios.find((h) => h.hora === pedido.hora);
      if (vaga) {
        setEscolha(vaga);
        setFolha("confirmar");
      } else setFolha("quando");
    }
    if (agenda.some((d) => d.date === date && d.horarios.length)) return;
    setDate(agenda.find((d) => d.horarios.length)?.date ?? agenda[0]?.date ?? "");
  }, [agenda, date]);

  // A setinha flutuante aparece quando o bloco de horários sai da tela (lista longa de serviços)
  useEffect(() => {
    const bloco = document.getElementById("mais-cedo");
    if (!bloco || typeof IntersectionObserver === "undefined") return;
    // meio bloco para fora já conta como fora: uma tirinha no alto da tela não mostra os horários
    const io = new IntersectionObserver(([e]) => setBlocoVisivel(e.intersectionRatio >= 0.5), { threshold: [0, 0.5, 1] });
    io.observe(bloco);
    return () => io.disconnect();
  }, [serviceIds]);

  // Marcou o primeiro serviço: o bloco de horários aparece logo abaixo dele; se ficou fora da
  // tela, rola só o necessário
  const mostrarBloco = useRef(false);
  useEffect(() => {
    if (!mostrarBloco.current) return;
    mostrarBloco.current = false;
    document.getElementById("mais-cedo")?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [serviceIds]);
  // a folha de confirmar trocou de conteúdo (horário pego, ou "Pegar"): o botão tocado sumiu e o
  // foco caía no body; volta ao título, que o leitor de tela lê
  useEffect(() => {
    if (folha === "confirmar") document.querySelector<HTMLElement>("dialog[open] [data-titulo]")?.focus();
  }, [tomado, folha]);
  // reservou: a tela inteira troca e o foco caía no body; vai para o dia reservado, que o leitor
  // de tela anuncia (o role="status" nasce com o texto e não seria lido)
  useEffect(() => {
    if (reserva) document.getElementById("reserva-feita")?.focus();
  }, [reserva]);

  function toggleService(id: string) {
    const motivo = travado(services.find((s) => s.id === id)!);
    if (motivo) return setAvisoLimite(motivo);
    setAvisoLimite("");
    // Mantém a ordem do catálogo: "Corte + Barba", não a ordem dos cliques
    const ids = services.map((s) => s.id).filter((s) => (s === id ? !serviceIds.includes(id) : serviceIds.includes(s)));
    if (!serviceIds.length) mostrarBloco.current = true;
    // sem serviço o bloco some: ao voltar, a pílula espera o observador dizer se ele está à vista
    if (!ids.length) setBlocoVisivel(true);
    escolherServicos(ids, staffId);
  }

  function escolherServicos(escolha: string[], quem: string) {
    // na ordem do catálogo, que muda com o tempo: "repetir o último" guardou a ordem de antes
    const ids = services.map((s) => s.id).filter((id) => escolha.includes(id));
    setServiceIds(ids);
    // O profissional escolhido pode não fazer o novo conjunto: volta para "qualquer"
    setStaffId(quem && ids.every((s) => staff.find((p) => p.id === quem)?.serviceIds.includes(s)) ? quem : "");
    setEscolha(null);
    setTomado(null);
  }

  function abrirConfirmar(v: Vaga) {
    setDate(v.date);
    setEscolha({ hora: v.hora, staffId: v.staffId });
    setTomado(null);
    setSubmitError("");
    setFolha("confirmar");
  }

  async function confirmar(alvo?: Vaga) {
    const vaga = alvo ?? (escolha && { date, ...escolha });
    if (!vaga) return;
    setSubmitError("");
    setTouched({ name: true, phone: true, enviou: true });
    if (!contatoOk) {
      // os campos ficam acima do botão, às vezes fora da folha: leva até o que falta
      setLembrado(false);
      setSubmitError("Confira seu nome e WhatsApp acima.");
      requestAnimationFrame(() => document.getElementById(errors.name ? "customerName" : "customerPhone")?.focus());
      return;
    }
    // O mesmo pedido em toda tentativa até chegar a resposta, mesmo recarregando a página:
    // confirmar de novo devolve o que já foi marcado, em vez de marcar outro horário
    const chavePedido = `pedido-${tenantId}`;
    try {
      pedido.current ??= sessionStorage.getItem(chavePedido) ?? undefined;
    } catch {}
    // randomUUID só existe em HTTPS (e localhost): testando pelo IP da rede, vale o improviso
    pedido.current ??= crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      sessionStorage.setItem(chavePedido, pedido.current);
    } catch {}
    setBusy(true);
    const recusa = (error: string) => ({ ok: false as const, error, field: true as const });
    // rede do celular caindo deixava "Reservando…" para sempre: com 20 s sem resposta,
    // desiste deste envio e a próxima tentativa sai na hora (sem AbortSignal.timeout,
    // que o Safari do iOS 15 não tem)
    const aborta = new AbortController();
    const prazo = setTimeout(() => aborta.abort(), 20_000);
    const result: Resposta = await fetch("/api/agendar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenantId,
        serviceIds,
        staffId: vaga.staffId,
        date: vaga.date,
        time: vaga.hora,
        customerName,
        customerPhone,
        // "qualquer um": se o oferecido na grade ocupou, o servidor tenta outro livre na mesma hora
        qualquer: !staffId,
        pedido: pedido.current,
      }),
      signal: aborta.signal,
    })
      .then((r) => (r.ok ? r.json() : recusa("Não foi possível confirmar agora. Tente de novo em instantes.")))
      .catch(() =>
        recusa(
          aborta.signal.aborted
            ? "A confirmação não respondeu. Verifique a internet e toque em confirmar de novo: se o horário já tiver sido reservado, ele não é marcado duas vezes."
            : "Não foi possível confirmar agora. Verifique sua conexão e tente de novo.",
        ),
      )
      .finally(() => {
        clearTimeout(prazo);
        setBusy(false);
      });
    if (!result.ok && "field" in result) return setSubmitError(result.error);
    if (result.ok) {
      // respondido: o próximo agendamento (outro filho, "Fazer outro agendamento") é outro pedido
      pedido.current = undefined;
      try {
        sessionStorage.removeItem(chavePedido);
        localStorage.setItem(
          CONTACT_KEY,
          JSON.stringify({ name: customerName.trim(), phone: customerPhone, ultimo: { serviceIds, staffId, atendeu: vaga.staffId } }),
        );
      } catch {}
      setFolha(null);
      scrollTo({ top: 0 });
      return setReserva(result);
    }
    // Horário tomado por outra pessoa (ou serviço/profissional que saiu): a folha fica aberta,
    // avisa e oferece os próximos livres da agenda recarregada
    setTomado({ date: vaga.date, hora: vaga.hora, msg: result.error });
    setEscolha(null);
    setVersao((v) => v + 1);
  }

  // O recado que o cliente leva no WhatsApp: é ele que avisa quem atende, então
  // sai pronto, com tudo que a casa precisa para achar o horário na agenda.
  const recado = (servicos: string, dia: string, hora: string, quem?: string) =>
    linkWhatsApp(
      phone,
      [
        `Olá! Acabei de agendar pelo site do ${name}.`,
        "",
        servicos,
        `${longDate(dia)}, às ${hora}`,
        ...(quem ? [`com ${quem}`] : []),
        "",
        `Meu nome é ${customerName.trim()} (${customerPhone}).`,
      ].join("\n"),
    );

  // ---------- confirmado ----------
  // sem exigir o atendente: a equipe pode ter mudado depois de a página abrir, e a reserva
  // feita ficava presa na confirmação
  if (reserva) {
    const { date, time: hora, durationMin: totalMin, serviceName: servicos, staffName: quem } = reserva;
    const total = precoDe({ priceCents: reserva.priceCents, tipoPreco: reserva.precoAberto ? "aPartir" : "fixo" });
    const avisoUrl = recado(servicos, date, hora, quem);
    const fim = fimDe(date, hora, totalMin);
    const dias = Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
    const quando = dias <= 0 ? "hoje" : dias === 1 ? "amanhã" : `daqui a ${dias} dias`;
    // Como chegar: a rua quando a casa cadastrou; sem ela, bairro e cidade ainda levam perto
    const cidadeUf = [city, uf].filter(Boolean).join("/");
    const onde = address ? [address, bairro, cidadeUf].filter(Boolean).join(", ") : bairro && city ? `${bairro}, ${cidadeUf}` : "";
    const rotas = onde ? mapas(onde) : null;
    const compromisso = {
      id: `${tenantId}-${reserva.id}`,
      titulo: `${servicos} · ${name}`,
      // no fuso do negócio: "10:30" em Manaus é 14:30 UTC, não 13:30 (o celular mostraria 09:30)
      inicio: zonedTime(date, hora, fuso),
      fim: new Date(zonedTime(date, hora, fuso).getTime() + totalMin * 60_000),
      local: onde || [name, cidadeUf].filter(Boolean).join(", "),
      detalhes: [quem ? `Com ${quem}.` : "", total ? `${total}, pago no local.` : "", phone ? `WhatsApp de ${name}: ${formatPhone(phone)}` : ""]
        .filter(Boolean)
        .join("\n"),
    };
    // no celular o .ics abre direto na agenda; no computador, baixa
    const salvarNaAgenda = () => {
      const url = URL.createObjectURL(new Blob([ics(compromisso)], { type: "text/calendar;charset=utf-8" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: "agendamento.ics" });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const desmarcar = linkWhatsApp(
      phone,
      `Olá! Preciso desmarcar ou mudar meu horário de ${longDate(date)}, às ${hora} (${servicos}). Meu nome é ${customerName.trim()}.`,
    );
    return (
      <main className="mx-auto flex w-full max-w-[420px] flex-1 flex-col gap-4 bg-[#F2F0E7] p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-[#17150F]">
        <Cabecalho tenantId={tenantId} temSite={temSite} siteUrl={siteUrl} name={name} rating={rating} reviews={reviews} city={city} phone={phone} />
        <div className={cn(PAINEL, "overflow-hidden shadow-[0_28px_50px_-34px_rgba(22,21,15,0.28)]")}>
          <div className="flex flex-col gap-4 p-5">
            {/* "pedido enviado", não "confirmado": quem confirma é o negócio (e, com sinal, depois do Pix).
                O que falta vem nos passos abaixo; o verde fica para quando o salão confirmar */}
            <p className={cn("flex items-center gap-2 text-[11px] font-medium tracking-[0.14em] uppercase text-[#5C5747]", MONO)} role="status">
              <span className="flex size-5 items-center justify-center rounded-full border border-[#B8B2A2]" aria-hidden="true">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#5C5747" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12l16-8-6 16-2-6z" />
                </svg>
              </span>
              pedido enviado
            </p>
            <div className="flex flex-col gap-1">
              <p className={cn(MONO, "text-[11px] tracking-[0.06em] text-[#6B6555]")}>{quando}</p>
              <h2 id="reserva-feita" tabIndex={-1} className="text-[28px] leading-[1.06] font-semibold tracking-[-0.03em] outline-none first-letter:uppercase">{longDate(date)}</h2>
              <p className={cn(MONO, "text-[22px]")}>
                {hora} — {fim}
              </p>
            </div>
            <dl className="flex flex-col gap-1.5 text-[13px]">
              <div className="flex gap-2.5">
                <dt className={cn(ROTULO, "w-16 shrink-0")}>serviço</dt>
                <dd>
                  {servicos} · {formatDuration(totalMin)}
                </dd>
              </div>
              <div className="flex gap-2.5">
                <dt className={cn(ROTULO, "w-16 shrink-0")}>com</dt>
                <dd>{quem ?? "a equipe"}</dd>
              </div>
              <div className="flex gap-2.5">
                <dt className={cn(ROTULO, "w-16 shrink-0")}>valor</dt>
                <dd>
                  {total ? (
                    <>
                      <span className={MONO}>{total}</span> <span className="text-[#5C5747]">· {reserva.sinal ? (reserva.sinal.cents >= reserva.priceCents ? "todo por Pix, no sinal" : `sinal de ${formatBRL(reserva.sinal.cents)} por Pix, o resto no local`) : "pago no local"}</span>
                    </>
                  ) : (
                    <span className="text-[#5C5747]">a combinar com {name}</span>
                  )}
                </dd>
              </div>
              {!onde && (
                <div className="flex gap-2.5">
                  <dt className={cn(ROTULO, "w-16 shrink-0")}>onde</dt>
                  <dd>{[name, city].filter(Boolean).join(" · ")}</dd>
                </div>
              )}
            </dl>
          </div>
          <div className="h-px bg-[repeating-linear-gradient(to_right,#D5D0C1_0_6px,transparent_6px_12px)]" />
          <div className="flex flex-col gap-3.5 p-5">
            {/* O caminho até o horário confirmado, com o passo de agora em destaque: o cliente vê
                o que já está feito, a única coisa que falta e quem faz o resto */}
            <ol className="flex flex-col" aria-label="O que falta para o horário ficar confirmado">
              <Passo estado="feito" ultimo={false}>
                <span className="font-semibold">Horário guardado</span>
                <span className="text-[13px] text-[#5C5747]">ninguém mais marca este horário{reserva.sinal ? " enquanto o prazo do sinal corre" : ""}</span>
              </Passo>
              <Passo estado="agora" ultimo={false}>
                {reserva.sinal ? (
                  // o horário fica segurado até o prazo; o salão confere no banco e confirma
                  <>
                    <span className="font-semibold">
                      Pague o sinal de <span className={MONO}>{formatBRL(reserva.sinal.cents)}</span> até <span className={MONO}>{formatTime(new Date(reserva.sinal.ate), fuso)}</span>
                    </span>
                    <span className="text-[13px] text-[#5C5747]">Sem o sinal até esse horário, ele é liberado para outra pessoa.</span>
                    <div className="mt-2">
                      <PixQr recebedor={reserva.sinal.pix} valorCents={reserva.sinal.cents} txid={reserva.sinal.txid} ate={reserva.sinal.ate} mensagem={`Sinal do horário de ${longDate(date)}, às ${hora}, em ${name}`} ajuda={`Fale com ${name} para combinar o pagamento.`}>
                        {phone && (
                          <a
                            href={linkWhatsApp(phone, `Olá! Paguei o sinal de ${formatBRL(reserva.sinal.cents)} do meu horário de ${longDate(date)}, às ${hora} (${servicos}). Meu nome é ${customerName.trim()}. Segue o comprovante.`) ?? undefined}
                            target="_blank"
                            rel="noreferrer"
                            className="flex min-h-11 items-center justify-center rounded-lg bg-[#17150F] px-4 py-2 text-center text-sm font-semibold text-[#FAF9F5]"
                          >
                            Enviar comprovante para {name}
                          </a>
                        )}
                      </PixQr>
                    </div>
                  </>
                ) : (
                  // "seu" deixa claro que o número mostrado é o do cliente, não o do negócio
                  <>
                    <span className="font-semibold">{name} confirma pelo seu WhatsApp</span>
                    <span className={cn(MONO, "text-[13px] text-[#5C5747]")}>{customerPhone}</span>
                  </>
                )}
              </Passo>
              <Passo estado="depois" ultimo>
                <span className="font-semibold text-[#5C5747]">{reserva.sinal ? `${name} confere o pagamento e confirma` : "Horário confirmado"}</span>
              </Passo>
            </ol>
            {/* o recado é do dono (texto puro, quebras de linha mantidas) */}
            {recadoDono && <p className="text-[15px] leading-relaxed whitespace-pre-line break-words">{recadoDono}</p>}
            {avisoUrl && (
              <div className="flex flex-col gap-2">
                <a
                  href={avisoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-[50px] items-center justify-center gap-2.5 rounded-[10px] border border-[#D5D0C1] bg-white text-[15px] font-semibold text-[#17150F] hover:border-[#17150F]"
                >
                  <Zap />
                  Mandar o resumo no WhatsApp
                </a>
                <p className="text-center text-xs text-[#5C5747]">Opcional: o pedido já chegou para {name}.</p>
              </div>
            )}
          </div>
        </div>

        {rotas && (
          <section aria-labelledby="como-chegar" className={cn(PAINEL, "overflow-hidden")}>
            {/* o mapa é a incorporação pública do Google: sem chave, e só carrega aqui, depois de agendar */}
            <iframe
              src={rotas.embed}
              title={`Mapa: ${onde}`}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="block h-44 w-full border-0 bg-[#E9E6DB]"
            />
            <div className="flex flex-col gap-3.5 p-5">
              <div className="flex flex-col gap-1">
                <h2 id="como-chegar" className={ROTULO}>como chegar</h2>
                {address ? (
                  <>
                    <p className="text-[16px] leading-snug font-semibold">{address}</p>
                    <p className="text-[13px] text-[#5C5747]">{[bairro, cidadeUf].filter(Boolean).join(" · ")}</p>
                  </>
                ) : (
                  <>
                    <p className="text-[16px] leading-snug font-semibold">{[bairro, cidadeUf].filter(Boolean).join(" · ")}</p>
                    <p className="text-[13px] text-[#5C5747]">O endereço exato: confirme com {name} pelo WhatsApp.</p>
                  </>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={rotas.google}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-11 items-center justify-center gap-2 rounded-[10px] border border-[#D5D0C1] bg-white text-sm font-semibold hover:border-[#17150F]"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" />
                    <circle cx="12" cy="9" r="2.5" />
                  </svg>
                  Google Maps
                </a>
                <a
                  href={rotas.waze}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-11 items-center justify-center gap-2 rounded-[10px] border border-[#D5D0C1] bg-white text-sm font-semibold hover:border-[#17150F]"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 11l18-8-8 18-2-8-8-2z" />
                  </svg>
                  Waze
                </a>
              </div>
              <button
                type="button"
                onClick={() =>
                  navigator.clipboard.writeText(onde).then(
                    () => setCopiado(true),
                    () => {},
                  )
                }
                className="h-10 text-[13px] font-semibold underline underline-offset-4"
              >
                <span aria-live="polite">{copiado ? "Endereço copiado" : "Copiar endereço"}</span>
              </button>
            </div>
          </section>
        )}

        {/* sem telefone do negócio não há como desmarcar por aqui: o quadro não aparece vazio */}
        {desmarcar && (
        <div className="flex flex-col gap-2.5 rounded-xl border border-[#E4E1D5] bg-[#F6F4EB] p-4">
          <p className={ROTULO}>precisa desmarcar ou mudar?</p>
          <p className="text-xs leading-relaxed text-[#5C5747]">Avisar cedo libera o horário para outra pessoa.</p>
          {desmarcar && (
            <a
              href={desmarcar}
              target="_blank"
              rel="noreferrer"
              className="flex h-11 items-center justify-center rounded-[10px] border border-[#D5D0C1] bg-white text-sm font-semibold hover:border-[#17150F]"
            >
              Falar com {name} no WhatsApp
            </a>
          )}
        </div>
        )}
        <button type="button" onClick={() => location.reload()} className="h-11 text-sm font-semibold underline underline-offset-4">
          Fazer outro agendamento
        </button>
        <div className="flex-1" />
        {/* Útil para poucos: fica no rodapé, sem disputar com falar com o negócio */}
        <p className="flex items-center justify-center gap-1.5 text-xs text-[#5C5747]">
          Salvar na agenda:
          <button type="button" onClick={salvarNaAgenda} className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-[#17150F]">
            celular
          </button>
          <span aria-hidden="true">·</span>
          <a href={linkGoogleAgenda(compromisso)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-[#17150F]">
            Google Agenda
          </a>
        </p>
        <Rodape />
      </main>
    );
  }

  // ---------- agenda ainda não montada ----------
  // Sem isso a página fica um beco sem saída: quem veio marcar horário lê
  // "nenhum serviço" e não tem para onde ir — nem de volta ao site, nem para o
  // WhatsApp da casa.
  if (!services.length) {
    const falar = linkWhatsApp(phone, `Olá! Quero marcar um horário no ${name}.`);
    return (
      <main className="mx-auto flex w-full max-w-[420px] flex-1 flex-col gap-4 bg-[#F2F0E7] p-4 py-6 text-[#17150F]">
        <Cabecalho tenantId={tenantId} temSite={temSite} siteUrl={siteUrl} name={name} rating={rating} reviews={reviews} city={city} phone={phone} />
        <div className={cn(PAINEL, "flex flex-col gap-4 p-5")}>
          <p className={cn("text-[11px] font-medium tracking-[0.16em] text-[#6B6555] uppercase", MONO)}>agenda online ainda fechada</p>
          <p className="text-sm leading-relaxed text-[#5C5747]">
            {name} ainda não abriu os horários aqui. Para marcar, fale direto — responde no WhatsApp o dia inteiro.
          </p>
          {falar && (
            <a
              href={falar}
              target="_blank"
              rel="noreferrer"
              className="flex h-[50px] items-center justify-center gap-2.5 rounded-[10px] bg-[#2C6A53] text-[15px] font-semibold text-[#FAF9F5] hover:bg-[#245743]"
            >
              <Zap />
              Falar no WhatsApp
            </a>
          )}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
              "/" no subdomínio do cliente é o site estático que o proxy entrega,
              não uma rota do app: Link tentaria navegar por dentro do Next. */}
          <a href="/" className="flex h-12 items-center justify-center rounded-[10px] border border-[#D5D0C1] bg-white text-sm font-semibold">
            Ver o site
          </a>
        </div>
        <div className="flex-1" />
        <Rodape />
      </main>
    );
  }

  const depoisDoTomado = tomado ? livres.filter((v) => `${v.date} ${v.hora}` > `${tomado.date} ${tomado.hora}`) : [];
  const proximos = (depoisDoTomado.length ? depoisDoTomado : livres).slice(0, 3);
  // o servidor diz por que não marcou: ocupado agora, ou serviço/profissional que saiu
  const ocupou = !!tomado?.msg.startsWith("Esse horário");
  const fecharSe = (qual: typeof folha) => () => setFolha((f) => (f === qual ? null : f));
  const quemTexto = escolhido ? `Com ${escolhido.name.split(" ")[0]}` : "Qualquer profissional";
  const zapEncaixe = linkWhatsApp(
    phone,
    `Olá! Queria um horário para ${escolhidos.map((s) => s.name).join(" + ")}${escolhido ? ` com ${escolhido.name}` : ""} na semana de ${longDate(from)}. Não achei vaga no site. Tem encaixe?`,
  );

  // Semana sem nenhum horário: as saídas no lugar dos horários (aqui e na folha "outro dia")
  const semVaga = (
    <div className="flex flex-col gap-2.5">
      <p className="text-[15px] font-semibold">Semana cheia{escolhido ? ` com ${escolhido.name.split(" ")[0]}` : ""}</p>
      <p className="-mt-1.5 text-[13px] text-[#5C5747]">
        Nenhum horário de {formatDuration(totalMin)} livre de {parte(from, { day: "numeric" })} a {parte(addDays(from, 6), { day: "numeric", month: "long" })}.
      </p>
      {temProxima && (
        <button type="button" onClick={() => setFrom(proximaSemana)} className="flex min-h-14 items-center gap-3 rounded-[14px] bg-[#17150F] px-4 text-left text-[#FAF9F5]">
          <span className="flex-1 text-[15px] font-semibold">Ver a semana seguinte</span>
          <Seta />
        </button>
      )}
      {staffId && (
        <button type="button" onClick={() => setStaffId("")} className="flex min-h-14 items-center gap-3 rounded-[14px] border border-[#17150F] bg-white px-4 text-left">
          <span className="flex-1 text-[15px] font-semibold">Com qualquer profissional</span>
          <Seta />
        </button>
      )}
      {zapEncaixe && (
        <a href={zapEncaixe} target="_blank" rel="noreferrer" className="flex min-h-14 items-center gap-3 rounded-[14px] border border-[#D5D0C1] bg-white px-4">
          <Zap className="text-[#2C6A53]" />
          <span className="flex-1 text-[15px] font-semibold">Pedir um encaixe no WhatsApp</span>
        </a>
      )}
    </div>
  );

  const erroCarga = erroAgenda && (
    <div role="alert" className="flex items-center gap-3 rounded-[10px] border border-[#E7C9BF] bg-[#FBF1EE] p-3 text-sm text-[#B4472F]">
      <span className="flex-1">Não foi possível carregar os horários.</span>
      <button type="button" onClick={() => setVersao((v) => v + 1)} className="h-11 shrink-0 rounded-[10px] border border-[#E7C9BF] bg-white px-3 font-semibold">
        Tentar de novo
      </button>
    </div>
  );

  // O bloco de horários, logo abaixo do último serviço marcado: os 3 mais cedo e as saídas
  const bloco = (
    <li id="mais-cedo" className="scroll-mt-4 border-b border-[#EEEAE1] px-3 pt-1 pb-3.5 last:border-b-0">
      <div className="flex flex-col gap-2.5 rounded-xl bg-[#F6F4EE] p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 flex-col">
            <span className="text-[13px] font-semibold">{from === today ? "Mais cedo possível" : "Primeiros livres"}{escolhidos.length > 1 ? ` para os ${escolhidos.length}` : ""}</span>
            {escolhidos.length > 1 && <span className="text-xs text-[#5C5747]">{formatDuration(totalMin)} no total, um depois do outro</span>}
          </span>
          {profissionais.length > 1 && (
            <button
              type="button"
              onClick={() => setFolha("quem")}
              aria-label={`Profissional: ${escolhido?.name ?? "qualquer um"}. Trocar`}
              className="flex h-11 max-w-[50%] shrink-0 items-center gap-1 rounded-full border border-[#D5D0C1] bg-white px-3 text-[13px]"
            >
              <span className="truncate">{escolhido ? escolhido.name.split(" ")[0] : "Qualquer um"}</span>
              <Seta d="m6 9 6 6 6-6" size={14} />
            </button>
          )}
        </div>
        {erroCarga}
        <p className="sr-only" aria-live="polite">
          {!agenda ? "Buscando horários" : semanaCheia ? "Nenhum horário livre nesta semana" : `Horários mais cedo: ${livres.slice(0, 3).map((v) => `${rotuloDia(v.date, today)} ${v.hora}`).join(", ")}`}
        </p>
        {!agenda ? (
          <div className="grid grid-cols-3 gap-2" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-[#E9E5DA] motion-reduce:animate-none" />
            ))}
          </div>
        ) : semanaCheia ? (
          semVaga
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {livres.slice(0, 3).map((v) => (
              <button
                key={`${v.date}${v.hora}`}
                type="button"
                onClick={() => abrirConfirmar(v)}
                className="flex h-14 min-w-0 flex-col items-center justify-center rounded-xl border border-[#17150F] bg-white"
              >
                <span className="text-xs text-[#5C5747]">{rotuloDia(v.date, today)}</span>
                <span className={cn(MONO, "text-base font-semibold")}>{v.hora}</span>
              </button>
            ))}
          </div>
        )}
        {!semanaCheia && (
          <button type="button" onClick={() => setFolha("quando")} className="flex min-h-11 items-center justify-between text-left text-sm font-medium">
            Outro dia ou horário
            <Seta />
          </button>
        )}
      </div>
    </li>
  );

  // ---------- página: serviço e horário na mesma tela, 3 toques ----------
  const ultimoNomes = ultimoValido ? services.filter((s) => ultimoValido.serviceIds.includes(s.id)).map((s) => s.name).join(" + ") : "";
  const ultimoQuem = ultimoValido ? staff.find((p) => p.id === ultimoValido.staffId) : undefined;
  const ultimoSel = ultimoValido && [...ultimoValido.serviceIds].sort().join() === [...serviceIds].sort().join();
  const ultimoServ = escolhidos.at(-1)?.id;
  const filtrados = profissionais.filter((p) => !busca.trim() || p.name.toLocaleLowerCase("pt-BR").includes(busca.trim().toLocaleLowerCase("pt-BR")));
  // ordem da folha "com quem": o do último atendimento, depois quem tem horário mais cedo nesta semana
  const primeiroDe = (id: string) => {
    const i = livres.findIndex((v) => v.staffId === id);
    return i < 0 ? Infinity : i;
  };
  const ordenados = [...filtrados].sort((a, b) => Number(b.id === ultimoValido?.atendeu) - Number(a.id === ultimoValido?.atendeu) || primeiroDe(a.id) - primeiroDe(b.id));

  return (
    <main className="min-h-dvh w-full bg-[#F2F0E7] p-4 pb-[max(7rem,env(safe-area-inset-bottom))] text-[#17150F] sm:py-8">
      <div className="mx-auto flex w-full max-w-[480px] flex-col gap-3.5">
        <Cabecalho tenantId={tenantId} temSite={temSite} siteUrl={siteUrl} name={name} rating={rating} reviews={reviews} city={city} phone={phone} />

        {ultimoValido && lembrado && !ultimoSel && (
          <button
            type="button"
            onClick={() => {
              mostrarBloco.current = true;
              escolherServicos(ultimoValido.serviceIds, ultimoValido.staffId);
            }}
            className="flex min-h-16 items-center gap-3 rounded-[14px] bg-[#17150F] px-3.5 py-2.5 text-left text-[#FAF9F5]"
          >
            <Seta d="M4 12a8 8 0 0 1 14-5.3M20 4v4h-4M20 12a8 8 0 0 1-14 5.3M4 20v-4h4" size={20} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-xs text-[#CFC8B9]">Olá, {customerName.split(" ")[0]} · repetir o último?</span>
              <span className="truncate text-[15px] font-semibold">
                {ultimoNomes}
                {ultimoQuem ? ` com ${ultimoQuem.name.split(" ")[0]}` : ""}
              </span>
            </span>
            <Seta size={18} />
          </button>
        )}

        <section aria-labelledby="oque" className="flex flex-col gap-2">
          <div className="flex flex-col px-1">
            <h2 id="oque" className="text-[17px] font-semibold tracking-[-0.02em]">
              O que você quer fazer?
            </h2>
            {services.length > 1 && limites.maxServicos > 1 && (
              <span className="text-xs text-[#5C5747]">
                {escolhidos.length ? `${escolhidos.length} de ${limites.maxServicos} escolhidos` : `pode escolher até ${limites.maxServicos}`}
              </span>
            )}
          </div>
          <ul className="flex flex-col overflow-hidden rounded-2xl border border-[#E2DDD3] bg-white">
            {services.map((s) => {
              const sel = serviceIds.includes(s.id);
              const fora = !!travado(s);
              return (
                <Fragment key={s.id}>
                  <li className="border-b border-[#EEEAE1] last:border-b-0">
                    <button
                      type="button"
                      aria-pressed={sel}
                      aria-disabled={fora || undefined}
                      onClick={() => toggleService(s.id)}
                      className={cn("flex min-h-16 w-full items-center gap-3 py-2.5 pr-3 pl-4 text-left", fora && "opacity-45")}
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className={cn("text-base break-words", sel ? "font-semibold" : "font-medium")}>{s.name}</span>
                        <span className="text-[13px] text-[#5C5747]">{[formatDuration(s.durationMin), precoDe(s)].filter(Boolean).join(" · ")}</span>
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn("flex size-11 shrink-0 items-center justify-center rounded-full", sel ? "bg-[#17150F] text-[#FAF9F5]" : "border border-[#D5D0C1] bg-white")}
                      >
                        <Seta d={sel ? "m5 12.5 4.5 4.5L19 7.5" : "M12 5v14M5 12h14"} size={20} />
                      </span>
                    </button>
                  </li>
                  {s.id === ultimoServ && bloco}
                </Fragment>
              );
            })}
          </ul>
          {avisoLimite && <p role="status" className="px-1 text-[13px] font-medium text-[#8A3B12]">{avisoLimite}</p>}
          {!escolhidos.length && <p className="px-1 text-[13px] text-[#5C5747]">Toque num serviço e os horários mais cedo aparecem logo abaixo dele.</p>}
        </section>

        <Rodape />
      </div>

      {/* A lista é longa e o bloco de horários saiu da tela: o atalho fica no alcance do dedo */}
      {escolhidos.length > 0 && !blocoVisivel && !folha && (
        <button
          type="button"
          onClick={() => document.getElementById("mais-cedo")?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}
          className="fixed inset-x-4 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-10 mx-auto flex h-14 max-w-[448px] items-center gap-2.5 rounded-full bg-[#17150F] pr-2 pl-5 text-left text-[#FAF9F5] shadow-[0_10px_28px_rgba(23,21,15,0.28)]"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[15px] font-semibold">
              {escolhidos.length > 1 ? `${escolhidos.length} serviços` : escolhidos[0].name} · {formatDuration(totalMin)}
            </span>
            {total && <span className="truncate text-xs text-[#CFC8B9]">{total}{valorSinal > 0 ? ` · sinal ${formatBRL(valorSinal)}` : ""}</span>}
          </span>
          <span className="flex h-10 shrink-0 items-center gap-1 rounded-full bg-[#F2F0E7] px-3.5 text-sm font-semibold text-[#17150F]">
            Ver horários
            <Seta d="m6 15 6-6 6 6" size={14} />
          </span>
        </button>
      )}

      {/* ---------- com quem ---------- */}
      <Folha aberta={folha === "quem"} aoFechar={fecharSe("quem")} titulo="Com quem">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-col">
            <h2 data-titulo tabIndex={-1} className="text-lg font-semibold outline-none">Com quem?</h2>
            <span className="text-[13px] text-[#5C5747]">{escolhidos.map((s) => s.name).join(" + ")} · só quem faz</span>
          </div>
          <Fechar onClick={() => setFolha(null)} />
        </div>
        {profissionais.length > 6 && (
          <Input type="search" aria-label="Buscar profissional" placeholder="Buscar pelo nome" value={busca} onChange={(e) => setBusca(e.target.value)} className={CAMPO} />
        )}
        <ul className="flex flex-col gap-2">
          {!busca.trim() && (
            <li>
              <BotaoPessoa sel={!staffId} nome="Qualquer profissional" detalhe="quem estiver livre mais cedo" onClick={() => (setStaffId(""), setEscolha(null), setFolha(null))} />
            </li>
          )}
          {ordenados.map((p) => (
            <li key={p.id}>
              <BotaoPessoa
                sel={staffId === p.id}
                nome={p.name}
                iniciais={iniciais(p.name)}
                detalhe={p.id === ultimoValido?.atendeu ? "seu último atendimento" : undefined}
                onClick={() => (setStaffId(p.id), setEscolha(null), setFolha(null))}
              />
            </li>
          ))}
          {!ordenados.length && <li className="py-3 text-sm text-[#5C5747]">Ninguém com esse nome faz {escolhidos.length > 1 ? "esses serviços" : "esse serviço"}.</li>}
        </ul>
      </Folha>

      {/* ---------- outro dia ou horário ---------- */}
      <Folha aberta={folha === "quando"} aoFechar={fecharSe("quando")} titulo="Outro dia ou horário">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-col">
            <h2 data-titulo tabIndex={-1} className="text-lg font-semibold outline-none">Quando?</h2>
            <span className="text-[13px] text-[#5C5747]">
              {escolhidos.map((s) => s.name).join(" + ")} · {formatDuration(totalMin)} · {quemTexto.toLowerCase()}
            </span>
          </div>
          <Fechar onClick={() => setFolha(null)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold first-letter:uppercase">
              {parte(from, { day: "numeric" })} a {parte(addDays(from, 6), { day: "numeric", month: "long" })}
            </span>
            <div className="flex gap-1">
              <button type="button" aria-label="Semana anterior" disabled={from <= today} onClick={() => setFrom(from <= addDays(today, 7) ? today : addDays(from, -7))} className="flex size-11 items-center justify-center rounded-full disabled:text-[#B5AE9F]">
                <Seta d="m15 6-6 6 6 6" size={18} />
              </button>
              <button type="button" aria-label="Próxima semana" disabled={!temProxima} onClick={() => setFrom(proximaSemana)} className={cn("flex size-11 items-center justify-center rounded-full disabled:text-[#B5AE9F]", semanaCheia ? "bg-[#17150F] text-[#FAF9F5]" : "border border-[#D5D0C1]")}>
                <Seta size={18} />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1 min-[360px]:gap-1.5">
            {(agenda ?? Array.from({ length: 7 }, (_, i): Dia => ({ date: addDays(from, i), horarios: [] }))).map((d) => {
              const sel = d.date === date && !!agenda;
              const n = d.horarios.length;
              const status = !agenda ? "…" : d.fechado ? "fech." : n ? <>{n}<span className="hidden sm:inline"> {n > 1 ? "livres" : "livre"}</span></> : "cheio";
              return (
                <button
                  key={d.date}
                  type="button"
                  aria-pressed={sel}
                  disabled={!agenda || !n}
                  onClick={() => setDate(d.date)}
                  aria-label={`${longDate(d.date)}, ${!agenda ? "carregando" : d.fechado ? "fechado" : n ? `${n} horários livres` : "sem horário livre"}`}
                  className={cn(
                    "flex min-h-[68px] min-w-0 flex-col items-center justify-center gap-1 rounded-xl border px-0",
                    sel ? "border-[#17150F] bg-[#17150F] text-[#FAF9F5]" : d.fechado ? "border-dashed border-[#CFC8B9] text-[#6E6756]" : n ? "border-[#E2DDD3] bg-white" : "border-[#E2DDD3] bg-[#F6F4EE] text-[#6E6756]",
                  )}
                >
                  <span className="text-[11px] uppercase">{d.date === today ? "hoje" : parte(d.date, { weekday: "short" })}</span>
                  <span className={cn(MONO, "text-lg leading-none")}>{parte(d.date, { day: "numeric" })}</span>
                  <span className={cn("text-[10px] font-semibold whitespace-nowrap", sel ? "text-[#9FD1B4]" : n ? "text-[#2E6B4E]" : "")}>{status}</span>
                </button>
              );
            })}
          </div>
          {agenda && !semanaCheia && <p className="text-xs text-[#5C5747] sm:hidden">Embaixo de cada dia, quantos horários livres.</p>}
        </div>
        {erroCarga}
        <p className="sr-only" aria-live="polite">
          {!agenda ? "Buscando horários" : semanaCheia ? "Nenhum horário livre nesta semana" : dia?.horarios.length ? `${dia.horarios.length} horários livres em ${longDate(date)}` : ""}
        </p>
        {!agenda ? (
          <div className="grid grid-cols-4 gap-2" aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="h-11 animate-pulse rounded-xl bg-[#EDEAE0] motion-reduce:animate-none" />
            ))}
          </div>
        ) : semanaCheia ? (
          <div className="rounded-2xl bg-[#F6F4EE] p-4">{semVaga}</div>
        ) : (
          <div className="flex flex-col gap-3.5">
            {PERIODOS.map((p, i) => {
              const horas = (dia?.horarios ?? []).filter((h) => h.hora < p.ate && (i === 0 || h.hora >= PERIODOS[i - 1].ate));
              if (!horas.length) return null;
              return (
                <div key={p.nome} className="flex flex-col gap-2">
                  <span className="text-[13px] font-semibold">
                    {p.nome} <span className="font-normal text-[#5C5747]">· {horas.length} {horas.length > 1 ? "livres" : "livre"}</span>
                  </span>
                  <div className="grid grid-cols-4 gap-2">
                    {horas.map((h) => (
                      <button key={h.hora} type="button" onClick={() => abrirConfirmar({ date, ...h })} className={cn(MONO, "h-11 rounded-xl border border-[#E2DDD3] text-[15px] hover:border-[#17150F]")}>
                        {h.hora}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-2.5">
          <label htmlFor="outra-data" className="text-[13px] text-[#5C5747]">
            Ir para a data
          </label>
          <Input
            id="outra-data"
            type="date"
            value={from}
            min={today}
            max={addDays(today, MAX_DAYS_AHEAD)}
            onChange={(e) => {
              // no computador dá para digitar qualquer ano: fora do intervalo, não busca
              const v = e.target.value;
              if (!v || v < today || v > addDays(today, MAX_DAYS_AHEAD)) return;
              setFrom(v);
              setDate(v);
            }}
            className={cn(CAMPO, MONO, "h-11 w-auto text-[13px]")}
          />
        </div>
      </Folha>

      {/* ---------- confirmar ---------- */}
      <Folha aberta={folha === "confirmar"} aoFechar={fecharSe("confirmar")} titulo="Confirmar agendamento" bloqueada={busy}>
        {tomado ? (
          <>
            <div role="alert" className="flex gap-3 rounded-[14px] bg-[#F6EBD3] p-3.5 text-[#4F3A10]">
              <Seta d="M12 7.5V12l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0" size={22} />
              <span className="flex flex-col gap-0.5">
                <h2 data-titulo tabIndex={-1} className="text-base font-semibold outline-none">
                  {ocupou ? `${rotuloDia(tomado.date, today)} ${tomado.hora} acabou de ser marcado` : tomado.msg}
                </h2>
                <span className="text-sm">{ocupou ? "Alguém confirmou antes. " : ""}Nada foi cobrado. Escolha outro:</span>
              </span>
            </div>
            <div className="flex flex-col gap-2" aria-live="polite">
              <span className="text-[13px] font-semibold">Próximos livres · {escolhidos.map((s) => s.name).join(" + ")}</span>
              {!agenda ? (
                [0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-[#EDEAE0] motion-reduce:animate-none" aria-hidden="true" />)
              ) : (
                proximos.map((v) => {
                    const quem = staff.find((p) => p.id === v.staffId);
                    return (
                      <button
                        key={`${v.date}${v.hora}`}
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setTomado(null);
                          setDate(v.date);
                          setEscolha({ hora: v.hora, staffId: v.staffId });
                          confirmar(v);
                        }}
                        className="flex min-h-14 items-center gap-3 rounded-xl border border-[#17150F] px-3.5 text-left"
                      >
                        <span className={cn(MONO, "w-14 text-[17px] font-semibold")}>{v.hora}</span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="text-sm font-medium first-letter:uppercase">{longDate(v.date)}</span>
                          <span className="truncate text-[13px] text-[#5C5747]">{quem && staffId ? `Com ${quem.name.split(" ")[0]}` : "Com quem estiver livre"}</span>
                        </span>
                        <span className="text-sm font-semibold">Pegar</span>
                      </button>
                    );
                  })
              )}
              {agenda && !livres.length && semVaga}
            </div>
            <button type="button" onClick={() => (setTomado(null), setFolha("quando"))} className="flex min-h-11 items-center justify-between text-sm font-medium">
              Ver outros dias
              <Seta />
            </button>
          </>
        ) : (
          escolha && (
            <>
              <div className="flex items-center gap-3">
                <div className="flex w-[52px] shrink-0 flex-col items-center rounded-xl bg-[#17150F] py-1.5 text-[#FAF9F5]">
                  <span className="text-[11px] uppercase">{date === today ? "hoje" : parte(date, { weekday: "short" })}</span>
                  <span className={cn(MONO, "text-[22px] leading-none")}>{parte(date, { day: "numeric" })}</span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <h2 data-titulo tabIndex={-1} className="text-lg leading-tight font-semibold outline-none">
                    {escolhidos.map((s) => s.name).join(" + ")} · {escolha.hora} – {fimDe(date, escolha.hora, totalMin)}
                  </h2>
                  <span className="text-[13px] text-[#5C5747] first-letter:uppercase">
                    {longDate(date)} · {staffId && atendente ? `com ${atendente.name}` : "com quem estiver livre"}
                  </span>
                </div>
                <button type="button" disabled={busy} onClick={() => setFolha(null)} className="min-h-11 shrink-0 px-1 text-sm font-medium underline underline-offset-[3px]">
                  Trocar
                </button>
              </div>

              {valorSinal > 0 && sinal ? (
                <div className="flex flex-col gap-2 rounded-[14px] bg-[#F6F4EE] px-3.5 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-semibold">
                      <span className="rounded-md bg-[#E3EFE8] px-2 py-0.5 text-xs font-semibold text-[#1F5A3E]">Pix</span>
                      Sinal agora{sinal.tipo === "percentual" ? ` (${textoDoSinal(sinal)})` : ""}
                    </span>
                    <span className="font-semibold">{formatBRL(valorSinal)}</span>
                  </div>
                  {valorSinal < precoEscolhido && (
                    <div className="flex justify-between gap-2">
                      <span className="text-[#5C5747]">Restante no local</span>
                      <span>{total.startsWith("a partir") ? "a partir de " : ""}{formatBRL(precoEscolhido - valorSinal)}</span>
                    </div>
                  )}
                </div>
              ) : total ? (
                <div className="flex justify-between gap-2 rounded-[14px] bg-[#F6F4EE] px-3.5 py-3 text-sm">
                  <span className="text-[#5C5747]">Pago no local</span>
                  <span className="font-semibold">{total}</span>
                </div>
              ) : null}
              {total.startsWith("a partir") && <p className="-mt-2 text-xs text-[#5C5747]">O valor final é combinado no local.</p>}

              {lembrado ? (
                <div className="flex items-center gap-3 rounded-[14px] border border-[#E2DDD3] px-3.5 py-3">
                  <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-full bg-[#EEEAE1] text-sm font-semibold", MONO)}>{iniciais(customerName)}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px] font-medium">{customerName}</span>
                    <span className={cn(MONO, "text-[13px] text-[#5C5747]")}>{customerPhone}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setLembrado(false);
                      setCustomerName("");
                      setCustomerPhone("");
                      setTouched({ name: false, phone: false, enviou: false });
                    }}
                    className="h-11 shrink-0 px-1 text-sm font-medium underline underline-offset-[3px]"
                  >
                    Não sou eu
                  </button>
                </div>
              ) : (
                <form
            id="contato-form"
            onSubmit={(e) => {
              e.preventDefault();
              confirmar();
            }}
            noValidate
            className="flex flex-col gap-3.5"
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor="customerName" className={ROTULO}>
                seu nome
              </label>
              <Input
                id="customerName"
                autoComplete="name"
                enterKeyHint="next"
                maxLength={80}
                placeholder="Como te chamam"
                value={customerName}
                onChange={(e) => {
                  setCustomerName(mascaraNome(e.target.value));
                  setSubmitError("");
                }}
                onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                aria-invalid={touched.name && !!errors.name}
                aria-describedby="nome-aviso"
                className={cn(CAMPO, touched.name && errors.name && "border-[#B4472F]", !errors.name && customerName && "border-[#2C6A53]")}
              />
              <p id="nome-aviso" aria-live="polite" className={cn(MONO, "min-h-4 text-[10px]", touched.name && errors.name ? "text-[#B4472F]" : "text-[#6B6555]")}>
                {touched.name && errors.name ? errors.name : !errors.name ? "tudo certo" : "como o negócio vai te chamar"}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="customerPhone" className={ROTULO}>
                whatsapp
              </label>
              <Input
                id="customerPhone"
                type="tel"
                inputMode="numeric"
                enterKeyHint="done"
                autoComplete="tel-national"
                placeholder="(11) 91234-5678"
                value={customerPhone}
                onChange={(e) => {
                  setCustomerPhone(formatPhone(e.target.value));
                  setSubmitError("");
                  // Valida enquanto digita assim que o número fica completo
                  if (e.target.value.replace(/\D/g, "").length >= 10) setTouched((t) => ({ ...t, phone: true }));
                }}
                onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
                aria-invalid={foneInvalido}
                aria-describedby="tel-aviso"
                className={cn(
                  CAMPO,
                  MONO,
                  foneInvalido && "border-[#B4472F]",
                  !errors.phone && customerPhone && "border-[#2C6A53]",
                )}
              />
              <p
                id="tel-aviso"
                aria-live="polite"
                className={cn(
                  MONO,
                  "min-h-4 text-[10px]",
                  foneInvalido
                    ? "text-[#B4472F]"
                    : !errors.phone && customerPhone
                      ? "text-[#2C6A53]"
                      : "text-[#6B6555]",
                )}
              >
                {faltamDigitos(customerPhone) ||
                  (touched.phone && errors.phone ? errors.phone : !errors.phone && customerPhone ? "número válido" : "é por aqui que o negócio confirma")}
              </p>
            </div>
          </form>
              )}

              {submitError && (
                <p role="alert" className="rounded-[10px] border border-[#E7C9BF] bg-[#FBF1EE] p-3 text-sm text-[#B4472F]">
                  {submitError}
                </p>
              )}

              {/* com o formulário aberto, o botão é o envio dele: "↵"/"ok" no teclado confirma */}
              <button
                type={lembrado ? "button" : "submit"}
                form={lembrado ? undefined : "contato-form"}
                onClick={lembrado ? () => confirmar() : undefined}
                disabled={busy}
                className={cn(PRIMARIO, "h-14 rounded-[14px] text-base")}
              >
                {busy ? "Reservando…" : valorSinal > 0 ? `Confirmar e pagar ${formatBRL(valorSinal)} no Pix` : `Confirmar às ${escolha.hora}`}
              </button>
              <p className="-mt-1.5 text-center text-xs text-[#5C5747]">
                {valorSinal > 0 && sinal
                  ? `O horário fica guardado por ${sinal.prazoMin >= 60 ? `${Math.round(sinal.prazoMin / 60)} h` : `${sinal.prazoMin} min`} para o Pix${valorSinal < precoEscolhido ? " · o resto no local" : ""}. Sem cadastro.`
                  : `${name} confirma pelo seu WhatsApp. Sem cadastro e sem pagar nada agora.`}
              </p>
            </>
          )
        )}
      </Folha>
    </main>
  );
}

function BotaoPessoa({ sel, nome, detalhe, iniciais, onClick }: { sel: boolean; nome: string; detalhe?: string; iniciais?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={sel}
      onClick={onClick}
      className={cn("flex min-h-14 w-full items-center gap-3 rounded-[14px] border px-3 text-left", sel ? "border-[#17150F] bg-[#F6F4EE]" : "border-[#E2DDD3] bg-white")}
    >
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold", iniciais ? "bg-[#EEEAE1]" : "bg-[#17150F] text-[#FAF9F5]")}>
        {iniciais ?? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="9" cy="8" r="3.2" />
            <path d="M3.5 19c.6-3 3-4.8 5.5-4.8s4.9 1.8 5.5 4.8" />
            <circle cx="17" cy="9" r="2.6" />
            <path d="M15.5 14.4c2.3.1 4.2 1.7 4.7 4.6" />
          </svg>
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-medium">{nome}</span>
        {detalhe && <span className="text-[13px] text-[#5C5747]">{detalhe}</span>}
      </span>
      {sel && <Seta d="m5 12.5 4.5 4.5L19 7.5" size={20} />}
    </button>
  );
}
