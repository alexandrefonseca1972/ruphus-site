"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  weekday,
  zonedTime,
} from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { createBooking, getSlots } from "./actions";

type Props = {
  tenantId: string;
  today: string;
  name: string;
  phone: string | null;
  services: { id: string; name: string; durationMin: number; priceCents: number }[];
  staff: { id: string; name: string; serviceIds: string[]; workDays: number[] }[];
};

const QUICK_DAYS = 14;
const CONTACT_KEY = "siteflow:contato"; // lembrado só neste navegador

const longDate = (date: string) => formatLongDate(zonedTime(date, "12:00"));
const dayChip = (date: string) => {
  const d = zonedTime(date, "12:00");
  return {
    weekday: new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: TIMEZONE }).format(d).replace(".", ""),
    day: new Intl.DateTimeFormat("pt-BR", { day: "numeric", timeZone: TIMEZONE }).format(d),
    month: new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: TIMEZONE }).format(d).replace(".", ""),
  };
};
const nameError = (v: string) => (!v.trim() ? "Informe seu nome" : v.trim().length < 2 ? "Nome muito curto" : "");
const PERIODS = [
  { label: "Manhã", test: (t: string) => t < "12:00" },
  { label: "Tarde", test: (t: string) => t >= "12:00" && t < "18:00" },
  { label: "Noite", test: (t: string) => t >= "18:00" },
];

function scrollToSection(el: HTMLElement | null) {
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Espera o React desenhar a seção nova
  requestAnimationFrame(() => el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }));
}

function Choice({ selected, ...props }: React.ComponentProps<"button"> & { selected: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      {...props}
      className={cn(
        "rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent",
        selected && "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
        props.className,
      )}
    />
  );
}

function Field(props: {
  id: string;
  label: string;
  error: string;
  show: boolean;
  children: (a11y: { "aria-invalid": boolean; "aria-describedby"?: string }) => React.ReactNode;
}) {
  const { id, label, error, show, children } = props;
  const invalid = show && !!error;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children({ "aria-invalid": invalid, "aria-describedby": invalid ? `${id}-error` : undefined })}
      <p id={`${id}-error`} className={cn("min-h-5 text-sm", invalid ? "text-destructive" : "text-emerald-700 dark:text-emerald-400")} aria-live="polite">
        {invalid ? error : show && !error ? <span aria-label={`${label} preenchido`}>✓</span> : ""}
      </p>
    </div>
  );
}

