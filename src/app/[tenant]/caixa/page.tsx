"use client";

import { caixaLigado } from "@/lib/modulos";
import { orderBy, Timestamp, where } from "firebase/firestore";
import { useValores } from "@/lib/valores";
import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";
import { ArrowDownToLine, ArrowUpFromLine, Check, ChevronLeft, ChevronRight, CircleCheckBig, Download, FileText, Focus, HandCoins, History, Plus, ReceiptText, RotateCcw, Search, Settings2, UserRound, UsersRound, WalletCards, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormMessage } from "@/components/form-message";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { errorMessage } from "@/lib/auth-errors";
import { dateIn, formatLongDate, formatTime, todayIn, zonedTime } from "@/lib/datetime";
import { idToken } from "@/lib/firebase";
import { CaixaConfig, comissoesDoMes, diaNoMes, fixaNoMes, mesDaComissao, pctDoTexto, csvDoMes, idDaBaixa, idDoEstorno, ehVale, idDoPagamento, Lancamento, resumoDoMes, ROTULO_FORMA } from "@/lib/financeiro";
import { useCollection } from "@/lib/use-collection";
import { usePaginatedCollection } from "@/lib/use-paginated-collection";
import { cn } from "@/lib/utils";
import { definirComissaoAction } from "../actions";
import { restanteDe } from "@/lib/sinal";
import { ConfirmDialog } from "../confirm-dialog";
import { ComissoesHistorico } from "../comissoes-historico";
import { ContasFixas } from "../contas-fixas";
import { type Folha, LancamentoFolha } from "../lancamento-folha";
import { itensDoRecibo } from "@/lib/recibo";
import { Recibo } from "./recibo";
import { ValeFolha } from "./vale-folha";
import { useTenant } from "../painel-layout";
import { PageTitle } from "../page-title";
import { mudarStatus } from "../status";

const Atendimento = z.object({
  serviceName: z.string(),
  staffName: z.string(),
  priceCents: z.number(),
  precoAberto: z.boolean().optional().catch(undefined),
  customerName: z.string(),
  customerPhone: z.string().optional().catch(undefined),
  start: z.instanceof(Timestamp),
  status: z.enum(["booked", "confirmed", "cancelled", "no_show"]),
  sinal: z.object({ cents: z.number(), status: z.string() }).optional().catch(undefined),
});

