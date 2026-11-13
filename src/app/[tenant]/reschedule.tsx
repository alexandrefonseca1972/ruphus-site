"use client";

import { errorMessage } from "@/lib/auth-errors";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { idToken } from "@/lib/firebase";
import { addDays, dateIn, formatLongDate, todayIn, zonedTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { getRescheduleSlots, rescheduleAppointment } from "./actions";
import type { Appointment } from "./page";

export function Reschedule(props: {
  tenantId: string;
  appointment: Appointment;
  onClose: () => void;
  onDone: (date: string, start: Date) => void;
}) {
  const { tenantId, appointment, onClose, onDone } = props;
  const [date, setDate] = useState(() => dateIn(appointment.start.toDate()));
  const [time, setTime] = useState("");
  const [fetched, setFetched] = useState<{ for: string; slots: string[] } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const hoje = todayIn();
  const maxDate = addDays(hoje, 180);
  const dataValida = !!date && date >= hoje && date <= maxDate;
  const key = `${date}|${version}`;
  const slots = dataValida ? (fetched?.for === key ? fetched.slots : null) : [];

  useEffect(() => {
    if (!dataValida) return;
    let current = true;
    idToken()
      .then((token) => getRescheduleSlots(token, { tenantId, appointmentId: appointment.id, date }))
      .then((r) => {
        if (!current) return;
        if (!r.ok) setError(r.error);
        setFetched({ for: key, slots: r.ok ? r.slots : [] });
      })
      .catch((err) => current && (setError(errorMessage(err)), setFetched({ for: key, slots: [] })));
    return () => {
      current = false;
    };
  }, [tenantId, appointment.id, date, key, dataValida]);

  async function save() {
    if (busy) return;
    if (!date) return setError("Escolha a nova data do agendamento.");
    if (!dataValida) return setError(`Escolha uma data entre hoje e ${formatLongDate(zonedTime(maxDate, "12:00"))}.`);
    if (!time) return setError("Escolha um dos horários livres para concluir a remarcação.");
    setError("");
    setBusy(true);
    try {
      const result = await rescheduleAppointment(await idToken(), { tenantId, appointmentId: appointment.id, date, time });
      if (!result.ok) {
        setError(result.error);
        setTime("");
        setVersion((v) => v + 1);
        return;
      }
      onDone(date, zonedTime(date, time));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const id = `reschedule-${appointment.id}`;

  function pickDate(value: string) {
    setDate(value);
    setTime("");
    if (!value) return setError("Escolha a nova data do agendamento.");
    if (value < hoje || value > maxDate) return setError(`Escolha uma data entre hoje e ${formatLongDate(zonedTime(maxDate, "12:00"))}.`);
    setError("");
  }

  return (
    <div className="grid gap-3 rounded-lg bg-muted/50 p-3">
      <div className="grid gap-1">
        <Label htmlFor={id}>Nova data</Label>
        <Input
          id={id}
          type="date"
          value={date}
          min={hoje}
          max={maxDate}
          required
          aria-invalid={!dataValida}
          aria-describedby={`${id}-legenda${error ? ` ${id}-erro` : ""}`}
          className="h-11 w-full bg-card sm:h-9 sm:w-56"
          onChange={(e) => pickDate(e.target.value)}
        />
        {dataValida && <p id={`${id}-legenda`} className="text-sm text-muted-foreground first-letter:uppercase">{formatLongDate(zonedTime(date, "12:00"))}</p>}
      </div>

      {!dataValida ? null : slots === null ? (
        <p role="status" className="text-sm text-muted-foreground">Buscando horários…</p>
      ) : slots.length === 0 ? (
        <div className="grid gap-2">
          {!error && <FormMessage tone="warning">Nenhum horário livre com {appointment.staffName} nesta data. Escolha outro dia.</FormMessage>}
          <div className="flex flex-wrap gap-2">
            {error && <Button variant="outline" className="h-11 bg-card sm:h-9" onClick={() => { setError(""); setVersion((v) => v + 1); }}>Tentar novamente</Button>}
            {addDays(date, 1) <= maxDate && (
              <Button variant="outline" className="h-11 bg-card sm:h-9" onClick={() => pickDate(addDays(date, 1))}>
                Ver dia seguinte
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Horários livres">
          {slots.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={s === time}
              onClick={() => { setTime(s); setError(""); }}
              className={cn(
                "min-h-11 rounded-md border bg-background px-3.5 text-sm tabular-nums hover:bg-muted sm:min-h-9 sm:px-2.5 sm:py-1 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                s === time && "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {error && <FormMessage id={`${id}-erro`}>{error}</FormMessage>}
      <div className="flex flex-wrap gap-2">
        {slots && slots.length > 0 && (
          <Button className="h-11 flex-1 px-4 sm:h-9 sm:flex-none" disabled={!time || busy} onClick={save}>
            {busy ? "Remarcando…" : time ? `Remarcar para ${time}` : "Escolha um horário"}
          </Button>
        )}
        <Button variant="ghost" className="h-11 px-4 sm:h-9" disabled={busy} onClick={onClose}>Fechar</Button>
      </div>
    </div>
  );
}
