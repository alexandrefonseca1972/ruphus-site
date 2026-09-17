"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addDays, formatBRL, formatDuration, formatLongDate, zonedTime } from "@/lib/scheduling";
import { cn } from "@/lib/utils";
import { createBooking, getSlots } from "./actions";

type Props = {
  tenantId: string;
  today: string;
  name: string;
  services: { id: string; name: string; durationMin: number; priceCents: number }[];
  staff: { id: string; name: string; serviceIds: string[] }[];
};

const longDate = (date: string) => formatLongDate(zonedTime(date, "12:00"));

function Choice({ selected, ...props }: React.ComponentProps<"button"> & { selected: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      {...props}
      className={cn(
        "rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        selected && "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
        props.className,
      )}
    />
  );
}

export function BookingForm({ tenantId, today, name, services, staff }: Props) {
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("");
  const [slotsVersion, setSlotsVersion] = useState(0);
  const slotsKey = `${serviceIds.join(",")}|${staffId}|${date}|${slotsVersion}`;
  const [fetched, setFetched] = useState<{ for: string; slots: string[] } | null>(null);
  const slots = fetched?.for === slotsKey ? fetched.slots : null;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const chosen = services.filter((s) => serviceIds.includes(s.id));
  const totalMin = chosen.reduce((sum, s) => sum + s.durationMin, 0);
  const totalCents = chosen.reduce((sum, s) => sum + s.priceCents, 0);
  const doesAll = (p: Props["staff"][number], ids: string[]) => ids.every((id) => p.serviceIds.includes(id));
  const professionals = staff.filter((p) => doesAll(p, serviceIds));
  const professional = professionals.find((p) => p.id === staffId);

  useEffect(() => {
    if (!serviceIds.length || !staffId || !date) return;
    let current = true;
    getSlots({ tenantId, serviceIds, staffId, date }).then((s) => current && setFetched({ for: slotsKey, slots: s }));
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
    if (!available.some((p) => p.id === staffId)) setStaffId(available.length === 1 ? available[0].id : "");
    setTime("");
    setError("");
  }

  async function submit(form: FormData) {
    setError("");
    setBusy(true);
    const result = await createBooking({
      tenantId,
      serviceIds,
      staffId,
      date,
      time,
      customerName: form.get("customerName"),
      customerPhone: form.get("customerPhone"),
    });
    setBusy(false);
    if (result.ok) return setDone(true);
    setError(result.error);
    setTime("");
    setSlotsVersion((v) => v + 1);
  }

  if (done && chosen.length && professional) {
    return (
      <main className="mx-auto w-full max-w-lg p-4 py-12">
        <Card>
          <CardHeader>
            <CardTitle>Agendamento confirmado</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            <p className="text-base font-medium">{chosen.map((s) => s.name).join(" + ")} com {professional.name}</p>
            <p>{formatDuration(totalMin)} · {formatBRL(totalCents)}</p>
            <p className="first-letter:uppercase">{longDate(date)}, às {time}</p>
            <p className="text-muted-foreground">{name}</p>
            <Button className="mt-4" variant="outline" onClick={() => location.reload()}>
              Fazer outro agendamento
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto grid w-full max-w-lg gap-6 p-4 py-10">
      <header>
        <p className="text-sm text-muted-foreground">Agendamento online</p>
        <h1 className="text-2xl font-semibold">{name}</h1>
      </header>

      <section aria-labelledby="s-service" className="grid gap-2">
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
        <section aria-labelledby="s-staff" className="grid gap-2">
          <h2 id="s-staff" className="font-medium">2. Profissional</h2>
          {professionals.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum profissional faz {chosen.length > 1 ? "todos esses serviços juntos. Tente separar em agendamentos diferentes." : "este serviço."}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            {professionals.map((p) => (
              <Choice key={p.id} selected={p.id === staffId} onClick={() => {
                  setStaffId(p.id);
                  setTime("");
                }}>
                {p.name}
              </Choice>
            ))}
          </div>
        </section>
      )}

      {professional && (
        <section aria-labelledby="s-date" className="grid gap-2">
          <h2 id="s-date" className="font-medium">3. Data e horário</h2>
          <Label htmlFor="date" className="sr-only">Data</Label>
          <Input id="date" type="date" value={date} min={today} max={addDays(today, 90)} onChange={(e) => {
              setDate(e.target.value);
              setTime("");
            }} />
          {date && <p className="text-sm text-muted-foreground first-letter:uppercase">{longDate(date)}</p>}
          {!date ? null : slots === null ? (
            <p className="text-sm text-muted-foreground">Buscando horários…</p>
          ) : slots.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum horário livre nesta data. Tente outro dia.</p>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
              {slots.map((s) => (
                <Choice key={s} selected={s === time} onClick={() => setTime(s)} className="text-center tabular-nums">
                  {s}
                </Choice>
              ))}
            </div>
          )}
        </section>
      )}

      {time && (
        <section aria-labelledby="s-contact" className="grid gap-2">
          <h2 id="s-contact" className="font-medium">4. Seus dados</h2>
          <form action={submit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="customerName">Nome</Label>
              <Input id="customerName" name="customerName" autoComplete="name" required minLength={2} maxLength={80} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="customerPhone">WhatsApp</Label>
              <Input id="customerPhone" name="customerPhone" type="tel" autoComplete="tel" inputMode="tel" placeholder="(11) 91234-5678" required />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={busy}>
              {busy ? "Confirmando…" : `Confirmar ${time}`}
            </Button>
          </form>
        </section>
      )}

      {!time && error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </main>
  );
}
