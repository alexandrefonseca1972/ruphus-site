"use client";

import Link from "next/link";
import { collection, doc, orderBy, serverTimestamp, Timestamp, where, writeBatch } from "firebase/firestore";
import { Fragment, useEffect, useState } from "react";
import { z } from "zod";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/auth-errors";
import { auth, db } from "@/lib/firebase";
import { addDays, customerKey, dateIn, formatBRL, formatLongDate, formatTime, todayIn, weekday, WEEKDAYS, whatsappLink, zonedTime } from "@/lib/datetime";
import { Service, Staff } from "@/lib/scheduling";
import { useCollection } from "@/lib/use-collection";
import { cn, openExternal } from "@/lib/utils";
import { ConfirmDialog } from "./confirm-dialog";
import { History } from "./history";
import { useTenant } from "./layout";
import { PageTitle } from "./page-title";
import { Reschedule } from "./reschedule";
import { RowMenu } from "./row-menu";
import { ShareLink } from "./share-link";
import { STATUS } from "./status";

const Appointment = z.object({
  serviceName: z.string(),
  staffId: z.string(),
  staffName: z.string(),
  priceCents: z.number(),
  start: z.instanceof(Timestamp),
  end: z.instanceof(Timestamp),
  customerName: z.string(),
  customerPhone: z.string(),
  planId: z.string().optional(),
  status: z.enum(["booked", "confirmed", "cancelled", "no_show"]),
});
export type Appointment = z.infer<typeof Appointment> & { id: string };

const ATIVO = (a: { status: string }) => a.status === "booked" || a.status === "confirmed";
// Semana de segunda a domingo, a que contém o dia escolhido
const segundaDe = (date: string) => addDays(date, -((weekday(date) + 6) % 7));
const capitaliza = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const firstName = (name: string) => name.trim().split(/\s+/)[0];

export function confirmationText(a: Appointment, business: string) {
  const start = a.start.toDate();
  return `Olá, ${firstName(a.customerName)}! Seu horário na ${business} está confirmado: ${a.serviceName} com ${a.staffName}, ${formatLongDate(start)} às ${formatTime(start)}. Até lá!`;
}

export function cancellationText(a: Appointment, business: string, bookingUrl: string) {
  const start = a.start.toDate();
  return `Olá, ${firstName(a.customerName)}! Seu horário na ${business} de ${formatLongDate(start)} às ${formatTime(start)} (${a.serviceName} com ${a.staffName}) foi cancelado. Para marcar outro horário: ${bookingUrl}`;
}

export function rescheduleText(a: Appointment, business: string, start: Date) {
  return `Olá, ${firstName(a.customerName)}! Seu horário na ${business} foi remarcado para ${formatLongDate(start)} às ${formatTime(start)} (${a.serviceName} com ${a.staffName}). Se não puder, é só responder esta mensagem.`;
}


