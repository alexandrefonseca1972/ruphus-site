"use client";

import Link from "next/link";
import { OCULTO, useValores } from "@/lib/valores";
import { orderBy, Timestamp, where } from "firebase/firestore";
import { Fragment, useEffect, useState } from "react";
import { z } from "zod";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/auth-errors";
import { addDays, customerKey, dateIn, formatLongDate, formatTime, todayIn, weekday, WEEKDAYS, whatsappLink, zonedTime, precoDe } from "@/lib/datetime";
import { Service, Staff } from "@/lib/scheduling";
import { useCollection } from "@/lib/use-collection";
import { cn, openExternal } from "@/lib/utils";
import { ConfirmDialog } from "./confirm-dialog";
import { History } from "./history";
import { type Folha, LancamentoFolha } from "./lancamento-folha";
import { idDaBaixa, Lancamento } from "@/lib/financeiro";
import { itensDoRecibo } from "@/lib/recibo";
import { Recibo } from "./caixa/recibo";
import { useTenant } from "./painel-layout";
import { PageTitle } from "./page-title";
import { Reschedule } from "./reschedule";
import { RowMenu } from "./row-menu";
import { ShareLink } from "./share-link";
import { mudarStatus, STATUS } from "./status";
import { avisarClienteWhatsappAction, avisarConfirmacaoSmsAction, confirmarSinalAction } from "./actions";
import { idToken } from "@/lib/firebase";
import { restanteDe } from "@/lib/sinal";
import { whatsappDoNegocio } from "@/lib/tenants";
import { type AvisoCliente, textoAvisoCliente } from "@/lib/mensagens";

const Appointment = z.object({
  serviceName: z.string(),
  staffId: z.string(),
  staffName: z.string(),
  priceCents: z.number(),
  precoAberto: z.boolean().optional(),
  start: z.instanceof(Timestamp),
  end: z.instanceof(Timestamp),
  customerName: z.string(),
  customerPhone: z.string(),
  planId: z.string().optional(),
  status: z.enum(["booked", "confirmed", "cancelled", "no_show"]),
  // sinal do agendamento online (Pix na chave do salão); só o servidor grava
  sinal: z.object({ cents: z.number(), status: z.enum(["pendente", "pago", "vencido", "dispensado", "erro"]), hora: z.string() }).optional().catch(undefined),
});
export type Appointment = z.infer<typeof Appointment> & { id: string };

const ATIVO = (a: { status: string }) => a.status === "booked" || a.status === "confirmed";
// Semana de segunda a domingo, a que contém o dia escolhido
const segundaDe = (date: string) => addDays(date, -((weekday(date) + 6) % 7));
const capitaliza = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const BOTAO_AVISO = "inline-flex h-10 items-center rounded-md bg-emerald-700 px-4 font-medium text-white hover:bg-emerald-800 disabled:opacity-60";

