"use client";

import { orderBy } from "firebase/firestore";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { idToken } from "@/lib/firebase";
import { WEEKDAYS, formatLongDate, planDates, todayIn, zonedTime } from "@/lib/datetime";
import { Service, Staff } from "@/lib/scheduling";
import { useCollection } from "@/lib/use-collection";
import { createPlanAction } from "./actions";

const shortDate = (date: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

const select =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function PlanForm(props: {
  tenantId: string;
  customer?: { name: string; phone: string };
  onClose: () => void;
}) {
  const { tenantId, customer, onClose } = props;
  const [services] = useCollection(tenantId, "services", Service, [orderBy("name")]);
  const [staff] = useCollection(tenantId, "staff", Staff, [orderBy("name")]);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);

  const activeServices = services?.filter((s) => s.active) ?? [];
  const professionals = staff?.filter((p) => p.active && serviceIds.every((id) => p.serviceIds.includes(id))) ?? [];

  async function submit(form: FormData) {
    setError("");
    setResult("");
    setBusy(true);
    try {
      const weekday = Number(form.get("weekday"));
      const startDate = String(form.get("startDate"));
      const res = await createPlanAction(await idToken(), {
        tenantId,
        customerName: customer?.name ?? form.get("customerName"),
        customerPhone: customer?.phone ?? form.get("customerPhone"),
        serviceIds: services?.map((s) => s.id).filter((id) => serviceIds.includes(id)),
        staffId: form.get("staffId"),
        weekday,
        time: form.get("time"),
        startDate,
        weeks: Number(form.get("weeks")),
      });
      if (!res.ok) return setError(res.error);
      const dates = res.created;
      setResult(
        `${dates.length} agendamento(s) criado(s): ${WEEKDAYS[weekday].toLowerCase()}s de ${shortDate(dates[0])} a ${shortDate(dates.at(-1)!)}.` +
          (res.skipped.length ? ` Datas puladas por falta de horário livre: ${res.skipped.map(shortDate).join(", ")}.` : ""),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div role="status" className="grid gap-3 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm dark:border-emerald-900 dark:bg-emerald-950">
        <p className="font-medium">Plano recorrente criado</p>
        <p>{result}</p>
        <Button size="sm" variant="outline" className="justify-self-start" onClick={onClose}>Fechar</Button>
      </div>
    );
  }

  return (
    <form
      className="grid gap-4 rounded-lg border p-4"
      onSubmit={(e) => {
        e.preventDefault(); // mantém os campos preenchidos se der erro
        submit(new FormData(e.currentTarget));
      }}
    >
      <h2 className="font-medium">Novo plano recorrente{customer && ` para ${customer.name}`}</h2>

      {!customer && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="plan-name">Nome do cliente</Label>
            <Input id="plan-name" name="customerName" required minLength={2} maxLength={80} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="plan-phone">WhatsApp</Label>
            <Input id="plan-phone" name="customerPhone" type="tel" inputMode="tel" placeholder="(11) 91234-5678" required />
          </div>
        </div>
      )}

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Serviços</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {activeServices.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={serviceIds.includes(s.id)}
                onChange={(e) => setServiceIds(e.target.checked ? [...serviceIds, s.id] : serviceIds.filter((id) => id !== s.id))}
              />
              {s.name}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="plan-staff">Profissional</Label>
          <select id="plan-staff" name="staffId" required className={select} disabled={!serviceIds.length}>
            <option value="">{serviceIds.length ? "Escolha" : "Escolha os serviços primeiro"}</option>
            {professionals.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="plan-weekday">Dia da semana</Label>
          <select id="plan-weekday" name="weekday" defaultValue="1" className={select}>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>{d}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="plan-time">Horário</Label>
          <Input id="plan-time" name="time" type="time" step={900} defaultValue="12:00" required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="plan-start">A partir de</Label>
          <Input id="plan-start" name="startDate" type="date" min={todayIn()} defaultValue={todayIn()} required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="plan-weeks">Quantidade de semanas</Label>
          <Input id="plan-weeks" name="weeks" type="number" min={1} max={52} defaultValue={12} required />
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !serviceIds.length}>{busy ? "Criando agendamentos…" : "Criar plano"}</Button>
        <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
      </div>
    </form>
  );
}

/** "toda segunda-feira às 12:00" / "todo sábado às 09:00" */
export const planLabel = (weekday: number, time: string) =>
  `${weekday === 0 || weekday === 6 ? "todo" : "toda"} ${formatLongDate(zonedTime(planDates(todayIn(), weekday, 1)[0], "12:00")).split(",")[0]} às ${time}`;
