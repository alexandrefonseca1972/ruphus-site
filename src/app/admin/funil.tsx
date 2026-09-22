"use client";

import { useMemo, useState } from "react";
import { formatBRL } from "@/lib/datetime";
import {
  COR,
  diaCurto,
  MOTIVOS_PERDA,
  ORIGENS,
  prazoDe,
  PRECO_PADRAO,
  ROTULO,
  type Crm,
  type Estagio,
  type MotivoPerda,
  type Origem,
} from "@/lib/crm-tipos";
import type { Espaco } from "./actions";

// O funil em colunas: os mesmos negócios da lista (com os mesmos filtros e busca),
// agrupados por estágio, com os números do período em cima e origem e perdas embaixo.

const COLUNAS = ["novo", "oferta", "negociando", "fechado"] as const satisfies readonly Estagio[];
const NOVOS_POR_VEZ = 12;
const PERIODOS = { mes: "Este mês", "30": "Últimos 30 dias", "90": "Últimos 90 dias", tudo: "Desde o início" } as const;
type Periodo = keyof typeof PERIODOS;

const inicioDe = (p: Periodo, hoje: Date) => {
  if (p === "tudo") return "";
  if (p === "mes") return new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString();
  return new Date(hoje.getTime() - Number(p) * 86_400_000).toISOString();
};
const mensal = (c: Crm | undefined) => c?.mensalCents ?? PRECO_PADRAO.mensalCents;
const origemDe = (c: Crm | undefined): Origem => c?.origem ?? "importado";