const mesSeguinte = (mes: string, n: number) => {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const nomeDoMes = (mes: string) => {
  const s = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${mes}-15T12:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
};

type FilaItem = { id: string; titulo: string; detalhe: string; valorCents: number; acao: string; abrir: () => void; secundaria?: () => void };

export default function CaixaPage() {
  const { brl } = useValores();
  const tenant = useTenant();
  const [mes, setMes] = useState(() => todayIn().slice(0, 7));
  const [folha, setFolha] = useState<Folha | null>(null);
  const [aviso, setAviso] = useState("");
  const [erro, setErro] = useState("");
  const [faltou, setFaltou] = useState<{ id: string; nome: string } | null>(null);
  const [verFixas, setVerFixas] = useState(false);
  const [recibo, setRecibo] = useState<Lancamento[] | null>(null);
  const [reciboDoAviso, setReciboDoAviso] = useState<string | null>(null);
  const [verTodos, setVerTodos] = useState(false);
  const [verAtividade, setVerAtividade] = useState(false);
  const [foco, setFoco] = useState(false);
  const [historico, setHistorico] = useState<{ staffId: string; nome: string } | null>(null);
  const [vale, setVale] = useState<{ id: string; nome: string } | null>(null);
  const [filtro, setFiltro] = useState<"tudo" | "entrada" | "saida">("tudo");
  const [forma, setForma] = useState("todas");
  const [busca, setBusca] = useState("");
  const [tentativa, setTentativa] = useState(0);
  const [pcts, setPcts] = useState<Record<string, { pct: number; vez: number }>>({});
  const [agora, setAgora] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => (setAviso(""), setReciboDoAviso(null)), 7000);
    return () => clearTimeout(t);
  }, [aviso]);

  const ligado = tenant.podeGerir && caixaLigado(tenant.modulos);
  const hoje = todayIn();
  const [mesCorrente, setMesCorrente] = useState(hoje.slice(0, 7));
  if (mesCorrente !== hoje.slice(0, 7)) {
    setMesCorrente(hoje.slice(0, 7));
    if (mes === mesCorrente) setMes(hoje.slice(0, 7));
  }
  const desde = mes === hoje.slice(0, 7) ? mesSeguinte(mes, -1) : mes;
  const ate = mes < hoje.slice(0, 7) ? mesSeguinte(mes, 1) : mes;
  const [comAnteriorLido, erroLeitura, foraDoMes] = useCollection(ligado ? tenant.id : "", "lancamentos", Lancamento, [where("mes", "in", [...new Set([desde, mes, ate])])], `${desde}/${mes}/${ate}/${tentativa}`);
  const [daComissaoLido, erroComissao, foraDaComissao] = useCollection(ligado ? tenant.id : "", "lancamentos", Lancamento, [where("mesComissao", "==", mes)], `comissao/${mes}/${tentativa}`);
  const comAnterior = erroLeitura || erroComissao || !comAnteriorLido || !daComissaoLido ? null : [...new Map([...comAnteriorLido, ...daComissaoLido].map((l) => [l.id, l])).values()];
  const descartados = new Set([...foraDoMes, ...foraDaComissao]).size;
  const lancamentos = comAnterior?.filter((l) => l.mes === mes) ?? null;
  const [doMes, erroAgenda] = useCollection(ligado ? tenant.id : "", "appointments", Atendimento, [where("start", ">=", zonedTime(`${desde}-01`, "00:00")), where("start", "<", zonedTime(`${mesSeguinte(mes, 1)}-01`, "00:00")), orderBy("start")], `${desde}/${mes}/${tentativa}`);
  const [equipe, erroEquipe] = useCollection(ligado ? tenant.id : "", "staff", z.object({ name: z.string() }), [], tentativa.toString());
  const [configs, erroConfig] = useCollection(ligado ? tenant.id : "", "caixa", z.record(z.string(), z.unknown()), [], tentativa.toString());
  const atividade = usePaginatedCollection(ligado ? tenant.id : "", "lancamentos", Lancamento, [where("mes", "==", mes), orderBy("data", "desc")], `${mes}/${tentativa}`);
  const lido = CaixaConfig.safeParse(configs?.find((c) => c.id === "config") ?? {});
  const configPronta = configs !== null && !erroConfig && lido.success;
  const config = lido.success ? lido.data : CaixaConfig.parse({});
  const configQuebrada = configs !== null && (!!erroConfig || !lido.success);
  const erroPrincipal = erroLeitura || erroComissao || erroAgenda || erroEquipe;

  if (!ligado) {
    return <><PageTitle title="Caixa" /><p className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">{tenant.podeGerir ? "O Caixa não está ativo para este negócio. Para usar, fale com a Ruphus." : "Só o dono ou um administrador do negócio vê o Caixa."}</p></>;
  }

  const recebidos = new Set(comAnterior?.map((l) => l.id));
  const sinalDe = (a: z.infer<typeof Atendimento>) => (a.sinal?.status === "pago" ? a.sinal.cents : 0);
  const mesesDaFila = new Set(mes === hoje.slice(0, 7) ? [desde, mes] : [mes]);
  const pendentes = (comAnterior ? (doMes ?? []) : []).filter((a) => mesesDaFila.has(dateIn(a.start.toDate()).slice(0, 7)) && (a.status === "booked" || a.status === "confirmed") && a.start.toMillis() <= agora && !recebidos.has(idDaBaixa(a.id)) && (restanteDe(a) > 0 || sinalDe(a) === 0));
  const aReceber = pendentes.reduce((t, a) => t + restanteDe(a), 0);
  const r = resumoDoMes(lancamentos ?? []);
  const doMesFixas = config.fixas.filter((f) => fixaNoMes(f, mes));
  const contas = (lancamentos ? doMesFixas : []).filter((f) => !recebidos.has(idDoPagamento("fixa", f.id, mes))).sort((a, b) => a.dia - b.dia);
  const pctsPendentes = Object.fromEntries(Object.entries(pcts).map(([k, o]) => [k, o.pct]));
  const nomes = Object.fromEntries([...(comAnterior ?? []).filter((l) => l.staffId && l.staffName).map((l) => [l.staffId!, l.staffName!]), ...(equipe ?? []).map((p) => [p.id, p.name])]);
  const daComissao = (comAnterior ?? []).filter((l) => mesDaComissao(l) === mes);
  const todasComissoes = comissoesDoMes(lancamentos ? daComissao : [], { ...config.comissoes, ...pctsPendentes }, config.descontos, nomes);
  const comissoes = todasComissoes.filter((c) => c.pct > 0 || c.desconto !== 0 || lancamentos?.some((l) => l.id === idDoPagamento("comissao", c.staffId, mes)));
  const semPct = todasComissoes.length - comissoes.length;
  const diaNovo = mes === hoje.slice(0, 7) ? hoje : diaNoMes(mes, mes < hoje ? 31 : 1);
  const pagas = new Map(lancamentos?.filter((l) => l.id.startsWith("cm-")).map((l) => [l.id, l]));
  const vales = (lancamentos ?? []).filter((l) => ehVale(l.id)).reduce<Record<string, number>>((t, l) => ((t[l.staffId ?? ""] = (t[l.staffId ?? ""] ?? 0) + l.valorCents), t), {});
  const abrirBaixa = (a: z.infer<typeof Atendimento> & { id: string }) => setFolha({ modo: "baixa", atendimento: { id: a.id, customerName: a.customerName, customerPhone: a.customerPhone, serviceName: a.serviceName, priceCents: restanteDe(a), precoAberto: a.precoAberto, sinalCents: sinalDe(a) } });
  const fila: FilaItem[] = [
    ...[...pendentes].reverse().map((a) => ({ id: `ag-${a.id}`, titulo: a.customerName, detalhe: `${formatLongDate(a.start.toDate())}, ${formatTime(a.start.toDate())} · ${a.serviceName} · ${a.staffName}${sinalDe(a) ? ` · sinal de ${brl(sinalDe(a))} pago` : ""}`, valorCents: restanteDe(a), acao: "Receber", abrir: () => abrirBaixa(a), secundaria: () => setFaltou({ id: a.id, nome: a.customerName }) })),
    ...contas.map((f) => ({ id: `fx-${f.id}`, titulo: f.nome, detalhe: `${f.categoria} · vence dia ${Number(diaNoMes(mes, f.dia).slice(8))}`, valorCents: f.valorCents, acao: "Pagar", abrir: () => setFolha({ modo: "pagar", titulo: `Pagar ${f.nome}`, detalhe: `${f.categoria} · ${nomeDoMes(mes)}`, valorCents: f.valorCents, pagamento: { tipo: "fixa", alvoId: f.id, mes } }) })),
    ...comissoes.filter((c) => !pagas.has(idDoPagamento("comissao", c.staffId, mes)) && (c.valor > 0 || c.abatido > 0)).map((c) => ({ id: `cm-${c.staffId}`, titulo: `Comissão de ${c.nome}`, detalhe: `${String(c.pct).replace(".", ",")}% de ${brl(c.faturado)}${c.abatido ? ` · ajuste de ${brl(c.abatido)}` : ""}`, valorCents: c.valor, acao: "Pagar", abrir: () => setFolha({ modo: "pagar", titulo: `Pagar comissão de ${c.nome}`, detalhe: `${String(c.pct).replace(".", ",")}% de ${brl(c.faturado)} · ${nomeDoMes(mes)}`, valorCents: c.valor, pagamento: { tipo: "comissao", alvoId: c.staffId, mes, descontoCents: c.abatido } }) })),
  ];
  const filaVisivel = foco ? fila.slice(0, 1) : verTodos ? fila : fila.slice(0, 5);
  const pagoComissoes = comissoes.filter((c) => !pagas.has(idDoPagamento("comissao", c.staffId, mes))).reduce((t, c) => t + c.valor, 0);
  const devidoContas = contas.reduce((t, f) => t + f.valorCents, 0);
  const atendimentosFeitos = (doMes ?? []).filter((a) => mesesDaFila.has(dateIn(a.start.toDate()).slice(0, 7)) && (a.status === "booked" || a.status === "confirmed") && a.start.toMillis() <= agora);
  const progresso = atendimentosFeitos.length ? Math.round(((atendimentosFeitos.length - pendentes.length) / atendimentosFeitos.length) * 100) : fila.length ? 0 : 100;
  const normalizar = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const filtrar = (l: Lancamento) => (filtro === "tudo" || l.tipo === filtro) && (forma === "todas" || l.forma === forma) && (!busca.trim() || normalizar(`${l.customerName ?? ""} ${l.descricao} ${l.categoria} ${l.staffName ?? ""}`).includes(normalizar(busca.trim())));
  const atividadeFiltrada = (atividade.items ?? []).filter(filtrar);
  const filtrando = !!busca.trim() || filtro !== "tudo" || forma !== "todas";
  const atividadeVisivel = verAtividade || filtrando ? atividadeFiltrada : atividadeFiltrada.slice(0, 8);
  const exportaveis = (lancamentos ?? []).filter(filtrar);

  function fechar(msg?: string) {
    setReciboDoAviso(folha?.modo === "baixa" && msg ? idDaBaixa(folha.atendimento.id) : null);
    setFolha(null);
    if (msg) setAviso(msg);
  }
  const abrirRecibo = (l: Lancamento) => (setFolha(null), setRecibo(itensDoRecibo(l, comAnterior ?? [])));
  const doAviso = reciboDoAviso ? comAnterior?.find((l) => l.id === reciboDoAviso) : undefined;

  async function mudarPct(staffId: string, pct: number) {
    setErro("");
    const vez = Date.now() + Math.random();
    setPcts((p) => ({ ...p, [staffId]: { pct, vez } }));
    const res = await definirComissaoAction(await idToken(), { tenantId: tenant.id, staffId, pct }).catch(() => ({ ok: false as const, error: "Sem conexão. Confira a internet e tente de novo." }));
    if (!res.ok) setErro(res.error ?? "Não foi possível salvar a comissão. Tente de novo.");
    setPcts(({ [staffId]: o, ...resto }) => (o?.vez === vez ? resto : { ...resto, ...(o && { [staffId]: o }) }));
  }

  function baixarCsv() {
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csvDoMes(exportaveis)], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `caixa-${tenant.id}-${mes}.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setAviso(`${exportaveis.length} ${exportaveis.length === 1 ? "registro exportado" : "registros exportados"}.`);
  }

  async function registrarFalta(id: string) {
    setFaltou(null);
    setErro("");
    try {
      await mudarStatus(tenant.id, id, "no_show");
      setAviso("Falta registrada. O atendimento saiu da fila de recebimento.");
    } catch (err) {
      setErro(err instanceof Error && err.message.startsWith("Sessão") ? err.message : errorMessage(err));
    }
  }

  return (
    <div className="grid gap-4 pb-24 sm:gap-5 sm:pb-0">
      <PageTitle title="Conciliação" valores sub={<>{nomeDoMes(mes)} · Feche o dia antes de analisar o mês.</>}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1" aria-label="Escolher mês">
            <Button variant="outline" size="icon-lg" className="size-11" onClick={() => setMes(mesSeguinte(mes, -1))} aria-label="Mês anterior"><ChevronLeft aria-hidden="true" /></Button>
            <Button variant="outline" size="icon-lg" className="size-11" onClick={() => setMes(mesSeguinte(mes, 1))} aria-label="Próximo mês"><ChevronRight aria-hidden="true" /></Button>
            <Button variant="ghost" className="h-11 px-3" disabled={mes === hoje.slice(0, 7)} onClick={() => setMes(hoje.slice(0, 7))}>Este mês</Button>
          </div>
          <Button variant="outline" className="h-11" onClick={() => setFolha({ modo: "novo", tipo: "saida", data: diaNovo })}><ArrowUpFromLine aria-hidden="true" />Nova saída</Button>
          <Button className="h-11 max-sm:hidden" onClick={() => setFolha({ modo: "novo", tipo: "entrada", data: diaNovo })}><Plus aria-hidden="true" />Novo lançamento</Button>
        </div>
      </PageTitle>

      <ol className="flex items-center gap-2 text-xs font-medium text-muted-foreground" aria-label="Etapas da conciliação">
        {[["Receber", pendentes.length === 0], ["Pagar", contas.length + pagoComissoes === 0], ["Conferir", fila.length === 0]].map(([rotulo, feita], i) => <li key={String(rotulo)} className="contents"><span className={cn("flex items-center gap-1.5", feita && "text-foreground")}><span className={cn("grid size-6 place-items-center rounded-full border text-[11px]", feita && "border-primary bg-primary text-primary-foreground")}>{feita ? <Check className="size-3.5" aria-hidden="true" /> : i + 1}</span>{rotulo}</span>{i < 2 && <span className="h-px w-5 bg-border sm:w-9" aria-hidden="true" />}</li>)}
      </ol>

      {descartados > 0 && <FormMessage tone="warning">{descartados === 1 ? "1 lançamento não pôde ser lido e ficou fora das contas." : `${descartados} lançamentos não puderam ser lidos e ficaram fora das contas.`} Os totais podem estar errados. Fale com a Ruphus.</FormMessage>}
      {erroPrincipal && <FormMessage><span className="grid flex-1 gap-2"><span>Não foi possível conferir todos os dados. Os valores e a fila estão pausados para não mostrar um saldo errado.</span><Button variant="outline" size="sm" className="h-10 w-fit bg-card" onClick={() => setTentativa((t) => t + 1)}><RotateCcw aria-hidden="true" />Tentar novamente</Button></span></FormMessage>}
      {configQuebrada && <FormMessage>Não foi possível ler as contas fixas e as comissões. Fale com a Ruphus antes de alterar esses dados.</FormMessage>}
      {!erroPrincipal && (!comAnterior || doMes === null) && <p role="status" className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Conferindo atendimentos e lançamentos…</p>}

      {!erroPrincipal && comAnterior && <>
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm" aria-label="Situação da conciliação">
          <div><strong className="font-serifa text-2xl font-normal">{fila.length ? `${fila.length} ${fila.length === 1 ? "ação restante" : "ações restantes"}` : mes === hoje.slice(0, 7) ? "Dia conciliado" : "Mês conciliado"}</strong><p className="text-sm text-muted-foreground">{fila.length ? `${brl(aReceber + devidoContas + pagoComissoes)} em movimentações pendentes` : "Tudo recebido e pago por aqui."}</p></div>
          <Button variant="outline" className="h-11" aria-pressed={foco} onClick={() => setFoco((v) => !v)}><Focus aria-hidden="true" />{foco ? "Mostrar fila completa" : "Modo foco"}</Button>
        </section>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(280px,.75fr)]">
          <section aria-labelledby="fila-titulo" className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
              <div><h2 id="fila-titulo" className="font-semibold">Fila de ação</h2><p className="text-sm text-muted-foreground">Recebimentos, contas e comissões em um só lugar.</p></div>
              {fila[0] && <Button variant="outline" className="h-11 max-sm:hidden" onClick={fila[0].abrir}><ArrowDownToLine aria-hidden="true" />{fila[0].acao} próximo</Button>}
            </div>
            {fila.length === 0 ? <div className="grid justify-items-start gap-2 border-t px-5 py-8"><CircleCheckBig className="size-8 text-emerald-700 dark:text-emerald-300" aria-hidden="true" /><h3 className="font-serifa text-2xl">Tudo em dia.</h3><p className="text-sm text-muted-foreground">Não há pendências. Confira a atividade e o resumo do mês abaixo.</p></div> : <ul className="border-t">
              {filaVisivel.map((item, i) => <li key={item.id} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b px-4 py-3.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:px-5", i === 0 && "bg-amber-50/60 shadow-[inset_3px_0_0_var(--foreground)] dark:bg-amber-950/20")}>
                <div className="grid min-w-0 gap-1"><div className="flex flex-wrap items-center gap-2"><strong>{item.titulo}</strong>{i === 0 && <span className="rounded-full bg-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-background">Próximo</span>}</div><span className="text-[13px] leading-snug text-muted-foreground">{item.detalhe}</span></div>
                <span className="text-right font-serifa text-xl tabular-nums">{item.valorCents ? brl(item.valorCents) : "a combinar"}</span>
                <div className="col-span-2 flex flex-wrap justify-end gap-2 sm:col-span-1"><Button className="h-11 min-w-28" onClick={item.abrir}>{item.acao === "Receber" ? <ArrowDownToLine aria-hidden="true" /> : <HandCoins aria-hidden="true" />}{item.acao}</Button>{item.secundaria && <Button variant="ghost" className="h-11" onClick={item.secundaria}><X aria-hidden="true" />Não veio</Button>}</div>
              </li>)}
            </ul>}
            {!foco && fila.length > 5 && <button type="button" aria-expanded={verTodos} onClick={() => setVerTodos((v) => !v)} className="min-h-12 w-full border-t px-4 text-sm font-medium hover:bg-muted/50">{verTodos ? "Mostrar menos" : `Ver todas as ${fila.length} ações`}</button>}
          </section>

          <aside className="grid gap-4 sm:max-lg:grid-cols-2" aria-label="Resumo do mês">
            <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5"><h2 className="font-semibold">Mês em números</h2><dl className="mt-2">
              {[["Sobrou", r.sobrou], ["Entrou", r.entrou], ["Saiu", r.saiu]].map(([rotulo, valor], i) => <div key={String(rotulo)} className="flex items-center justify-between gap-3 border-t py-2.5 first:border-t-0"><dt className="text-sm text-muted-foreground">{rotulo}</dt><dd className={cn("text-right tabular-nums", i === 0 ? "font-serifa text-2xl" : "font-semibold", rotulo === "Entrou" && "text-emerald-800 dark:text-emerald-300", (rotulo === "Saiu" || (rotulo === "Sobrou" && r.sobrou < 0)) && "text-red-800 dark:text-red-300")}>{lancamentos ? brl(Number(valor)) : "…"}</dd></div>)}
            </dl><div className="mt-2"><div className="flex justify-between gap-2 text-xs text-muted-foreground"><span>{progresso}% dos atendimentos recebidos</span><strong>{progresso}%</strong></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Atendimentos recebidos" aria-valuenow={progresso} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${progresso}%` }} /></div></div></section>
            <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5"><h2 className="font-semibold">Próximas obrigações</h2><div className="mt-2 flex justify-between gap-3 border-b py-2.5 text-sm"><span className="text-muted-foreground">Comissões da equipe</span><strong className="tabular-nums">{brl(pagoComissoes)}</strong></div><div className="flex justify-between gap-3 py-2.5 text-sm"><span className="text-muted-foreground">Contas do mês</span><strong className="tabular-nums">{brl(devidoContas)}</strong></div><div className="grid gap-2"><Button variant="outline" className="h-11 w-full justify-start" onClick={() => document.getElementById("comissoes")?.scrollIntoView({ behavior: "smooth", block: "start" })}><UsersRound aria-hidden="true" />Ver comissões</Button><Button variant="outline" className="h-11 w-full justify-start" disabled={!configPronta} onClick={() => setVerFixas(true)}><Settings2 aria-hidden="true" />Contas fixas</Button></div></section>
          </aside>
        </div>
      </>}

      <section aria-labelledby="atividade-titulo" className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5"><div><h2 id="atividade-titulo" className="font-semibold">Atividade recente</h2><p className="text-sm text-muted-foreground">Confira, corrija ou emita um recibo sem abrir uma planilha.</p></div><Button variant="outline" className="h-11" disabled={!exportaveis.length} onClick={baixarCsv}><Download aria-hidden="true" />Exportar{busca || filtro !== "tudo" || forma !== "todas" ? " filtrados" : " mês"}</Button></div>
        <div className="grid gap-2 border-t p-3 sm:grid-cols-[minmax(200px,1fr)_auto_auto] sm:px-5"><label className="relative"><span className="sr-only">Buscar nos registros carregados</span><Search className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground" aria-hidden="true" /><Input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente, descrição ou categoria" className="h-11 pl-9 text-base" /></label><label><span className="sr-only">Filtrar por tipo</span><select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} className="h-11 w-full rounded-md border bg-card px-3 text-sm sm:w-auto"><option value="tudo">Entradas e saídas</option><option value="entrada">Só entradas</option><option value="saida">Só saídas</option></select></label><label><span className="sr-only">Filtrar por forma de pagamento</span><select value={forma} onChange={(e) => setForma(e.target.value)} className="h-11 w-full rounded-md border bg-card px-3 text-sm sm:w-auto"><option value="todas">Todas as formas</option>{Object.entries(ROTULO_FORMA).map(([id, rotulo]) => <option key={id} value={id}>{rotulo}</option>)}</select></label></div>
        {atividade.error && <div className="border-t p-4"><FormMessage><span className="grid flex-1 gap-2">{atividade.error}<Button variant="outline" size="sm" className="h-10 w-fit bg-card" onClick={atividade.items?.length ? atividade.loadMore : () => setTentativa((t) => t + 1)}><RotateCcw aria-hidden="true" />Tentar novamente</Button></span></FormMessage></div>}
        {!atividade.items && !atividade.error ? <p role="status" className="border-t px-5 py-8 text-sm text-muted-foreground">Carregando a atividade…</p> : atividadeFiltrada.length === 0 ? <div className="grid justify-items-center gap-2 border-t px-5 py-9 text-center"><ReceiptText className="size-7 text-muted-foreground" aria-hidden="true" /><p className="text-sm text-muted-foreground">{busca || filtro !== "tudo" || forma !== "todas" ? "Nenhum registro encontrado nos lançamentos carregados. Ajuste os filtros ou carregue mais." : "Nada lançado neste mês. Receba um atendimento ou registre uma entrada."}</p></div> : <ul className="border-t">{atividadeVisivel.map((l) => <li key={l.id} className="border-b last:border-b-0"><button type="button" onClick={() => setFolha({ modo: "editar", lancamento: l })} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_auto] sm:px-5"><span className="grid min-w-0 gap-0.5"><span className="font-medium [overflow-wrap:anywhere]">{l.customerName || l.descricao || l.categoria}</span><span className="text-[13px] text-muted-foreground">{[recebidos.has(idDoEstorno(l.id)) && "Estornado", (l.customerName || l.descricao) && l.categoria, l.customerName && l.descricao, l.staffName].filter(Boolean).join(" · ") || "Lançamento manual"}</span></span><span className="text-sm text-muted-foreground max-sm:col-span-2">{formatLongDate(zonedTime(l.data, "12:00"))}{l.data === hoje ? " · hoje" : ""}</span><span className="text-sm text-muted-foreground max-sm:col-span-2">{ROTULO_FORMA[l.forma]}</span><span className={cn("text-right font-semibold whitespace-nowrap tabular-nums max-sm:col-start-2 max-sm:row-start-1", l.tipo === "saida" ? "text-red-800 dark:text-red-300" : "text-emerald-800 dark:text-emerald-300")}>{l.tipo === "saida" ? "−" : "+"} {brl(l.valorCents)}</span></button></li>)}</ul>}
        {!filtrando && atividadeFiltrada.length > 8 && <div className="border-t p-2"><Button variant="ghost" className="h-11 w-full" aria-expanded={verAtividade} onClick={() => setVerAtividade((v) => !v)}>{verAtividade ? "Mostrar só os 8 mais recentes" : `Ver todos os ${atividadeFiltrada.length} registros carregados`}</Button></div>}
        {atividade.hasMore && <div className="border-t p-3 text-center"><Button variant="ghost" className="h-11 w-full" disabled={atividade.busy} onClick={atividade.loadMore}>{atividade.busy ? "Carregando…" : "Carregar mais 30 registros"}</Button><p className="text-xs text-muted-foreground">A busca e os filtros também procuram nos registros já carregados.</p></div>}
      </section>

      {!!lancamentos?.length && <details className="rounded-2xl border bg-card"><summary className="flex min-h-14 cursor-pointer items-center gap-2 px-4 py-4 font-semibold sm:px-5"><FileText aria-hidden="true" className="size-5" />Resumo do mês</summary><div className="grid gap-6 border-t px-4 py-5 sm:grid-cols-2 sm:px-5"><Bloco titulo="Recebido por forma (já sem estornos)" linhas={r.porForma} /><Bloco titulo="Faturamento por profissional" linhas={r.porProfissional} vazio="Só conta o que foi recebido pela agenda." /><Bloco titulo="Entradas por categoria" linhas={r.entradasPorCategoria} /><Bloco titulo="Saídas por categoria" linhas={r.saidasPorCategoria} /></div></details>}

      {!configQuebrada && todasComissoes.length > 0 && <details id="comissoes" className="scroll-mt-20 rounded-2xl border bg-card"><summary className="flex min-h-14 cursor-pointer items-center justify-between gap-3 px-4 py-4 sm:px-5"><span className="flex items-center gap-2 font-semibold"><UsersRound className="size-5" aria-hidden="true" />Comissões</span><span className="text-sm font-normal text-muted-foreground">{brl(pagoComissoes)} a pagar</span></summary><div className="border-t px-4 py-4 sm:px-5"><p className="text-sm text-muted-foreground">Sobre o que cada profissional recebeu pela agenda. Toque no nome para ver o histórico.</p>{semPct > 0 && <p className="mt-2 text-sm text-muted-foreground">{semPct === 1 ? "1 profissional sem % fica fora." : `${semPct} profissionais sem % ficam fora.`} <Link href={`/${tenant.id}/profissionais`} className="underline underline-offset-4">Definir em Profissionais</Link></p>}</div><ul>{comissoes.map((c) => {
        const paga = pagas.get(idDoPagamento("comissao", c.staffId, mes));
        const devido = paga ? c.bruto - (paga.descontoCents ?? 0) : c.valor;
        const fica = paga ? c.desconto : c.desconto - c.abatido;
        return <li key={c.staffId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-t px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_6rem_7rem_auto] sm:px-5"><span className="grid min-w-0 gap-0.5"><button type="button" onClick={() => setHistorico({ staffId: c.staffId, nome: c.nome })} className="flex min-h-11 w-fit max-w-full items-center gap-1.5 text-left font-medium underline decoration-dotted underline-offset-4"><UserRound className="size-4 shrink-0" aria-hidden="true" /><span className="truncate">{c.nome}</span><History className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /></button><span className="text-[13px] text-muted-foreground tabular-nums">faturou {brl(c.faturado)}{vales[c.staffId] > 0 && ` · ${brl(vales[c.staffId])} em vale`}{!paga && c.abatido !== 0 && ` · ajuste de ${brl(c.abatido)}`}{paga && paga.valorCents !== devido && ` · pago ${brl(paga.valorCents)}, conta atual ${brl(devido)}`}{fica !== 0 && ` · ${brl(Math.abs(fica))} ${fica > 0 ? "a descontar" : "a devolver"} no próximo`}</span></span><label className="flex items-center gap-1 text-sm"><Input key={`${c.staffId}-${c.pct}`} inputMode="decimal" disabled={!configPronta} defaultValue={c.pct ? String(c.pct).replace(".", ",") : ""} placeholder="0" aria-label={`Comissão de ${c.nome} em %`} onBlur={(e) => { const pct = pctDoTexto(e.target.value); if (pct === null) return void (e.target.value = c.pct ? String(c.pct).replace(".", ",") : ""); if (pct !== c.pct) mudarPct(c.staffId, pct); }} className="h-11 w-16 text-right text-base tabular-nums" />%</label><span className="font-serifa text-xl tabular-nums max-sm:col-start-1">{brl(paga ? paga.valorCents : c.valor)}</span><div className="flex justify-end gap-1 max-sm:col-start-2 max-sm:row-start-3"><Button variant="ghost" className="h-11 px-3" disabled={!configPronta} onClick={() => setVale({ id: c.staffId, nome: c.nome })}><WalletCards aria-hidden="true" />Vale</Button>{paga ? <span className="flex min-h-11 items-center gap-1 text-sm text-emerald-800 dark:text-emerald-300"><Check className="size-4" aria-hidden="true" />Paga</span> : <Button variant="outline" className="h-11" disabled={!c.valor && !(c.abatido > 0)} onClick={() => setFolha({ modo: "pagar", titulo: `Pagar comissão de ${c.nome}`, detalhe: `${String(c.pct).replace(".", ",")}% de ${brl(c.faturado)}${c.abatido > 0 ? ` − ${brl(c.abatido)} de vale e estorno` : c.abatido < 0 ? ` + ${brl(-c.abatido)} de estorno desfeito` : ""} · ${nomeDoMes(mes)}`, valorCents: c.valor, pagamento: { tipo: "comissao", alvoId: c.staffId, mes, descontoCents: c.abatido } })}><HandCoins aria-hidden="true" />Pagar</Button>}</div></li>;
      })}</ul></details>}

      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 border-t bg-card p-3 sm:hidden"><Button className="h-12 w-full text-base" onClick={fila[0]?.abrir ?? (() => setFolha({ modo: "novo", tipo: "entrada", data: diaNovo }))} disabled={!!erroPrincipal}>{fila[0] ? <><ArrowDownToLine aria-hidden="true" />{fila[0].acao} próximo · {fila[0].valorCents ? brl(fila[0].valorCents) : "a combinar"}</> : <><Plus aria-hidden="true" />Novo lançamento</>}</Button></div>
      {aviso && <div role="status" className="fixed inset-x-3 bottom-[calc(9.5rem+env(safe-area-inset-bottom))] z-30 flex items-center justify-between gap-2 rounded-xl border bg-foreground p-3 text-sm text-background shadow-lg sm:top-5 sm:right-5 sm:bottom-auto sm:left-auto sm:max-w-md"><span className="flex items-start gap-2"><CircleCheckBig className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{aviso}</span><span className="flex shrink-0 gap-1">{doAviso && <Button variant="outline" size="sm" className="h-10 bg-background text-foreground" onClick={() => abrirRecibo(doAviso)}><ReceiptText aria-hidden="true" />Recibo</Button>}<Button variant="ghost" size="icon" className="size-10 text-background hover:bg-background/20 hover:text-background" aria-label="Fechar aviso" onClick={() => (setAviso(""), setReciboDoAviso(null))}><X aria-hidden="true" /></Button></span></div>}
      {erro && <FeedbackDialog tipo="erro" mensagem={erro} onClose={() => setErro("")} />}
      {historico && <ComissoesHistorico tenantId={tenant.id} staffId={historico.staffId} nome={historico.nome} pct={config.comissoes[historico.staffId] ?? 0} guardado={config.descontos[historico.staffId] ?? 0} onClose={() => setHistorico(null)} />}
      {vale && <ValeFolha tenantId={tenant.id} negocio={tenant.name} staff={vale} onClose={(msg) => (setVale(null), msg && setAviso(msg))} />}
      {verFixas && <ContasFixas tenantId={tenant.id} nicho={tenant.gerado?.nicho} fixas={config.fixas.filter((f) => !f.ate)} onClose={() => setVerFixas(false)} />}
      {folha && <LancamentoFolha tenantId={tenant.id} nicho={tenant.gerado?.nicho} folha={folha} estornado={folha.modo === "editar" && recebidos.has(idDoEstorno(folha.lancamento.id))} onClose={fechar} onRecibo={folha.modo === "editar" ? () => abrirRecibo(folha.lancamento) : undefined} />}
      {recibo && <Recibo tenantId={tenant.id} itens={recibo} onClose={() => setRecibo(null)} />}
      {faltou && <ConfirmDialog title={`Registrar que ${faltou.nome} faltou?`} description="O atendimento sai da fila de recebimento e fica no histórico do cliente." confirmLabel="Sim, registrar falta" onConfirm={() => registrarFalta(faltou.id)} onCancel={() => setFaltou(null)} />}
    </div>
  );
}

function Bloco({ titulo, linhas, vazio = "Nada neste mês." }: { titulo: string; linhas: [string, number][]; vazio?: string }) {
  const { brl } = useValores();
  const maior = linhas[0]?.[1] ?? 0;
  return <div className="grid content-start gap-2.5"><h3 className="text-sm font-medium">{titulo}</h3>{linhas.length === 0 ? <p className="text-sm text-muted-foreground">{vazio}</p> : linhas.map(([nome, valor], i) => <div key={i} className="grid gap-1"><div className="flex justify-between gap-3 text-sm"><span className="truncate">{nome}</span><span className="tabular-nums">{brl(valor)}</span></div><div className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${maior ? (valor / maior) * 100 : 0}%` }} /></div></div>)}</div>;
}
