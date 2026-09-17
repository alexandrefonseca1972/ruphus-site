"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { auth } from "@/lib/firebase";
import { addDays, dateIn, formatLongDate, todayIn, zonedTime } from "@/lib/scheduling";
import { cn } from "@/lib/utils";
import { getRescheduleSlots, rescheduleAppointment } from "./actions";
import type { Appointment } from "./page";

const idToken = () => auth.currentUser?.getIdToken() ?? Promise.reject(new Error("Sessão expirada. Entre novamente."));

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
      .then((s) => current && setFetched({ for: key, slots: s }))
      .catch((err: Error) => current && (setError(err.message), setFetched({ for: key, slots: [] })));
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
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const id = `reschedule-${appointment.id}`;

  return (
    <div className="grid gap-3 rounded-lg bg-muted/50 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label htmlFor={id}>Nova data</Label>
          <Input
            id={id}
            type="date"
            value={date}
            min={todayIn()}
            max={addDays(todayIn(), 180)}
            onChange={(e) => {
              setDate(e.target.value);
              setTime("");
            }}
          />
        </div>
        {date && <p className="pb-2 text-sm text-muted-foreground first-letter:uppercase">{formatLongDate(zonedTime(date, "12:00"))}</p>}
      </div>

      {!date ? null : slots === null ? (
        <p className="text-sm text-muted-foreground">Buscando horários…</p>
      ) : slots.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum horário livre com {appointment.staffName} nesta data.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Horários livres">
          {slots.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={s === time}
              onClick={() => setTime(s)}
              className={cn(
                "rounded-md border bg-background px-2.5 py-1 text-sm tabular-nums hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
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
        <Button size="sm" disabled={!time || busy} onClick={save}>
          {busy ? "Remarcando…" : time ? `Remarcar para ${time}` : "Escolha um horário"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Fechar</Button>
      </div>
    </div>
  );
}
