"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ROTULO_TIPO, csvDasMensagens, funil, mapaDeLeitura, mensagensNoSaldo, porDia, porTipo, resumo, saldoPorDia, situacao, SITUACOES } from "@/lib/consumo-tela";
import type { EnvioTela, PainelConsumo } from "@/lib/consumo-painel.server";
import { useValores } from "@/lib/valores";
import { cn } from "@/lib/utils";
import { PageTitle } from "../page-title";
import { useTenant } from "../painel-layout";
import { Extrato, mesAtual, quando, useConsumo } from "./extrato";
import { Anel, COR, COR_SITUACAO, Faisca, Funil, LinhaDoSaldo, LinhaDoTempo, MapaLeitura, PorDia, ROTULO_SITUACAO, Rosca, Segmentos, SEMANA_LONGA } from "./graficos";

const mesVizinho = (mes: string, n: number) => {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const nomeDoMes = (mes: string, curto = false) => {
  const s = new Intl.DateTimeFormat("pt-BR", { month: curto ? "short" : "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${mes}-15T12:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const soMes = (mes: string) => new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(new Date(`${mes}-15T12:00:00Z`));

const PILULA: Record<string, string> = {
  lido: "bg-teal-50 text-teal-800 dark:bg-teal-950 dark:text-teal-200",
  entregue: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  enviado: "bg-muted text-foreground",
  aceito: "bg-muted text-foreground",
  parado: "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  falhou: "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200",
  "sem-saldo": "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200",
};

function textoStatus(e: EnvioTela, hora: (ms: number) => string) {
  if (e.status === "lido") return e.statusEm ? `Lida ${hora(e.statusEm)}` : "Lida";
  if (e.status === "entregue") return "Entregue";
  if (e.status === "enviado") return e.canal === "sms" ? "Enviado" : "Enviada";
  if (e.status === "aceito") return "Na fila";
  if (e.status === "parado") return "Parada na cota";
  if (e.status === "sem-saldo") return "Não saiu · sem saldo";
  return e.erro && /\s/.test(e.erro) && e.erro.length < 60 ? `Falhou · ${e.erro}` : "Falhou";
}

const horaBR = (ms: number) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
const quandoAg = (ms: number, hoje: string) => quando(ms, hoje).replace(/^Hoje/, "hoje").replace(/^Ontem/, "ontem");

type Filtro = "todas" | "whatsapp" | "sms" | "atencao" | "clientes" | "voce" | "lembretes";
const FILTROS: { id: Filtro; rotulo: string; vale: (e: EnvioTela) => boolean }[] = [
  { id: "todas", rotulo: "Todas", vale: () => true },
  { id: "atencao", rotulo: "Falhas e paradas", vale: (e) => situacao(e.status) === "falhou" || situacao(e.status) === "parada" },
  { id: "whatsapp", rotulo: "WhatsApp", vale: (e) => e.canal === "whatsapp" },
  { id: "sms", rotulo: "SMS", vale: (e) => e.canal === "sms" },
  { id: "clientes", rotulo: "Para clientes", vale: (e) => e.destinatario === "cliente" },
  { id: "voce", rotulo: "Para você", vale: (e) => e.destinatario === "dono" },
  { id: "lembretes", rotulo: "Lembretes", vale: (e) => e.tipo === "lembrete" },
];
const POR_PAGINA = 50;

export default function ConsumoPage() {
  const tenant = useTenant();
  const [mes, setMes] = useState(mesAtual);
  const { dados, erro, carregando, recarregar } = useConsumo(tenant.id, mes);

  if (!tenant.podeGerir) {
    return (
      <>
        <PageTitle title="Consumo" />
        <p className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">Só o dono ou um administrador do negócio vê o consumo de mensagens.</p>
      </>
    );
  }

  const atual = mesAtual();
  return (
    <>
      <PageTitle title="Consumo" sub="O que a Ruphus enviou pelo WhatsApp e por SMS em nome do seu negócio." valores>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Mês" className="inline-flex h-11 items-stretch overflow-hidden rounded-lg border bg-card">
            <button type="button" aria-label="Mês anterior" onClick={() => setMes((m) => mesVizinho(m, -1))} className="grid w-11 place-items-center hover:bg-muted">
              <Seta d="m15 6-6 6 6 6" />
            </button>
            <span aria-live="polite" className="flex items-center border-x px-3 text-sm font-semibold whitespace-nowrap">{nomeDoMes(mes)}</span>
            <button type="button" aria-label="Mês seguinte" disabled={mes >= atual} onClick={() => setMes((m) => mesVizinho(m, 1))} className="grid w-11 place-items-center hover:bg-muted disabled:text-muted-foreground/50 disabled:hover:bg-transparent">
              <Seta d="m9 6 6 6-6 6" />
            </button>
          </div>
          {dados && dados.envios.length > 0 && <BaixarCsv dados={dados} />}
        </div>
      </PageTitle>
      {erro ? (
        <div role="alert" className="grid gap-3 rounded-2xl border bg-card p-6 text-sm">
          <p>{erro}</p>
          <Button className="h-11 w-fit px-4" onClick={recarregar}>Tentar de novo</Button>
        </div>
      ) : carregando || !dados ? (
        <p role="status" className="text-sm text-muted-foreground">Carregando o consumo…</p>
      ) : (
        <Tela dados={dados} slug={tenant.id} />
      )}
    </>
  );
}

function Seta({ d }: { d: string }) {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function BaixarCsv({ dados }: { dados: PainelConsumo }) {
  function baixar() {
    const linhas = dados.envios.map((e) => ({
      quando: quando(e.em, dados.hoje),
      tipo: ROTULO_TIPO[e.tipo] ?? e.tipo,
      para: `${e.destinatario === "dono" ? "Você" : (e.agendamento?.cliente ?? "Cliente")} · ${e.destino}`,
      canal: e.canal === "sms" ? "SMS" : "WhatsApp",
      situacao: textoStatus(e, horaBR),
      agendamento: e.agendamento ? `${e.agendamento.servico} · ${quandoAg(e.agendamento.inicio, dados.hoje)}` : "",
      custo: (e.custoCents / 100).toFixed(2).replace(".", ","),
    }));
    // BOM: o Excel abre os acentos certos
    const blob = new Blob(["\uFEFF", csvDasMensagens(linhas)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mensagens-${dados.mes}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  return (
    <Button variant="outline" className="h-11 px-3.5" onClick={baixar}>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 21h14" />
      </svg>
      Baixar CSV
    </Button>
  );
}

const cartao = "flex flex-col gap-1.5 rounded-2xl border bg-card p-4 sm:p-5";
const kpi = "text-xs font-semibold tracking-wide text-muted-foreground uppercase";

function Tela({ dados, slug }: { dados: PainelConsumo; slug: string }) {
  const { brl } = useValores();
  const [aba, setAba] = useState<"tipo" | "todas" | "extrato">("tipo");
  const r = useMemo(() => resumo(dados.envios), [dados.envios]);
  const dias = useMemo(() => porDia(dados.envios, dados.mes, dados.hoje), [dados]);
  const leitura = useMemo(() => mapaDeLeitura(dados.envios), [dados.envios]);
  const tipos = useMemo(() => porTipo(dados.envios), [dados.envios]);
  const { conta } = dados;
  const preco = conta.precos;
  const corrente = dados.mes === dados.hoje.slice(0, 7);
  const prepago = conta.cobrar && conta.modelo === "prepago" && conta.aberta;
  const delta = dados.anterior.total > 0 ? Math.round(((r.total - dados.anterior.total) / dados.anterior.total) * 100) : null;
  const sms = r.canais.sms;
  const pctSms = r.custoCents ? Math.round((sms.custoCents / r.custoCents) * 100) : 0;

  return (
    <>
      <section aria-label="Resumo do mês" className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr]">
        <Saldo dados={dados} slug={slug} gastoCents={r.custoCents} />
        <div className={cartao}>
          <span className={kpi}>Mensagens</span>
          <span className="text-3xl leading-tight font-bold tabular-nums">{r.total}</span>
          <span className="text-[13px]">
            {delta !== null ? (
              <>
                <span className={cn("font-semibold", delta >= 0 ? "text-teal-700 dark:text-teal-400" : "text-muted-foreground")}>{delta >= 0 ? `+${delta}%` : `${delta}%`}</span>{" "}
                <span className="text-muted-foreground">vs. {soMes(dados.anterior.mes)} ({dados.anterior.total})</span>
              </>
            ) : (
              <span className="text-muted-foreground">{r.canais.whatsapp.total} WhatsApp · {sms.total} SMS</span>
            )}
          </span>
          <Faisca valores={dias.map((d) => d.whatsapp + d.sms)} />
        </div>
        <div className={cartao}>
          <span className={kpi}>Entrega</span>
          {r.entrega.pct === null ? (
            <span className="text-sm text-muted-foreground">Sem WhatsApp no mês.</span>
          ) : (
            <div className="flex items-center gap-3">
              <Anel pct={r.entrega.pct} rotulo={`${r.entrega.pct}% entregues`} />
              <div className="grid">
                <span className="text-3xl leading-tight font-bold tabular-nums">{r.entrega.pct}%</span>
                <span className="text-[13px] text-muted-foreground">
                  {r.entrega.chegaram} entregues · {r.entrega.lidas} lidas
                </span>
              </div>
            </div>
          )}
          <span className="text-xs text-muted-foreground">Do WhatsApp. O SMS não informa entrega.</span>
        </div>
        <div className={cartao}>
          <span className={kpi}>Precisam de atenção</span>
          <span className={cn("text-3xl leading-tight font-bold tabular-nums", r.atencao > 0 ? "text-red-700 dark:text-red-400" : "")}>{r.atencao}</span>
          {r.atencao > 0 ? (
            <>
              <Segmentos rotulo={`${r.situacoes.falhou} falhas, ${r.situacoes.parada} paradas`} partes={[{ cor: COR_SITUACAO.falhou, n: r.situacoes.falhou }, { cor: COR_SITUACAO.parada, n: r.situacoes.parada }]} />
              <span className="text-[13px] text-muted-foreground">
                {r.situacoes.falhou} {r.situacoes.falhou === 1 ? "falha" : "falhas"}
                {r.semSaldo > 0 && ` (${r.semSaldo} sem saldo)`} · {r.situacoes.parada} {r.situacoes.parada === 1 ? "parada" : "paradas"} ·{" "}
                <button type="button" className="underline underline-offset-4" onClick={() => (setAba("todas"), document.getElementById("detalhes")?.scrollIntoView({ behavior: "smooth" }))}>
                  ver
                </button>
              </span>
            </>
          ) : (
            <span className="text-[13px] text-muted-foreground">Nenhuma falha nem mensagem parada.</span>
          )}
        </div>
      </section>

      {r.total === 0 ? (
        <p className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
          Nenhuma mensagem em {soMes(dados.mes)}. Quando a Ruphus avisar você ou seus clientes pelo WhatsApp ou por SMS, cada mensagem aparece aqui, com o que custou.
        </p>
      ) : (
        <>
          <section aria-label="Resultados das mensagens" className="grid gap-3.5 lg:grid-cols-[1.4fr_1fr_1fr]">
            <div className={cn(cartao, "gap-3")}>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-[15px] font-semibold">Caminho das mensagens</h2>
                <span className="text-xs text-muted-foreground">WhatsApp</span>
              </div>
              <Funil etapas={funil(dados.envios)} />
              <p className="text-[13px] text-muted-foreground">
                {r.situacoes.falhou} falharam (número sem WhatsApp, inválido ou sem saldo) · {r.situacoes.parada} pararam na cota · {r.situacoes.entregue} entregues ainda sem leitura.
              </p>
            </div>
            <div className={cn(cartao, "gap-2.5")}>
              <h2 className="text-[15px] font-semibold">Custo por canal</h2>
              <div className="flex items-center gap-3.5">
                <Rosca whatsapp={r.canais.whatsapp.custoCents} sms={sms.custoCents} centro={brl(r.custoCents)} rotulo={`Custo: WhatsApp ${brl(r.canais.whatsapp.custoCents)}, SMS ${brl(sms.custoCents)}`} />
                <div className="grid gap-2 text-[13px]">
                  <Legenda cor={COR.whatsapp} nome="WhatsApp" valor={brl(r.canais.whatsapp.custoCents)} detalhe={`${r.canais.whatsapp.total} msgs · ${brl(preco.whatsappUtilityCents)} cada`} />
                  <Legenda cor={COR.sms} nome="SMS" valor={brl(sms.custoCents)} detalhe={`${sms.total} msgs · ${brl(preco.smsCents)} cada`} />
                </div>
              </div>
              {sms.total > 0 && r.total > 0 && (
                <span className="text-xs text-muted-foreground">
                  SMS é {Math.round((sms.total / r.total) * 100)}% do volume e {pctSms}% do custo.
                </span>
              )}
            </div>
            <div className={cn(cartao, "gap-2.5")}>
              <h2 className="text-[15px] font-semibold">Quando leem</h2>
              {leitura.total ? (
                <>
                  <MapaLeitura celulas={leitura.celulas} max={leitura.max} rotulo={`Leituras por dia da semana e faixa de hora${leitura.pico ? `: maior leitura ${SEMANA_LONGA[leitura.pico.dia]}, ${leitura.pico.faixa}` : ""}`} />
                  {leitura.pico && <span className="text-xs text-muted-foreground">Pico de leitura: {SEMANA_LONGA[leitura.pico.dia]}, {leitura.pico.faixa}. {leitura.total} leituras no mês.</span>}
                </>
              ) : (
                <p className="text-[13px] text-muted-foreground">Ainda sem leituras confirmadas neste mês. Só o WhatsApp informa quando a pessoa lê.</p>
              )}
            </div>
          </section>

          <section aria-label="Mensagens por dia" className={cn(cartao, "gap-3 p-5")}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="grid gap-0.5">
                <h2 className="font-semibold">Por dia</h2>
                <span className="text-[13px] text-muted-foreground">Barras: mensagens por canal. Linha: custo acumulado no mês (eixo da direita).</span>
              </div>
              <div className="flex gap-3.5 text-xs text-muted-foreground">
                <Ponto cor={COR.whatsapp} nome="WhatsApp" />
                <Ponto cor={COR.sms} nome="SMS" />
                <span className="inline-flex items-center gap-1.5">
                  <svg width="18" height="8" aria-hidden="true">
                    <path d="M0 4 L18 4" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
                  </svg>
                  Custo acumulado
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[640px]">
                <PorDia dias={dias} hoje={corrente ? dados.hoje : ""} brl={brl} />
              </div>
            </div>
          </section>

          <div id="detalhes" role="tablist" aria-label="Detalhes" className="inline-flex gap-1 justify-self-start rounded-xl bg-muted p-1">
            {(
              [
                ["tipo", "Por tipo"],
                ["todas", `Todas as mensagens`],
                ["extrato", "Extrato do saldo"],
              ] as const
            ).map(([id, nome]) => (
              <button
                key={id}
                role="tab"
                id={`aba-${id}`}
                aria-selected={aba === id}
                aria-controls={`painel-${id}`}
                type="button"
                onClick={() => setAba(id)}
                className={cn("min-h-10 rounded-lg px-3 text-sm font-medium text-muted-foreground sm:px-4", aba === id && "bg-card font-semibold text-foreground shadow-sm")}
              >
                {nome}
                {id === "todas" && <span className="ml-1.5 text-muted-foreground/70">{r.total}</span>}
              </button>
            ))}
          </div>

          <section role="tabpanel" id={`painel-${aba}`} aria-labelledby={`aba-${aba}`} className={cn(cartao, "gap-3 p-4 sm:p-5")}>
            {aba === "tipo" && <PorTipo tipos={tipos} total={r} />}
            {aba === "todas" && <Todas dados={dados} />}
            {aba === "extrato" && (prepago || dados.creditos.length ? <Extrato creditos={dados.creditos} limite={20} /> : <p className="text-sm text-muted-foreground">Este negócio ainda não tem saldo pré-pago: não há extrato.</p>)}
          </section>
        </>
      )}

      <section aria-label="Como funciona a cobrança" className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card px-5 py-4">
        <div className="grid gap-1 text-[13px]">
          <strong className="text-sm">Como contamos</strong>
          {conta.cobrar ? (
            <span>
              <strong>WhatsApp {brl(preco.whatsappUtilityCents)}</strong> por aviso ao cliente ou a você · <strong>SMS {brl(preco.smsCents)}</strong> ·{" "}
              {preco.whatsappServiceCents === 0 ? "resposta a quem escreveu primeiro é grátis" : `resposta a quem escreveu primeiro ${brl(preco.whatsappServiceCents)}`} · falhas e paradas não são cobradas.
            </span>
          ) : (
            <span>As mensagens deste negócio não são cobradas: todas aparecem aqui, sem custo.</span>
          )}
          <span className="text-muted-foreground">
            {!conta.cobrar ? "" : conta.modelo === "pospago" ? "O consumo do mês entra na mensalidade." : prepago ? "Desconta do seu saldo pré-pago." : "Por enquanto o consumo só é registrado: nada é descontado."}
          </span>
        </div>
        {prepago && (
          <Link href={`/${slug}/consumo/recarga`} className="inline-flex h-11 items-center rounded-lg border px-3.5 text-sm font-medium hover:bg-muted">
            Ver saldo e recarregar
          </Link>
        )}
      </section>
    </>
  );
}

function Saldo({ dados, slug, gastoCents }: { dados: PainelConsumo; slug: string; gastoCents: number }) {
  const { brl } = useValores();
  const { conta } = dados;
  const escuro = "flex flex-col gap-1.5 rounded-2xl border border-zinc-900 bg-zinc-900 p-4 text-white sm:col-span-2 sm:p-5 lg:col-span-1 dark:border-zinc-700";
  const gasto = (
    <span className="text-[13px] text-zinc-300">
      Gasto em {soMes(dados.mes)}: <strong className="text-white">{brl(gastoCents)}</strong>
      {dados.anterior.custoCents > 0 && ` · ${soMes(dados.anterior.mes)}: ${brl(dados.anterior.custoCents)}`}
    </span>
  );
  if (!conta.cobrar || conta.modelo !== "prepago" || !conta.aberta) {
    return (
      <div className={escuro}>
        <span className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">{conta.modelo === "pospago" && conta.cobrar ? "Cobrado na mensalidade" : "Mensagens"}</span>
        <span className="text-[15px] leading-snug text-zinc-200">
          {!conta.cobrar
            ? "Incluídas no seu plano: nada é descontado."
            : conta.modelo === "pospago"
              ? "O consumo do mês entra na próxima mensalidade."
              : "Seu negócio ainda não tem saldo pré-pago. Por enquanto as mensagens só são registradas."}
        </span>
        {gasto}
      </div>
    );
  }
  const saldo = conta.saldoCents ?? 0;
  const msgs = mensagensNoSaldo(saldo, conta.precos.whatsappUtilityCents);
  const dias = conta.previsao?.diasRestantesEstimados ?? null;
  const pontos = saldoPorDia(dados.creditos, dados.hoje, saldo).map((d) => d.saldoCents);
  const nivel = conta.previsao?.nivel ?? (saldo <= 0 ? "critico" : "ok");
  return (
    <div className={escuro}>
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <span className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Saldo disponível</span>
          <span className={cn("text-4xl leading-none font-bold tracking-tight tabular-nums", saldo <= 0 && "text-red-300")}>{brl(saldo)}</span>
          <span className="text-[13px] text-zinc-300">
            {msgs !== null && `≈ ${msgs.toLocaleString("pt-BR")} mensagens`}
            {dias !== null && ` · ${dias === 0 ? "acaba hoje" : `uns ${duracao(dias)} no seu ritmo`}`}
          </span>
        </div>
        <Link href={`/${slug}/consumo/recarga`} className="inline-flex h-11 shrink-0 items-center rounded-lg bg-white px-3.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-100">
          Recarregar
        </Link>
      </div>
      {nivel !== "ok" && (
        <span role="status" className={cn("w-fit rounded-full px-2.5 py-0.5 text-xs font-semibold", nivel === "critico" ? "bg-red-500/20 text-red-200" : "bg-amber-400/20 text-amber-200")}>
          {saldo <= 0 ? "Sem saldo: avisos aos clientes pausados" : "Saldo baixo"}
        </span>
      )}
      <LinhaDoSaldo pontos={pontos} rotulo={`Saldo nos últimos ${pontos.length} dias, de ${brl(pontos[0] ?? saldo)} para ${brl(saldo)}`} />
      {gasto}
    </div>
  );
}

/** 3 → "3 dias"; 45 → "1 mês e meio"; 70 → "2 meses". */
function duracao(dias: number) {
  if (dias < 30) return `${dias} ${dias === 1 ? "dia" : "dias"}`;
  const meses = dias / 30;
  if (meses < 1.75 && meses >= 1.25) return "1 mês e meio";
  const n = Math.round(meses);
  return `${n} ${n === 1 ? "mês" : "meses"}`;
}

function Legenda({ cor, nome, valor, detalhe }: { cor: string; nome: string; valor: string; detalhe: string }) {
  return (
    <div className="grid">
      <Ponto cor={cor} nome={nome} />
      <strong className="text-base tabular-nums">{valor}</strong>
      <span className="text-muted-foreground">{detalhe}</span>
    </div>
  );
}

function Ponto({ cor, nome }: { cor: string; nome: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span aria-hidden="true" className="inline-block size-2.5 rounded-[3px]" style={{ background: cor }} />
      {nome}
    </span>
  );
}

function PorTipo({ tipos, total }: { tipos: ReturnType<typeof porTipo>; total: ReturnType<typeof resumo> }) {
  const { brl } = useValores();
  const partes = (s: Record<string, number>) => SITUACOES.map((k) => ({ cor: COR_SITUACAO[k], n: s[k] }));
  const descreve = (s: Record<string, number>) =>
    SITUACOES.filter((k) => s[k] > 0)
      .map((k) => `${s[k]} ${ROTULO_SITUACAO[k].toLowerCase()}${s[k] > 1 ? "s" : ""}`)
      .join(", ");
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-semibold">Por tipo de mensagem</h2>
        <div className="flex flex-wrap gap-3">
          {SITUACOES.map((k) => <Ponto key={k} cor={COR_SITUACAO[k]} nome={ROTULO_SITUACAO[k]} />)}
        </div>
      </div>
      {/* celular: uma linha por tipo em cartão; a partir do tablet, a tabela */}
      <ul className="divide-y sm:hidden">
        {tipos.map((t) => (
          <li key={`${t.tipo}/${t.canal}`} className="grid gap-1.5 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium">
                {ROTULO_TIPO[t.tipo]} {t.canal === "sms" && <span className="text-xs text-muted-foreground">· SMS</span>}
              </span>
              <span className="text-sm font-semibold tabular-nums">{brl(t.custoCents)}</span>
            </div>
            <Segmentos partes={partes(t.situacoes)} rotulo={descreve(t.situacoes)} />
            <span className="text-xs text-muted-foreground">
              {t.total} {t.total === 1 ? "enviada" : "enviadas"} · {descreve(t.situacoes)}
            </span>
          </li>
        ))}
        <li className="grid gap-1.5 py-3">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-bold">Total</span>
            <span className="text-sm font-bold tabular-nums">{brl(total.custoCents)}</span>
          </div>
          <span className="text-xs text-muted-foreground">{total.total} enviadas · {descreve(total.situacoes)}</span>
        </li>
      </ul>
      <div className="max-sm:hidden overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-3 py-2.5 font-semibold">Tipo</th>
              <th className="px-3 py-2.5 font-semibold">Canal</th>
              <th className="px-3 py-2.5 text-right font-semibold">Enviadas</th>
              <th className="w-[34%] px-3 py-2.5 font-semibold">Situação de cada mensagem</th>
              <th className="px-3 py-2.5 text-right font-semibold">Lidas</th>
              <th className="px-3 py-2.5 text-right font-semibold">Falhas</th>
              <th className="px-3 py-2.5 text-right font-semibold">Custo</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {tipos.map((t) => (
              <tr key={`${t.tipo}/${t.canal}`} className="hover:bg-muted/40">
                <td className="px-3 py-3 font-medium">{ROTULO_TIPO[t.tipo]}</td>
                <td className="px-3 py-3"><Ponto cor={t.canal === "sms" ? COR.sms : COR.whatsapp} nome={t.canal === "sms" ? "SMS" : "WhatsApp"} /></td>
                <td className="px-3 py-3 text-right tabular-nums">{t.total}</td>
                <td className="px-3 py-3"><Segmentos partes={partes(t.situacoes)} rotulo={descreve(t.situacoes)} /></td>
                <td className="px-3 py-3 text-right tabular-nums">{t.canal === "sms" ? <span className="text-muted-foreground">—</span> : t.situacoes.lida}</td>
                <td className={cn("px-3 py-3 text-right tabular-nums", t.situacoes.falhou ? "font-semibold text-red-700 dark:text-red-400" : "text-muted-foreground")}>{t.situacoes.falhou}</td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums">{brl(t.custoCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t font-bold">
              <td className="px-3 py-3">Total</td>
              <td />
              <td className="px-3 py-3 text-right tabular-nums">{total.total}</td>
              <td className="px-3 py-3"><Segmentos alta partes={partes(total.situacoes)} rotulo={descreve(total.situacoes)} /></td>
              <td className="px-3 py-3 text-right tabular-nums">{total.situacoes.lida}</td>
              <td className={cn("px-3 py-3 text-right tabular-nums", total.situacoes.falhou && "text-red-700 dark:text-red-400")}>{total.situacoes.falhou}</td>
              <td className="px-3 py-3 text-right tabular-nums">{brl(total.custoCents)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

function Todas({ dados }: { dados: PainelConsumo }) {
  const { brl } = useValores();
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [busca, setBusca] = useState("");
  const [mostrar, setMostrar] = useState(POR_PAGINA);
  const termo = busca.trim().toLowerCase();
  const digitos = termo.replace(/\D/g, "");
  const f = FILTROS.find((x) => x.id === filtro)!;
  const lista = dados.envios.filter(
    (e) => f.vale(e) && (!termo || (digitos && e.destino.replace(/\D/g, "").endsWith(digitos)) || (e.agendamento?.cliente.toLowerCase().includes(termo) ?? false) || (e.destinatario === "dono" && "você".includes(termo))),
  );
  const para = (e: EnvioTela) => `${e.destinatario === "dono" ? "Você" : (e.agendamento?.cliente || "Cliente")} · ${e.destino}`;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">
          Todas as mensagens <span className="text-sm font-medium text-muted-foreground">· {dados.envios.length}</span>
        </h2>
        <label className="flex h-11 items-center gap-2 rounded-lg border bg-background px-3 max-sm:w-full">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-muted-foreground">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <span className="sr-only">Buscar por cliente ou final do telefone</span>
          <input type="search" value={busca} onChange={(e) => (setBusca(e.target.value), setMostrar(POR_PAGINA))} placeholder="Cliente ou final do telefone" className="w-full min-w-0 bg-transparent text-base outline-none sm:w-56 sm:text-sm" />
        </label>
      </div>
      <div role="group" aria-label="Filtros" className="flex gap-2 overflow-x-auto pb-1">
        {FILTROS.map((x) => {
          const n = dados.envios.filter(x.vale).length;
          if (x.id !== "todas" && n === 0) return null;
          return (
            <button
              key={x.id}
              type="button"
              aria-pressed={filtro === x.id}
              onClick={() => (setFiltro(x.id), setMostrar(POR_PAGINA))}
              className={cn("inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px]", filtro === x.id ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-muted")}
            >
              {x.id === "whatsapp" && <span aria-hidden="true" className="size-2 rounded-full" style={{ background: COR.whatsapp }} />}
              {x.id === "sms" && <span aria-hidden="true" className="size-2 rounded-full" style={{ background: COR.sms }} />}
              {x.rotulo} <b className="font-semibold opacity-70">{n}</b>
            </button>
          );
        })}
      </div>
      {lista.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">Nenhuma mensagem com esse filtro.</p>
      ) : (
        <>
          {/* celular: cartões; tablet em diante: tabela */}
          <ul className="divide-y sm:hidden">
            {lista.slice(0, mostrar).map((e) => (
              <li key={e.id} className={cn("grid gap-1.5 py-3", situacao(e.status) === "falhou" && "bg-red-50/60 dark:bg-red-950/30", situacao(e.status) === "parada" && "bg-amber-50/60 dark:bg-amber-950/30")}>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-sm font-medium">{ROTULO_TIPO[e.tipo]}</span>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", PILULA[e.status])}>{textoStatus(e, horaBR)}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {quando(e.em, dados.hoje)} · {para(e)} · {e.canal === "sms" ? "SMS" : "WhatsApp"}
                </span>
                <div className="flex items-center justify-between gap-3">
                  <LinhaDoTempo status={e.status} canal={e.canal} />
                  <span className="text-xs tabular-nums">{e.agendamento && `${e.agendamento.servico} · ${quandoAg(e.agendamento.inicio, dados.hoje)} · `}{brl(e.custoCents)}</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="max-sm:hidden overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  {["Quando", "Tipo", "Para", "Canal", "Linha do tempo", "Situação", "Agendamento"].map((h) => <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap">{h}</th>)}
                  <th className="px-3 py-2.5 text-right font-semibold">Custo</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lista.slice(0, mostrar).map((e) => (
                  <tr key={e.id} className={cn("hover:bg-muted/40", situacao(e.status) === "falhou" && "bg-red-50/60 dark:bg-red-950/30", situacao(e.status) === "parada" && "bg-amber-50/60 dark:bg-amber-950/30")}>
                    <td className="px-3 py-3 whitespace-nowrap">{quando(e.em, dados.hoje)}</td>
                    <td className="px-3 py-3">{ROTULO_TIPO[e.tipo]}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{para(e)}</td>
                    <td className="px-3 py-3"><Ponto cor={e.canal === "sms" ? COR.sms : COR.whatsapp} nome={e.canal === "sms" ? "SMS" : "WhatsApp"} /></td>
                    <td className="px-3 py-3"><LinhaDoTempo status={e.status} canal={e.canal} /></td>
                    <td className="px-3 py-3"><span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap", PILULA[e.status])}>{textoStatus(e, horaBR)}</span></td>
                    <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">{e.agendamento ? `${e.agendamento.servico} · ${quandoAg(e.agendamento.inicio, dados.hoje)}` : "—"}</td>
                    <td className={cn("px-3 py-3 text-right tabular-nums", !e.custoCents && "text-muted-foreground")}>{brl(e.custoCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <span className="text-[13px] text-muted-foreground">
          Linha do tempo: aceita → entregue → lida. Mostrando {Math.min(mostrar, lista.length)} de {lista.length} · telefones mascarados por privacidade
          {dados.truncado && " · o mês tem mais mensagens do que a tela lista"}
        </span>
        {lista.length > mostrar && (
          <Button variant="outline" className="h-11 px-4" onClick={() => setMostrar((m) => m + POR_PAGINA)}>
            Mostrar mais {Math.min(POR_PAGINA, lista.length - mostrar)}
          </Button>
        )}
      </div>
    </>
  );
}
