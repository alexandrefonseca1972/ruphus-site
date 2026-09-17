"use client";

import Link from "next/link";
import { collection, doc, orderBy, serverTimestamp, Timestamp, where, writeBatch } from "firebase/firestore";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/auth-errors";
import { auth, db } from "@/lib/firebase";
import {
  addDays,
  customerKey,
  formatBRL,
  formatLongDate,
  formatTime,
  todayIn,
  whatsappLink,
  zonedTime,
} from "@/lib/scheduling";
import { useCollection } from "@/lib/use-collection";
import { History } from "./history";
import { useTenant } from "./layout";
import { Reschedule } from "./reschedule";
import { STATUS } from "./status";

const Appointment = z.object({
  serviceName: z.string(),
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

const firstName = (name: string) => name.trim().split(/\s+/)[0];

export function confirmationText(a: Appointment, business: string) {
  const start = a.start.toDate();
  return `Olá, ${firstName(a.customerName)}! Seu horário na ${business} está confirmado: ${a.serviceName} com ${a.staffName}, ${formatLongDate(start)} às ${formatTime(start)}. Até lá!`;
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
  async function changeStatus(a: Appointment, status: "confirmed" | "cancelled" | "no_show") {
    setError("");
    const user = auth.currentUser;
    if (!user) return setError("Sessão expirada. Entre novamente.");
    const entry = doc(collection(db, "tenants", tenant.id, "history"));
    const batch = writeBatch(db);
    batch.set(entry, { appointmentId: a.id, type: status, at: serverTimestamp(), by: user.uid, byName: user.email });
    batch.update(doc(db, "tenants", tenant.id, "appointments", a.id), { status, lastHistoryId: entry.id });
    try {
      await batch.commit();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function confirmViaWhatsapp(a: Appointment) {
    // Abre a janela antes de qualquer await, senão o navegador bloqueia o pop-up
    window.open(whatsappLink(a.customerPhone, confirmationText(a, tenant.name)), "_blank", "noopener");
    changeStatus(a, "confirmed");
  }

  function cancel(a: Appointment) {
    if (confirm(`Cancelar o agendamento de ${a.customerName}? O horário volta a ficar livre.`)) {
      changeStatus(a, "cancelled");
    }
  }

  function noShow(a: Appointment) {
    if (confirm(`Registrar que ${a.customerName} faltou?`)) changeStatus(a, "no_show");
  }

  const active = items?.filter((a) => a.status === "booked" || a.status === "confirmed") ?? [];

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
      {(error || loadError) && <p role="alert" className="text-sm text-destructive">{error || loadError}</p>}

      {!items ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhum agendamento neste dia.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {items.map((a) => (
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
                      <Button size="sm" onClick={() => confirmViaWhatsapp(a)}>
                        Confirmar pelo WhatsApp
                      </Button>
                    )}
                    <Button variant="outline" size="sm" aria-expanded={rescheduling === a.id} onClick={() => setRescheduling(rescheduling === a.id ? null : a.id)}>
                      Remarcar
                    </Button>
                    {a.start.toMillis() <= now && (
                      <Button variant="outline" size="sm" onClick={() => noShow(a)}>
                        Faltou
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => cancel(a)}>
                      Cancelar
                    </Button>
                    </>
                  )}
                  <Button variant="ghost" size="sm" aria-expanded={showHistory === a.id} onClick={() => setShowHistory(showHistory === a.id ? null : a.id)}>
                    Histórico
                  </Button>
                </div>
              </div>
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
