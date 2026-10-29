"use client";

import { orderBy, Timestamp, where } from "firebase/firestore";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/auth-errors";
import { formatBRL, formatLongDate, formatTime, todayIn, zonedTime } from "@/lib/datetime";
import { idDaBaixa, Lancamento, resumoDoMes, ROTULO_FORMA } from "@/lib/financeiro";
import { useCollection } from "@/lib/use-collection";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "../confirm-dialog";
import { type Folha, LancamentoFolha } from "../lancamento-folha";
import { useTenant } from "../layout";
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
  const tenant = useTenant();
  const [mes, setMes] = useState(() => todayIn().slice(0, 7));
  const [folha, setFolha] = useState<Folha | null>(null);
  const [aviso, setAviso] = useState("");
  const [erro, setErro] = useState("");
  const [faltou, setFaltou] = useState<{ id: string; nome: string } | null>(null);
  // o relógio de quando a página abriu: o que começou depois entra ao trocar de mês ou recarregar
  const [agora] = useState(Date.now);
  const ligado = tenant.podeGerir && tenant.modulos?.financeiro === true;

  // as consultas só sobem com o Caixa ligado: desligado, a regra negaria a leitura
  const [lancamentos, erroLeitura] = useCollection(ligado ? tenant.id : "", "lancamentos", Lancamento, [where("mes", "==", mes)], mes);
  const [doMes] = useCollection(
    ligado ? tenant.id : "",
    "appointments",
    Atendimento,
    [where("start", ">=", zonedTime(`${mes}-01`, "00:00")), where("start", "<", zonedTime(`${mesSeguinte(mes, 1)}-01`, "00:00")), orderBy("start")],
    mes,
  );

  if (!ligado) {
    return (
      <>
        <PageTitle title="Caixa" />
        <p className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
          O Caixa não está ativo para este negócio. Para usar, fale com a Ruphus.
        </p>
      </>
    );
  }

  const recebidos = new Set(lancamentos?.map((l) => l.id));
  // sem os lançamentos carregados não dá para saber o que já foi recebido
  const pendentes = (lancamentos ? (doMes ?? []) : []).filter(
    (a) => (a.status === "booked" || a.status === "confirmed") && a.start.toMillis() <= agora && !recebidos.has(idDaBaixa(a.id)),
  );
  const aReceber = pendentes.reduce((t, a) => t + a.priceCents, 0);
  const r = resumoDoMes(lancamentos ?? []);
  const porDia = Object.entries(
    [...(lancamentos ?? [])].sort((a, b) => b.data.localeCompare(a.data)).reduce<Record<string, Lancamento[]>>((g, l) => ((g[l.data] ??= []).push(l), g), {}),
  );

  function fechar(msg?: string) {
    setFolha(null);
    if (msg) setAviso(msg);
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
      <PageTitle title="Caixa" sub={nomeDoMes(mes)}>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-lg" className="size-10 max-sm:size-11" onClick={() => setMes(mesSeguinte(mes, -1))} aria-label="Mês anterior">‹</Button>
          <Button variant="outline" size="icon-lg" className="size-10 max-sm:size-11" onClick={() => setMes(mesSeguinte(mes, 1))} aria-label="Próximo mês">›</Button>
          <Button variant="ghost" className="h-10 px-3 max-sm:h-11" disabled={mes === todayIn().slice(0, 7)} onClick={() => setMes(todayIn().slice(0, 7))}>Este mês</Button>
        </div>
      </PageTitle>

      <dl className="grid grid-cols-3 gap-2 sm:gap-4">
        {[
          { label: "Entrou", valor: r.entrou, cor: "text-emerald-800 dark:text-emerald-300" },
          { label: "Saiu", valor: r.saiu, cor: "text-red-800 dark:text-red-300" },
          { label: "Sobrou", valor: r.sobrou, cor: r.sobrou < 0 ? "text-red-800 dark:text-red-300" : "" },
        ].map((t) => (
          <div key={t.label} className="grid gap-1.5 rounded-2xl border bg-card px-3 py-4 sm:px-5">
            <dt className="text-[13px] text-muted-foreground">{t.label}</dt>
            <dd className={cn("font-serifa text-xl leading-none tabular-nums sm:text-3xl", t.cor)}>{lancamentos ? formatBRL(t.valor) : "…"}</dd>
          </div>
        ))}
      </dl>

      <div className="grid grid-cols-2 gap-3">
        <Button className="h-12 text-base" onClick={() => setFolha({ modo: "novo", tipo: "entrada" })}>+ Entrada</Button>
        <Button variant="outline" className="h-12 text-base" onClick={() => setFolha({ modo: "novo", tipo: "saida" })}>− Saída</Button>
      </div>

      {aviso && (
        <p role="status" className="flex items-center justify-between gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950">
          {aviso}
          <Button variant="ghost" size="sm" onClick={() => setAviso("")}>Fechar</Button>
        </p>
      )}
      {(erro || erroLeitura) && <p role="alert" className="text-sm text-destructive">{erro || erroLeitura}</p>}

      {pendentes.length > 0 && (
        <section aria-labelledby="fechar" className="overflow-hidden rounded-2xl border bg-card">
          <div className="grid gap-0.5 px-4 py-4 sm:px-6">
            <h2 id="fechar" className="font-semibold">Fechar o dia</h2>
            <p className="text-sm text-muted-foreground">
              {pendentes.length} atendimento{pendentes.length > 1 ? "s" : ""} sem recebimento · {formatBRL(aReceber)} na agenda
            </p>
          </div>
          <ul>
            {pendentes.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 border-t px-4 py-3.5 sm:px-6">
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="font-semibold">{a.customerName}</span>
                  <span className="text-sm text-muted-foreground">
                    {formatLongDate(a.start.toDate()).split(",")[0]}, {formatTime(a.start.toDate())} · {a.serviceName} · {a.staffName}
                  </span>
                </div>
                <span className="font-serifa text-xl tabular-nums">{formatBRL(a.priceCents)}</span>
                <div className="flex gap-2">
                  <Button className="h-10 px-4" onClick={() => setFolha({ modo: "baixa", atendimento: { id: a.id, customerName: a.customerName, serviceName: a.serviceName, priceCents: a.priceCents } })}>Recebi</Button>
                  <Button variant="outline" className="h-10 px-4" onClick={() => setFaltou({ id: a.id, nome: a.customerName })}>Não veio</Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="lancamentos" className="overflow-hidden rounded-2xl border bg-card">
        <h2 id="lancamentos" className="px-4 py-4 font-semibold sm:px-6">Lançamentos do mês</h2>
        {!lancamentos ? (
          <p className="border-t px-6 py-8 text-sm text-muted-foreground">Carregando…</p>
        ) : porDia.length === 0 ? (
          <p className="border-t px-6 py-10 text-center text-sm text-muted-foreground">Nada lançado neste mês. Use “+ Entrada” e “− Saída”, ou receba os atendimentos da agenda.</p>
        ) : (
          porDia.map(([dia, itens]) => {
            const saldo = itens.reduce((t, l) => t + (l.tipo === "entrada" ? l.valorCents : -l.valorCents), 0);
            return (
              <div key={dia} className="border-t">
                <div className="flex justify-between bg-muted/40 px-4 py-2 text-[13px] text-muted-foreground sm:px-6">
                  <span>{formatLongDate(zonedTime(dia, "12:00"))}{dia === todayIn() ? " · hoje" : ""}</span>
                  <span className="tabular-nums">{saldo >= 0 ? "+" : "−"} {formatBRL(Math.abs(saldo))}</span>
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
                          <span className="truncate font-medium">{l.customerName ?? l.descricao ?? l.categoria}</span>
                          <span className="truncate text-[13px] text-muted-foreground">
                            {[l.categoria, l.customerName && l.descricao, l.staffName, ROTULO_FORMA[l.forma]].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        <span className={cn("tabular-nums font-semibold", l.tipo === "saida" ? "text-red-800 dark:text-red-300" : "text-emerald-800 dark:text-emerald-300")}>
                          {l.tipo === "saida" ? "−" : "+"} {formatBRL(l.valorCents)}
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
            <Bloco titulo="Recebido por forma" linhas={r.porForma} />
            <Bloco titulo="Faturamento por profissional" linhas={r.porProfissional} vazio="Só conta o que foi recebido pela agenda." />
            <Bloco titulo="Entradas por categoria" linhas={r.entradasPorCategoria} />
            <Bloco titulo="Saídas por categoria" linhas={r.saidasPorCategoria} />
          </div>
        </details>
      )}

      {folha && <LancamentoFolha tenantId={tenant.id} nicho={tenant.gerado?.nicho} folha={folha} onClose={fechar} />}
      {faltou && (
        <ConfirmDialog
          title={`Registrar que ${faltou.nome} faltou?`}
          description="O atendimento sai do fechamento do dia e fica no histórico do cliente."
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
              <span className="tabular-nums">{formatBRL(valor)}</span>
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
