"use client";

import { useState } from "react";
import { BarChart3, CalendarCheck, ChevronDown, ChevronUp, Clock3, CreditCard, Filter, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/datetime";
import type { Appointment } from "./page";

type Profissional = { id: string; name: string };
export type FiltroStatus = "booked" | "signal" | null;

export const INICIO_EXPEDIENTE = 8 * 60;
export const FIM_EXPEDIENTE = 18 * 60;
export const INTERVALOS = Array.from({ length: 20 }, (_, i) => INICIO_EXPEDIENTE + i * 30);
const HORAS = Array.from({ length: 10 }, (_, i) => INICIO_EXPEDIENTE + i * 60);

const minutos = (d: Date) => {
  const [h, m] = formatTime(d).split(":").map(Number);
  return h * 60 + m;
};
const hora = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const cobre = (a: Appointment, inicio: number, duracao = 30) => minutos(a.start.toDate()) < inicio + duracao && minutos(a.end.toDate()) > inicio;

export function horariosVagos(items: Appointment[], staff: Profissional[]) {
  return staff.reduce((total, p) => total + INTERVALOS.filter((inicio) => !items.some((a) => a.staffId === p.id && cobre(a, inicio))).length, 0);
}

export function AgendaOverview({ items, staff, previsto, filtro, onFilter }: {
  items: Appointment[];
  staff: Profissional[];
  previsto: string;
  filtro: FiltroStatus;
  onFilter: (filtro: FiltroStatus) => void;
}) {
  const vagos = horariosVagos(items, staff);
  const capacidade = staff.length * INTERVALOS.length;
  const ocupacao = capacidade ? Math.round(((capacidade - vagos) / capacidade) * 100) : 0;
  const confirmados = items.filter((a) => a.status === "confirmed").length;
  const aguardando = items.filter((a) => a.status === "booked" && a.sinal?.status !== "pendente").length;
  const sinais = items.filter((a) => a.sinal?.status === "pendente").length;
  const metricas = [
    { label: "Agendamentos", value: String(items.length), icone: CalendarCheck },
    { label: "Confirmados", value: `${items.length ? Math.round((confirmados / items.length) * 100) : 0}%`, icone: Clock3 },
    { label: "Ocupação", value: `${ocupacao}%`, icone: BarChart3 },
    { label: "Previsto", value: previsto, icone: CreditCard },
  ];
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-xl border bg-card lg:grid-cols-4" aria-label="Resumo executivo do dia">
      {metricas.map(({ label, value, icone: Icone }, i) => (
        <div key={label} className={cn("min-w-0 px-3 py-2.5 sm:px-4", i > 0 && "border-l", i > 1 && "max-lg:border-t", i === 2 && "max-lg:border-l-0")}>
          <dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Icone className="size-3.5" strokeWidth={1.8} aria-hidden="true" />{label}</dt>
          <dd className={cn("mt-0.5 font-serifa text-[23px] leading-none tabular-nums sm:text-[25px]", label === "Previsto" && "text-[21px] whitespace-nowrap sm:text-[25px]")}>{value}</dd>
        </div>
      ))}
      <div className="col-span-full flex flex-wrap gap-1.5 border-t bg-muted/30 px-2 py-1.5">
        <button type="button" aria-pressed={filtro === "booked"} onClick={() => onFilter(filtro === "booked" ? null : "booked")} className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-md border border-transparent px-2.5 text-[11px] text-amber-800 hover:border-input hover:bg-card dark:text-amber-300", filtro === "booked" && "border-input bg-card text-foreground")}>
          <Clock3 className="size-3.5" strokeWidth={1.8} aria-hidden="true" />{aguardando} aguardando confirmação
        </button>
        <button type="button" aria-pressed={filtro === "signal"} onClick={() => onFilter(filtro === "signal" ? null : "signal")} className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-md border border-transparent px-2.5 text-[11px] text-violet-800 hover:border-input hover:bg-card dark:text-violet-300", filtro === "signal" && "border-input bg-card text-foreground")}>
          <CreditCard className="size-3.5" strokeWidth={1.8} aria-hidden="true" />{sinais} sinais pendentes
        </button>
        {filtro && <button type="button" onClick={() => onFilter(null)} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2.5 text-[11px] text-muted-foreground hover:bg-card hover:text-foreground"><Filter className="size-3.5" aria-hidden="true" />Limpar filtros<X className="size-3" aria-hidden="true" /></button>}
      </div>
    </dl>
  );
}

export function CapacidadeEquipe({ items, staff, onSelect }: { items: Appointment[]; staff: Profissional[]; onSelect: (minutos: number) => void }) {
  const [expandido, setExpandido] = useState(false);
  const simultaneos = HORAS.map((inicio) => items.filter((a) => cobre(a, inicio, 60)).length);
  const pico = Math.max(0, ...simultaneos);
  const indicePico = Math.max(0, simultaneos.indexOf(pico));
  const inicioPico = HORAS[indicePico];
  const emAtendimento = items.filter((a) => cobre(a, inicioPico, 60));
  const livres = staff.filter((p) => !emAtendimento.some((a) => a.staffId === p.id));

  return (
    <section className="rounded-xl border bg-card px-3 py-2.5" aria-labelledby="capacidade-titulo">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="capacidade-titulo" className="inline font-serifa text-xl">{pico ? `Pico às ${hora(inicioPico)}` : "Sem atendimentos"}</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground sm:ml-2 sm:inline sm:text-xs">
            {pico ? `${pico} ${pico === 1 ? "cliente" : "clientes"} simultâneos · ${livres.length} ${livres.length === 1 ? "profissional livre" : "profissionais livres"}` : "Escolha um horário vago para agendar"}
          </p>
          <p className="text-[11px] text-muted-foreground">Toque para analisar a capacidade por hora.</p>
        </div>
        <button type="button" aria-expanded={expandido} aria-controls="capacidade-grafico" onClick={() => setExpandido((v) => !v)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border bg-card px-3 text-[11px] font-semibold hover:bg-muted">
          <BarChart3 className="size-4" strokeWidth={1.8} aria-hidden="true" />{expandido ? "Ocultar capacidade" : "Analisar capacidade"}{expandido ? <ChevronUp className="size-3.5" aria-hidden="true" /> : <ChevronDown className="size-3.5" aria-hidden="true" />}
        </button>
      </div>
      {expandido && (
        <div id="capacidade-grafico" className="mt-3 border-t pt-3">
          <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10" role="group" aria-label="Atendimentos simultâneos por hora">
            {HORAS.map((inicio, i) => {
              const quantidade = simultaneos[i];
              const destaque = i === indicePico && pico > 0;
              return (
                <button key={inicio} type="button" onClick={() => onSelect(inicio)} aria-label={`${hora(inicio)}: ${quantidade} ${quantidade === 1 ? "cliente" : "clientes"} em atendimento`} className={cn("grid min-h-[62px] min-w-0 grid-rows-[12px_26px_16px] justify-items-center gap-1 rounded-md border border-transparent bg-background px-1 py-1.5 text-muted-foreground hover:border-input hover:bg-muted", destaque && "border-primary bg-primary text-primary-foreground hover:border-primary hover:bg-primary")}>
                  <span className="font-mono text-[9px]">{hora(inicio)}</span>
                  <span className="flex h-[26px] w-full items-end justify-center border-b border-border" aria-hidden="true"><i className={cn("w-[65%] rounded-t-sm bg-muted-foreground", destaque && "bg-[#f1e51c]")} style={{ height: `${Math.max(10, staff.length ? (quantidade / staff.length) * 100 : 10)}%` }} /></span>
                  <strong className={cn("font-serifa text-base leading-none text-foreground", destaque && "text-primary-foreground")}>{quantidade}</strong>
                </button>
              );
            })}
          </div>
          <div className="mt-2 grid gap-1 text-[10px] text-muted-foreground sm:flex sm:justify-between"><span>Cada coluna representa 1 hora.</span><span>O número indica clientes em atendimento ao mesmo tempo.</span></div>
        </div>
      )}
    </section>
  );
}
