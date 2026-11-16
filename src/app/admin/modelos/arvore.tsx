"use client";

import type { DefModelo } from "@/lib/modelos/tipos";
import { BOTAO_CLARO, CAMPO, defDe, familiaDe, FOCO, type Item, ramoDe, ROTULO_GRUPO, type Tipo } from "./util";

// A coluna da esquerda: Bio/Site, busca e família › ramo › modelo, com os pontos de ligado,
// rascunho e padrão. No celular vira um <select> (SeletorCelular).

type Props = {
  tipo: Tipo;
  setTipo: (t: Tipo) => void;
  itens: Item[];
  edicoes: Record<string, DefModelo>;
  padroes: Record<string, string>;
  selId: string;
  selecionar: (id: string) => void;
  busca: string;
};

export function TipoSeg({ tipo, setTipo }: Pick<Props, "tipo" | "setTipo">) {
  return (
    <div role="group" aria-label="Tipo" className="flex rounded-[10px] border border-[#E2DDD3] bg-[#FAF8F4] p-[3px]">
      {(["bio", "site"] as const).map((t) => (
        <button
          key={t}
          type="button"
          aria-pressed={tipo === t}
          onClick={() => setTipo(t)}
          className={`h-10 flex-1 rounded-lg px-3 text-[13px] font-semibold ${FOCO} ${tipo === t ? "bg-white text-[#17150F] shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "text-[#6F6A5E]"}`}
        >
          {t === "bio" ? "Bio" : "Site"}
        </button>
      ))}
    </div>
  );
}

/** Família › ramo › modelos, na ordem em que chegam. */
function agrupar(itens: Item[]) {
  const grupos = new Map<string, Map<string, Item[]>>();
  for (const i of itens) {
    const f = familiaDe(i.def.sub);
    const r = ramoDe(i.def.sub);
    if (!grupos.has(f)) grupos.set(f, new Map());
    const ramos = grupos.get(f)!;
    ramos.set(r, [...(ramos.get(r) ?? []), i]);
  }
  return grupos;
}

export function Arvore({ tipo, setTipo, itens, edicoes, padroes, selId, selecionar, busca, setBusca, aoNovo }: Props & { setBusca: (b: string) => void; aoNovo: () => void }) {
  const q = busca.trim().toLowerCase();
  const visiveis = itens.filter((i) => !q || defDe(i, edicoes).nome.toLowerCase().includes(q) || i.def.id.includes(q));
  return (
    <>
      <TipoSeg tipo={tipo} setTipo={setTipo} />
      <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar modelo" aria-label="Buscar modelo" className={`${CAMPO} mt-2.5`} />
      {[...agrupar(visiveis)].map(([familia, ramos]) => (
        <div key={familia}>
          <div className={`${ROTULO_GRUPO} mt-3.5`}>{familia}</div>
          {[...ramos].map(([ramo, ms]) => (
            <details key={ramo} open={!!q || ms.some((m) => m.def.id === selId)} className="mt-1 [&[open]>summary>span:first-child]:rotate-90">
              <summary className={`flex cursor-pointer list-none items-center rounded-lg px-2 py-2 font-semibold hover:bg-[#FAF8F4] ${FOCO} [&::-webkit-details-marker]:hidden`}>
                <span aria-hidden="true" className="mr-1.5 text-[#6F6A5E] transition-transform motion-reduce:transition-none">▸</span>
                {ramo}
                <span className="ml-auto font-mono text-[11px] text-[#6F6A5E]">{ms.length}</span>
              </summary>
              {ms.map((m) => {
                const sel = m.def.id === selId;
                const rascunho = !!(m.rascunho || edicoes[m.def.id]);
                const padrao = padroes[m.def.sub] === m.def.id;
                return (
                  <button
                    key={m.def.id}
                    type="button"
                    aria-current={sel}
                    onClick={() => selecionar(m.def.id)}
                    className={`flex min-h-11 w-full items-center gap-2 rounded-lg py-1.5 pr-2 pl-6 text-left ${FOCO} ${sel ? "bg-[#17150F] text-white" : "hover:bg-[#FAF8F4]"}`}
                  >
                    <span title={m.ativo ? "Ligado" : "Desligado"} className={`h-[7px] w-[7px] flex-none rounded-full ${m.ativo ? "bg-[#2C6A53]" : "bg-[#CFC9BD]"}`} />
                    <span className="min-w-0 truncate">{defDe(m, edicoes).nome}</span>
                    {rascunho && <span title="Rascunho" className="h-[7px] w-[7px] flex-none rounded-full bg-[#E8A33D]" />}
                    <span className="sr-only">{[m.ativo ? "ligado" : "desligado", rascunho && "rascunho", padrao && "padrão do ramo"].filter(Boolean).join(", ")}</span>
                    {padrao && <span aria-hidden="true" className="ml-auto text-[11px]">★</span>}
                  </button>
                );
              })}
            </details>
          ))}
        </div>
      ))}
      {!visiveis.length && <p className="mt-3 text-[12.5px] text-[#6F6A5E]">Nenhum modelo com esse nome.</p>}
      <button type="button" onClick={aoNovo} className={`${BOTAO_CLARO} mt-3.5 w-full`}>
        + Novo modelo
      </button>
    </>
  );
}

/** Celular: a árvore vira um select, com Bio/Site ao lado. */
export function SeletorCelular({ tipo, setTipo, itens, edicoes, selId, selecionar }: Omit<Props, "padroes" | "busca">) {
  return (
    <div className="flex items-center gap-2 border-b border-[#E2DDD3] bg-white px-4 py-2.5 min-[980px]:hidden">
      <TipoSeg tipo={tipo} setTipo={setTipo} />
      <select aria-label="Modelo" value={selId} onChange={(e) => selecionar(e.target.value)} className={`${CAMPO} min-w-0 flex-1`}>
        {itens.map((m) => (
          <option key={m.def.id} value={m.def.id}>
            {ramoDe(m.def.sub)} · {defDe(m, edicoes).nome}
            {m.rascunho || edicoes[m.def.id] ? " (rascunho)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
