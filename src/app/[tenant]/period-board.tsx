"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { CalendarClock, ChevronRight, Clock3, FileText, GripVertical, Plus, Undo2, XCircle } from "lucide-react";
import { desfazerCancelamentoAction, rescheduleAppointment } from "./actions";
import { ConfirmDialog } from "./confirm-dialog";
import { History } from "./history";
import { Reschedule } from "./reschedule";
import { formatBRL, formatTime, todayIn, zonedTime } from "@/lib/datetime";
import { idToken } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import { STATUS } from "./status";
import type { Appointment } from "./page";

type Profissional = { id: string; name: string };
type Movimento = { appointment: Appointment; date: string; time: string };
type SessaoArrasto = {
  appointment: Appointment;
  pointerId: number;
  x: number;
  y: number;
  deslocX: number;
  deslocY: number;
  movendo: boolean;
  fantasma: HTMLElement | null;
  alvo: number | null;
};

const ATIVO = (a: Appointment) => a.status === "booked" || a.status === "confirmed";
const hora = (minutos: number) => `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
const minutosDe = (d: Date) => {
  const [h, m] = formatTime(d).split(":").map(Number);
  return h * 60 + m;
};
const dataHora = (a: Appointment) => `${formatTime(a.start.toDate())}–${formatTime(a.end.toDate())}`;

export function PeriodBoard(props: {
  tenantId: string;
  items: Appointment[];
  staff: Profissional[];
  date: string;
  foco: { minutos: number; id: number } | null;
  periodoFiltro: "ativos" | "vagos" | "todos";
  onPeriodoFiltroChange: (filtro: "ativos" | "vagos" | "todos") => void;
  now: number;
  onMoved: (appointment: Appointment, date: string, start: Date) => void;
  onCancel: (appointment: Appointment, notify: boolean) => Promise<boolean>;
}) {
  const { tenantId, items, staff, date, foco, periodoFiltro, onPeriodoFiltroChange, now, onMoved, onCancel } = props;
  const slotAgora = Math.floor(minutosDe(new Date(now)) / 30) * 30;
  const [aberto, setAberto] = useState<number | null>(foco?.minutos ?? (date === todayIn() ? Math.floor(slotAgora / 60) * 60 : null));
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [historicoId, setHistoricoId] = useState<string | null>(null);
  const [remarcandoId, setRemarcandoId] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState<Appointment | null>(null);
  const [movendoId, setMovendoId] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<number | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [ultimoMovimento, setUltimoMovimento] = useState<Movimento | null>(null);
  const [ultimoCancelamento, setUltimoCancelamento] = useState<Appointment | null>(null);
  const [aviso, setAviso] = useState("");
  const arrasto = useRef<SessaoArrasto | null>(null);
  useEffect(() => () => {
    arrasto.current?.fantasma?.remove();
    arrasto.current = null;
  }, []);

  const ativos = items.filter(ATIVO);
  const inicio = Math.min(8 * 60, ...ativos.map((a) => Math.floor(minutosDe(a.start.toDate()) / 60) * 60));
  const fim = Math.max(18 * 60, ...ativos.map((a) => Math.ceil(minutosDe(a.end.toDate()) / 60) * 60));
  const periodos = Array.from({ length: Math.max(1, (fim - inicio) / 60) }, (_, i) => inicio + i * 60);

  function dadosDoPeriodo(minutos: number) {
    const agendamentos = ativos.filter((a) => {
      const comeca = minutosDe(a.start.toDate());
      const termina = minutosDe(a.end.toDate());
      return comeca < minutos + 60 && termina > minutos;
    });
    const livres = staff.filter((p) => !agendamentos.some((a) => a.staffId === p.id));
    return { agendamentos, livres };
  }

  function livreNoSlot(profissional: Profissional, slot: number) {
    return !ativos.some((a) => a.staffId === profissional.id && minutosDe(a.start.toDate()) < slot + 30 && minutosDe(a.end.toDate()) > slot);
  }

  function iniciarArrasto(e: PointerEvent<HTMLElement>, a: Appointment) {
    if (e.button !== 0 || e.pointerType === "touch" || (e.target as HTMLElement).closest("button, a, input, select")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    arrasto.current = { appointment: a, pointerId: e.pointerId, x: e.clientX, y: e.clientY, deslocX: e.clientX - rect.left, deslocY: e.clientY - rect.top, movendo: false, fantasma: null, alvo: null };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function moverPonteiro(e: PointerEvent<HTMLElement>) {
    const s = arrasto.current;
    if (!s || s.pointerId !== e.pointerId) return;
    if (!s.movendo) {
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < 7) return;
      s.movendo = true;
      setMovendoId(s.appointment.id);
      const rect = e.currentTarget.getBoundingClientRect();
      s.fantasma = e.currentTarget.cloneNode(true) as HTMLElement;
      Object.assign(s.fantasma.style, { position: "fixed", zIndex: 120, top: 0, left: 0, width: `${rect.width}px`, height: `${rect.height}px`, margin: 0, pointerEvents: "none", opacity: ".96", boxShadow: "0 16px 38px rgb(23 21 15 / 22%)" });
      document.body.appendChild(s.fantasma);
    }
    e.preventDefault();
    s.fantasma!.style.transform = `translate(${e.clientX - s.deslocX}px, ${e.clientY - s.deslocY}px)`;
    const destino = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-periodo]");
    const minutos = destino ? Number((destino as HTMLElement).dataset.periodo) : null;
    if (minutos !== s.alvo) {
      s.alvo = minutos;
      setAlvo(minutos);
    }
  }

  function limparPonteiro() {
    arrasto.current?.fantasma?.remove();
    arrasto.current = null;
    setMovendoId(null);
    setAlvo(null);
  }

  function soltarPonteiro(e: PointerEvent<HTMLElement>) {
    const s = arrasto.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const minutos = s.alvo;
    const a = s.appointment;
    const estavaMovendo = s.movendo;
    limparPonteiro();
    if (estavaMovendo && minutos !== null) void moverParaPeriodo(a, minutos);
  }

  async function moverParaPeriodo(a: Appointment, minutos: number) {
    const time = hora(minutos);
    if (formatTime(a.start.toDate()) === time) return;
    setErro("");
    setPending(a.id);
    const r = await rescheduleAppointment(await idToken(), { tenantId, appointmentId: a.id, date, time }).catch(() => null);
    setPending(null);
    setMovendoId(null);
    setAlvo(null);
    if (!r?.ok) {
      setErro(r ? r.error : "Sem conexão. Tente de novo.");
      setRemarcandoId(a.id);
      setAberto(Math.floor(minutosDe(a.start.toDate()) / 60) * 60);
      return;
    }
    const anterior = { appointment: a, date, time: formatTime(a.start.toDate()) };
    setUltimoMovimento(anterior);
    setUltimoCancelamento(null);
    setAviso(`${a.customerName} foi remarcado para ${time}.`);
    onMoved(a, date, zonedTime(date, time));
  }

  async function desfazerMovimento() {
    if (!ultimoMovimento) return;
    const { appointment, date: dataAnterior, time } = ultimoMovimento;
    setPending(appointment.id);
    const r = await rescheduleAppointment(await idToken(), { tenantId, appointmentId: appointment.id, date: dataAnterior, time }).catch(() => null);
    setPending(null);
    if (!r?.ok) return setErro(r ? r.error : "Não foi possível desfazer agora.");
    setUltimoMovimento(null);
    setAviso("Reagendamento desfeito.");
    onMoved(appointment, dataAnterior, zonedTime(dataAnterior, time));
  }

  async function desfazerCancelamento() {
    if (!ultimoCancelamento) return;
    const a = ultimoCancelamento;
    setPending(a.id);
    const r = await desfazerCancelamentoAction(await idToken(), { tenantId, appointmentId: a.id, status: a.status }).catch(() => null);
    setPending(null);
    if (!r?.ok) return setErro(r ? r.error : "Não foi possível desfazer o cancelamento.");
    setUltimoCancelamento(null);
    setAviso("Cancelamento desfeito.");
  }

  const visiveis = periodos.filter((minutos) => {
    const { agendamentos } = dadosDoPeriodo(minutos);
    if (periodoFiltro === "ativos") return agendamentos.length > 0;
    if (periodoFiltro === "vagos") return staff.some((p) => livreNoSlot(p, minutos) || livreNoSlot(p, minutos + 30));
    return true;
  });

  return (
    <>
      {visiveis.length === 0 ? (
        <div className="grid justify-items-center gap-3 p-8 text-center">
          <p className="text-sm text-muted-foreground">Nenhum período com compromissos neste dia.</p>
          <Button variant="outline" className="h-11" onClick={() => onPeriodoFiltroChange("todos")}>Ver todos os períodos</Button>
        </div>
      ) : (
        <div>
          {visiveis.map((minutos) => {
            const { agendamentos, livres } = dadosDoPeriodo(minutos);
            const total = agendamentos.reduce((soma, a) => soma + a.priceCents, 0);
            const estaAberto = aberto === minutos;
            const atual = date === todayIn() && minutos === Math.floor(slotAgora / 60) * 60;
            const grupos = new Map<string, Appointment[]>();
            for (const a of agendamentos) grupos.set(dataHora(a), [...(grupos.get(dataHora(a)) ?? []), a]);
            return (
              <article
                key={minutos}
                data-periodo={minutos}
                className={cn(
                  "relative border-b last:border-0",
                  atual && "shadow-[inset_3px_0_0_#b4533c] dark:shadow-[inset_3px_0_0_#f0a18c]",
                  alvo === minutos && "shadow-[inset_0_0_0_2px_#236342] dark:shadow-[inset_0_0_0_2px_#bfe3c9]",
                )}
              >
                <button
                  type="button"
                  aria-expanded={estaAberto}
                  aria-label={`${hora(minutos)} às ${hora(minutos + 60)}, ${agendamentos.length} agendamentos. ${atual ? "Horário atual. " : ""}Ver detalhes`}
                  onClick={() => setAberto(estaAberto ? null : minutos)}
                  className={cn(
                    "grid min-h-[80px] w-full grid-cols-[minmax(0,1fr)_auto_1rem] items-center gap-x-2 gap-y-1 p-3 text-left transition-[transform,background-color] active:scale-[.99] sm:min-h-[66px] sm:grid-cols-[130px_minmax(0,1.5fr)_minmax(130px,.75fr)_auto_1rem] sm:gap-3",
                    estaAberto ? "bg-muted" : "bg-card hover:bg-muted/45",
                    atual && !estaAberto && "bg-[#b4533c]/5 dark:bg-[#f0a18c]/5",
                  )}
                >
                  <span className="flex items-center gap-2 font-serifa text-[22px] leading-none tabular-nums"><Clock3 className="size-4 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />{hora(minutos)}–{hora(minutos + 60)}</span>
                  <span className="col-span-2 min-w-0 truncate text-xs sm:col-span-1">
                    {agendamentos.length ? agendamentos.map((a) => a.customerName.split(" ")[0]).join(" · ") : "Período disponível"}
                    <small className="block text-[10px] text-muted-foreground">{agendamentos.length} {agendamentos.length === 1 ? "agendamento" : "agendamentos"}{atual && <span className="ml-2 inline-flex items-center gap-1 font-mono text-[9px] font-semibold text-[#b4533c] dark:text-[#f0a18c]"><i className="size-1.5 animate-pulse rounded-full bg-current" />Agora · {hora(slotAgora)}</span>}</small>
                  </span>
                  <span className="col-start-1 row-start-3 text-[11px] text-muted-foreground sm:col-start-auto sm:row-start-auto">{livres.length} {livres.length === 1 ? "profissional livre" : "profissionais livres"}</span>
                  <span className="col-start-2 row-span-2 row-start-2 font-mono text-[11px] whitespace-nowrap sm:col-start-auto sm:row-span-1 sm:row-start-auto">{total ? formatBRL(total) : "Sem cobranças"}</span>
                  <ChevronRight className={cn("col-start-3 row-span-3 row-start-1 size-4 text-muted-foreground transition-transform sm:col-start-auto sm:row-span-1 sm:row-start-auto", estaAberto && "rotate-90")} aria-hidden="true" />
                </button>

                {estaAberto && (
                  <div className="grid min-w-0 gap-3 border-t bg-background p-3 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-150">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span>Agendamentos e vagas de 30 minutos</span>
                      <Link href={`/agendar/${tenantId}`} target="_blank" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border bg-card px-3 text-xs font-semibold text-foreground hover:bg-muted"><Plus className="size-4" aria-hidden="true" />Novo agendamento</Link>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground">Vagas:</span>
                      {[0, 30].map((acrescimo) => {
                        const slot = minutos + acrescimo;
                        const livre = staff.some((p) => livreNoSlot(p, slot));
                        if (!livre) return null;
                        const atualVaga = date === todayIn() && slot === slotAgora;
                        return <Link key={slot} href={`/agendar/${tenantId}`} target="_blank" aria-label={`${hora(slot)} vago${atualVaga ? ", horário atual" : ""}`} className={cn("inline-flex min-h-11 items-center gap-1 rounded-md border border-dashed bg-card px-2.5 font-mono text-[10px] text-muted-foreground hover:border-emerald-700 hover:text-emerald-800", atualVaga && "border-solid border-[#b4533c] text-[#b4533c] shadow-[0_0_0_2px_#b4533c/14] dark:border-[#f0a18c] dark:text-[#f0a18c]")}><Plus className="size-3.5" aria-hidden="true" />{hora(slot)}</Link>;
                      })}
                    </div>
                    <div className="grid min-w-0 gap-3">
                      {[...grupos].map(([horario, itens]) => (
                        <section key={horario} className="min-w-0" aria-label={`Agendamentos de ${horario}`}>
                          <h3 className="mb-1.5 font-mono text-[10px] font-medium text-muted-foreground">{horario}</h3>
                          <div className="grid w-full min-w-0 grid-flow-col auto-cols-[minmax(230px,1fr)] gap-2 overflow-x-auto pb-1 max-sm:auto-cols-[minmax(245px,82vw)] max-sm:snap-x max-sm:snap-mandatory">
                            {itens.map((a) => (
                              <article
                                key={a.id}
                                data-agendamento={a.id}
                                tabIndex={0}
                                aria-label={`${a.customerName}. Arraste para reagendar ou pressione Enter para escolher um novo horário`}
                                onKeyDown={(e) => {
                                  if (e.target === e.currentTarget && ["Enter", " "].includes(e.key)) {
                                    e.preventDefault();
                                    setRemarcandoId(a.id);
                                  }
                                }}
                                onPointerDown={(e) => iniciarArrasto(e, a)}
                                onPointerMove={moverPonteiro}
                                onPointerUp={soltarPonteiro}
                                onPointerCancel={limparPonteiro}
                                className={cn(
                                  "grid cursor-grab snap-start gap-2 rounded-lg border border-l-[3px] p-3 transition-[transform,box-shadow,opacity] select-none active:cursor-grabbing motion-safe:hover:-translate-y-px",
                                  a.sinal?.status === "pendente"
                                    ? "border-violet-200 bg-violet-50 text-violet-950 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-100"
                                    : a.status === "confirmed"
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
                                      : "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
                                  movendoId === a.id && "opacity-40",
                                  pending === a.id && "pointer-events-none opacity-60",
                                )}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <h4 className="truncate text-sm font-semibold">{a.customerName}</h4>
                                    <p className="text-xs opacity-75">{a.serviceName} · {a.staffName}</p>
                                    <p className="mt-1 text-xs tabular-nums opacity-85">{dataHora(a)} · {STATUS[a.status].label}</p>
                                  </div>
                                  <span className="inline-flex items-center gap-1.5 font-mono text-[10px] whitespace-nowrap"><GripVertical className="size-3.5 opacity-50" aria-hidden="true" />{formatBRL(a.priceCents)}</span>
                                </div>
                                {pending === a.id && <p role="status" className="text-xs opacity-75">Salvando…</p>}
                                <div className="flex flex-wrap gap-1.5 border-t border-current/15 pt-2">
                                  <Button variant="outline" size="sm" className="h-11 gap-1.5 border-current/20 bg-transparent text-current hover:bg-card/60 sm:h-9" onClick={() => setDetalheId(detalheId === a.id ? null : a.id)}><FileText className="size-3.5" aria-hidden="true" />Detalhes</Button>
                                  <Button variant="outline" size="sm" className="h-11 gap-1.5 border-current/20 bg-transparent text-current hover:bg-card/60 sm:h-9" onClick={() => setRemarcandoId(remarcandoId === a.id ? null : a.id)} disabled={pending === a.id}><CalendarClock className="size-3.5" aria-hidden="true" />Reagendar</Button>
                                  <Button variant="outline" size="sm" className="h-11 gap-1.5 border-current/20 bg-transparent text-current hover:bg-card/60 sm:h-9" onClick={() => setHistoricoId(historicoId === a.id ? null : a.id)}><Clock3 className="size-3.5" aria-hidden="true" />Histórico</Button>
                                  <Button variant="ghost" size="sm" className="h-11 gap-1.5 text-destructive sm:h-9" onClick={() => setCancelando(a)} disabled={pending === a.id}><XCircle className="size-3.5" aria-hidden="true" />Cancelar</Button>
                                </div>
                                {detalheId === a.id && (
                                  <dl className="grid gap-1 rounded-lg bg-card/55 p-3 text-xs">
                                    <div className="flex justify-between gap-3"><dt className="opacity-70">WhatsApp</dt><dd>{a.customerPhone || "Não informado"}</dd></div>
                                    <div className="flex justify-between gap-3"><dt className="opacity-70">Duração</dt><dd>{Math.round((a.end.toMillis() - a.start.toMillis()) / 60_000)} min</dd></div>
                                    {a.sinal && <div className="flex justify-between gap-3"><dt className="opacity-70">Sinal</dt><dd>{a.sinal.status} · {formatBRL(a.sinal.cents)}</dd></div>}
                                    {a.planId && <div className="flex justify-between gap-3"><dt className="opacity-70">Origem</dt><dd>Plano recorrente</dd></div>}
                                  </dl>
                                )}
                                {historicoId === a.id && <History tenantId={tenantId} appointmentId={a.id} />}
                                {remarcandoId === a.id && (
                                  <Reschedule
                                    tenantId={tenantId}
                                    appointment={a}
                                    onClose={() => setRemarcandoId(null)}
                                    onDone={(newDate, start) => {
                                      setRemarcandoId(null);
                                      setUltimoMovimento({ appointment: a, date, time: formatTime(a.start.toDate()) });
                                      setAviso(`${a.customerName} foi remarcado.`);
                                      onMoved(a, newDate, start);
                                    }}
                                  />
                                )}
                              </article>
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {erro && <FeedbackDialog tipo="erro" mensagem={erro} onClose={() => { setErro(""); setAviso(""); setUltimoMovimento(null); setUltimoCancelamento(null); }} />}
      {aviso && !erro && (
        <FeedbackDialog
          tipo="sucesso"
          titulo="Agenda atualizada"
          mensagem={aviso}
          closeLabel="Fechar"
          actions={(ultimoMovimento || ultimoCancelamento) && (
            <Button variant="outline" className="h-11 gap-2 px-4" onClick={ultimoMovimento ? desfazerMovimento : desfazerCancelamento} disabled={!!pending}>
              <Undo2 className="size-4" aria-hidden="true" />{pending ? "Desfazendo…" : "Desfazer"}
            </Button>
          )}
          onClose={() => { setAviso(""); setUltimoMovimento(null); setUltimoCancelamento(null); }}
        />
      )}

      {cancelando && (
        <ConfirmDialog
          title={`Cancelar o agendamento de ${cancelando.customerName}?`}
          description={`${cancelando.serviceName}, ${dataHora(cancelando)}, com ${cancelando.staffName}. O horário voltará a ficar livre e o cancelamento ficará no histórico.`}
          notifyLabel="Avisar o cliente pelo WhatsApp"
          confirmLabel="Sim, cancelar"
          onConfirm={async (notify) => {
            const ok = await onCancel(cancelando, notify);
            if (ok) {
              setUltimoCancelamento(cancelando);
              setUltimoMovimento(null);
              setAviso(`${cancelando.customerName}: agendamento cancelado.`);
            }
            setCancelando(null);
          }}
          onCancel={() => setCancelando(null)}
        />
      )}
    </>
  );
}
