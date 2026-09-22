"use client";

import { orderBy } from "firebase/firestore";
import { useEffect, useState } from "react";
import { getAgenda } from "@/app/agendar/[tenant]/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { idToken } from "@/lib/firebase";
import { MAX_DAYS_AHEAD, WEEKDAYS, addDays, formatBRL, formatDuration, formatLongDate, formatPhone, planDates, todayIn, weekday, zonedTime } from "@/lib/datetime";
import { Service, Staff } from "@/lib/scheduling";
import { useCollection } from "@/lib/use-collection";
import { cn } from "@/lib/utils";
import { createPlanAction } from "./actions";

type Dia = { date: string; horarios: { hora: string; staffId: string }[] };

const shortDate = (date: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
const parte = (date: string, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("pt-BR", { ...o, timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)).replace(".", "");

const CHIP = "rounded-xl border bg-card hover:border-foreground/40";
const CHIP_SEL = "border-primary bg-primary text-primary-foreground hover:border-primary";

/** O plano escolhe dia e horário como a página de agendamento: serviços, com
 * quem, a semana com as vagas e a grade de horários livres. O primeiro dia
 * escolhido define o dia da semana; as semanas seguintes que estiverem
 * ocupadas o servidor pula e devolve. */
export function PlanForm(props: {
  tenantId: string;
  customer?: { name: string; phone: string };
  onClose: () => void;
}) {
  const { tenantId, customer, onClose } = props;
  const [services] = useCollection(tenantId, "services", Service, [orderBy("name")]);
  const [staff] = useCollection(tenantId, "staff", Staff, [orderBy("name")]);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [staffId, setStaffId] = useState("");
  const [hoje] = useState(todayIn);
  const [from, setFrom] = useState(hoje);
  const [buscado, setBuscado] = useState<{ para: string; dias: Dia[] } | null>(null);
  const [date, setDate] = useState("");
  const [escolha, setEscolha] = useState<{ hora: string; staffId: string } | null>(null);
  const [phone, setPhone] = useState("");
  const [weeks, setWeeks] = useState(12);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);

  const activeServices = services?.filter((s) => s.active) ?? [];
  const professionals = staff?.filter((p) => p.active && serviceIds.every((id) => p.serviceIds.includes(id))) ?? [];
  const escolhidos = activeServices.filter((s) => serviceIds.includes(s.id));
  // A agenda recebida vale para esta combinação; trocar qualquer parte volta ao "carregando"
  const chave = `${serviceIds.join(",")}|${staffId}|${from}`;
  const agenda = buscado?.para === chave ? buscado.dias : null;
  const dia = agenda?.find((d) => d.date === date);

  useEffect(() => {
    if (!serviceIds.length) return;
    let atual = true;
    getAgenda({ tenantId, serviceIds, staffId, from })
      .catch(() => {
        if (atual) setError("Não foi possível carregar os horários. Tente de novo.");
        return [] as Dia[];
      })
      .then((dias) => atual && setBuscado({ para: chave, dias }));
    return () => {
      atual = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- serviceIds, staffId e from já estão em chave
  }, [tenantId, chave]);

  // O primeiro dia com vaga já vem aberto, como na página de agendamento
  useEffect(() => {
    if (!agenda) return;
    if (agenda.some((d) => d.date === date && d.horarios.length)) return;
    setDate(agenda.find((d) => d.horarios.length)?.date ?? agenda[0]?.date ?? ""); // eslint-disable-line react-hooks/set-state-in-effect -- segue a agenda recebida
  }, [agenda, date]);

  function toggleService(id: string) {
    // Ordem do catálogo, não dos cliques
    const ids = activeServices.map((s) => s.id).filter((s) => (s === id ? !serviceIds.includes(id) : serviceIds.includes(s)));
    setServiceIds(ids);
    if (staffId && !ids.every((s) => staff?.find((p) => p.id === staffId)?.serviceIds.includes(s))) setStaffId("");
    setEscolha(null);
  }

  async function submit(form: FormData) {
    if (!escolha || !date) return setError("Escolha o dia e o horário.");
    setError("");
    setResult("");
    setBusy(true);
    try {
      const wd = weekday(date);
      const res = await createPlanAction(await idToken(), {
        tenantId,
        customerName: customer?.name ?? form.get("customerName"),
        customerPhone: customer?.phone ?? phone,
        serviceIds,
        staffId: staffId || escolha.staffId,
        weekday: wd,
        time: escolha.hora,
        startDate: date,
        weeks,
      });
      if (!res.ok) return setError(res.error);
      const dates = res.created;
      setResult(
        `${dates.length} agendamento(s) criado(s): ${WEEKDAYS[wd].toLowerCase()}s de ${shortDate(dates[0])} a ${shortDate(dates.at(-1)!)}.` +
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
      <div role="status" className="grid gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-5 text-sm dark:border-emerald-900 dark:bg-emerald-950">
        <p className="font-semibold">Plano recorrente criado</p>
        <p>{result}</p>
        <Button variant="outline" className="h-10 justify-self-start px-4" onClick={onClose}>Fechar</Button>
      </div>
    );
  }

  const quem = staffId ? professionals.find((p) => p.id === staffId)?.name : staff?.find((p) => p.id === escolha?.staffId)?.name;

  return (
    <form
      className="grid gap-6 rounded-2xl border bg-card p-5 sm:p-6"
      onSubmit={(e) => {
        e.preventDefault(); // mantém os campos preenchidos se der erro
        submit(new FormData(e.currentTarget));
      }}
    >
      <h2 className="font-serifa text-2xl leading-tight">Novo plano recorrente{customer && ` para ${customer.name}`}</h2>

      {!customer && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="plan-name">Nome do cliente</Label>
            <Input id="plan-name" name="customerName" required minLength={2} maxLength={80} className="h-11 bg-card px-3.5 text-[15px]" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="plan-phone">WhatsApp</Label>
            <Input
              id="plan-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(11) 91234-5678"
              required
              value={phone}
              onChange={(e) => setPhone(formatPhone(e.target.value))}
              className="h-11 bg-card px-3.5 text-[15px] tabular-nums"
            />
          </div>
        </div>
      )}

      <fieldset className="grid gap-2.5">
        <legend className="mb-2.5 text-sm font-medium">O que vai fazer</legend>
        <div className="flex flex-wrap gap-2">
          {activeServices.map((s) => {
            const sel = serviceIds.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={sel}
                onClick={() => toggleService(s.id)}
                className={cn(CHIP, "flex min-h-14 flex-col justify-center gap-0.5 px-3.5 py-2 text-left", sel && CHIP_SEL)}
              >
                <span className="text-sm font-semibold">{s.name}</span>
                <span className={cn("text-xs tabular-nums", sel ? "opacity-80" : "text-muted-foreground")}>
                  {formatDuration(s.durationMin)} · {formatBRL(s.priceCents)}
                </span>
              </button>
            );
          })}
        </div>
        {escolhidos.length > 1 && (
          <p className="text-xs text-muted-foreground tabular-nums">
            somando: {formatDuration(escolhidos.reduce((t, s) => t + s.durationMin, 0))} · {formatBRL(escolhidos.reduce((t, s) => t + s.priceCents, 0))}
          </p>
        )}
      </fieldset>

      {!serviceIds.length ? (
        <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">Escolha os serviços e os horários livres aparecem aqui.</p>
      ) : (
        <>
          {professionals.length > 1 && (
            <fieldset className="grid gap-2.5">
              <legend className="mb-2.5 text-sm font-medium">Com quem</legend>
              <div className="flex flex-wrap gap-2">
                {[{ id: "", name: "Qualquer um" }, ...professionals].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={staffId === p.id}
                    onClick={() => {
                      setStaffId(p.id);
                      setEscolha(null);
                    }}
                    className={cn("h-10 rounded-full border bg-card px-4 text-sm hover:border-foreground/40", staffId === p.id && CHIP_SEL)}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset className="grid gap-3">
            <legend className="mb-2.5 text-sm font-medium">Primeiro dia</legend>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:grid sm:grid-cols-7">
              {(agenda ?? Array.from({ length: 7 }, (_, i) => ({ date: addDays(from, i), horarios: [] }))).map((d) => {
                const sel = d.date === date;
                const vazio = !d.horarios.length;
                const rotulo = d.date === hoje ? "hoje" : d.date === addDays(hoje, 1) ? "amanhã" : parte(d.date, { weekday: "short" });
                return (
                  <button
                    key={d.date}
                    type="button"
                    aria-pressed={sel}
                    disabled={!agenda || vazio}
                    onClick={() => {
                      setDate(d.date);
                      setEscolha(null);
                    }}
                    aria-label={`${formatLongDate(zonedTime(d.date, "12:00"))}, ${agenda ? (vazio ? "sem horário" : `${d.horarios.length} horários livres`) : "carregando"}`}
                    className={cn(
                      CHIP,
                      "flex min-h-[72px] w-[62px] shrink-0 flex-col items-center justify-center gap-0.5 sm:w-auto",
                      sel ? CHIP_SEL : vazio && "border-dashed bg-transparent text-muted-foreground hover:border-border",
                    )}
                  >
                    <span className="text-[11px] tracking-wider uppercase opacity-75">{rotulo}</span>
                    <span className="font-serifa text-2xl leading-none">{parte(d.date, { day: "numeric" })}</span>
                    <span className={cn("text-[11px]", sel ? "opacity-80" : vazio ? "" : "text-emerald-800 dark:text-emerald-300")}>
                      {agenda ? (vazio ? "fechado" : `${d.horarios.length} livres`) : "—"}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2.5">
              <Label htmlFor="plan-from" className="text-[13px] font-normal text-muted-foreground">Outra data</Label>
              <Input
                id="plan-from"
                type="date"
                value={from}
                min={hoje}
                max={addDays(hoje, MAX_DAYS_AHEAD)}
                onChange={(e) => {
                  if (!e.target.value) return;
                  setFrom(e.target.value);
                  setDate(e.target.value);
                  setEscolha(null);
                }}
                className="h-10 w-auto bg-card"
              />
            </div>
          </fieldset>

          <fieldset className="grid gap-3">
            <legend className="mb-2.5 text-sm font-medium">Horário</legend>
            <p className="sr-only" aria-live="polite">
              {!agenda ? "Buscando horários" : !dia?.horarios.length ? "Nenhum horário livre nesta data" : `${dia.horarios.length} horários disponíveis`}
            </p>
            {!agenda ? (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8" aria-hidden="true">
                {Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className="h-12 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
                ))}
              </div>
            ) : !dia?.horarios.length ? (
              <p className="text-sm text-muted-foreground">Nenhum horário livre nesta data. Os dias com vaga estão marcados acima.</p>
            ) : (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
                {dia.horarios.map((h) => (
                  <button
                    key={h.hora}
                    type="button"
                    aria-pressed={escolha?.hora === h.hora}
                    onClick={() => setEscolha(h)}
                    className={cn(CHIP, "min-h-12 text-[15px] tabular-nums", escolha?.hora === h.hora && CHIP_SEL)}
                  >
                    {h.hora}
                  </button>
                ))}
              </div>
            )}
          </fieldset>

          <div className="flex flex-wrap items-end gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="plan-weeks">Por quantas semanas</Label>
              <Input
                id="plan-weeks"
                type="number"
                min={1}
                max={52}
                value={weeks}
                onChange={(e) => setWeeks(Math.min(52, Math.max(1, Number(e.target.value) || 1)))}
                className="h-11 w-28 bg-card px-3.5 text-[15px] tabular-nums"
              />
            </div>
            {escolha && date && (
              <p className="pb-3 text-sm">
                <span className="font-semibold">{planLabel(weekday(date), escolha.hora)}</span>
                {quem && ` com ${quem}`}, de {shortDate(date)} a {shortDate(addDays(date, (weeks - 1) * 7))}.
              </p>
            )}
          </div>
        </>
      )}

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" className="h-11 px-5" disabled={busy || !escolha}>{busy ? "Criando agendamentos…" : "Criar plano"}</Button>
        <Button type="button" variant="ghost" className="h-11 px-4" onClick={onClose}>Cancelar</Button>
      </div>
    </form>
  );
}

/** "toda segunda-feira às 12:00" / "todo sábado às 09:00" */
export const planLabel = (weekday: number, time: string) =>
  `${weekday === 0 || weekday === 6 ? "todo" : "toda"} ${formatLongDate(zonedTime(planDates(todayIn(), weekday, 1)[0], "12:00")).split(",")[0]} às ${time}`;
