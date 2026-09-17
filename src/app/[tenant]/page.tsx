"use client";

import { doc, orderBy, Timestamp, updateDoc, where } from "firebase/firestore";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/auth-errors";
import { db } from "@/lib/firebase";
import { addDays, formatBRL, formatTime, todayIn, zonedTime } from "@/lib/scheduling";
import { useCollection } from "@/lib/use-collection";
import { useTenant } from "./layout";

const Appointment = z.object({
  serviceName: z.string(),
  staffName: z.string(),
  priceCents: z.number(),
  start: z.instanceof(Timestamp),
  end: z.instanceof(Timestamp),
  customerName: z.string(),
  customerPhone: z.string(),
  status: z.enum(["booked", "cancelled"]),
});

const whatsapp = (phone: string) => {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits.length <= 11 ? `55${digits}` : digits}`;
};

export default function AgendaPage() {
  const tenant = useTenant();
  const [date, setDate] = useState(todayIn);
  const [error, setError] = useState("");
  const [items, loadError] = useCollection(
    tenant.id,
    "appointments",
    Appointment,
    [where("start", ">=", zonedTime(date, "00:00")), where("start", "<", zonedTime(addDays(date, 1), "00:00")), orderBy("start")],
    date,
  );

  async function cancel(id: string, label: string) {
    if (!confirm(`Cancelar o agendamento de ${label}? O horário volta a ficar livre.`)) return;
    try {
      await updateDoc(doc(db, "tenants", tenant.id, "appointments", id), { status: "cancelled" });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const booked = items?.filter((a) => a.status === "booked") ?? [];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Agenda</h1>
          {items && (
            <p className="text-sm text-muted-foreground">
              {booked.length} agendamento(s) · {formatBRL(booked.reduce((sum, a) => sum + a.priceCents, 0))} previsto
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
            <li key={a.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 p-3 ${a.status === "cancelled" ? "opacity-50" : ""}`}>
              <span className="w-28 font-medium tabular-nums">
                {formatTime(a.start.toDate())}–{formatTime(a.end.toDate())}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {a.customerName}
                  {a.status === "cancelled" && <span className="ml-2 text-xs font-normal">(cancelado)</span>}
                </p>
                <p className="text-sm text-muted-foreground">
                  {a.serviceName} · {a.staffName} · {formatBRL(a.priceCents)}
                </p>
              </div>
              <a href={whatsapp(a.customerPhone)} target="_blank" rel="noreferrer" className="text-sm underline-offset-4 hover:underline">
                {a.customerPhone}
              </a>
              {a.status === "booked" && (
                <Button variant="ghost" size="sm" onClick={() => cancel(a.id, a.customerName)}>
                  Cancelar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
