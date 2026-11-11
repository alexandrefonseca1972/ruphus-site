"use client";

import { errorMessage } from "@/lib/auth-errors";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
  const key = `${date}|${version}`;
  const slots = fetched?.for === key ? fetched.slots : null;

  useEffect(() => {
    if (!date) return;
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
  }, [tenantId, appointment.id, date, key]);

  async function save() {
    setError("");
    setBusy(true);
    try {
      const result = await rescheduleAppointment(await idToken(), { tenantId, appointmentId: appointment.id, date, time });
      if (!result.ok) {
        setError(result.error);
        setTime("");
        setVersion((v) => v + 1); // busca os horários de novo
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
  const maxDate = addDays(todayIn(), 180);

  function pickDate(value: string) {
    setDate(value);
    setTime("");
    setError("");
  }

  return (
    <div className="grid gap-3 rounded-lg bg-muted/50 p-3">
      {/* Data por extenso embaixo do campo: ao lado, no celular, ficava espremida e desalinhada */}
      <div className="grid gap-1">
        <Label htmlFor={id}>Nova data</Label>
        <Input
          id={id}
          type="date"
          value={date}
          min={todayIn()}
          max={maxDate}
          className="h-11 w-full bg-card sm:h-8 sm:w-56"
          onChange={(e) => pickDate(e.target.value)}
        />
        {date && <p className="text-sm text-muted-foreground first-letter:uppercase">{formatLongDate(zonedTime(date, "12:00"))}</p>}
      </div>

      {!date ? null : slots === null ? (
        <p className="text-sm text-muted-foreground">Buscando horários…</p>
      ) : slots.length === 0 ? (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">Nenhum horário livre com {appointment.staffName} nesta data.</p>
          {addDays(date, 1) <= maxDate && (
            <Button variant="outline" className="h-11 w-full bg-card sm:h-8 sm:w-auto sm:justify-self-start" onClick={() => pickDate(addDays(date, 1))}>
              Ver dia seguinte
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Horários livres">
          {slots.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={s === time}
              onClick={() => setTime(s)}
              className={cn(
                "min-h-11 rounded-md border bg-background px-3.5 text-sm tabular-nums hover:bg-muted sm:min-h-0 sm:px-2.5 sm:py-1 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                s === time && "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        {/* Sem horário livre não há o que remarcar: o botão desabilitado só confundia */}
        {slots && slots.length > 0 && (
          <Button className="h-11 flex-1 px-4 sm:h-8 sm:flex-none" disabled={!time || busy} onClick={save}>
            {busy ? "Remarcando…" : time ? `Remarcar para ${time}` : "Escolha um horário"}
          </Button>
        )}
        <Button variant="ghost" className="h-11 px-4 sm:h-8" onClick={onClose}>Fechar</Button>
      </div>
    </div>
  );
}