export default function AgendaPage() {
  const tenant = useTenant();
  const { brl, oculto } = useValores();
  const [date, setDate] = useState(todayIn);
  const [error, setError] = useState("");
  const [rescheduling, setRescheduling] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ id: string; kind: "cancel" | "no_show" | "sinal" } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  // quem é da equipe abre na própria agenda; "Todos" continua a um toque
  const [staffFilter, setStaffFilter] = useState(tenant.staffId ?? "");
  const [staff] = useCollection(tenant.id, "staff", Staff, [orderBy("name")]);
  // aviso no topo; com a mensagem, oferece mandar ao cliente (manual: pelo WhatsApp do aparelho)
  // recibo: id do lançamento recebido agora; o aviso oferece o recibo dele
  const [notice, setNotice] = useState<{ text: string; aviso?: { a: Appointment; tipo: AvisoCliente; start: Date }; manual?: boolean; recibo?: string } | null>(null);
  // WhatsApp do negócio conectado (atendys): a mensagem sai por ele, sem abrir o WhatsApp do aparelho
  const peloNegocio = whatsappDoNegocio(tenant);
  const mensagem = (a: Appointment, tipo: AvisoCliente, start = a.start.toDate()) =>
    textoAvisoCliente(tipo, { ...a, start }, tenant.name, `${location.origin}/agendar/${tenant.id}`);
  const aviso = notice?.aviso;
  // o aviso some sozinho: só texto em 6 s; com botão (avisar, recibo) fica 20 s para dar tempo de tocar
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), notice.aviso || notice.recibo ? 20_000 : 6_000);
    return () => clearTimeout(t);
  }, [notice]);
  // O relógio anda a cada minuto: com a agenda aberta o dia todo, o horário que passa perde
  // o "Confirmar" e ganha o "Faltou", e a linha do "agora" desce, sem recarregar a página
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const [services] = useCollection(tenant.id, "services", Service, []);
  // A semana inteira numa consulta só: a faixa de dias conta, a lista mostra um dia
  const semana = segundaDe(date);
  const [daSemana, loadError] = useCollection(
    tenant.id,
    "appointments",
    Appointment,
    [where("start", ">=", zonedTime(semana, "00:00")), where("start", "<", zonedTime(addDays(semana, 7), "00:00")), orderBy("start")],
    semana,
  );
  const items = daSemana?.filter((a) => dateIn(a.start.toDate()) === date) ?? null;
  // Caixa ligado: o que já foi recebido na semana (só quem gere lê dinheiro)
  const caixa = tenant.podeGerir && tenant.modulos?.financeiro === true;
  // quem é da equipe vê a agenda toda, mas só mexe nos próprios horários (o servidor e as regras conferem)
  const meu = (a: { staffId: string }) => tenant.podeGerir || !tenant.staffId || a.staffId === tenant.staffId;
  const [recebidosDaSemana] = useCollection(
    caixa ? tenant.id : "",
    "lancamentos",
    Lancamento,
    [where("data", ">=", semana), where("data", "<", addDays(semana, 7))],
    semana,
  );
  const recebidos = new Set(recebidosDaSemana?.map((l) => l.id));
  const [folha, setFolha] = useState<Folha | null>(null);
  const [recibo, setRecibo] = useState<Lancamento[] | null>(null);
  // o mesmo recibo do Caixa: o atendimento, o sinal e o que o cliente pagou no mesmo dia
  const abrirRecibo = (id: string) => {
    const l = recebidosDaSemana?.find((x) => x.id === id);
    if (l) setRecibo(itensDoRecibo(l, recebidosDaSemana!));
  };

  // Toda mudança de status grava um registro no histórico no mesmo batch (exigido pelas regras)
  /** Devolve true quando gravou; só então o cliente pode ser avisado. */
  async function changeStatus(a: Appointment, status: "confirmed" | "cancelled" | "no_show") {
    setError("");
    try {
      await mudarStatus(tenant.id, a.id, status);
      // o SMS de confirmação (negócio com SMS ligado no admin): sem esperar, e falha não desfaz nada
      if (status === "confirmed") void idToken().then((t) => avisarConfirmacaoSmsAction(t, { tenantId: tenant.id, appointmentId: a.id })).catch(() => {});
      return true;
    } catch (err) {
      setError(err instanceof Error && err.message.startsWith("Sessão") ? err.message : errorMessage(err));
      return false;
    }
  }

  /** Pelo WhatsApp do negócio; se não sair, o aviso oferece mandar pelo do aparelho. */
  async function avisarPeloNegocio(aviso: { a: Appointment; tipo: AvisoCliente; start: Date }) {
    const { a } = aviso;
    setPending(a.id);
    const r = await idToken()
      .then((t) => avisarClienteWhatsappAction(t, { tenantId: tenant.id, appointmentId: a.id, tipo: aviso.tipo }))
      .catch(() => null);
    setPending(null);
    if (r?.ok) return setNotice({ text: `Mensagem enviada a ${a.customerName} pelo WhatsApp do negócio.` });
    // sem resposta não quer dizer que não saiu: a queda pode ter vindo depois do envio
    const text = r
      ? `A mensagem para ${a.customerName} não saiu pelo WhatsApp do negócio: ${r.error} Mande pelo seu WhatsApp.`
      : `Sem conexão: não deu para saber se a mensagem chegou a ${a.customerName}. Confira na conversa antes de mandar de novo pelo seu WhatsApp.`;
    setNotice({ text, aviso, manual: true });
  }

  async function notifyAndChange(a: Appointment, status: "confirmed" | "cancelled") {
    const tipo = status === "confirmed" ? "confirmado" : "cancelado";
    if (peloNegocio) {
      setPending(a.id);
      const saved = await changeStatus(a, status);
      setPending(null);
      if (saved) await avisarPeloNegocio({ a, tipo, start: a.start.toDate() });
      return;
    }
    // a aba abre ainda dentro do clique: depois do await da gravação o navegador já não conta
    // como gesto, bloqueava a aba nova, e o WhatsApp tomava o lugar do painel
    const aba = window.open("", "_blank");
    setPending(a.id);
    const saved = await changeStatus(a, status);
    setPending(null);
    // Falhou a gravação: não avisa o cliente de algo que não aconteceu
    if (!saved) return aba?.close();
    const link = whatsappLink(a.customerPhone, mensagem(a, tipo));
    if (aba) {
      aba.opener = null;
      aba.location.href = link;
    } else if (!openExternal(link)) location.assign(link); // webview bloqueou a aba nova
  }

  async function sinalRecebido(a: Appointment) {
    setError("");
    setPending(a.id);
    const r = await confirmarSinalAction(await idToken(), { tenantId: tenant.id, appointmentId: a.id }).catch(() => null);
    setPending(null);
    if (!r?.ok) setError(r ? r.error : "Sem conexão. Tente de novo.");
  }

  function cancel(a: Appointment, notify: boolean) {
    setConfirming(null);
    return notify
      ? notifyAndChange(a, "cancelled")
      : changeStatus(a, "cancelled");
  }

  // o profissional de quem entrou pela equipe pode ter sido excluído: aí abre em "Todos"
  const filtro = staffFilter && staff && !staff.some((p) => p.id === staffFilter) ? "" : staffFilter;
  const shown = items?.filter((a) => !filtro || a.staffId === filtro) ?? null;
  const active = shown?.filter(ATIVO) ?? [];
  const dias = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(semana, i);
    return { date: d, count: daSemana?.filter((a) => ATIVO(a) && dateIn(a.start.toDate()) === d).length ?? 0 };
  });
  const hoje = todayIn();
  // Linha do "agora": antes do primeiro horário que ainda não começou, só no dia de hoje
  const agoraAntesDe = date === hoje ? shown?.find((a) => a.start.toMillis() > now)?.id : undefined;
  const stats = [
    { label: "Horários", value: active.length },
    { label: "Confirmados", value: active.filter((a) => a.status === "confirmed").length },
    { label: "Aguardando", value: active.filter((a) => a.status === "booked").length },
    { label: "Previsto", value: brl(active.reduce((sum, a) => sum + a.priceCents, 0)) },
  ];

  return (
    <>
      <PageTitle title="Agenda" valores sub={capitaliza(formatLongDate(zonedTime(date, "12:00")))}>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Button variant="outline" size="icon-lg" className="size-10 max-sm:size-11" onClick={() => setDate(addDays(date, -7))} aria-label="Semana anterior">‹</Button>
          <Label htmlFor="agenda-date" className="sr-only">Data</Label>
          <Input id="agenda-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-10 w-auto grow bg-card max-sm:h-11 sm:grow-0" />
          <Button variant="outline" size="icon-lg" className="size-10 max-sm:size-11" onClick={() => setDate(addDays(date, 7))} aria-label="Próxima semana">›</Button>
          <Button variant="ghost" className="h-10 px-3 max-sm:h-11" disabled={date === hoje} onClick={() => setDate(hoje)}>Hoje</Button>
        </div>
      </PageTitle>

      <div className="grid grid-cols-7 gap-1.5 sm:gap-2.5" role="group" aria-label="Dias da semana">
        {dias.map((d) => {
          const sel = d.date === date;
          return (
            <button
              key={d.date}
              type="button"
              aria-pressed={sel}
              aria-label={`${WEEKDAYS[weekday(d.date)]} ${Number(d.date.slice(8))}: ${d.count} horário(s)`}
              onClick={() => setDate(d.date)}
              className={cn(
                "grid justify-items-center gap-1 rounded-xl border bg-card py-2.5 hover:border-foreground/40 sm:py-3",
                sel && "border-primary bg-primary text-primary-foreground hover:border-primary",
              )}
            >
              <span className="text-[11px] tracking-wider uppercase opacity-75">{WEEKDAYS[weekday(d.date)].slice(0, 3)}</span>
              <span className={cn("font-serifa text-2xl leading-none sm:text-3xl", d.date === hoje && !sel && "underline underline-offset-4")}>{Number(d.date.slice(8))}</span>
              {/* no celular o dia tem ~46px: "4 hor." cabe, "4 horários" não */}
              <span className="text-[10px] leading-none whitespace-nowrap opacity-75 sm:text-xs" aria-hidden="true">
                {d.count ? (
                  <>
                    {d.count} hor<span className="sm:hidden">.</span>
                    <span className="hidden sm:inline">ário{d.count > 1 ? "s" : ""}</span>
                  </>
                ) : (
                  "livre"
                )}
              </span>
            </button>
          );
        })}
      </div>

      {!!daSemana?.length && (
        <dl className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 sm:grid-cols-4 sm:gap-4">
          {stats.map((st) => (
            <div key={st.label} className="grid min-w-0 gap-1.5 rounded-2xl border bg-card px-4 py-4 sm:px-5">
              <dt className="text-[13px] text-muted-foreground">{st.label}</dt>
              <dd className="font-serifa text-2xl leading-none tabular-nums [overflow-wrap:anywhere] sm:text-3xl">{st.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {notice && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950">
          <span>{notice.text}</span>
          <div className="flex gap-2">
            {aviso && (peloNegocio && !notice.manual ? (
              <button type="button" disabled={pending === aviso.a.id} onClick={() => avisarPeloNegocio(aviso)} className={BOTAO_AVISO}>
                {pending === aviso.a.id ? "Enviando…" : "Avisar pelo WhatsApp"}
              </button>
            ) : (
              <a href={whatsappLink(aviso.a.customerPhone, mensagem(aviso.a, aviso.tipo, aviso.start))} target="_blank" rel="noreferrer" className={BOTAO_AVISO}>
                Avisar pelo WhatsApp
              </a>
            ))}
            {notice.recibo && recebidos.has(notice.recibo) && (
              <Button variant="outline" size="sm" onClick={() => abrirRecibo(notice.recibo!)}>Recibo</Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>Fechar</Button>
          </div>
        </div>
      )}
      {(error || loadError) && <p role="alert" className="text-sm text-destructive">{error || loadError}</p>}

      {!shown ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : shown.length === 0 && staff && staff.length === 0 ? (
        /* Primeiro acesso: sem ninguém cadastrado para atender, o link de
           agendamento não tem o que oferecer — e "Nenhum agendamento neste dia"
           faz parecer que é só um dia vazio. */
        <Onboarding tenantId={tenant.id} name={tenant.name} temServicos={!!services?.length} />
      ) : (
        <section aria-labelledby="dia" className="overflow-hidden rounded-2xl border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
            <h2 id="dia" className="font-semibold">Horários do dia</h2>
            {(staff?.length ?? 0) > 1 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por profissional">
                {[{ id: "", name: "Todos" }, ...(staff ?? [])].map((p) => {
                  const n = p.id ? items?.filter((a) => ATIVO(a) && a.staffId === p.id).length : undefined;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={filtro === p.id}
                      onClick={() => setStaffFilter(p.id)}
                      className={cn(
                        "h-9 rounded-full border px-3.5 text-[13px] hover:bg-muted max-sm:h-11",
                        filtro === p.id && "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
                      )}
                    >
                      {p.name}{n ? ` · ${n}` : ""}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {shown.length === 0 ? (
            <p className="border-t px-6 py-12 text-center text-sm text-muted-foreground">
              {filtro ? "Nenhum horário para este profissional neste dia." : "Nenhum horário marcado neste dia."}
            </p>
          ) : (
        <ul>
          {shown.map((a) => (
            <Fragment key={a.id}>
            {agoraAntesDe === a.id && (
              <li aria-hidden="true" className="flex h-9 items-center gap-3 border-t px-4 text-xs font-semibold tracking-wider text-red-800 uppercase sm:px-6 dark:text-red-300">
                Agora · {formatTime(new Date(now))}
                <span className="h-px flex-1 bg-current opacity-40" />
              </li>
            )}
            <li className="grid gap-3 border-t px-4 py-4 sm:px-6">
              <div className="grid items-center gap-x-6 gap-y-3 sm:grid-cols-[6.5rem_minmax(0,1fr)_auto]">
                <div className="flex items-baseline gap-2 tabular-nums sm:grid sm:gap-0.5">
                  <span className={cn("text-xl font-semibold", a.status === "cancelled" && "text-muted-foreground line-through")}>{formatTime(a.start.toDate())}</span>
                  <span className="text-[13px] text-muted-foreground">até {formatTime(a.end.toDate())}</span>
                </div>
                <div className="grid min-w-0 gap-1.5">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link href={`/${tenant.id}/clientes/${customerKey(a.customerPhone)}`} className="text-base font-semibold underline-offset-4 hover:underline">
                      {a.customerName}
                    </Link>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS[a.status].className}`}>{STATUS[a.status].label}</span>
                    {a.planId && <span className="rounded-full border px-2.5 py-0.5 text-xs">Recorrente</span>}
                    {a.sinal?.status === "pendente" && ATIVO(a) && (
                      <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        Sinal de {brl(a.sinal.cents)} até {a.sinal.hora}
                      </span>
                    )}
                    {a.sinal?.status === "pago" && <span className="rounded-full border px-2.5 py-0.5 text-xs">Sinal pago · {brl(a.sinal.cents)}</span>}
                    {recebidos.has(idDaBaixa(a.id)) && <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">Recebido</span>}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {[a.serviceName, `com ${a.staffName}`, (oculto ? OCULTO : precoDe({ priceCents: a.priceCents, tipoPreco: a.precoAberto ? "aPartir" : "fixo" }))].filter(Boolean).join(" · ")} ·{" "}
                    <a href={whatsappLink(a.customerPhone)} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
                      {a.customerPhone}
                    </a>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* o salão conferiu no banco: confirma o horário e lança o sinal no Caixa */}
                  {a.sinal?.status === "pendente" && ATIVO(a) && tenant.podeGerir && (
                    <Button className="h-10 px-4" disabled={pending === a.id} onClick={() => setConfirming({ id: a.id, kind: "sinal" })}>
                      {pending === a.id ? "Confirmando…" : "Sinal recebido"}
                    </Button>
                  )}
                  {/* Confirmar só antes do horário: depois dele já não há o que combinar com o cliente */}
                  {a.status === "booked" && a.start.toMillis() > now && meu(a) && (
                    <Button className="h-10 px-4" disabled={pending === a.id} onClick={() => notifyAndChange(a, "confirmed")}>
                      {pending === a.id ? "Confirmando…" : "Confirmar pelo WhatsApp"}
                    </Button>
                  )}
                  {/* recebido no Caixa: remarcar deixaria o recebimento no dia antigo */}
                  {ATIVO(a) && meu(a) && !recebidos.has(idDaBaixa(a.id)) && (
                    <Button variant="outline" className="h-10 px-4" aria-expanded={rescheduling === a.id} onClick={() => setRescheduling(rescheduling === a.id ? null : a.id)}>
                      Remarcar
                    </Button>
                  )}
                  <RowMenu
                    label={`Mais ações: ${a.customerName} às ${formatTime(a.start.toDate())}`}
                    actions={[
                      ...(caixa && recebidosDaSemana && ATIVO(a) && a.start.toMillis() <= now && !recebidos.has(idDaBaixa(a.id)) && restanteDe(a) > 0
                        ? [{ label: "Recebido", onClick: () => setFolha({ modo: "baixa", atendimento: { id: a.id, customerName: a.customerName, serviceName: a.serviceName, priceCents: restanteDe(a), sinalCents: a.sinal?.status === "pago" ? a.sinal.cents : 0 } }) }]
                        : []),
                      ...(caixa && recebidos.has(idDaBaixa(a.id)) ? [{ label: "Recibo", onClick: () => abrirRecibo(idDaBaixa(a.id)) }] : []),
                      // recebido no Caixa não vira falta: a entrada contaria um atendimento que não houve
                      ...(ATIVO(a) && meu(a) && a.start.toMillis() <= now && !recebidos.has(idDaBaixa(a.id)) ? [{ label: "Faltou", onClick: () => setConfirming({ id: a.id, kind: "no_show" as const }) }] : []),
                      ...(ATIVO(a) && meu(a) && !recebidos.has(idDaBaixa(a.id)) ? [{ label: "Cancelar horário", danger: true, onClick: () => setConfirming({ id: a.id, kind: "cancel" as const }) }] : []),
                      { label: showHistory === a.id ? "Esconder histórico" : "Histórico", onClick: () => setShowHistory(showHistory === a.id ? null : a.id) },
                    ]}
                  />
                </div>
              </div>
              {confirming?.id === a.id && confirming.kind === "cancel" && (
                <ConfirmDialog
                  title={`Cancelar o agendamento de ${a.customerName}?`}
                  description={`${formatLongDate(a.start.toDate())} às ${formatTime(a.start.toDate())} · ${a.serviceName} com ${a.staffName}. O horário volta a ficar livre.${a.sinal?.status === "pago" ? ` O sinal de ${brl(a.sinal.cents)} foi pago: combine a devolução com o cliente.` : ""}`}
                  notifyLabel="Avisar o cliente pelo WhatsApp"
                  confirmLabel="Sim, cancelar"
                  onConfirm={(notify) => cancel(a, notify)}
                  onCancel={() => setConfirming(null)}
                />
              )}
              {/* marcar dinheiro como recebido não tem volta pelo painel: confere antes */}
              {confirming?.id === a.id && confirming.kind === "sinal" && a.sinal && (
                <ConfirmDialog
                  title={`O sinal de ${brl(a.sinal.cents)} caiu na sua conta?`}
                  description={`Confira no app do banco o Pix de ${a.customerName}. Confirmando, o horário fica confirmado${caixa ? " e o sinal entra no Caixa" : ""}.`}
                  confirmLabel="Sim, recebi"
                  tom="normal"
                  onConfirm={() => {
                    setConfirming(null);
                    return sinalRecebido(a);
                  }}
                  onCancel={() => setConfirming(null)}
                />
              )}
              {confirming?.id === a.id && confirming.kind === "no_show" && (
                <ConfirmDialog
                  title={`Registrar que ${a.customerName} faltou?`}
                  description="Fica no histórico do cliente e não pode ser desfeito pelo painel."
                  confirmLabel="Sim, registrar falta"
                  onConfirm={() => {
                    setConfirming(null);
                    return changeStatus(a, "no_show");
                  }}
                  onCancel={() => setConfirming(null)}
                />
              )}
              {showHistory === a.id && <History tenantId={tenant.id} appointmentId={a.id} />}
              {rescheduling === a.id && (
                <Reschedule
                  tenantId={tenant.id}
                  appointment={a}
                  onClose={() => setRescheduling(null)}
                  onDone={(newDate, start) => {
                    setRescheduling(null);
                    setNotice({
                      text: `${a.customerName} remarcado para ${formatLongDate(start)} às ${formatTime(start)}.`,
                      aviso: { a, tipo: "remarcado", start },
                    });
                    setDate(newDate);
                  }}
                />
              )}
            </li>
            </Fragment>
          ))}
        </ul>
          )}
        </section>
      )}
      {folha && (
        <LancamentoFolha
          tenantId={tenant.id}
          nicho={tenant.gerado?.nicho}
          folha={folha}
          onClose={(aviso) => {
            // recebeu: o aviso oferece o recibo (o "Recebido" também aparece na linha)
            if (aviso && folha.modo === "baixa") setNotice({ text: `${folha.atendimento.customerName}: ${aviso}`, recibo: idDaBaixa(folha.atendimento.id) });
            setFolha(null);
          }}
        />
      )}
      {recibo && <Recibo tenantId={tenant.id} itens={recibo} onClose={() => setRecibo(null)} />}
    </>
  );
}

/** Primeiro acesso: sem ninguém para atender, o link não tem o que oferecer —
 * e "nenhum horário neste dia" faria parecer que é só um dia vazio. */
function Onboarding({ tenantId, name, temServicos }: { tenantId: string; name: string; temServicos: boolean }) {
  const passos = [
    { titulo: "Cadastre o que você faz", texto: "Serviços com duração e preço.", feito: temServicos, href: `/${tenantId}/servicos`, cta: "Cadastrar serviços" },
    { titulo: "Cadastre quem atende", texto: "Profissionais, os serviços que fazem e os horários.", feito: false, href: `/${tenantId}/profissionais`, cta: "Cadastrar profissional" },
  ];
  const feitos = passos.filter((p) => p.feito).length;
  const proximo = passos.find((p) => !p.feito);
  return (
    <section aria-labelledby="abrir" className="relative rounded-2xl border bg-card">
      <div className="flex flex-wrap items-end justify-between gap-6 p-6 sm:p-7">
        <div className="grid gap-2">
          <h2 id="abrir" className="font-serifa text-3xl leading-tight sm:text-4xl">Falta pouco para a agenda abrir</h2>
          <p className="text-[15px] text-muted-foreground">Com estes passos feitos, o seu link começa a receber marcações.</p>
        </div>
        <div className="grid justify-items-end gap-2">
          <span className="text-[13px] text-muted-foreground">{feitos} de 3</span>
          <div role="progressbar" aria-label="Passos concluídos" aria-valuenow={feitos} aria-valuemin={0} aria-valuemax={3} className="h-1.5 w-48 rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(feitos / 3) * 100}%` }} />
          </div>
        </div>
      </div>
      <ol>
        {passos.map((p, i) => (
          <li key={p.titulo} className="grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-4 border-t px-6 py-5 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto] sm:px-7">
            <Marca n={i + 1} feito={p.feito} />
            <div className="grid gap-0.5">
              <span className={cn("font-semibold", p.feito && "text-muted-foreground line-through")}>{p.titulo}</span>
              <span className="text-sm text-muted-foreground">{p.texto}</span>
            </div>
            <div className="col-start-2 sm:col-start-auto">
              {p.feito ? (
                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">Feito</span>
              ) : (
                <Link href={p.href} className={buttonVariants({ variant: p === proximo ? "default" : "outline", className: "h-10 px-4" })}>{p.cta}</Link>
              )}
            </div>
          </li>
        ))}
        <li className="grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-4 border-t px-6 py-5 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto] sm:px-7">
          <Marca n={3} feito={false} />
          <div className="grid gap-0.5">
            <span className="font-semibold">Divulgue o seu link</span>
            <span className="text-sm text-muted-foreground">Na bio do Instagram, no status do WhatsApp, para cada cliente.</span>
          </div>
          <div className="col-start-2 sm:col-start-auto">
            <ShareLink tenantId={tenantId} name={name} iconeNoCelular={false} />
          </div>
        </li>
      </ol>
    </section>
  );
}

function Marca({ n, feito }: { n: number; feito: boolean }) {
  return feito ? (
    <span className="grid size-9 place-items-center rounded-full bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m5 12 5 5 9-10" />
      </svg>
    </span>
  ) : (
    <span aria-hidden="true" className="grid size-9 place-items-center rounded-full border font-serifa text-xl">{n}</span>
  );
}
