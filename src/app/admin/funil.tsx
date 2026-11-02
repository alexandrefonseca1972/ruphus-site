"use client";

import { useState } from "react";
import { formatBRL } from "@/lib/datetime";
import { COR, diaCurto, MOTIVOS_PERDA, ORIGENS, prazoDe, ROTULO, type Crm, type Estagio, type MotivoPerda } from "@/lib/crm-tipos";
import { COLUNAS, mensal, NOVOS_POR_VEZ, origemDe, PERIODOS, ehPeriodo, type Periodo, type ResumoDoFunil } from "@/lib/funil-consulta";
import type { Espaco } from "./actions";

// O funil em colunas: os mesmos negócios da lista (com os mesmos filtros e busca),
// agrupados por estágio, com os números do período em cima e origem e perdas embaixo.
// Os números vêm prontos (src/lib/funil-consulta.ts): da rota do painel ou, no ?modo=antigo,
// calculados na página.

export function Funil({
  resumo: n,
  crm,
  hoje,
  periodo,
  setPeriodo,
  novos,
  maisNovos,
  abrir,
  mover,
  verAtrasadas,
  verPerdidos,
  verNovos,
}: {
  resumo: ResumoDoFunil;
  /** o CRM dos cartões (pode ter mais) */
  crm: Record<string, Crm>;
  hoje: string;
  periodo: Periodo;
  setPeriodo: (p: Periodo) => void;
  novos: number;
  maisNovos: () => void;
  abrir: (e: Espaco) => void;
  mover: (slug: string, estagio: Estagio) => void;
  verAtrasadas: () => void;
  verPerdidos: () => void;
  verNovos: () => void;
}) {
  // no celular as cinco colunas (1.080 px) rolavam para o lado: mostra uma etapa por vez
  const [etapaMovel, setEtapaMovel] = useState<Estagio>("novo");
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<Estagio | null>(null);

  // Conversão entre etapas: de quem chegou a uma etapa, quantos passaram da seguinte
  const chegaram = (i: number) => n.chegaram[i];
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
            onChange={(e) => ehPeriodo(e.target.value) && setPeriodo(e.target.value)}
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
                  <span><b className="font-semibold">{ROTULO[e]}</b> · {n.colunas[e].total}</span>
                  {i > 0 && <span className="text-[#6F6A5E]">{antes ? `${Math.round((aqui / antes) * 100)}% chegam` : "—"}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <div role="tablist" aria-label="Etapas" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:hidden [&::-webkit-scrollbar]:hidden">
        {[...COLUNAS, "perdido" as const].map((e) => (
          <button
            key={e}
            type="button"
            role="tab"
            aria-selected={etapaMovel === e}
            onClick={() => setEtapaMovel(e)}
            className={`flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs whitespace-nowrap ${etapaMovel === e ? "border-[#17150F] bg-[#17150F] font-bold text-white" : "border-[#D8D2C6] bg-white font-semibold text-[#17150F]"}`}
          >
            {ROTULO[e]} <span className={etapaMovel === e ? "text-white/70" : "text-[#6F6A5E]"}>{(e === "perdido" ? n.perdidos : n.colunas[e].total).toLocaleString("pt-BR")}</span>
          </button>
        ))}
      </div>

      <div className="sm:overflow-x-auto">
        <div className="flex flex-col gap-3 sm:grid sm:min-w-[1080px] sm:grid-cols-[repeat(4,minmax(0,1fr))_220px] sm:items-start">
          {COLUNAS.map((e) => {
            // ordenadas no resumo: data combinada antes; "Novo" na ordem da Lista, o resto por nome
            const { total, somaCents: soma, cartoes } = n.colunas[e];
            return (
              <section
                key={e}
                aria-label={ROTULO[e]}
                {...alvo(e)}
                className={`flex flex-col gap-2.5 rounded-2xl p-3 transition-colors ${etapaMovel === e ? "" : "max-sm:hidden"} ${sobre === e ? "bg-[#E4DED2] ring-2 ring-[#17150F]" : "bg-[#EFEBE2]"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${COR[e]}`}>{ROTULO[e]}</span>
                  <span className="text-[11px] text-[#6F6A5E]">
                    {total}
                    {e !== "novo" && total ? ` · ${formatBRL(soma)}/mês` : ""}
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
                {!total && <p className="rounded-xl border border-dashed border-[#D8D2C6] p-3 text-center text-[11px] text-[#6F6A5E]"><span className="hidden sm:inline">Arraste um negócio para cá</span><span className="sm:hidden">Nenhum negócio nesta etapa</span></p>}
                {e === "novo" && total > novos && (
                  <div className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={maisNovos}
                      className="h-10 rounded-[10px] border border-dashed border-[#D8D2C6] text-xs text-[#6F6A5E] hover:border-[#17150F] hover:text-[#17150F]"
                    >
                      Mostrar mais {Math.min(NOVOS_POR_VEZ, total - novos)}
                    </button>
                    <button type="button" onClick={verNovos} className="h-9 text-[11px] font-semibold underline underline-offset-4">
                      Ver os {total} novos na Lista
                    </button>
                  </div>
                )}
              </section>
            );
          })}

          <section
            aria-label="Perdido"
            {...alvo("perdido")}
            className={`flex flex-col gap-2.5 rounded-2xl p-3 transition-colors ${etapaMovel === "perdido" ? "" : "max-sm:hidden"} ${sobre === "perdido" ? "bg-[#EBDCDC] ring-2 ring-[#8A2F2F]" : "bg-[#EFEBE2]"}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${COR.perdido}`}>{ROTULO.perdido}</span>
              <span className="text-[11px] text-[#6F6A5E]">{n.perdidos}</span>
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
              {n.perdidos > 0 && (
                <button type="button" onClick={verPerdidos} className="self-start text-[11px] font-semibold underline underline-offset-4">
                  ver os {n.perdidos} perdidos
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

        <section aria-labelledby="campanhas-t" className="overflow-hidden rounded-2xl border border-[#E2DDD3] bg-white">
          <h3 id="campanhas-t" className="px-4 pt-4 pb-3 font-[family-name:var(--fonte-serifa)] text-[22px] leading-none">Anúncios</h3>
          {n.campanhas.length ? (
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-[#FBFAF8] text-[11px] tracking-[0.06em] text-[#6F6A5E] uppercase">
                  <th scope="col" className="px-4 py-2.5 text-left font-medium">Campanha</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Cadastros</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Fechados</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Conversão</th>
                </tr>
              </thead>
              <tbody>
                {n.campanhas.map(([nome, { cadastros, fechados }]) => (
                  <tr key={nome} className="border-t border-[#E2DDD3]">
                    <td className="max-w-0 truncate px-4 py-2.5 font-semibold" title={nome}>{nome}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{cadastros}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fechados}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{`${Math.round((fechados / cadastros) * 100)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-4 pb-4 text-xs leading-relaxed text-[#6F6A5E]">
              Nenhum cadastro veio de anúncio ainda. Use links com <code>utm_campaign</code> nos anúncios, por exemplo
              {" "}<code className="break-all">www.ruphus.site/?utm_source=instagram&amp;utm_campaign=setembro</code>: cada campanha aparece aqui com os negócios que criou.
            </p>
          )}
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
        {/* sem CRM é o importado que ninguém tocou: o painel não manda esses documentos */}
        <span className="rounded-full bg-[#EFEBE2] px-2 py-0.5 text-[11px] text-[#6F6A5E]">{ORIGENS[origemDe(crm)]}</span>
      </span>
    </button>
  );
}
