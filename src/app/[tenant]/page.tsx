"use client";

import Link from "next/link";
import { collection, doc, orderBy, serverTimestamp, Timestamp, where, writeBatch } from "firebase/firestore";
import { useState } from "react";
import { z } from "zod";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/auth-errors";
import { auth, db } from "@/lib/firebase";
import { addDays, customerKey, formatBRL, formatLongDate, formatTime, todayIn, whatsappLink, zonedTime } from "@/lib/datetime";
import { Staff } from "@/lib/scheduling";
import { useCollection } from "@/lib/use-collection";
import { cn, openExternal } from "@/lib/utils";
import { ConfirmPanel } from "./confirm-panel";
import { History } from "./history";
import { useTenant } from "./layout";
import { Reschedule } from "./reschedule";
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
  // false = quem agendou pelo site não abriu o WhatsApp com o resumo, então
  // este horário pode ser novidade para quem atende
  avisou: z.boolean().optional(),
  status: z.enum(["booked", "confirmed", "cancelled", "no_show"]),
});
export type Appointment = z.infer<typeof Appointment> & { id: string };

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
  // ponytail: instante fixo ao abrir a página; "Faltou" de horários que passaram depois aparece ao recarregar
  const [now] = useState(Date.now);
  const [items, loadError] = useCollection(
    tenant.id,
    "appointments",
    Appointment,
    [where("start", ">=", zonedTime(date, "00:00")), where("start", "<", zonedTime(addDays(date, 1), "00:00")), orderBy("start")],
    date,
  );

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
  const active = shown?.filter((a) => a.status === "booked" || a.status === "confirmed") ?? [];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Agenda</h1>
          {items && (
            <p className="text-sm text-muted-foreground">
              {active.length} agendamento(s) · {formatBRL(active.reduce((sum, a) => sum + a.priceCents, 0))} previsto
            </p>
          )}
        </div>
        <div className="flex items-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setDate(addDays(date, -1))} aria-label="Dia anterior">‹</Button>
          <div className="grid gap-1">
            <Label htmlFor="agenda-date" className="sr-only">Data</Label>
            <Input id="agenda-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </div>
          <Button variant="outline" size="sm" onClick={() => setDate(addDays(date, 1))} aria-label="Próximo dia">›</Button>
          <Button variant="ghost" size="sm" onClick={() => setDate(todayIn())}>Hoje</Button>
        </div>
      </div>

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
      {(staff?.length ?? 0) > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por profissional">
          {[{ id: "", name: "Todos" }, ...(staff ?? [])].map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={staffFilter === p.id}
              onClick={() => setStaffFilter(p.id)}
              className={cn(
                "rounded-full border px-3 py-1 text-sm hover:bg-muted",
                staffFilter === p.id && "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
              )}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {(error || loadError) && <p role="alert" className="text-sm text-destructive">{error || loadError}</p>}

      {!shown ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : shown.length === 0 && staff && staff.length === 0 ? (
        /* Primeiro acesso: sem ninguém cadastrado para atender, o link de
           agendamento não tem o que oferecer — e "Nenhum agendamento neste dia"
           faz parecer que é só um dia vazio. */
        <div className="grid gap-3 rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm font-medium">Sua agenda ainda não abriu</p>
          <p className="text-sm text-muted-foreground">
            Cadastre o que você faz e quem atende. A partir daí o seu link começa a receber marcações.
          </p>
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            <Link href={`/${tenant.id}/servicos`} className={buttonVariants({ variant: "outline" })}>
              Cadastrar serviços
            </Link>
            <Link href={`/${tenant.id}/profissionais`} className={buttonVariants()}>
              Cadastrar quem atende
            </Link>
          </div>
        </div>
      ) : shown.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {staffFilter ? "Nenhum agendamento para este profissional neste dia." : "Nenhum agendamento neste dia."}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {shown.map((a) => (
            <li key={a.id} className="grid gap-3 p-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className={`w-28 font-medium tabular-nums ${a.status === "cancelled" ? "text-muted-foreground line-through" : ""}`}>
                  {formatTime(a.start.toDate())}–{formatTime(a.end.toDate())}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <Link href={`/${tenant.id}/clientes/${customerKey(a.customerPhone)}`} className="underline-offset-4 hover:underline">
                      {a.customerName}
                    </Link>
                    {a.planId && <span className="rounded-full border px-2 py-0.5 text-xs font-normal">Recorrente</span>}
                    {a.avisou === false && !a.planId && (
                      <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-normal text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        não avisou
                      </span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-xs font-normal ${STATUS[a.status].className}`}>
                      {STATUS[a.status].label}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {a.serviceName} · {a.staffName} · {formatBRL(a.priceCents)}
                  </p>
                  <a href={whatsappLink(a.customerPhone)} target="_blank" rel="noreferrer" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
                    {a.customerPhone}
                  </a>
                </div>
                <div className="flex flex-wrap gap-1">
                  {(a.status === "booked" || a.status === "confirmed") && (
                    <>
                    {a.status === "booked" && (
                      <Button
                        size="sm"
                        disabled={pending === a.id}
                        onClick={() => notifyAndChange(a, "confirmed", confirmationText(a, tenant.name))}
                      >
                        {pending === a.id ? "Confirmando…" : "Confirmar pelo WhatsApp"}
                      </Button>
                    )}
                    <Button variant="outline" size="sm" aria-expanded={rescheduling === a.id} onClick={() => setRescheduling(rescheduling === a.id ? null : a.id)}>
                      Remarcar
                    </Button>
                    {a.start.toMillis() <= now && (
                      <Button variant="outline" size="sm" onClick={() => setConfirming({ id: a.id, kind: "no_show" })}>
                        Faltou
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => setConfirming({ id: a.id, kind: "cancel" })}>
                      Cancelar
                    </Button>
                    </>
                  )}
                  <Button variant="ghost" size="sm" aria-expanded={showHistory === a.id} onClick={() => setShowHistory(showHistory === a.id ? null : a.id)}>
                    Histórico
                  </Button>
                </div>
              </div>
              {confirming?.id === a.id && confirming.kind === "cancel" && (
                <ConfirmPanel
                  title={`Cancelar o agendamento de ${a.customerName}?`}
                  description={`${formatLongDate(a.start.toDate())} às ${formatTime(a.start.toDate())} · ${a.serviceName} com ${a.staffName}. O horário volta a ficar livre.`}
                  notifyLabel="Avisar o cliente pelo WhatsApp"
                  confirmLabel="Sim, cancelar"
                  onConfirm={(notify) => cancel(a, notify)}
                  onCancel={() => setConfirming(null)}
                />
              )}
              {confirming?.id === a.id && confirming.kind === "no_show" && (
                <ConfirmPanel
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
          ))}
        </ul>
      )}
    </>
  );
}