export function BookingForm({ tenantId, today, name, phone, services, staff }: Props) {
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [slotsVersion, setSlotsVersion] = useState(0);
  const slotsKey = `${serviceIds.join(",")}|${staffId}|${date}|${slotsVersion}`;
  const [fetched, setFetched] = useState<{ for: string; slots: string[] } | null>(null);
  const slots = fetched?.for === slotsKey ? fetched.slots : null;
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [touched, setTouched] = useState({ name: false, phone: false });
  const [slotError, setSlotError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const staffRef = useRef<HTMLElement>(null);
  const dateRef = useRef<HTMLElement>(null);
  const contactRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const slotErrorRef = useRef<HTMLParagraphElement>(null);
  const selectedDayRef = useRef<HTMLButtonElement>(null);

  const chosen = services.filter((s) => serviceIds.includes(s.id));
  const totalMin = chosen.reduce((sum, s) => sum + s.durationMin, 0);
  const totalCents = chosen.reduce((sum, s) => sum + s.priceCents, 0);
  const doesAll = (p: Props["staff"][number], ids: string[]) => ids.every((id) => p.serviceIds.includes(id));
  const professionals = staff.filter((p) => doesAll(p, serviceIds));
  const professional = professionals.find((p) => p.id === staffId);
  const errors = { name: nameError(customerName), phone: phoneError(customerPhone) };
  const quickDays = Array.from({ length: QUICK_DAYS }, (_, i) => addDays(today, i));
  const worksOn = (d: string) => !!professional?.workDays.includes(weekday(d));
  const firstWorkDay = (p: Props["staff"][number]) => quickDays.find((d) => p.workDays.includes(weekday(d))) ?? "";

  // Mantém o dia escolhido visível na faixa horizontal
  useEffect(() => {
    selectedDayRef.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [date]);

  // Contato lembrado da última reserva neste navegador
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CONTACT_KEY) ?? "null");
      if (saved?.name) setCustomerName(saved.name); // eslint-disable-line react-hooks/set-state-in-effect -- leitura única do localStorage
      if (saved?.phone) setCustomerPhone(formatPhone(saved.phone));
    } catch {}
  }, []);

  useEffect(() => {
    if (!serviceIds.length || !staffId || !date) return;
    let current = true;
    getSlots({ tenantId, serviceIds, staffId, date })
      .catch(() => {
        if (current) setSlotError("Não foi possível carregar os horários. Tente de novo.");
        return [];
      })
      .then((s) => current && setFetched({ for: slotsKey, slots: s }));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- serviceIds já está em slotsKey
  }, [tenantId, staffId, date, slotsKey]);

  function toggleService(id: string) {
    // Mantém a ordem do catálogo: "Corte + Barba", não a ordem dos cliques
    const ids = services.map((s) => s.id).filter((s) => (s === id ? !serviceIds.includes(id) : serviceIds.includes(s)));
    setServiceIds(ids);
    const available = staff.filter((p) => doesAll(p, ids));
    if (!available.some((p) => p.id === staffId)) {
      const only = available.length === 1 ? available[0] : undefined;
      setStaffId(only?.id ?? "");
      setDate(only ? firstWorkDay(only) : "");
    }
    setTime("");
    setSlotError("");
    if (services.length === 1 && ids.length === 1) scrollToSection(staffRef.current);
  }

  function pickStaff(id: string) {
    setStaffId(id);
    setTime("");
    setSlotError("");
    const p = staff.find((s) => s.id === id)!;
    // Mantém a data se ela ainda serve; senão sugere o primeiro dia em que atende
    if (!date || !p.workDays.includes(weekday(date))) setDate(firstWorkDay(p));
    scrollToSection(dateRef.current);
  }

  function pickDate(d: string) {
    setDate(d);
    setTime("");
    setSlotError("");
  }

  function pickTime(t: string) {
    setTime(t);
    setSlotError("");
    setSubmitError("");
    scrollToSection(contactRef.current);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError("");
    setTouched({ name: true, phone: true });
    if (errors.name) return nameRef.current?.focus();
    if (errors.phone) return phoneRef.current?.focus();
    setBusy(true);
    // O servidor valida de novo com o mesmo schema
    const result = await createBooking({ tenantId, serviceIds, staffId, date, time, customerName, customerPhone })
      .catch(() => ({ ok: false as const, error: "Não foi possível confirmar agora. Verifique sua conexão e tente de novo." }))
      .finally(() => setBusy(false));
    // Erro nos dados: fica junto dos campos, sem perder o horário escolhido
    if (!result.ok && "field" in result) return setSubmitError(result.error);
    if (result.ok) {
      try {
        localStorage.setItem(CONTACT_KEY, JSON.stringify({ name: customerName.trim(), phone: customerPhone }));
      } catch {}
      scrollTo({ top: 0 });
      return setDone(true);
    }
    // Horário tomado por outra pessoa: mantém os dados e mostra os horários atualizados
    setSlotError(result.error);
    setTime("");
    setSlotsVersion((v) => v + 1);
    requestAnimationFrame(() => {
      if (slotErrorRef.current) slotErrorRef.current.focus();
      else scrollToSection(dateRef.current);
    });
  }

  if (done && professional) {
    const start = zonedTime(date, time);
    const end = new Date(start.getTime() + totalMin * 60_000);
    const gcal = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const calendarUrl =
      "https://calendar.google.com/calendar/render?" +
      new URLSearchParams({
        action: "TEMPLATE",
        text: `${chosen.map((s) => s.name).join(" + ")} · ${name}`,
        dates: `${gcal(start)}/${gcal(end)}`,
        details: `Com ${professional.name}. ${formatBRL(totalCents)}.`,
      });
    // Nada avisa o estabelecimento quando alguém agenda — quem agenda leva o
    // recado pelo canal que esses negócios já usam o dia inteiro.
    const avisoUrl = linkWhatsApp(
      phone,
      [
        `Olá! Acabei de agendar pelo site do ${name}.`,
        "",
        chosen.map((s) => s.name).join(" + "),
        `${longDate(date)}, às ${time}`,
        `com ${professional.name}`,
        "",
        `Meu nome é ${customerName.trim()} (${customerPhone}).`,
      ].join("\n"),
    );
    return (
      <main className="mx-auto w-full max-w-lg p-4 py-12 pb-[max(3rem,env(safe-area-inset-bottom))]">
        <Card>
          <CardHeader>
            <p className="text-sm text-emerald-700 dark:text-emerald-400" role="status">✓ Agendamento confirmado</p>
            <CardTitle className="text-xl">{chosen.map((s) => s.name).join(" + ")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            <p className="text-base first-letter:uppercase">{longDate(date)}, às {time}</p>
            <p>com {professional.name} · {formatDuration(totalMin)} · {formatBRL(totalCents)}</p>
            <p className="text-muted-foreground">{name}</p>
            <p className="mt-3 text-muted-foreground">
              {avisoUrl
                ? "Falta avisar o estabelecimento. Mande o resumo no WhatsApp para confirmarem o seu horário."
                : `O estabelecimento fala com você no WhatsApp que você informou (${customerPhone}).`}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {avisoUrl && (
                <a
                  href={avisoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/80"
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.9-.9L3 20.5l1.6-4.9A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z" />
                  </svg>
                  Avisar no WhatsApp
                </a>
              )}
              <a href={calendarUrl} rel="noreferrer" className={cn("inline-flex h-11 items-center rounded-lg border px-4 text-sm font-medium hover:bg-accent", !avisoUrl && "bg-primary text-primary-foreground hover:bg-primary/80")}>
                Adicionar ao Google Agenda
              </a>
              <Button variant="outline" onClick={() => location.reload()}>
                Fazer outro agendamento
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto grid w-full max-w-lg gap-8 p-4 py-10 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <header>
        <p className="text-sm text-muted-foreground">Agendamento online</p>
        <h1 className="text-2xl font-semibold">{name}</h1>
      </header>

      <section aria-labelledby="s-service" className="grid scroll-mt-4 gap-2">
        <h2 id="s-service" className="font-medium">
          1. Serviços <span className="text-sm font-normal text-muted-foreground">(escolha um ou mais)</span>
        </h2>
        {services.length === 0 && <p className="text-sm text-muted-foreground">Nenhum serviço disponível no momento.</p>}
        <div className="grid gap-2">
          {services.map((s) => (
            <Choice key={s.id} selected={serviceIds.includes(s.id)} onClick={() => toggleService(s.id)} className="flex justify-between gap-4">
              <span className="font-medium">{s.name}</span>
              <span className="shrink-0 opacity-80">
                {formatDuration(s.durationMin)} · {formatBRL(s.priceCents)}
              </span>
            </Choice>
          ))}
        </div>
        {chosen.length > 1 && (
          <p className="text-sm text-muted-foreground">
            Total: {formatDuration(totalMin)} · {formatBRL(totalCents)}
          </p>
        )}
      </section>

      {chosen.length > 0 && (
        <section ref={staffRef} aria-labelledby="s-staff" className="grid scroll-mt-4 gap-2">
          <h2 id="s-staff" className="font-medium">2. Profissional</h2>
          {professionals.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum profissional faz {chosen.length > 1 ? "todos esses serviços juntos. Tente separar em agendamentos diferentes." : "este serviço."}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            {professionals.map((p) => (
              <Choice key={p.id} selected={p.id === staffId} onClick={() => pickStaff(p.id)}>
                {p.name}
              </Choice>
            ))}
          </div>
        </section>
      )}

      {professional && (
        <section ref={dateRef} aria-labelledby="s-date" className="grid scroll-mt-4 gap-3">
          <h2 id="s-date" className="font-medium">3. Data e horário</h2>
          <div className="-mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Próximos dias">
            {quickDays.map((d, i) => {
              const chip = dayChip(d);
              return (
                <Choice
                  key={d}
                  ref={d === date ? selectedDayRef : undefined}
                  selected={d === date}
                  disabled={!worksOn(d)}
                  onClick={() => pickDate(d)}
                  aria-label={`${longDate(d)}${worksOn(d) ? "" : " (não atende)"}`}
                  className="grid min-h-11 w-16 shrink-0 snap-start justify-items-center gap-0 px-1 py-2 text-center"
                >
                  <span className="text-xs capitalize opacity-80">{i === 0 ? "hoje" : i === 1 ? "amanhã" : chip.weekday}</span>
                  <span className="text-lg leading-6 font-semibold tabular-nums">{chip.day}</span>
                  <span className="text-xs opacity-80">{chip.month}</span>
                </Choice>
              );
            })}
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Label htmlFor="date" className="font-normal text-muted-foreground">Outra data:</Label>
            <Input
              id="date"
              type="date"
              className="h-11 w-auto md:h-8"
              value={date}
              min={today}
              max={addDays(today, MAX_DAYS_AHEAD)}
              onChange={(e) => pickDate(e.target.value)}
            />
          </div>

          {date && (
            <div className="grid gap-3">
              <p className="sr-only" aria-live="polite">
                {!worksOn(date)
                  ? "Profissional não atende neste dia"
                  : slots === null
                    ? "Buscando horários"
                    : slots.length === 0
                      ? "Nenhum horário livre nesta data"
                      : `${slots.length} horários disponíveis`}
              </p>
              <p className="text-sm text-muted-foreground first-letter:uppercase">{longDate(date)}</p>
              {slotError && (
                <p ref={slotErrorRef} tabIndex={-1} role="alert" className="rounded-lg bg-destructive/10 p-2 text-sm text-destructive outline-none">
                  {slotError}
                </p>
              )}
              {!worksOn(date) ? (
                <p className="text-sm text-muted-foreground">{professional.name} não atende neste dia da semana. Escolha outra data.</p>
              ) : slots === null ? (
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-5" aria-label="Buscando horários">
                  {Array.from({ length: 20 }, (_, i) => (
                    <div key={i} className="h-11 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
                  ))}
                </div>
              ) : slots.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum horário livre nesta data. Tente outro dia.</p>
              ) : (
                PERIODS.map((period) => {
                  const list = slots.filter(period.test);
                  if (!list.length) return null;
                  return (
                    <div key={period.label} className="grid gap-1.5">
                      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{period.label}</h3>
                      <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                        {list.map((s) => (
                          <Choice key={s} selected={s === time} onClick={() => pickTime(s)} className="min-h-11 text-center tabular-nums">
                            {s}
                          </Choice>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </section>
      )}

      {time && professional && (
        <section ref={contactRef} aria-labelledby="s-contact" className="grid scroll-mt-4 gap-3">
          <h2 id="s-contact" className="font-medium">4. Seus dados</h2>
          <div className="rounded-lg bg-muted/60 p-3 text-sm">
            <p className="font-medium">{chosen.map((s) => s.name).join(" + ")} com {professional.name}</p>
            <p className="first-letter:uppercase">{longDate(date)}, às {time}</p>
            <p className="text-muted-foreground">{formatDuration(totalMin)} · {formatBRL(totalCents)}</p>
          </div>
          <form onSubmit={submit} noValidate className="grid gap-2">
            <Field id="customerName" label="Nome" error={errors.name} show={touched.name}>
              {(a11y) => (
                <Input
                  ref={nameRef}
                  id="customerName"
                  autoComplete="name"
                  enterKeyHint="next"
                  maxLength={80}
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                  {...a11y}
                />
              )}
            </Field>
            <Field id="customerPhone" label="WhatsApp" error={errors.phone} show={touched.phone}>
              {(a11y) => (
                <Input
                  ref={phoneRef}
                  id="customerPhone"
                  type="text"
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
                  {...a11y}
                />
              )}
            </Field>
            {submitError && <p role="alert" className="text-sm text-destructive">{submitError}</p>}
            <Button type="submit" size="lg" className="h-12 text-base" disabled={busy}>
              {busy ? "Confirmando…" : `Confirmar agendamento às ${time}`}
            </Button>
          </form>
        </section>
      )}
    </main>
  );
}
