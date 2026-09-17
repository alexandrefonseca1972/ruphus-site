"use client";

import { doc, onSnapshot, orderBy, Timestamp, where } from "firebase/firestore";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { db, idToken } from "@/lib/firebase";
import { dateIn, formatBRL, formatLongDate, formatTime, whatsappLink } from "@/lib/scheduling";
import { useCollection } from "@/lib/use-collection";
import { endPlanAction } from "../../actions";
import { History } from "../../history";
import { useTenant } from "../../layout";
import { PlanForm, planLabel } from "../../plan-form";
import { STATUS } from "../../status";

const Appointment = z.object({
  serviceName: z.string(),
  staffName: z.string(),
  priceCents: z.number(),
  start: z.instanceof(Timestamp),
  status: z.enum(["booked", "confirmed", "cancelled", "no_show"]),
  planId: z.string().optional(),
});

const Plan = z.object({
  serviceName: z.string(),
  staffName: z.string(),
  weekday: z.number(),
  time: z.string(),
  firstDate: z.string(),
  lastDate: z.string(),
  count: z.number(),
  status: z.enum(["active", "ended"]),
  createdBy: z.string(),
  createdAt: z.instanceof(Timestamp),
});

const shortDate = (date: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

export default function CustomerPage() {
  const tenant = useTenant();
  const { customer: key } = useParams<{ customer: string }>();
  const [customer, setCustomer] = useState<{ name: string; phone: string } | null | undefined>(undefined);
  const [appointments] = useCollection(tenant.id, "appointments", Appointment, [where("customerKey", "==", key), orderBy("start", "desc")], key);
  const [plans] = useCollection(tenant.id, "plans", Plan, [where("customerKey", "==", key)], key);
  const [planning, setPlanning] = useState(false);
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [now] = useState(Date.now);

  useEffect(
    () =>
      onSnapshot(
        doc(db, "tenants", tenant.id, "customers", key),
        (snap) => setCustomer(snap.exists() ? { name: snap.get("name"), phone: snap.get("phone") } : null),
        () => setCustomer(null),
      ),
    [tenant.id, key],
  );

  async function endPlan(planId: string, label: string) {
    if (!confirm(`Encerrar o plano ${label}? Os agendamentos futuros dele serão cancelados.`)) return;
    setError("");
    try {
      const res = await endPlanAction(await idToken(), { tenantId: tenant.id, planId });
      if (!res.ok) setError(res.error);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (customer === undefined) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (customer === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Cliente não encontrado. <Link href={`/${tenant.id}/clientes`} className="underline">Ver clientes</Link>
      </p>
    );
  }

  const past = appointments?.filter((a) => a.start.toMillis() <= now) ?? [];
  const count = (status: string) => appointments?.filter((a) => a.status === status).length ?? 0;
  const attended = past.filter((a) => a.status === "booked" || a.status === "confirmed");
  const upcoming = appointments?.filter((a) => a.start.toMillis() > now && (a.status === "booked" || a.status === "confirmed")).length ?? 0;
  const stats = [
    { label: "Agendamentos", value: appointments?.length ?? 0 },
    { label: "Próximos", value: upcoming },
    { label: "Atendidos", value: attended.length },
    { label: "Faltas", value: count("no_show") },
    { label: "Cancelados", value: count("cancelled") },
    { label: "Total gasto", value: formatBRL(attended.reduce((sum, a) => sum + a.priceCents, 0)) },
  ];
  const sortedPlans = plans?.toSorted((a, b) => (a.status === b.status ? b.createdAt.toMillis() - a.createdAt.toMillis() : a.status === "active" ? -1 : 1));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href={`/${tenant.id}/clientes`} className="text-sm text-muted-foreground underline-offset-4 hover:underline">← Clientes</Link>
          <h1 className="text-2xl font-semibold">{customer.name}</h1>
          <a href={whatsappLink(customer.phone)} target="_blank" rel="noreferrer" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            {customer.phone} · WhatsApp
          </a>
        </div>
        {!planning && <Button onClick={() => setPlanning(true)}>Novo plano recorrente</Button>}
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border p-3">
            <dt className="text-xs text-muted-foreground">{s.label}</dt>
            <dd className={`text-lg font-semibold tabular-nums ${s.label === "Faltas" && s.value ? "text-red-700 dark:text-red-400" : ""}`}>{s.value}</dd>
          </div>
        ))}
      </dl>

      {planning && <PlanForm tenantId={tenant.id} customer={customer} onClose={() => setPlanning(false)} />}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {!!sortedPlans?.length && (
        <section className="grid gap-2">
          <h2 className="font-medium">Planos recorrentes</h2>
          <ul className="divide-y rounded-lg border">
            {sortedPlans.map((p) => {
              const label = planLabel(p.weekday, p.time);
              return (
                <li key={p.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 p-3 ${p.status === "ended" ? "opacity-60" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium first-letter:uppercase">
                      {label}
                      {p.status === "ended" && <span className="ml-2 text-xs font-normal">(encerrado)</span>}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {p.serviceName} · {p.staffName} · {p.count} agendamento(s), de {shortDate(p.firstDate)} a {shortDate(p.lastDate)}
                    </p>
                    <p className="text-xs text-muted-foreground">Criado por {p.createdBy}</p>
                  </div>
                  {p.status === "active" && p.lastDate >= dateIn(new Date(now)) && (
                    <Button variant="outline" size="sm" onClick={() => endPlan(p.id, label)}>Encerrar plano</Button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="grid gap-2">
        <h2 className="font-medium">Histórico de agendamentos</h2>
        {!appointments ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : appointments.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum agendamento.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {appointments.map((a) => (
              <li key={a.id} className="grid gap-2 p-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      <span className="first-letter:uppercase">{formatLongDate(a.start.toDate())}, {formatTime(a.start.toDate())}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-normal ${STATUS[a.status].className}`}>{STATUS[a.status].label}</span>
                      {a.planId && <span className="rounded-full border px-2 py-0.5 text-xs font-normal">Recorrente</span>}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {a.serviceName} · {a.staffName} · {formatBRL(a.priceCents)}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" aria-expanded={openHistory === a.id} onClick={() => setOpenHistory(openHistory === a.id ? null : a.id)}>
                    Histórico
                  </Button>
                </div>
                {openHistory === a.id && <History tenantId={tenant.id} appointmentId={a.id} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