export default function AgendaPage() {
  const tenant = useTenant();
  const [date, setDate] = useState(todayIn);
  const [error, setError] = useState("");
  const [rescheduling, setRescheduling] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ id: string; kind: "cancel" | "no_show" } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [staffFilter, setStaffFilter] = useState("");
  const [staff] = useCollection(tenant.id, "staff", Staff, [orderBy("name")]);
  const [notice, setNotice] = useState<{ text: string; link: string } | null>(null);
  // O relógio anda a cada minuto: com a agenda aberta o dia todo, o horário que passa perde
  // o "Confirmar" e ganha o "Faltou", e a linha do "agora" desce, sem recarregar a página
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const [services] = useCollection(tenant.id, "services", Service, []);
  // A semana inteira numa consulta só: a faixa de dias conta, a lista mostra um dia
  const semana = segundaDe(date);
  const [daSemana, loadError] = useCollection(
    tenant.id,
    "appointments",
    Appointment,
    [where("start", ">=", zonedTime(semana, "00:00")), where("start", "<", zonedTime(addDays(semana, 7), "00:00")), orderBy("start")],
    semana,
  );
  const items = daSemana?.filter((a) => dateIn(a.start.toDate()) === date) ?? null;

  // Toda mudança de status grava um registro no histórico no mesmo batch (exigido pelas regras)
  /** Devolve true quando gravou; só então o cliente pode ser avisado. */
  async function changeStatus(a: Appointment, status: "confirmed" | "cancelled" | "no_show") {
    setError("");
    const user = auth.currentUser;
    if (!user) {
      setError("Sessão expirada. Entre novamente.");
      return false;
    }
    const entry = doc(collection(db, "tenants", tenant.id, "history"));
    const batch = writeBatch(db);
    batch.set(entry, { appointmentId: a.id, type: status, at: serverTimestamp(), by: user.uid, byName: user.email });
    batch.update(doc(db, "tenants", tenant.id, "appointments", a.id), { status, lastHistoryId: entry.id });
    try {
      await batch.commit();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  }

  async function notifyAndChange(a: Appointment, status: "confirmed" | "cancelled", message: string) {
    setPending(a.id);
    const saved = await changeStatus(a, status);
    setPending(null);
    // Falhou a gravação: não avisa o cliente de algo que não aconteceu
    if (!saved) return;
    const link = whatsappLink(a.customerPhone, message);
    if (!openExternal(link)) location.assign(link); // webview bloqueou a aba nova
  }

  function cancel(a: Appointment, notify: boolean) {
    setConfirming(null);
    const url = `${location.origin}/agendar/${tenant.id}`;
    return notify
      ? notifyAndChange(a, "cancelled", cancellationText(a, tenant.name, url))
      : changeStatus(a, "cancelled");
  }

  const shown = items?.filter((a) => !staffFilter || a.staffId === staffFilter) ?? null;
  const active = shown?.filter(ATIVO) ?? [];
  const dias = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(semana, i);
    return { date: d, count: daSemana?.filter((a) => ATIVO(a) && dateIn(a.start.toDate()) === d).length ?? 0 };
  });
  const hoje = todayIn();
  // Linha do "agora": antes do primeiro horário que ainda não começou, só no dia de hoje
  const agoraAntesDe = date === hoje ? shown?.find((a) => a.start.toMillis() > now)?.id : undefined;
  const stats = [
    { label: "Horários", value: active.length },
    { label: "Confirmados", value: active.filter((a) => a.status === "confirmed").length },
    { label: "Aguardando", value: active.filter((a) => a.status === "booked").length },
    { label: "Previsto", value: formatBRL(active.reduce((sum, a) => sum + a.priceCents, 0)) },
  ];

  return (
    <>
      <PageTitle title="Agenda" sub={capitaliza(formatLongDate(zonedTime(date, "12:00")))}>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-lg" className="size-10" onClick={() => setDate(addDays(date, -7))} aria-label="Semana anterior">‹</Button>
          <Label htmlFor="agenda-date" className="sr-only">Data</Label>
          <Input id="agenda-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-10 w-auto bg-card" />
          <Button variant="outline" size="icon-lg" className="size-10" onClick={() => setDate(addDays(date, 7))} aria-label="Próxima semana">›</Button>
          <Button variant="ghost" className="h-10 px-3" disabled={date === hoje} onClick={() => setDate(hoje)}>Hoje</Button>
        </div>
      </PageTitle>

      <div className="grid grid-cols-7 gap-1.5 sm:gap-2.5" role="group" aria-label="Dias da semana">
        {dias.map((d) => {
          const sel = d.date === date;
          return (
            <button
              key={d.date}
              type="button"
              aria-pressed={sel}
              aria-label={`${WEEKDAYS[weekday(d.date)]} ${Number(d.date.slice(8))}: ${d.count} horário(s)`}
              onClick={() => setDate(d.date)}
              className={cn(
                "grid justify-items-center gap-1 rounded-xl border bg-card py-2.5 hover:border-foreground/40 sm:py-3",
                sel && "border-primary bg-primary text-primary-foreground hover:border-primary",
              )}
            >
              <span className="text-[11px] tracking-wider uppercase opacity-75">{WEEKDAYS[weekday(d.date)].slice(0, 3)}</span>
              <span className={cn("font-serifa text-2xl leading-none sm:text-3xl", d.date === hoje && !sel && "underline underline-offset-4")}>{Number(d.date.slice(8))}</span>
              <span className="hidden text-xs opacity-75 sm:block">{d.count ? `${d.count} horário${d.count > 1 ? "s" : ""}` : "livre"}</span>
            </button>
          );
        })}
      </div>

      {!!daSemana?.length && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          {stats.map((st) => (
            <div key={st.label} className="grid gap-1.5 rounded-2xl border bg-card px-5 py-4">
              <dt className="text-[13px] text-muted-foreground">{st.label}</dt>
              <dd className="font-serifa text-3xl leading-none tabular-nums">{st.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {notice && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950">
          <span>{notice.text}</span>
          <div className="flex gap-2">
            <a href={notice.link} target="_blank" rel="noreferrer" className="rounded-md bg-emerald-700 px-3 py-1.5 font-medium text-white hover:bg-emerald-800">
              Avisar pelo WhatsApp
            </a>
            <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>Fechar</Button>
          </div>
        </div>
      )}
      {(error || loadError) && <p role="alert" className="text-sm text-destructive">{error || loadError}</p>}

      {!shown ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : shown.length === 0 && staff && staff.length === 0 ? (
        /* Primeiro acesso: sem ninguém cadastrado para atender, o link de
           agendamento não tem o que oferecer — e "Nenhum agendamento neste dia"
           faz parecer que é só um dia vazio. */
        <Onboarding tenantId={tenant.id} name={tenant.name} temServicos={!!services?.length} />
      ) : (
        <section aria-labelledby="dia" className="overflow-hidden rounded-2xl border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
            <h2 id="dia" className="font-semibold">Horários do dia</h2>
            {(staff?.length ?? 0) > 1 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por profissional">
                {[{ id: "", name: "Todos" }, ...(staff ?? [])].map((p) => {
                  const n = p.id ? items?.filter((a) => ATIVO(a) && a.staffId === p.id).length : undefined;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={staffFilter === p.id}
                      onClick={() => setStaffFilter(p.id)}
                      className={cn(
                        "h-9 rounded-full border px-3.5 text-[13px] hover:bg-muted",
                        staffFilter === p.id && "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
                      )}
                    >
                      {p.name}{n ? ` · ${n}` : ""}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {shown.length === 0 ? (
            <p className="border-t px-6 py-12 text-center text-sm text-muted-foreground">
              {staffFilter ? "Nenhum horário para este profissional neste dia." : "Nenhum horário marcado neste dia."}
            </p>
          ) : (
        <ul>
          {shown.map((a) => (
            <Fragment key={a.id}>
            {agoraAntesDe === a.id && (
              <li aria-hidden="true" className="flex h-9 items-center gap-3 border-t px-4 text-xs font-semibold tracking-wider text-red-800 uppercase sm:px-6 dark:text-red-300">
                Agora · {formatTime(new Date(now))}
                <span className="h-px flex-1 bg-current opacity-40" />
              </li>
            )}
            <li className="grid gap-3 border-t px-4 py-4 sm:px-6">
              <div className="grid items-center gap-x-6 gap-y-3 sm:grid-cols-[6.5rem_minmax(0,1fr)_auto]">
                <div className="flex items-baseline gap-2 tabular-nums sm:grid sm:gap-0.5">
                  <span className={cn("text-xl font-semibold", a.status === "cancelled" && "text-muted-foreground line-through")}>{formatTime(a.start.toDate())}</span>
                  <span className="text-[13px] text-muted-foreground">até {formatTime(a.end.toDate())}</span>
                </div>
                <div className="grid min-w-0 gap-1.5">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link href={`/${tenant.id}/clientes/${customerKey(a.customerPhone)}`} className="text-base font-semibold underline-offset-4 hover:underline">
                      {a.customerName}
                    </Link>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS[a.status].className}`}>{STATUS[a.status].label}</span>
                    {a.planId && <span className="rounded-full border px-2.5 py-0.5 text-xs">Recorrente</span>}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {a.serviceName} · com {a.staffName} · {formatBRL(a.priceCents)} ·{" "}
                    <a href={whatsappLink(a.customerPhone)} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
                      {a.customerPhone}
                    </a>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Confirmar só antes do horário: depois dele já não há o que combinar com o cliente */}
                  {a.status === "booked" && a.start.toMillis() > now && (
                    <Button className="h-10 px-4" disabled={pending === a.id} onClick={() => notifyAndChange(a, "confirmed", confirmationText(a, tenant.name))}>
                      {pending === a.id ? "Confirmando…" : "Confirmar pelo WhatsApp"}
                    </Button>
                  )}
                  {ATIVO(a) && (
                    <Button variant="outline" className="h-10 px-4" aria-expanded={rescheduling === a.id} onClick={() => setRescheduling(rescheduling === a.id ? null : a.id)}>
                      Remarcar
                    </Button>
                  )}
                  <RowMenu
                    label={`Mais ações: ${a.customerName} às ${formatTime(a.start.toDate())}`}
                    actions={[
                      ...(ATIVO(a) && a.start.toMillis() <= now ? [{ label: "Faltou", onClick: () => setConfirming({ id: a.id, kind: "no_show" as const }) }] : []),
                      ...(ATIVO(a) ? [{ label: "Cancelar horário", danger: true, onClick: () => setConfirming({ id: a.id, kind: "cancel" as const }) }] : []),
                      { label: showHistory === a.id ? "Esconder histórico" : "Histórico", onClick: () => setShowHistory(showHistory === a.id ? null : a.id) },
                    ]}
                  />
                </div>
              </div>
              {confirming?.id === a.id && confirming.kind === "cancel" && (
                <ConfirmDialog
                  title={`Cancelar o agendamento de ${a.customerName}?`}
                  description={`${formatLongDate(a.start.toDate())} às ${formatTime(a.start.toDate())} · ${a.serviceName} com ${a.staffName}. O horário volta a ficar livre.`}
                  notifyLabel="Avisar o cliente pelo WhatsApp"
                  confirmLabel="Sim, cancelar"
                  onConfirm={(notify) => cancel(a, notify)}
                  onCancel={() => setConfirming(null)}
                />
              )}
              {confirming?.id === a.id && confirming.kind === "no_show" && (
                <ConfirmDialog
                  title={`Registrar que ${a.customerName} faltou?`}
                  description="Fica no histórico do cliente e não pode ser desfeito pelo painel."
                  confirmLabel="Sim, registrar falta"
                  onConfirm={() => {
                    setConfirming(null);
                    return changeStatus(a, "no_show");
                  }}
                  onCancel={() => setConfirming(null)}
                />
              )}
              {showHistory === a.id && <History tenantId={tenant.id} appointmentId={a.id} />}
              {rescheduling === a.id && (
                <Reschedule
                  tenantId={tenant.id}
                  appointment={a}
                  onClose={() => setRescheduling(null)}
                  onDone={(newDate, start) => {
                    setRescheduling(null);
                    setNotice({
                      text: `${a.customerName} remarcado para ${formatLongDate(start)} às ${formatTime(start)}.`,
                      link: whatsappLink(a.customerPhone, rescheduleText(a, tenant.name, start)),
                    });
                    setDate(newDate);
                  }}
                />
              )}
            </li>
            </Fragment>
          ))}
        </ul>
          )}
        </section>
      )}
    </>
  );
}

/** Primeiro acesso: sem ninguém para atender, o link não tem o que oferecer —
 * e "nenhum horário neste dia" faria parecer que é só um dia vazio. */
function Onboarding({ tenantId, name, temServicos }: { tenantId: string; name: string; temServicos: boolean }) {
  const passos = [
    { titulo: "Cadastre o que você faz", texto: "Serviços com duração e preço.", feito: temServicos, href: `/${tenantId}/servicos`, cta: "Cadastrar serviços" },
    { titulo: "Cadastre quem atende", texto: "Profissionais, os serviços que fazem e os horários.", feito: false, href: `/${tenantId}/profissionais`, cta: "Cadastrar profissional" },
  ];
  const feitos = passos.filter((p) => p.feito).length;
  const proximo = passos.find((p) => !p.feito);
  return (
    <section aria-labelledby="abrir" className="relative rounded-2xl border bg-card">
      <div className="flex flex-wrap items-end justify-between gap-6 p-6 sm:p-7">
        <div className="grid gap-2">
          <h2 id="abrir" className="font-serifa text-3xl leading-tight sm:text-4xl">Falta pouco para a agenda abrir</h2>
          <p className="text-[15px] text-muted-foreground">Com estes passos feitos, o seu link começa a receber marcações.</p>
        </div>
        <div className="grid justify-items-end gap-2">
          <span className="text-[13px] text-muted-foreground">{feitos} de 3</span>
          <div role="progressbar" aria-label="Passos concluídos" aria-valuenow={feitos} aria-valuemin={0} aria-valuemax={3} className="h-1.5 w-48 rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(feitos / 3) * 100}%` }} />
          </div>
        </div>
      </div>
      <ol>
        {passos.map((p, i) => (
          <li key={p.titulo} className="grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-4 border-t px-6 py-5 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto] sm:px-7">
            <Marca n={i + 1} feito={p.feito} />
            <div className="grid gap-0.5">
              <span className={cn("font-semibold", p.feito && "text-muted-foreground line-through")}>{p.titulo}</span>
              <span className="text-sm text-muted-foreground">{p.texto}</span>
            </div>
            <div className="col-start-2 sm:col-start-auto">
              {p.feito ? (
                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">Feito</span>
              ) : (
                <Link href={p.href} className={buttonVariants({ variant: p === proximo ? "default" : "outline", className: "h-10 px-4" })}>{p.cta}</Link>
              )}
            </div>
          </li>
        ))}
        <li className="grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-4 border-t px-6 py-5 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto] sm:px-7">
          <Marca n={3} feito={false} />
          <div className="grid gap-0.5">
            <span className="font-semibold">Divulgue o seu link</span>
            <span className="text-sm text-muted-foreground">Na bio do Instagram, no status do WhatsApp, para cada cliente.</span>
          </div>
          <div className="col-start-2 sm:col-start-auto">
            <ShareLink tenantId={tenantId} name={name} />
          </div>
        </li>
      </ol>
    </section>
  );
}

function Marca({ n, feito }: { n: number; feito: boolean }) {
  return feito ? (
    <span className="grid size-9 place-items-center rounded-full bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m5 12 5 5 9-10" />
      </svg>
    </span>
  ) : (
    <span aria-hidden="true" className="grid size-9 place-items-center rounded-full border font-serifa text-xl">{n}</span>
  );
}
