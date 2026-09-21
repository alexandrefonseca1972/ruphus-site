"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  addDays,
  formatBRL,
  formatDuration,
  formatLongDate,
  formatPhone,
  linkWhatsApp,
  MAX_DAYS_AHEAD,
  phoneError,
  TIMEZONE,
  zonedTime,
} from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { createBooking, getAgenda } from "./actions";

type Props = {
  tenantId: string;
  today: string;
  name: string;
  phone: string | null;
  rating?: number | null;
  reviews?: number | null;
  city?: string | null;
  services: { id: string; name: string; durationMin: number; priceCents: number }[];
  staff: { id: string; name: string; serviceIds: string[]; workDays: number[] }[];
};

type Dia = { date: string; horarios: { hora: string; staffId: string }[] };

const CONTACT_KEY = "siteflow:contato"; // lembrado só neste navegador

// A mesma paleta dos sites dos negócios e da tela de entrada: esta página é a
// vitrine do cliente, não o painel.
const ROTULO = "font-[family-name:var(--font-geist-mono)] text-[9px] font-medium tracking-[0.14em] text-[#6B6555] uppercase";
const MONO = "font-[family-name:var(--font-geist-mono)]";
const PAINEL = "rounded-[14px] border border-[#E0DCCE] bg-[#FAF9F5]";
const CAMPO =
  "h-12 rounded-[10px] border-[#D5D0C1] bg-white px-3.5 text-[15px] text-[#17150F] focus-visible:border-[#17150F] focus-visible:ring-[3px] focus-visible:ring-[#17150F]/8";
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
const nameError = (v: string) => (!v.trim() ? "Informe seu nome" : v.trim().length < 2 ? "Nome muito curto" : "");
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

