"use client";

import { useState } from "react";
import GEO from "./mapa-br.json";

// Mapa dos negócios por estado, das mesmas contagens do painel (o índice em memória do
// servidor): entra site novo, o mapa acompanha na próxima consulta, sem leitura a mais.
// Respeita a busca e os filtros da Lista (menos o estado); tocar num estado abre a Lista nele.
// Geometria: Highcharts map-collection (br-all), projetada e simplificada para SVG.

type Estado = { n: string; d: string; c: number[] };
const ESTADOS = GEO.s as Record<string, Estado>;

// cinzas até o preto pela quantidade; o amarelo-volt marca o estado em foco (identidade do ruphus.site)
const FAIXAS: [number, number, string][] = [
  [1, 49, "#d4d4d4"],
  [50, 499, "#a8a8a8"],
  [500, 1499, "#6e6e6e"],
  [1500, 2999, "#2f2f2f"],
  [3000, Infinity, "#000000"],
];
const VAZIO = "#efefef";
const VOLT = "#fff100";
const corDe = (n: number) => (n ? FAIXAS.find(([a, b]) => n >= a && n <= b)![2] : VAZIO);
const fmt = (n: number) => n.toLocaleString("pt-BR");

export function MapaEstados({ ufs, carregando, aoEscolher }: { ufs: [string, number][]; carregando: boolean; aoEscolher: (uf: string) => void }) {
  const [foco, setFoco] = useState<string | null>(null);
  const porUf = Object.fromEntries(ufs.filter(([u]) => u)) as Record<string, number>;
  const total = Object.values(porUf).reduce((a, b) => a + b, 0);
  const com = Object.keys(ESTADOS).filter((u) => porUf[u]);
  const sem = Object.keys(ESTADOS).filter((u) => !porUf[u]).map((u) => ESTADOS[u].n).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const ranking = [...com].sort((a, b) => porUf[b] - porUf[a]);
  const maior = porUf[ranking[0]] ?? 1;
  const pct = (n: number) => (total ? `${((n * 100) / total).toFixed(1).replace(".", ",")}%` : "");
  const pad = 16;

  return (
    <div className={`flex flex-col gap-4 ${carregando ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap gap-x-10 gap-y-3">
        {[
          [fmt(total), "negócios no recorte"],
          [`${com.length} de 27`, "estados com site"],
          [String(27 - com.length), "estados sem nenhum"],
        ].map(([n, r]) => (
          <div key={r} className="flex flex-col gap-1">
            <b className="text-[30px] leading-none font-semibold tabular-nums">{n}</b>
            <span className="text-[11px] tracking-[0.06em] text-[#6F6A5E] uppercase">{r}</span>
          </div>
        ))}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section aria-label="Mapa do Brasil por quantidade de sites" className="relative min-w-0 rounded-2xl border border-[#E2DDD3] bg-white p-4 sm:p-6">
          <svg viewBox={`${-pad} ${-pad} ${GEO.w + 2 * pad} ${GEO.h + 2 * pad}`} className="block h-auto w-full" role="img" aria-label="Mapa do Brasil: mais escuro onde há mais sites">
            {Object.entries(ESTADOS).map(([uf, e]) => {
              const n = porUf[uf] ?? 0;
              return (
                <path
                  key={uf}
                  d={e.d}
                  fill={foco === uf ? VOLT : corDe(n)}
                  stroke="#ffffff"
                  strokeWidth={2.5}
                  strokeLinejoin="round"
                  tabIndex={0}
                  role="button"
                  aria-label={`${e.n}: ${n ? `${fmt(n)} negócios` : "nenhum"}. Abrir na Lista`}
                  className="cursor-pointer outline-none transition-[fill] duration-150"
                  onPointerEnter={() => setFoco(uf)}
                  onPointerLeave={() => setFoco(null)}
                  onFocus={() => setFoco(uf)}
                  onBlur={() => setFoco(null)}
                  onClick={() => aoEscolher(uf)}
                  onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && (ev.preventDefault(), aoEscolher(uf))}
                />
              );
            })}
            {Object.entries(ESTADOS).map(([uf, e]) => {
              // sigla só onde cabe (DF e SE ficam no ranking e na dica)
              if (uf === "DF" || uf === "SE") return null;
              const n = porUf[uf] ?? 0;
              const fill = foco === uf ? "#000" : !n ? "#979797" : n >= 500 ? "#fff" : "#000";
              return (
                <text key={uf} x={e.c[0]} y={e.c[1]} textAnchor="middle" dominantBaseline="central" fontSize={24} fontWeight={600} fill={fill} pointerEvents="none" className="font-mono">
                  {uf}
                </text>
              );
            })}
          </svg>
          {foco && (
            <div role="status" className="pointer-events-none absolute top-4 left-4 rounded-xl bg-[#17150F] px-3.5 py-2.5 text-white">
              <b className="block text-[15px] leading-tight">{ESTADOS[foco].n}</b>
              <span className="text-[12px] text-[#fff100]">{porUf[foco] ? `${fmt(porUf[foco])} negócios · ${pct(porUf[foco])}` : "nenhum ainda"}</span>
            </div>
          )}
          <ul aria-label="Legenda" className="mt-3 flex flex-wrap gap-2 text-[11px] text-[#6F6A5E]">
            {FAIXAS.map(([a, b, c]) => (
              <li key={a} className="flex items-center gap-1.5 rounded-full bg-[#F5F2EC] px-2.5 py-1">
                <i className="size-2.5 rounded-full" style={{ background: c }} />
                {b === Infinity ? `${fmt(a)} ou mais` : `${fmt(a)}–${fmt(b)}`}
              </li>
            ))}
            <li className="flex items-center gap-1.5 rounded-full bg-[#F5F2EC] px-2.5 py-1">
              <i className="size-2.5 rounded-full ring-1 ring-[#D9D3C7]" style={{ background: VAZIO }} />
              nenhum
            </li>
          </ul>
        </section>

        <section className="min-w-0 rounded-2xl border border-[#E2DDD3] bg-white p-4 sm:p-6">
          <h2 className="mb-3 text-[11px] font-semibold tracking-[0.06em] text-[#6F6A5E] uppercase">Por estado</h2>
          {ranking.length === 0 ? (
            <p className="text-sm text-[#6F6A5E]">{carregando ? "Carregando…" : "Nenhum negócio neste recorte."}</p>
          ) : (
            <ol className="flex flex-col">
              {ranking.map((uf) => {
                const n = porUf[uf];
                return (
                  <li key={uf}>
                    <button
                      type="button"
                      onClick={() => aoEscolher(uf)}
                      onPointerEnter={() => setFoco(uf)}
                      onPointerLeave={() => setFoco(null)}
                      className={`grid w-full grid-cols-[2.4rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-[#F0ECE4] px-1.5 py-2 text-left ${foco === uf ? "bg-[#fff100]" : "hover:bg-[#FAF8F3]"}`}
                    >
                      <span className="font-mono text-[12px] font-semibold">{uf}</span>
                      <span className="grid min-w-0 gap-1">
                        <span className="truncate text-[13px] font-medium">{ESTADOS[uf].n}</span>
                        <i className="block h-1.5 rounded-full bg-[#17150F]" style={{ width: `${Math.max(1.5, (n * 100) / maior)}%` }} />
                      </span>
                      <span className="text-right tabular-nums">
                        <b className="block text-[15px] leading-tight font-semibold">{fmt(n)}</b>
                        <small className="text-[11px] text-[#8B8578]">{pct(n)}</small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {sem.length > 0 && !carregando && (
            <p className="mt-4 rounded-xl bg-[#F5F2EC] px-3.5 py-3 text-[13px] leading-snug">
              <span className="mb-0.5 block text-[11px] font-semibold tracking-[0.06em] text-[#6F6A5E] uppercase">Sem nenhum</span>
              {sem.join(", ")}.
            </p>
          )}
        </section>
      </div>
      <p className="text-[12px] text-[#8B8578]">Atualiza a cada consulta do painel e segue a busca e os filtros da Lista. Toque num estado para abrir a Lista nele.</p>
    </div>
  );
}
