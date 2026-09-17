"use client";

import { orderBy, Timestamp, where } from "firebase/firestore";
import { z } from "zod";
import { TIMEZONE, formatLongDate, formatTime } from "@/lib/datetime";
import { useCollection } from "@/lib/use-collection";

const Range = z.object({ start: z.instanceof(Timestamp), end: z.instanceof(Timestamp) });
const Entry = z.object({
  type: z.enum(["created", "confirmed", "rescheduled", "cancelled", "no_show"]),
  at: z.instanceof(Timestamp),
  by: z.string(),
  byName: z.string().nullish(),
  planId: z.string().optional(),
  reason: z.string().optional(),
  from: Range.optional(),
  to: Range.optional(),
});
type Entry = z.infer<typeof Entry>;

const when = (d: Date) => `${formatLongDate(d)} às ${formatTime(d)}`;
const stamp = new Intl.DateTimeFormat("pt-BR", { timeZone: TIMEZONE, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

function describe(e: Entry) {
  const who = e.byName || e.by;
  switch (e.type) {
    case "created":
      return e.planId ? `Agendado pelo plano recorrente por ${who}` : `Agendado online por ${who}`;
    case "confirmed":
      return `Confirmado pelo WhatsApp por ${who}`;
    case "rescheduled":
      return e.from && e.to
        ? `Remarcado de ${when(e.from.start.toDate())} para ${when(e.to.start.toDate())} por ${who}`
        : `Remarcado por ${who}`;
    case "cancelled":
      return e.reason === "plan_ended" ? `Cancelado ao encerrar o plano recorrente, por ${who}` : `Cancelado por ${who}`;
    case "no_show":
      return `Falta registrada por ${who}`;
  }
}

export function History({ tenantId, appointmentId }: { tenantId: string; appointmentId: string }) {
  const [entries, error] = useCollection(
    tenantId,
    "history",
    Entry,
    [where("appointmentId", "==", appointmentId), orderBy("at")],
    appointmentId,
  );

  return (
    <div className="rounded-lg bg-muted/50 p-3 text-sm">
      <h3 className="mb-2 font-medium">Histórico</h3>
      {error ? (
        <p role="alert" className="text-destructive">{error}</p>
      ) : !entries ? (
        <p className="text-muted-foreground">Carregando…</p>
      ) : entries.length === 0 ? (
        <p className="text-muted-foreground">Sem registros (agendamento anterior ao histórico).</p>
      ) : (
        <ol className="grid gap-1.5">
          {entries.map((e) => (
            <li key={e.id} className="grid gap-x-3 sm:grid-cols-[9.5rem_1fr]">
              <time className="text-muted-foreground tabular-nums" dateTime={e.at.toDate().toISOString()}>
                {stamp.format(e.at.toDate())}
              </time>
              <span>{describe(e)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
