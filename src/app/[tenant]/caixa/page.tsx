"use client";

import { orderBy, Timestamp, where } from "firebase/firestore";
import { useValores } from "@/lib/valores";
import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/auth-errors";
import { formatLongDate, formatTime, todayIn, zonedTime } from "@/lib/datetime";
import { idToken } from "@/lib/firebase";
import { CaixaConfig, comissoesDoMes, diaNoMes, fixaNoMes, mesDaComissao, pctDoTexto, csvDoMes, idDaBaixa, idDoEstorno, ehVale, idDoPagamento, Lancamento, resumoDoMes, ROTULO_FORMA } from "@/lib/financeiro";
import { useCollection } from "@/lib/use-collection";
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

// O que o "fechar o dia" precisa do agendamento
const Atendimento = z.object({
  serviceName: z.string(),
  staffName: z.string(),
  priceCents: z.number(),
  customerName: z.string(),
  start: z.instanceof(Timestamp),
  status: z.enum(["booked", "confirmed", "cancelled", "no_show"]),
  // sinal pago pelo agendamento online: já entrou no Caixa, sai do que falta receber
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
  // o "Fechar o dia" mostra os mais recentes; a lista toda só quando o dono pede
  const [verTodos, setVerTodos] = useState(false);
  const [historico, setHistorico] = useState<{ staffId: string; nome: string } | null>(null);
  const [vale, setVale] = useState<{ id: string; nome: string } | null>(null);
  // a lista do mês por tipo: o dono leigo vê o que entrou separado do que saiu (contas, comissões, vales)
  const [filtro, setFiltro] = useState<"tudo" | "entrada" | "saida">("tudo");
  // o % digitado vale na hora, só enquanto a gravação dele está a caminho: "Pagar" logo depois
  // usa o novo. Voltou do servidor, sai daqui e vale o da configuração, mude ela onde mudar.
  // ponytail: entre a resposta e o snapshot pode piscar o % velho; esperar o snapshot se incomodar
  const [pcts, setPcts] = useState<Record<string, { pct: number; vez: number }>>({});
  // o relógio anda a cada minuto: com o Caixa aberto, o horário que passa entra no "Fechar o dia" sem recarregar
  const [agora, setAgora] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const ligado = tenant.podeGerir && tenant.modulos?.financeiro === true;

  const hoje = todayIn();
  // aberto na virada do mês: quem olhava o mês corrente passa para o novo, senão o lançamento
  // de hoje nasceria no dia 31 e o "Fechar o dia" deixaria os atendimentos de hoje de fora
  const [mesCorrente, setMesCorrente] = useState(hoje.slice(0, 7));
  if (mesCorrente !== hoje.slice(0, 7)) {
    setMesCorrente(hoje.slice(0, 7));
    if (mes === mesCorrente) setMes(hoje.slice(0, 7));
  }
  // no mês corrente, o "Fechar o dia" também olha o mês anterior: o atendimento das 19h do
  // dia 31 não some na virada do mês. Os lançamentos de lá só servem para saber o que já foi recebido.
  // ponytail: só um mês para trás; o que ficou de antes, o dono acha voltando o mês
  const desde = mes === hoje.slice(0, 7) ? mesSeguinte(mes, -1) : mes;
  // num mês passado, o seguinte também: o estorno nasce no dia em que foi feito, e a entrada
  // daqui precisa saber que já foi estornada. ponytail: estorno 2+ meses depois, só o servidor barra
  const ate = mes < hoje.slice(0, 7) ? mesSeguinte(mes, 1) : mes;
  // as consultas só sobem com o Caixa ligado: desligado, a regra negaria a leitura
  const [comAnteriorLido, erroLeitura] = useCollection(ligado ? tenant.id : "", "lancamentos", Lancamento, [where("mes", "in", [...new Set([desde, mes, ate])])], `${desde}/${mes}/${ate}`);
  // leitura com erro chega vazia: tratada como "carregando", senão a tela daria R$ 0, tudo a
  // receber de novo e todas as contas em aberto como se fosse verdade
  const comAnterior = erroLeitura ? null : comAnteriorLido;
  const lancamentos = comAnterior && comAnterior.filter((l) => l.mes === mes);
  const [doMes, erroAgenda] = useCollection(
    ligado ? tenant.id : "",
    "appointments",
    Atendimento,
    [where("start", ">=", zonedTime(`${desde}-01`, "00:00")), where("start", "<", zonedTime(`${mesSeguinte(mes, 1)}-01`, "00:00")), orderBy("start")],
    `${desde}/${mes}`,
  );
  // lido solto e conferido aqui: o useCollection descartaria em silêncio um documento fora do
  // esquema, e o Caixa mostraria contas e comissões zeradas como se fossem verdade
  const [equipe] = useCollection(ligado ? tenant.id : "", "staff", z.object({ name: z.string() }));
  const [configs, erroConfig] = useCollection(ligado ? tenant.id : "", "caixa", z.record(z.string(), z.unknown()));
  const lido = CaixaConfig.safeParse(configs?.find((c) => c.id === "config") ?? {});
  // sem a configuração lida não se mexe nela: mostrar vazio e deixar editar enganaria o dono
  const configPronta = configs !== null && !erroConfig && lido.success;
  const config = lido.success ? lido.data : CaixaConfig.parse({});
  const configQuebrada = configs !== null && (!!erroConfig || !lido.success);

  if (!ligado) {
    return (
      <>
        <PageTitle title="Caixa" />
        <p className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
          {tenant.podeGerir ? "O Caixa não está ativo para este negócio. Para usar, fale com a Ruphus." : "Só o dono ou um administrador do negócio vê o Caixa."}
        </p>
      </>
    );
  }

  const recebidos = new Set(comAnterior?.map((l) => l.id));
  // o sinal que restanteDe tira do preço: vai junto na baixa, para o servidor conferir que não mudou
  const sinalDe = (a: z.infer<typeof Atendimento>) => (a.sinal?.status === "pago" ? a.sinal.cents : 0);
  // ponytail: sinal de 100% confirmado com o Caixa desligado fica fora (restante 0 não aparece aqui)
  // sem os lançamentos carregados não dá para saber o que já foi recebido
  const pendentes = (comAnterior ? (doMes ?? []) : []).filter(
    (a) => (a.status === "booked" || a.status === "confirmed") && a.start.toMillis() <= agora && !recebidos.has(idDaBaixa(a.id)) && (restanteDe(a) > 0 || sinalDe(a) === 0),
  );
  const aReceber = pendentes.reduce((t, a) => t + restanteDe(a), 0);
  // o de hoje primeiro: é o que o dono está fechando; os antigos esperam no "ver todos"
  const PRIMEIROS = 3;
  const visiveis = [...pendentes].reverse().slice(0, verTodos ? undefined : PRIMEIROS);
  const r = resumoDoMes(lancamentos ?? []);
  // contas fixas ainda não pagas no mês, pela ordem do vencimento
  // antes de a conta existir, ela não conta: nem a pagar, nem "tudo pago"
  const doMesFixas = config.fixas.filter((f) => fixaNoMes(f, mes));
  const contas = (lancamentos ? doMesFixas : []).filter((f) => !recebidos.has(idDoPagamento("fixa", f.id, mes))).sort((a, b) => a.dia - b.dia);
  const pctsPendentes = Object.fromEntries(Object.entries(pcts).map(([k, o]) => [k, o.pct]));
  // nome de quem só tem crédito no mês: o cadastro, ou o último lançamento dele que a tela tem
  const nomes = Object.fromEntries([...(comAnterior ?? []).filter((l) => l.staffId && l.staffName).map((l) => [l.staffId!, l.staffName!]), ...(equipe ?? []).map((p) => [p.id, p.name])]);
  // pelo mês da comissão: o sinal só depois de o atendimento ser recebido, no mês do recebimento.
  // ponytail: sinal pago 2+ meses antes do recebimento fica fora da tela (o servidor conta certo)
  const daComissao = (comAnterior ?? []).filter((l) => mesDaComissao(l) === mes);
  const todasComissoes = comissoesDoMes(lancamentos ? daComissao : [], { ...config.comissoes, ...pctsPendentes }, config.descontos, nomes);
  // sem % no cadastro, sem comissão: fica fora da lista e do total. Só fica quem, mesmo sem %,
  // ainda tem algo a acertar no mês (comissão já paga ou estorno guardado)
  const comissoes = todasComissoes.filter((c) => c.pct > 0 || c.desconto !== 0 || lancamentos?.some((l) => l.id === idDoPagamento("comissao", c.staffId, mes)));
  const semPct = todasComissoes.length - comissoes.length;
  // lançamento novo cai no mês da tela: hoje, ou o último dia de um mês passado
  const diaNovo = mes === hoje.slice(0, 7) ? hoje : diaNoMes(mes, mes < hoje ? 31 : 1);
  const pagas = new Map(lancamentos?.filter((l) => l.id.startsWith("cm-")).map((l) => [l.id, l]));
  // vales dados no mês, por profissional: já saíram do caixa, contam como pago
  const vales = (lancamentos ?? []).filter((l) => ehVale(l.id)).reduce<Record<string, number>>((t, l) => ((t[l.staffId ?? ""] = (t[l.staffId ?? ""] ?? 0) + l.valorCents), t), {});
  const totalDe = (tipo: "entrada" | "saida") => (lancamentos ?? []).reduce((t, l) => t + (l.tipo === tipo ? l.valorCents : 0), 0);
  const porDia = Object.entries(
    [...(lancamentos ?? [])].filter((l) => filtro === "tudo" || l.tipo === filtro).sort((a, b) => b.data.localeCompare(a.data)).reduce<Record<string, Lancamento[]>>((g, l) => ((g[l.data] ??= []).push(l), g), {}),
  );

  function fechar(msg?: string) {
    // recebeu um atendimento: o aviso já oferece o recibo dele
    setReciboDoAviso(folha?.modo === "baixa" && msg ? idDaBaixa(folha.atendimento.id) : null);
    setFolha(null);
    if (msg) setAviso(msg);
  }
  // com o mês anterior junto: o atendimento do dia 31 recebido no dia 1 e o sinal pago no mês de antes
  const abrirRecibo = (l: Lancamento) => (setFolha(null), setRecibo(itensDoRecibo(l, comAnterior ?? [])));
  const doAviso = reciboDoAviso ? comAnterior?.find((l) => l.id === reciboDoAviso) : undefined;

  async function mudarPct(staffId: string, pct: number) {
    setErro("");
    const vez = Date.now() + Math.random();
    setPcts((p) => ({ ...p, [staffId]: { pct, vez } }));
    const r = await definirComissaoAction(await idToken(), { tenantId: tenant.id, staffId, pct }).catch(() => ({ ok: false as const, error: "Sem conexão. Tente de novo." }));
    if (!r.ok) setErro(r.error ?? "Não foi possível salvar.");
    // tira só este %: um digitado depois, ainda a caminho, fica
    setPcts(({ [staffId]: o, ...resto }) => (o?.vez === vez ? resto : { ...resto, ...(o && { [staffId]: o }) }));
  }

  function baixarCsv() {
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csvDoMes(lancamentos ?? [])], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `caixa-${tenant.id}-${mes}.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function registrarFalta(id: string) {
    setFaltou(null);
    setErro("");
    try {
      await mudarStatus(tenant.id, id, "no_show");
      setAviso("Falta registrada.");
    } catch (err) {
      setErro(err instanceof Error && err.message.startsWith("Sessão") ? err.message : errorMessage(err));
    }
  }

  return (
    <>
      <PageTitle title="Caixa" valores sub={nomeDoMes(mes)}>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-lg" className="size-10 max-sm:size-11" onClick={() => setMes(mesSeguinte(mes, -1))} aria-label="Mês anterior">‹</Button>
          <Button variant="outline" size="icon-lg" className="size-10 max-sm:size-11" onClick={() => setMes(mesSeguinte(mes, 1))} aria-label="Próximo mês">›</Button>
          <Button variant="ghost" className="h-10 px-3 max-sm:h-11" disabled={mes === hoje.slice(0, 7)} onClick={() => setMes(hoje.slice(0, 7))}>Este mês</Button>
        </div>
      </PageTitle>

      {/* No celular, três cartões de ~115 px partiam "R$ 12.345,00" no meio: o Sobrou (o que o
          dono quer saber) ocupa a linha de cima, maior, e Entrou/Saiu dividem a de baixo. */}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4">
        {[
          { label: "Entrou", valor: r.entrou, cor: "text-emerald-800 dark:text-emerald-300", destaque: false },
          { label: "Saiu", valor: r.saiu, cor: "text-red-800 dark:text-red-300", destaque: false },
          { label: "Sobrou", valor: r.sobrou, cor: r.sobrou < 0 ? "text-red-800 dark:text-red-300" : "", destaque: true },
        ].map((t) => (
          // min-w-0 e quebra em qualquer ponto: segurança para valores enormes em 320 px
          <div key={t.label} className={cn("grid min-w-0 gap-1.5 rounded-2xl border bg-card px-4 py-4 sm:px-5", t.destaque && "max-sm:order-first max-sm:col-span-2")}>
            <dt className="text-[13px] text-muted-foreground">{t.label}</dt>
            <dd className={cn("font-serifa leading-none tabular-nums [overflow-wrap:anywhere] sm:text-3xl", t.destaque ? "text-3xl" : "text-2xl max-[359px]:text-xl", t.cor)}>{lancamentos ? brl(t.valor) : "…"}</dd>
          </div>
        ))}
      </dl>

      {/* no computador, dois botões de meia tela pesavam mais que os números: largura do texto */}
      <div className="grid grid-cols-2 gap-3 sm:flex">
        <Button className="h-12 text-base sm:min-w-44" onClick={() => setFolha({ modo: "novo", tipo: "entrada", data: diaNovo })}>+ Entrada</Button>
        <Button variant="outline" className="h-12 text-base sm:min-w-44" onClick={() => setFolha({ modo: "novo", tipo: "saida", data: diaNovo })}>− Saída</Button>
      </div>

      {aviso && (
        <p role="status" className="flex items-center justify-between gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950">
          <span>{aviso}</span>
          <span className="flex shrink-0 gap-1">
            {doAviso && <Button variant="outline" size="sm" onClick={() => abrirRecibo(doAviso)}>Recibo</Button>}
            <Button variant="ghost" size="sm" onClick={() => (setAviso(""), setReciboDoAviso(null))}>Fechar</Button>
          </span>
        </p>
      )}
      {(erro || erroLeitura) && <p role="alert" className="text-sm text-destructive">{erro || erroLeitura}</p>}
      {configQuebrada && <p role="alert" className="text-sm text-destructive">Não foi possível ler as contas fixas e as comissões. Fale com a Ruphus antes de mexer nelas.</p>}

      {/* sem a agenda, "Fechar o dia" sumiria calado e o dono acharia que recebeu tudo */}
      {erroAgenda && <p role="alert" className="text-sm text-destructive">Não foi possível ler a agenda: os atendimentos a receber não aparecem. Recarregue a página.</p>}
      {!erroAgenda && comAnterior && doMes === null && <p className="text-sm text-muted-foreground">Conferindo os atendimentos a receber…</p>}

      {pendentes.length > 0 && (
        <section aria-labelledby="fechar" className="overflow-hidden rounded-2xl border bg-card">
          <div className="grid gap-0.5 px-4 py-4 sm:px-6">
            {/* "Fechar o dia" listava também os dias anteriores: o título diz o que é a lista */}
            <h2 id="fechar" className="font-semibold">A receber da agenda</h2>
            <p className="text-sm text-muted-foreground">
              {pendentes.length} atendimento{pendentes.length > 1 ? "s" : ""} já feito{pendentes.length > 1 ? "s" : ""}, sem recebimento · {brl(aReceber)}
            </p>
          </div>
          <ul>
            {visiveis.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-4 py-3.5 sm:px-6">
                <div className="grid min-w-0 flex-1 basis-60 gap-0.5">
                  <span className="font-semibold">{a.customerName}</span>
                  <span className="text-sm text-muted-foreground">
                    {formatLongDate(a.start.toDate())}, {formatTime(a.start.toDate())} · {a.serviceName} · {a.staffName}
                    {sinalDe(a) > 0 && ` · sinal de ${brl(sinalDe(a))} já pago`}
                  </span>
                </div>
                {/* serviço sem preço no cadastro: o valor se digita ao receber */}
                <span className="font-serifa text-xl tabular-nums max-sm:mr-auto">{restanteDe(a) ? brl(restanteDe(a)) : "a combinar"}</span>
                <div className="flex gap-2">
                  <Button className="h-10 px-4" onClick={() => setFolha({ modo: "baixa", atendimento: { id: a.id, customerName: a.customerName, serviceName: a.serviceName, priceCents: restanteDe(a), sinalCents: sinalDe(a) } })}>Recebi</Button>
                  <Button variant="outline" className="h-10 px-4" onClick={() => setFaltou({ id: a.id, nome: a.customerName })}>Não veio</Button>
                </div>
              </li>
            ))}
          </ul>
          {pendentes.length > PRIMEIROS && (
            <button
              type="button"
              aria-expanded={verTodos}
              onClick={() => setVerTodos(!verTodos)}
              className="flex min-h-12 w-full items-center justify-center border-t px-4 text-sm font-medium hover:bg-muted/50"
            >
              {verTodos ? "Mostrar só os mais recentes" : `Ver os outros ${pendentes.length - PRIMEIROS}, mais antigos`}
            </button>
          )}
        </section>
      )}

      {!configQuebrada && <section aria-labelledby="contas" className="overflow-hidden rounded-2xl border bg-card">
        <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="grid gap-0.5">
            <h2 id="contas" className="font-semibold">Contas do mês</h2>
            <p className="text-sm text-muted-foreground">
              {!config.fixas.some((f) => !f.ate)
                ? "Cadastre aluguel, internet e o que se repete todo mês."
                : doMesFixas.length === 0
                  ? "Nenhuma conta fixa neste mês."
                  : contas.length === 0
                    ? "Tudo pago neste mês."
                  : `${contas.length} a pagar · ${brl(contas.reduce((t, f) => t + f.valorCents, 0))}`}
            </p>
          </div>
          <Button variant="outline" className="h-10 px-3 max-sm:h-11" disabled={!configPronta} onClick={() => setVerFixas(true)}>Contas fixas</Button>
        </div>
        {contas.length > 0 && (
          <ul>
            {contas.map((f) => (
              <li key={f.id} className="flex items-center gap-3 border-t px-4 py-3 sm:px-6">
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate font-medium">{f.nome}</span>
                  <span className="text-[13px] text-muted-foreground">vence dia {Number(diaNoMes(mes, f.dia).slice(8))} · {f.categoria}</span>
                </span>
                <span className="shrink-0 whitespace-nowrap font-serifa text-lg tabular-nums">{brl(f.valorCents)}</span>
                <Button
                  className="h-10 px-4"
                  onClick={() => setFolha({ modo: "pagar", titulo: `Pagar ${f.nome}`, detalhe: `${f.categoria} · ${nomeDoMes(mes)}`, valorCents: f.valorCents, pagamento: { tipo: "fixa", alvoId: f.id, mes } })}
                >
                  Paguei
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>}

      <section aria-labelledby="lancamentos" className="overflow-hidden rounded-2xl border bg-card">
        <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <h2 id="lancamentos" className="font-semibold">Lançamentos do mês</h2>
          {!!lancamentos?.length && <Button variant="ghost" className="h-10 px-3 max-sm:h-11" onClick={baixarCsv}>Exportar planilha</Button>}
        </div>
        {!!lancamentos?.length && (
          <div role="group" aria-label="Mostrar" className="grid grid-cols-3 gap-1 border-t p-2 sm:px-6">
            {([["tudo", "Tudo", null], ["entrada", "Entradas", totalDe("entrada")], ["saida", "Saídas", totalDe("saida")]] as const).map(([f, rotulo, total]) => (
              <button
                key={f}
                type="button"
                aria-pressed={filtro === f}
                onClick={() => setFiltro(f)}
                className={cn("grid min-h-11 content-center rounded-lg px-2 py-1.5 text-sm hover:bg-muted", filtro === f && "bg-primary text-primary-foreground hover:bg-primary/90")}
              >
                <span className="font-medium">{rotulo}</span>
                {total !== null && <span className="text-xs tabular-nums opacity-80">{brl(total)}</span>}
              </button>
            ))}
          </div>
        )}
        {!lancamentos ? (
          <p className="border-t px-6 py-8 text-sm text-muted-foreground">Carregando…</p>
        ) : porDia.length === 0 && lancamentos.length ? (
          <p className="border-t px-6 py-10 text-center text-sm text-muted-foreground">{filtro === "entrada" ? "Nenhuma entrada neste mês." : "Nenhuma saída neste mês."}</p>
        ) : porDia.length === 0 ? (
          <p className="border-t px-6 py-10 text-center text-sm text-muted-foreground">Nada lançado neste mês. Use “+ Entrada” e “− Saída”, ou receba os atendimentos da agenda.</p>
        ) : (
          porDia.map(([dia, itens]) => {
            const saldo = itens.reduce((t, l) => t + (l.tipo === "entrada" ? l.valorCents : -l.valorCents), 0);
            return (
              <div key={dia} className="border-t">
                <div className="flex justify-between gap-3 bg-muted/40 px-4 py-2 text-[13px] text-muted-foreground sm:px-6">
                  <span className="min-w-0">{formatLongDate(zonedTime(dia, "12:00"))}{dia === hoje ? " · hoje" : ""}</span>
                  <span className="shrink-0 whitespace-nowrap tabular-nums">{saldo >= 0 ? "+" : "−"} {brl(Math.abs(saldo))}</span>
                </div>
                <ul>
                  {itens.map((l) => (
                    <li key={l.id}>
                      <button
                        type="button"
                        onClick={() => setFolha({ modo: "editar", lancamento: l })}
                        className="flex w-full items-center gap-3 border-t px-4 py-3 text-left first:border-t-0 hover:bg-muted/50 sm:px-6"
                      >
                        <span className="grid min-w-0 flex-1 gap-0.5">
                          <span className="truncate font-medium">{l.customerName || l.descricao || l.categoria}</span>
                          <span className="truncate text-[13px] text-muted-foreground">
                            {/* sem cliente nem descrição, a categoria já é o título: não repete embaixo */}
                            {[recebidos.has(idDoEstorno(l.id)) && "Estornado", (l.customerName || l.descricao) && l.categoria, l.customerName && l.descricao, l.staffName, ROTULO_FORMA[l.forma]].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        <span className={cn("shrink-0 whitespace-nowrap tabular-nums font-semibold", l.tipo === "saida" ? "text-red-800 dark:text-red-300" : "text-emerald-800 dark:text-emerald-300")}>
                          {l.tipo === "saida" ? "−" : "+"} {brl(l.valorCents)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </section>

      {!!lancamentos?.length && (
        <details className="rounded-2xl border bg-card">
          <summary className="cursor-pointer px-4 py-4 font-semibold sm:px-6">Resumo do mês</summary>
          <div className="grid gap-6 border-t px-4 py-5 sm:grid-cols-2 sm:px-6">
            <Bloco titulo="Recebido por forma (já sem estornos)" linhas={r.porForma} />
            <Bloco titulo="Faturamento por profissional" linhas={r.porProfissional} vazio="Só conta o que foi recebido pela agenda." />
            <Bloco titulo="Entradas por categoria" linhas={r.entradasPorCategoria} />
            <Bloco titulo="Saídas por categoria" linhas={r.saidasPorCategoria} />
          </div>
        </details>
      )}

      {!configQuebrada && todasComissoes.length > 0 && (
        <section aria-labelledby="comissoes" className="overflow-hidden rounded-2xl border bg-card">
          <div className="grid gap-0.5 px-4 py-4 sm:px-6">
            <h2 id="comissoes" className="font-semibold">Comissões</h2>
            <p className="text-sm text-muted-foreground">Sobre o que cada profissional recebeu pela agenda neste mês. Toque no nome para ver os meses anteriores. Só você vê.</p>
            {semPct > 0 && (
              <p className="text-sm text-muted-foreground">
                {semPct === 1 ? "1 profissional sem % de comissão fica fora." : `${semPct} profissionais sem % de comissão ficam fora.`}{" "}
                <Link href={`/${tenant.id}/profissionais`} className="underline underline-offset-4">Definir em Profissionais</Link>
              </p>
            )}
          </div>
          {/* o mês de relance: o pago é o que saiu; o que falta, o que ainda não foi pago */}
          {comissoes.length > 0 && (
            <dl className="grid grid-cols-3 border-t text-sm">
              {[
                { label: "Total", valor: comissoes.reduce((t, c) => t + (pagas.get(idDoPagamento("comissao", c.staffId, mes))?.valorCents ?? c.valor) + (vales[c.staffId] ?? 0), 0) },
                { label: "Pago", valor: comissoes.reduce((t, c) => t + (pagas.get(idDoPagamento("comissao", c.staffId, mes))?.valorCents ?? 0) + (vales[c.staffId] ?? 0), 0) },
                { label: "Falta pagar", valor: comissoes.reduce((t, c) => t + (pagas.has(idDoPagamento("comissao", c.staffId, mes)) ? 0 : c.valor), 0) },
              ].map((t) => (
                <div key={t.label} className="grid min-w-0 gap-0.5 border-l px-2.5 py-3 first:border-l-0 sm:px-6">
                  <dt className="text-[13px] text-muted-foreground">{t.label}</dt>
                  <dd className="font-serifa text-base tabular-nums [overflow-wrap:anywhere] sm:text-lg">{brl(t.valor)}</dd>
                </div>
              ))}
            </dl>
          )}
          <ul>
            {comissoes.map((c) => {
              const paga = pagas.get(idDoPagamento("comissao", c.staffId, mes));
              // paga: a conta é a do dia do pagamento, com o estorno que ele abateu; o estorno de
              // depois fica guardado para o próximo
              const devido = paga ? c.bruto - (paga.descontoCents ?? 0) : c.valor;
              const fica = paga ? c.desconto : c.desconto - c.abatido;
              return (
                <li key={c.staffId} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-4 py-3 sm:px-6">
                  <span className="grid min-w-0 flex-1 basis-60 gap-0.5">
                    <button type="button" onClick={() => setHistorico({ staffId: c.staffId, nome: c.nome })} className="-my-2 w-fit max-w-full truncate py-2 text-left font-medium underline decoration-dotted underline-offset-4 sm:no-underline sm:hover:underline">
                      {c.nome}
                    </button>
                    <span className="text-[13px] text-muted-foreground tabular-nums">
                      faturou {brl(c.faturado)}
                      {vales[c.staffId] > 0 && ` · ${brl(vales[c.staffId])} em vale neste mês`}
                      {!paga && c.abatido > 0 && ` · menos ${brl(c.abatido)} de vale e estorno`}
                      {!paga && c.abatido < 0 && ` · mais ${brl(-c.abatido)} de estorno desfeito`}
                      {/* paga antes de novos recebimentos ou de mudar o %: o dono vê a diferença */}
                      {paga && paga.valorCents !== devido && ` · pago ${brl(paga.valorCents)}, a conta dá ${brl(devido)}`}
                      {fica > 0 && ` · ${brl(fica)} de vale e estorno a descontar no próximo pagamento`}
                      {fica < 0 && ` · ${brl(-fica)} de estorno desfeito a devolver no próximo pagamento`}
                    </span>
                  </span>
                  <label className="flex items-center gap-1.5 text-sm max-sm:mr-auto">
                    <Input
                      key={`${c.staffId}-${c.pct}`}
                      inputMode="decimal"
                      disabled={!configPronta}
                      defaultValue={c.pct ? String(c.pct).replace(".", ",") : ""}
                      placeholder="0"
                      aria-label={`Comissão de ${c.nome} em %`}
                      onBlur={(e) => {
                        // vírgula do teclado brasileiro; vazio ou texto não zera o que estava
                        const pct = pctDoTexto(e.target.value);
                        if (pct === null) return void (e.target.value = c.pct ? String(c.pct).replace(".", ",") : "");
                        if (pct !== c.pct) mudarPct(c.staffId, pct);
                      }}
                      className="h-10 w-16 text-right tabular-nums sm:w-20"
                    />
                    %
                  </label>
                  <span className="text-right font-serifa text-lg tabular-nums sm:w-24">{brl(paga ? paga.valorCents : c.valor)}</span>
                  {/* vale a qualquer dia, mesmo com o mês pago: sai do próximo pagamento */}
                  <Button variant="ghost" className="h-10 px-3" disabled={!configPronta} onClick={() => setVale({ id: c.staffId, nome: c.nome })}>Vale</Button>
                  {paga ? (
                    <span className="text-center text-sm text-emerald-800 sm:w-24 dark:text-emerald-300">Paga</span>
                  ) : (
                    <Button
                      variant="outline"
                      className="h-10 px-4 sm:w-24"
                      // o estorno que zera a comissão também se registra: o mês fica acertado e o desconto, usado
                      disabled={!c.valor && !(c.abatido > 0)}
                      onClick={() =>
                        setFolha({
                          modo: "pagar",
                          titulo: `Pagar comissão de ${c.nome}`,
                          detalhe: `${String(c.pct).replace(".", ",")}% de ${brl(c.faturado)}${c.abatido > 0 ? ` − ${brl(c.abatido)} de vale e estorno` : c.abatido < 0 ? ` + ${brl(-c.abatido)} de estorno desfeito` : ""} · ${nomeDoMes(mes)}`,
                          valorCents: c.valor,
                          pagamento: { tipo: "comissao", alvoId: c.staffId, mes, descontoCents: c.abatido },
                        })
                      }
                    >
                      Pagar
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {historico && (
        <ComissoesHistorico
          tenantId={tenant.id}
          staffId={historico.staffId}
          nome={historico.nome}
          pct={config.comissoes[historico.staffId] ?? 0}
          guardado={config.descontos[historico.staffId] ?? 0}
          onClose={() => setHistorico(null)}
        />
      )}
      {vale && <ValeFolha tenantId={tenant.id} negocio={tenant.name} staff={vale} onClose={(msg) => (setVale(null), msg && setAviso(msg))} />}
      {verFixas && <ContasFixas tenantId={tenant.id} nicho={tenant.gerado?.nicho} fixas={config.fixas.filter((f) => !f.ate)} onClose={() => setVerFixas(false)} />}
      {folha && <LancamentoFolha tenantId={tenant.id} nicho={tenant.gerado?.nicho} folha={folha} estornado={folha.modo === "editar" && recebidos.has(idDoEstorno(folha.lancamento.id))} onClose={fechar} onRecibo={folha.modo === "editar" ? () => abrirRecibo(folha.lancamento) : undefined} />}
      {recibo && <Recibo tenantId={tenant.id} itens={recibo} onClose={() => setRecibo(null)} />}
      {faltou && (
        <ConfirmDialog
          title={`Registrar que ${faltou.nome} faltou?`}
          description="O atendimento sai de “A receber da agenda” e fica no histórico do cliente."
          confirmLabel="Sim, registrar falta"
          onConfirm={() => registrarFalta(faltou.id)}
          onCancel={() => setFaltou(null)}
        />
      )}
    </>
  );
}

/** Uma lista de valores com a barra proporcional ao maior: o resumo lido de relance. */
function Bloco({ titulo, linhas, vazio = "Nada neste mês." }: { titulo: string; linhas: [string, number][]; vazio?: string }) {
  const { brl } = useValores();
  const maior = linhas[0]?.[1] ?? 0;
  return (
    <div className="grid content-start gap-2.5">
      <h3 className="text-sm font-medium">{titulo}</h3>
      {linhas.length === 0 ? (
        <p className="text-sm text-muted-foreground">{vazio}</p>
      ) : (
        linhas.map(([nome, valor]) => (
          <div key={nome} className="grid gap-1">
            <div className="flex justify-between gap-3 text-sm">
              <span className="truncate">{nome}</span>
              <span className="tabular-nums">{brl(valor)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${maior ? (valor / maior) * 100 : 0}%` }} />
            </div>
          </div>
        ))
      )}
    </div>
  );
}