function Cabecalho({ name, rating, reviews, city, phone }: Pick<Props, "name" | "rating" | "reviews" | "city" | "phone">) {
  const falar = linkWhatsApp(phone, `Olá! Quero marcar um horário no ${name}.`);
  return (
    <header className={cn("flex items-center gap-3 p-3.5", PAINEL)}>
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-[#17150F] text-[12px] text-[#FAF9F5]", MONO)}>
        {iniciais(name)}
      </span>
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
    <p className={cn("flex items-center justify-center gap-2 text-[9px] tracking-[0.12em] text-[#6B6555] uppercase", MONO)}>
      ruphus · agenda deste negócio
    </p>
  );
}

export function BookingForm({ tenantId, today, name, phone, rating, reviews, city, services, staff }: Props) {
  // Nada vem marcado: quem agenda diz o que quer, e só então a agenda aparece.
  // Os serviços chegam do servidor na ordem do que mais se agenda.
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [staffId, setStaffId] = useState("");
  const [from, setFrom] = useState(today);
  const [versao, setVersao] = useState(0);
  const chave = `${serviceIds.join(",")}|${staffId}|${from}|${versao}`;
  const [buscado, setBuscado] = useState<{ para: string; dias: Dia[] } | null>(null);
  const agenda = buscado?.para === chave ? buscado.dias : null;
  const [date, setDate] = useState("");
  const [escolha, setEscolha] = useState<{ hora: string; staffId: string } | null>(null);
  const [etapa, setEtapa] = useState<"escolha" | "confirmar">("escolha");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [lembrado, setLembrado] = useState(false);
  const [touched, setTouched] = useState({ name: false, phone: false });
  const [slotError, setSlotError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [avisado, setAvisado] = useState(false);

  const escolhidos = services.filter((s) => serviceIds.includes(s.id));
  const totalMin = escolhidos.reduce((sum, s) => sum + s.durationMin, 0);
  const totalCents = escolhidos.reduce((sum, s) => sum + s.priceCents, 0);
  const fazTudo = (p: Props["staff"][number]) => serviceIds.every((id) => p.serviceIds.includes(id));
  const profissionais = staff.filter(fazTudo);
  const atendente = staff.find((p) => p.id === escolha?.staffId);
  const errors = { name: nameError(customerName), phone: phoneError(customerPhone) };
  const contatoOk = !errors.name && !errors.phone;
  const dia = agenda?.find((d) => d.date === date);

  // Contato lembrado da última reserva neste navegador
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CONTACT_KEY) ?? "null");
      if (saved?.name && saved?.phone) {
        setCustomerName(saved.name); // eslint-disable-line react-hooks/set-state-in-effect -- leitura única do localStorage
        setCustomerPhone(formatPhone(saved.phone));
        setLembrado(true);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!serviceIds.length) return;
    let atual = true;
    getAgenda({ tenantId, serviceIds, staffId, from })
      .catch(() => {
        if (atual) setSlotError("Não foi possível carregar os horários. Tente de novo.");
        return [] as Dia[];
      })
      .then((dias) => atual && setBuscado({ para: chave, dias }));
    return () => {
      atual = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- serviceIds e from já estão em chave
  }, [tenantId, staffId, chave]);

  // O primeiro dia com horário é o dia aberto: ninguém precisa caçar um que tenha vaga
  useEffect(() => {
    if (!agenda) return;
    if (agenda.some((d) => d.date === date && d.horarios.length)) return;
    setDate(agenda.find((d) => d.horarios.length)?.date ?? agenda[0]?.date ?? ""); // eslint-disable-line react-hooks/set-state-in-effect -- segue a agenda recebida
  }, [agenda, date]);

  function toggleService(id: string) {
    // Mantém a ordem do catálogo: "Corte + Barba", não a ordem dos cliques
    const ids = services.map((s) => s.id).filter((s) => (s === id ? !serviceIds.includes(id) : serviceIds.includes(s)));
    if (!ids.length) return; // sem serviço não há agenda para mostrar
    setServiceIds(ids);
    // O profissional escolhido pode não fazer o novo conjunto: volta para "qualquer"
    if (staffId && !ids.every((s) => staff.find((p) => p.id === staffId)?.serviceIds.includes(s))) setStaffId("");
    setEscolha(null);
    setSlotError("");
  }

  async function confirmar(avisou = false) {
    if (!escolha) return;
    setSubmitError("");
    setTouched({ name: true, phone: true });
    if (!contatoOk) return;
    setAvisado(avisou);
    setBusy(true);
    const result = await createBooking({
      tenantId,
      serviceIds,
      staffId: escolha.staffId,
      date,
      time: escolha.hora,
      customerName,
      customerPhone,
      avisou,
    })
      .catch(() => ({ ok: false as const, error: "Não foi possível confirmar agora. Verifique sua conexão e tente de novo." }))
      .finally(() => setBusy(false));
    if (!result.ok && "field" in result) return setSubmitError(result.error);
    if (result.ok) {
      try {
        localStorage.setItem(CONTACT_KEY, JSON.stringify({ name: customerName.trim(), phone: customerPhone }));
      } catch {}
      scrollTo({ top: 0 });
      return setDone(true);
    }
    // Horário tomado por outra pessoa: volta para a grade já atualizada
    setSlotError(result.error);
    setEscolha(null);
    setEtapa("escolha");
    setVersao((v) => v + 1);
    scrollTo({ top: 0 });
  }

  // O recado que o cliente leva no WhatsApp: é ele que avisa quem atende, então
  // sai pronto, com tudo que a casa precisa para achar o horário na agenda.
  const recado = (hora: string, quem?: string) =>
    linkWhatsApp(
      phone,
      [
        `Olá! Acabei de agendar pelo site do ${name}.`,
        "",
        escolhidos.map((s) => s.name).join(" + "),
        `${longDate(date)}, às ${hora}`,
        ...(quem ? [`com ${quem}`] : []),
        "",
        `Meu nome é ${customerName.trim()} (${customerPhone}).`,
      ].join("\n"),
    );

  // ---------- confirmado ----------
  if (done && escolha && atendente) {
    const avisoUrl = recado(escolha.hora, atendente.name);
    return (
      <main className="mx-auto flex w-full max-w-[420px] flex-1 flex-col gap-4 bg-[#F2F0E7] p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-[#17150F]">
        <div className={cn(PAINEL, "overflow-hidden shadow-[0_28px_50px_-34px_rgba(22,21,15,0.28)]")}>
          <div className="flex flex-col gap-4 p-5">
            <p className={cn("flex items-center gap-2 text-[9px] font-medium tracking-[0.16em] text-[#2C6A53] uppercase", MONO)} role="status">
              <span className="flex size-5 items-center justify-center rounded-full bg-[#2C6A53]">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FAF9F5" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 13l4 4L19 7" />
                </svg>
              </span>
              horário confirmado
            </p>
            <div className="flex flex-col gap-1">
              <h1 className="text-[28px] leading-[1.06] font-semibold tracking-[-0.03em] first-letter:uppercase">{longDate(date)}</h1>
              <p className={cn(MONO, "text-[21px]")}>
                {escolha.hora} — {fimDe(date, escolha.hora, totalMin)}
              </p>
            </div>
            <dl className="flex flex-col gap-1.5 text-[13px]">
              <div className="flex gap-2.5">
                <dt className={cn(ROTULO, "w-16 shrink-0")}>serviço</dt>
                <dd>
                  {escolhidos.map((s) => s.name).join(" + ")} · {formatDuration(totalMin)} · <span className={MONO}>{formatBRL(totalCents)}</span>
                </dd>
              </div>
              <div className="flex gap-2.5">
                <dt className={cn(ROTULO, "w-16 shrink-0")}>com</dt>
                <dd>{atendente.name}</dd>
              </div>
              <div className="flex gap-2.5">
                <dt className={cn(ROTULO, "w-16 shrink-0")}>onde</dt>
                <dd>{[name, city].filter(Boolean).join(" · ")}</dd>
              </div>
            </dl>
          </div>
          <div className="h-px bg-[repeating-linear-gradient(to_right,#D5D0C1_0_6px,transparent_6px_12px)]" />
          <div className="flex flex-col gap-3.5 p-5">
            <p className="text-[13px] leading-relaxed text-[#5C5747]">
              {!avisoUrl
                ? `${name} fala com você no WhatsApp que você informou (${customerPhone}).`
                : avisado
                  ? `O resumo abriu no WhatsApp de ${name}. Se a mensagem não foi enviada, mande de novo aqui.`
                  : `Falta avisar ${name}. Mande o resumo no WhatsApp para confirmarem o seu horário.`}
            </p>
            {avisoUrl && (
              <a
                href={avisoUrl}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  "flex h-[50px] items-center justify-center gap-2.5 rounded-[10px] text-[15px] font-semibold",
                  avisado
                    ? "border border-[#D5D0C1] bg-white text-[#17150F]"
                    : "bg-[#2C6A53] text-[#FAF9F5] hover:bg-[#245743]",
                )}
              >
                <Zap />
                {avisado ? "Mandar o resumo de novo" : "Avisar no WhatsApp"}
              </a>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-[#E4E1D5] bg-[#F6F4EB] p-4">
          <p className={cn(ROTULO, "mb-1.5")}>precisa desmarcar?</p>
          <p className="text-xs leading-relaxed text-[#5C5747]">
            Fale no WhatsApp {city ? `da casa` : "do estabelecimento"}. Avisar cedo libera o horário para outra pessoa.
          </p>
        </div>
        <button type="button" onClick={() => location.reload()} className="h-11 text-sm font-semibold underline underline-offset-4">
          Fazer outro agendamento
        </button>
        <div className="flex-1" />
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
        <Cabecalho name={name} rating={rating} reviews={reviews} city={city} phone={phone} />
        <div className={cn(PAINEL, "flex flex-col gap-4 p-5")}>
          <p className={cn("text-[9px] font-medium tracking-[0.16em] text-[#6B6555] uppercase", MONO)}>agenda online ainda fechada</p>
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

  const resumo = escolha && (
    <div className={cn(PAINEL, "flex flex-col gap-3 p-4 shadow-[0_28px_50px_-34px_rgba(22,21,15,0.28)]")}>
      <p className={ROTULO}>você está agendando</p>
      <div className="flex flex-col gap-0.5">
        <p className="text-[22px] leading-tight font-semibold tracking-[-0.025em] first-letter:uppercase">{longDate(date)}</p>
        <p className={cn(MONO, "text-[19px]")}>
          {escolha.hora} — {fimDe(date, escolha.hora, totalMin)}
        </p>
      </div>
      <span className="h-px bg-[#EDEAE0]" />
      <div className="flex items-center gap-2.5 text-[13px]">
        <span className="flex-1">
          {escolhidos.map((s) => s.name).join(" + ")}
          {atendente ? ` com ${atendente.name}` : ""}
        </span>
        <span className={cn(MONO, "font-medium")}>{formatBRL(totalCents)}</span>
      </div>
    </div>
  );

  // ---------- confirmar ----------
  if (etapa === "confirmar" && escolha) {
    const avisoUrl = recado(escolha.hora, atendente?.name);
    return (
      <main className="mx-auto flex w-full max-w-[420px] flex-1 flex-col gap-4 bg-[#F2F0E7] p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-[#17150F]">
        <button
          type="button"
          onClick={() => setEtapa("escolha")}
          className="flex h-11 items-center gap-2 self-start text-[13px] text-[#5C5747]"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Voltar aos horários
        </button>
        {resumo}

        {lembrado ? (
          <div className="flex items-center gap-3 rounded-xl border border-[#E4E1D5] bg-[#F6F4EB] p-3.5">
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-[#E7E3D6] text-[11px] text-[#5C5747]", MONO)}>
              {iniciais(customerName)}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm font-semibold">{customerName}</span>
              <span className={cn(MONO, "text-xs text-[#5C5747]")}>{customerPhone}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setLembrado(false);
                setCustomerName("");
                setCustomerPhone("");
                setTouched({ name: false, phone: false });
              }}
              className="h-11 shrink-0 text-xs text-[#2C6A53] underline underline-offset-[3px]"
            >
              não sou eu
            </button>
          </div>
        ) : (
          <form
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
                onChange={(e) => setCustomerName(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                aria-invalid={touched.name && !!errors.name}
                aria-describedby="nome-aviso"
                className={cn(CAMPO, touched.name && errors.name && "border-[#B4472F]", !errors.name && customerName && "border-[#2C6A53]")}
              />
              <p id="nome-aviso" aria-live="polite" className={cn(MONO, "min-h-4 text-[10px]", touched.name && errors.name ? "text-[#B4472F]" : "text-[#6B6555]")}>
                {touched.name && errors.name ? errors.name : customerName.trim().length >= 2 ? "tudo certo" : "como o negócio vai te chamar"}
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
                  // Valida enquanto digita assim que o número fica completo
                  if (e.target.value.replace(/\D/g, "").length >= 10) setTouched((t) => ({ ...t, phone: true }));
                }}
                onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
                aria-invalid={touched.phone && !!errors.phone && !faltamDigitos(customerPhone)}
                aria-describedby="tel-aviso"
                className={cn(
                  CAMPO,
                  MONO,
                  touched.phone && errors.phone && !faltamDigitos(customerPhone) && "border-[#B4472F]",
                  !errors.phone && customerPhone && "border-[#2C6A53]",
                )}
              />
              <p
                id="tel-aviso"
                aria-live="polite"
                className={cn(
                  MONO,
                  "min-h-4 text-[10px]",
                  touched.phone && errors.phone && !faltamDigitos(customerPhone)
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

        {/* Confirmar e avisar no mesmo toque. A abertura do WhatsApp sai do próprio
            clique: se eu gravasse primeiro e abrisse depois do await, o navegador
            bloquearia a aba por não ser mais um gesto do usuário. */}
        {avisoUrl ? (
          <a
            href={avisoUrl}
            target="_blank"
            rel="noreferrer"
            aria-disabled={busy || !contatoOk}
            onClick={(e) => {
              if (busy || !contatoOk) {
                e.preventDefault();
                setTouched({ name: true, phone: true });
                return;
              }
              confirmar(true);
            }}
            className={cn(PRIMARIO, (busy || !contatoOk) && "cursor-not-allowed bg-[#B8B3A4]")}
          >
            <Zap />
            {busy ? "Confirmando…" : `Confirmar às ${escolha.hora}`}
          </a>
        ) : (
          <button type="button" onClick={() => confirmar()} disabled={busy || !contatoOk} className={PRIMARIO}>
            {busy ? "Confirmando…" : `Confirmar às ${escolha.hora}`}
            <span className={cn("flex size-5 items-center justify-center rounded-md bg-[#FAF9F5]/16 text-[11px]", MONO)}>&#8629;</span>
          </button>
        )}
        <p className="text-center text-xs text-[#5C5747]">
          {avisoUrl
            ? "Abre o WhatsApp com o resumo para a casa confirmar. Sem cadastro e sem pagar nada agora."
            : "Sem cadastro e sem pagar nada agora."}
        </p>
        <div className="flex-1" />
        <Rodape />
      </main>
    );
  }

  // ---------- escolha: o que e quando, na mesma tela ----------
  return (
    <main className="mx-auto w-full max-w-[420px] bg-[#F2F0E7] p-4 pb-[max(6rem,env(safe-area-inset-bottom))] text-[#17150F] lg:max-w-[1120px]">
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[1fr_340px] lg:items-start lg:gap-8">
        <div className="flex flex-col gap-4">
          <Cabecalho name={name} rating={rating} reviews={reviews} city={city} phone={phone} />

          {slotError && (
            <p role="alert" className="rounded-[10px] border border-[#E7C9BF] bg-[#FBF1EE] p-3 text-sm text-[#B4472F]">
              {slotError}
            </p>
          )}

          <section aria-labelledby="oque" className="flex flex-col gap-2.5">
            <h2 id="oque" className="text-[17px] font-semibold tracking-[-0.02em]">
              O que você quer fazer?
            </h2>
            <div className="-mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0">
              {services.map((s) => {
                const sel = serviceIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={sel}
                    onClick={() => toggleService(s.id)}
                    className={cn(
                      "flex min-h-14 shrink-0 snap-start flex-col justify-center gap-0.5 rounded-xl border px-3.5 py-2 text-left",
                      sel ? "border-[#17150F] bg-[#17150F] text-[#FAF9F5]" : "border-[#D5D0C1] bg-white",
                    )}
                  >
                    <span className="text-sm font-semibold tracking-[-0.01em]">{s.name}</span>
                    <span className={cn(MONO, "text-[10px]", sel ? "text-[#FAF9F5]/72" : "text-[#5C5747]")}>
                      {formatDuration(s.durationMin)} · {formatBRL(s.priceCents)}
                    </span>
                  </button>
                );
              })}
            </div>
            {escolhidos.length > 1 && (
              <p className={cn(MONO, "text-[10px] tracking-[0.06em] text-[#6B6555]")}>
                somando: {formatDuration(totalMin)} · {formatBRL(totalCents)}
              </p>
            )}
          </section>

          {!escolhidos.length ? (
            <div className={cn(PAINEL, "flex flex-col gap-1.5 p-5")}>
              <h2 className="text-[17px] font-semibold tracking-[-0.02em]">Quando?</h2>
              <p className="text-[13px] leading-relaxed text-[#5C5747]">Escolha um serviço acima e os horários livres aparecem aqui.</p>
            </div>
          ) : (
            <section aria-labelledby="quando" className="flex flex-col gap-3">
              <div className="flex items-baseline gap-2.5">
                <h2 id="quando" className="text-[17px] font-semibold tracking-[-0.02em]">
                  Quando?
                </h2>
                <span className={cn(MONO, "text-[10px] tracking-[0.08em] text-[#6B6555] uppercase")}>
                  {escolha ? `${escolha.hora} escolhido` : "horários livres"}
                </span>
              </div>

              <div className="-mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:grid lg:grid-cols-7 lg:px-0">
                {(agenda ?? Array.from({ length: 7 }, (_, i) => ({ date: addDays(from, i), horarios: [] }))).map((d) => {
                  const sel = d.date === date;
                  const vazio = !d.horarios.length;
                  const rotulo = d.date === today ? "hoje" : d.date === addDays(today, 1) ? "amanhã" : parte(d.date, { weekday: "short" });
                  return (
                    <button
                      key={d.date}
                      type="button"
                      aria-pressed={sel}
                      disabled={!agenda || vazio}
                      onClick={() => {
                        setDate(d.date);
                        setEscolha(null);
                      }}
                      aria-label={`${longDate(d.date)}, ${agenda ? (vazio ? "sem horário" : `${d.horarios.length} horários livres`) : "carregando"}`}
                      className={cn(
                        "flex min-h-[72px] w-[62px] shrink-0 snap-start flex-col items-center justify-center gap-0.5 rounded-xl border lg:w-auto",
                        sel ? "border-[#17150F] bg-[#17150F] text-[#FAF9F5]" : vazio ? "border-dashed border-[#D5D0C1] text-[#9A9484]" : "border-[#D5D0C1] bg-white",
                      )}
                    >
                      <span className={cn(MONO, "text-[9px] tracking-[0.06em] uppercase opacity-75")}>{rotulo}</span>
                      <span className={cn(MONO, "text-lg leading-none")}>{parte(d.date, { day: "numeric" })}</span>
                      <span className={cn(MONO, "text-[9px]", sel ? "text-[#FAF9F5]/80" : vazio ? "text-[#9A9484]" : "text-[#2C6A53]")}>
                        {agenda ? (vazio ? "fechado" : `${d.horarios.length} livres`) : "—"}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2.5">
                <label htmlFor="outra-data" className={cn(MONO, "text-[10px] tracking-[0.08em] text-[#6B6555] uppercase")}>
                  outra data
                </label>
                <Input
                  id="outra-data"
                  type="date"
                  value={from}
                  min={today}
                  max={addDays(today, MAX_DAYS_AHEAD)}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    setFrom(e.target.value);
                    setDate(e.target.value);
                    setEscolha(null);
                  }}
                  className={cn(CAMPO, MONO, "h-11 w-auto text-[13px]")}
                />
              </div>

              <div className={cn(PAINEL, "flex flex-col gap-3.5 p-4")}>
                <p className="sr-only" aria-live="polite">
                  {!agenda ? "Buscando horários" : !dia?.horarios.length ? "Nenhum horário livre nesta data" : `${dia.horarios.length} horários disponíveis`}
                </p>
                <p className="text-[13px] text-[#5C5747] first-letter:uppercase">
                  {date ? longDate(date) : "—"}
                  {agenda && dia?.horarios.length ? (
                    <>
                      {" — "}
                      <span className={cn(MONO, "text-xs text-[#17150F]")}>{dia.horarios.length}</span> livres
                    </>
                  ) : null}
                </p>
                {!agenda ? (
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-5" aria-hidden="true">
                    {Array.from({ length: 12 }, (_, i) => (
                      <div key={i} className="h-12 animate-pulse rounded-[10px] bg-[#EDEAE0] motion-reduce:animate-none" />
                    ))}
                  </div>
                ) : !dia?.horarios.length ? (
                  <p className="text-[13px] text-[#5C5747]">
                    Nenhum horário livre nesta data. Os dias com vaga estão marcados na faixa acima.
                  </p>
                ) : (
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 lg:grid-cols-6">
                    {dia.horarios.map((h) => {
                      const sel = escolha?.hora === h.hora;
                      return (
                        <button
                          key={h.hora}
                          type="button"
                          aria-pressed={sel}
                          onClick={() => setEscolha(h)}
                          className={cn(
                            MONO,
                            "min-h-12 rounded-[10px] border text-[15px]",
                            sel ? "border-[#17150F] bg-[#17150F] text-[#FAF9F5]" : "border-[#D5D0C1] bg-white",
                          )}
                        >
                          {h.hora}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Escolher profissional só importa para quem tem preferência: fica
              numa linha, com o padrão já resolvido. */}
          {profissionais.length > 1 && (
            <div className="flex items-center gap-2.5 rounded-xl border border-[#E4E1D5] bg-[#F6F4EB] px-3.5 py-2.5">
              <span className={cn(ROTULO, "shrink-0")}>com quem</span>
              <span className="flex-1 text-[13px] font-medium">
                {staffId ? (staff.find((p) => p.id === staffId)?.name ?? "") : escolha && atendente ? atendente.name : "Qualquer profissional livre"}
              </span>
              <select
                aria-label="Escolher profissional"
                value={staffId}
                onChange={(e) => {
                  setStaffId(e.target.value);
                  setEscolha(null);
                }}
                className={cn(MONO, "h-11 shrink-0 rounded-[10px] border border-[#D5D0C1] bg-white px-2 text-xs")}
              >
                <option value="">qualquer</option>
                {profissionais.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="hidden lg:block">
            <Rodape />
          </div>
        </div>

        {/* Desktop: o resumo e o confirmar ficam à vista ao lado da grade */}
        <aside className="hidden lg:sticky lg:top-6 lg:flex lg:flex-col lg:gap-4">
          {escolha ? (
            <>
              {resumo}
              <button type="button" onClick={() => setEtapa("confirmar")} className={PRIMARIO}>
                Continuar
              </button>
            </>
          ) : (
            <div className={cn(PAINEL, "flex flex-col gap-2 p-5")}>
              <p className={ROTULO}>seu agendamento</p>
              <p className="text-[13px] leading-relaxed text-[#5C5747]">Escolha um horário na grade e o resumo aparece aqui.</p>
            </div>
          )}
        </aside>
      </div>

      {/* Celular: a ação fica no alcance do dedo, com o que já foi escolhido */}
      {escolha && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-[#E0DCCE] bg-[#FAF9F5] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
          <div className="mx-auto flex w-full max-w-[420px] items-center gap-3.5">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={cn(MONO, "text-[9px] tracking-[0.12em] text-[#6B6555] uppercase")}>
                {parte(date, { weekday: "short", day: "numeric" })} · {escolha.hora}
                {atendente ? ` · ${atendente.name}` : ""}
              </span>
              <span className="truncate text-sm font-semibold tracking-[-0.01em]">
                {escolhidos.map((s) => s.name).join(" + ")} · {formatBRL(totalCents)}
              </span>
            </div>
            <button type="button" onClick={() => setEtapa("confirmar")} className={cn(PRIMARIO, "shrink-0")}>
              Continuar
              <span className={cn("flex size-5 items-center justify-center rounded-md bg-[#FAF9F5]/16 text-[11px]", MONO)}>&#8594;</span>
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