export function Funil({
  espacos,
  crm,
  hoje,
  abrir,
  mover,
  verAtrasadas,
  verPerdidos,
}: {
  espacos: Espaco[];
  crm: Record<string, Crm>;
  hoje: string;
  abrir: (e: Espaco) => void;
  mover: (slug: string, estagio: Estagio) => void;
  verAtrasadas: () => void;
  verPerdidos: () => void;
}) {
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [novos, setNovos] = useState(NOVOS_POR_VEZ);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<Estagio | null>(null);
  const [agora] = useState(() => new Date());

  const n = useMemo(() => {
    const inicio = inicioDe(periodo, agora);
    const no = (iso: string | null) => !!iso && (!inicio || iso >= inicio);
    const de = (e: Estagio) => espacos.filter((x) => (crm[x.slug]?.estagio ?? "novo") === e);
    const fechados = de("fechado");
    const perdidos = de("perdido");
    // "desde o início" conta todo fechado, até os de antes de a data ser gravada
    const vendas = periodo === "tudo" ? fechados : fechados.filter((x) => no(crm[x.slug]?.fechadoEm ?? null));
    const perdas = perdidos.filter((x) => (periodo === "tudo" ? true : no(crm[x.slug]?.perdidoEm ?? null)));
    const dias = vendas.flatMap((x) => {
      const c = crm[x.slug];
      return c?.entrouEm && c.fechadoEm ? [(Date.parse(c.fechadoEm) - Date.parse(c.entrouEm)) / 86_400_000] : [];
    });
    const motivos = new Map<MotivoPerda, number>();
    for (const x of perdas) {
      const m = crm[x.slug]?.motivoPerda;
      if (m) motivos.set(m, (motivos.get(m) ?? 0) + 1);
    }
    const origens = (Object.keys(ORIGENS) as Origem[]).map((o) => {
      const deles = espacos.filter((x) => origemDe(crm[x.slug]) === o);
      const ok = deles.filter((x) => crm[x.slug]?.estagio === "fechado").length;
      return { o, contatos: deles.length, fechados: ok };
    });
    return {
      colunas: Object.fromEntries(COLUNAS.map((e) => [e, de(e)])) as Record<(typeof COLUNAS)[number], Espaco[]>,
      perdidos,
      receita: fechados.reduce((s, x) => s + mensal(crm[x.slug]), 0),
      fechadosTotal: fechados.length,
      negociacao: [...de("oferta"), ...de("negociando")].reduce((s, x) => s + mensal(crm[x.slug]), 0),
      emNegociacao: de("oferta").length + de("negociando").length,
      vendas: vendas.length,
      perdas: perdas.length,
      dias: dias.length ? Math.round(dias.reduce((a, b) => a + b, 0) / dias.length) : null,
      atrasadas: espacos.filter((x) => prazoDe(crm[x.slug], hoje) === "atrasada").length,
      motivos: [...motivos].sort((a, b) => b[1] - a[1]),
      origens,
    };
  }, [espacos, crm, periodo, agora, hoje]);

  // Conversão entre etapas: de quem chegou a uma etapa, quantos passaram da seguinte
  const ordem = (e: Estagio) => COLUNAS.indexOf(e as (typeof COLUNAS)[number]);
  const chegaram = (i: number) => espacos.filter((x) => ordem(crm[x.slug]?.estagio ?? "novo") >= i).length;
  const taxa = n.vendas + n.perdas ? Math.round((n.vendas / (n.vendas + n.perdas)) * 100) : null;

  const numeros: { rotulo: string; valor: string; nota: string; destaque?: string; acao?: () => void }[] = [
    { rotulo: "Receita fechada", valor: formatBRL(n.receita), nota: `/mês · ${n.fechadosTotal} cliente(s)` },
    { rotulo: "Em negociação", valor: formatBRL(n.negociacao), nota: `/mês · ${n.emNegociacao} negócio(s)` },
    { rotulo: "Vendas", valor: String(n.vendas), nota: PERIODOS[periodo].toLowerCase(), destaque: n.vendas ? "text-[#2C6A53]" : undefined },
    { rotulo: "Taxa de ganho", valor: taxa === null ? "—" : `${taxa}%`, nota: `${n.vendas} fechado(s) · ${n.perdas} perdido(s)` },
    { rotulo: "Tempo até fechar", valor: n.dias === null ? "—" : `${n.dias} dia${n.dias === 1 ? "" : "s"}`, nota: "média dos fechados" },
    { rotulo: "Ações atrasadas", valor: String(n.atrasadas), nota: n.atrasadas ? "abrir a lista" : "nada atrasado", destaque: n.atrasadas ? "text-[#8A2F2F]" : undefined, acao: n.atrasadas ? verAtrasadas : undefined },
  ];

  function soltar(estagio: Estagio) {
    const slug = arrastando;
    setArrastando(null);
    setSobre(null);
    if (slug && (crm[slug]?.estagio ?? "novo") !== estagio) mover(slug, estagio);
  }
  const alvo = (estagio: Estagio) => ({
    onDragOver: (ev: React.DragEvent) => {
      if (!arrastando) return;
      ev.preventDefault();
      setSobre(estagio);
    },
    onDragLeave: () => setSobre((s) => (s === estagio ? null : s)),
    onDrop: (ev: React.DragEvent) => {
      ev.preventDefault();
      soltar(estagio);
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-[family-name:var(--fonte-serifa)] text-[26px] leading-none">Funil</h2>
        <label className="flex items-center gap-2 text-xs text-[#6F6A5E]">
          Período
          <select
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value as Periodo)}
            className="h-10 rounded-[10px] border border-[#D8D2C6] bg-white px-2.5 text-xs text-[#17150F]"
          >
            {(Object.keys(PERIODOS) as Periodo[]).map((p) => (
              <option key={p} value={p}>{PERIODOS[p]}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Arrastar é de mouse: no celular a etapa muda dentro da gaveta */}
      <p className="text-xs text-[#6F6A5E] sm:hidden">Toque no negócio para abrir e mudar a etapa.</p>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {numeros.map((x) => {
          const corpo = (
            <>
              <dt className="text-[11px] tracking-[0.06em] text-[#6F6A5E] uppercase">{x.rotulo}</dt>
              <dd className="font-[family-name:var(--fonte-serifa)] text-[30px] leading-none tabular-nums">{x.valor}</dd>
              <dd className={`text-[11px] ${x.destaque ? `font-semibold ${x.destaque}` : "text-[#6F6A5E]"}`}>{x.nota}</dd>
            </>
          );
          return x.acao ? (
            <button key={x.rotulo} type="button" onClick={x.acao} className="flex flex-col gap-1.5 rounded-2xl border border-[#E2DDD3] bg-white px-4 py-3.5 text-left hover:border-[#17150F]">
              {corpo}
            </button>
          ) : (
            <div key={x.rotulo} className="flex flex-col gap-1.5 rounded-2xl border border-[#E2DDD3] bg-white px-4 py-3.5">
              {corpo}
            </div>
          );
        })}
      </dl>

      <section aria-label="Conversão entre etapas" className="flex flex-col gap-3 rounded-2xl border border-[#E2DDD3] bg-white px-4 py-3.5 sm:flex-row sm:items-start">
        <span className="w-28 shrink-0 pt-0.5 text-[11px] tracking-[0.06em] text-[#6F6A5E] uppercase">Conversão</span>
        <ol className="grid grow grid-cols-2 gap-3 sm:grid-cols-4">
          {COLUNAS.map((e, i) => {
            const aqui = chegaram(i);
            const antes = i ? chegaram(i - 1) : 0;
            return (
              <li key={e} className="flex flex-col gap-1.5">
                <span className={`h-2.5 rounded-full ${COR[e].split(" ")[0]}`} />
                <span className="flex justify-between gap-2 text-[11px]">
                  <span><b className="font-semibold">{ROTULO[e]}</b> · {n.colunas[e].length}</span>
                  {i > 0 && <span className="text-[#6F6A5E]">{antes ? `${Math.round((aqui / antes) * 100)}% chegam` : "—"}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="grid min-w-[1080px] grid-cols-[repeat(4,minmax(0,1fr))_220px] items-start gap-3">
          {COLUNAS.map((e) => {
            const todos = [...n.colunas[e]].sort(
              (a, b) =>
                (crm[a.slug]?.proximaData ?? "9999").localeCompare(crm[b.slug]?.proximaData ?? "9999") || a.nome.localeCompare(b.nome, "pt-BR"),
            );
            const cartoes = e === "novo" ? todos.slice(0, novos) : todos;
            const soma = todos.reduce((s, x) => s + mensal(crm[x.slug]), 0);
            return (
              <section
                key={e}
                aria-label={ROTULO[e]}
                {...alvo(e)}
                className={`flex flex-col gap-2.5 rounded-2xl p-3 transition-colors ${sobre === e ? "bg-[#E4DED2] ring-2 ring-[#17150F]" : "bg-[#EFEBE2]"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${COR[e]}`}>{ROTULO[e]}</span>
                  <span className="text-[11px] text-[#6F6A5E]">
                    {todos.length}
                    {e !== "novo" && todos.length ? ` · ${formatBRL(soma)}/mês` : ""}
                  </span>
                </div>
                {cartoes.map((x) => (
                  <Cartao
                    key={x.slug}
                    espaco={x}
                    crm={crm[x.slug]}
                    hoje={hoje}
                    abrir={() => abrir(x)}
                    arrastar={() => setArrastando(x.slug)}
                    soltou={() => {
                      setArrastando(null);
                      setSobre(null);
                    }}
                    arrastando={arrastando === x.slug}
                  />
                ))}
                {!todos.length && <p className="rounded-xl border border-dashed border-[#D8D2C6] p-3 text-center text-[11px] text-[#6F6A5E]"><span className="hidden sm:inline">Arraste um negócio para cá</span><span className="sm:hidden">Nenhum negócio nesta etapa</span></p>}
                {e === "novo" && todos.length > novos && (
                  <button
                    type="button"
                    onClick={() => setNovos((v) => v + NOVOS_POR_VEZ * 2)}
                    className="h-10 rounded-[10px] border border-dashed border-[#D8D2C6] text-xs text-[#6F6A5E] hover:border-[#17150F] hover:text-[#17150F]"
                  >
                    + {todos.length - novos} negócios
                  </button>
                )}
              </section>
            );
          })}

          <section
            aria-label="Perdido"
            {...alvo("perdido")}
            className={`flex flex-col gap-2.5 rounded-2xl p-3 transition-colors ${sobre === "perdido" ? "bg-[#EBDCDC] ring-2 ring-[#8A2F2F]" : "bg-[#EFEBE2]"}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${COR.perdido}`}>{ROTULO.perdido}</span>
              <span className="text-[11px] text-[#6F6A5E]">{n.perdidos.length}</span>
            </div>
            <div className="flex flex-col gap-2 rounded-xl border border-[#E2DDD3] bg-white p-3">
              <span className="text-[11px] tracking-[0.06em] text-[#6F6A5E] uppercase">Por quê · {PERIODOS[periodo].toLowerCase()}</span>
              {n.motivos.length ? (
                n.motivos.map(([m, q]) => (
                  <div key={m} className="flex justify-between gap-2 text-xs">
                    <span>{MOTIVOS_PERDA[m]}</span>
                    <b className="font-semibold">{q}</b>
                  </div>
                ))
              ) : (
                <p className="text-xs text-[#6F6A5E]">Nenhuma perda com motivo no período.</p>
              )}
              {n.perdidos.length > 0 && (
                <button type="button" onClick={verPerdidos} className="self-start text-[11px] font-semibold underline underline-offset-4">
                  ver os {n.perdidos.length} perdidos
                </button>
              )}
            </div>
            {arrastando && <p className="text-center text-[11px] text-[#8A2F2F]">Solte aqui: o motivo é perguntado em seguida.</p>}
          </section>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="origens-t" className="overflow-hidden rounded-2xl border border-[#E2DDD3] bg-white">
          <h3 id="origens-t" className="px-4 pt-4 pb-3 font-[family-name:var(--fonte-serifa)] text-[22px] leading-none">De onde vêm os clientes</h3>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-[#FBFAF8] text-[11px] tracking-[0.06em] text-[#6F6A5E] uppercase">
                <th scope="col" className="px-4 py-2.5 text-left font-medium">Origem</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Contatos</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Fechados</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Conversão</th>
              </tr>
            </thead>
            <tbody>
              {n.origens.map(({ o, contatos, fechados }) => (
                <tr key={o} className="border-t border-[#E2DDD3]">
                  <td className="px-4 py-2.5 font-semibold">{ORIGENS[o]}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{contatos}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fechados}</td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{contatos ? `${Math.round((fechados / contatos) * 100)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section aria-labelledby="perdas-t" className="flex flex-col gap-3 rounded-2xl border border-[#E2DDD3] bg-white p-4">
          <h3 id="perdas-t" className="font-[family-name:var(--fonte-serifa)] text-[22px] leading-none">Por que perdemos</h3>
          {(Object.keys(MOTIVOS_PERDA) as MotivoPerda[]).map((m) => {
            const q = n.motivos.find(([x]) => x === m)?.[1] ?? 0;
            const max = Math.max(1, ...n.motivos.map(([, v]) => v));
            return (
              <div key={m} className="grid grid-cols-[10rem_minmax(0,1fr)_2rem] items-center gap-3 text-xs">
                <span>{MOTIVOS_PERDA[m]}</span>
                <span className="h-2.5 rounded-full bg-[#EFEBE2]">
                  <span className="block h-2.5 rounded-full bg-[#8A2F2F]" style={{ width: `${(q / max) * 100}%` }} />
                </span>
                <b className="text-right font-semibold tabular-nums">{q}</b>
              </div>
            );
          })}
          <p className="text-[11px] text-[#6F6A5E]">{PERIODOS[periodo]}. Conta a partir de quando o motivo passou a ser pedido.</p>
        </section>
      </div>
    </div>
  );
}

function Cartao({
  espaco,
  crm,
  hoje,
  abrir,
  arrastar,
  soltou,
  arrastando,
}: {
  espaco: Espaco;
  crm: Crm | undefined;
  hoje: string;
  abrir: () => void;
  arrastar: () => void;
  soltou: () => void;
  arrastando: boolean;
}) {
  const p = prazoDe(crm, hoje);
  const estilo = p === "atrasada" ? COR.perdido : p === "hoje" ? COR.negociando : COR.novo;
  const lugar = [espaco.cidade && `${espaco.cidade}${espaco.uf ? `/${espaco.uf}` : ""}`, espaco.nicho].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      draggable
      onDragStart={(ev) => {
        ev.dataTransfer.effectAllowed = "move";
        ev.dataTransfer.setData("text/plain", espaco.slug);
        arrastar();
      }}
      onDragEnd={soltou}
      onClick={abrir}
      aria-label={`${espaco.nome}. Abrir o negócio`}
      className={`flex cursor-grab flex-col gap-2 rounded-xl border border-[#E2DDD3] bg-white p-3 text-left hover:border-[#17150F] active:cursor-grabbing ${arrastando ? "opacity-40" : ""}`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-[13px] leading-snug font-semibold">{espaco.nome}</span>
        {crm && crm.estagio !== "novo" && <span className="shrink-0 text-xs font-semibold tabular-nums">{formatBRL(mensal(crm))}</span>}
      </span>
      {lugar && <span className="truncate text-[11px] text-[#6F6A5E]">{lugar}</span>}
      <span className="flex flex-wrap gap-1.5">
        {crm?.proximaData && (
          <span className={`max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-semibold ${estilo}`}>
            {crm.proximaAcao ? `${crm.proximaAcao} · ` : ""}
            {p === "atrasada" ? `desde ${diaCurto(crm.proximaData)}` : p === "hoje" ? "hoje" : diaCurto(crm.proximaData)}
          </span>
        )}
        {crm?.origem && <span className="rounded-full bg-[#EFEBE2] px-2 py-0.5 text-[11px] text-[#6F6A5E]">{ORIGENS[crm.origem]}</span>}
      </span>
    </button>
  );
}
