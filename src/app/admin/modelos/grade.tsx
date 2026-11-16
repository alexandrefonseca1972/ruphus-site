"use client";

import type { DefModelo } from "@/lib/modelos/tipos";
import { Miniatura } from "./tela";
import { defDe, FOCO, type Item, ramoDe } from "./util";

// A vista em grade: todos os modelos do tipo, com selos de padrão, rascunho e desligado.
// Tocar num cartão abre o modelo no editor.

const CHIP = "rounded-full px-2 py-0.5 text-[11px] font-semibold";

export function Grade({ itens, edicoes, padroes, selId, abrir }: { itens: Item[]; edicoes: Record<string, DefModelo>; padroes: Record<string, string>; selId: string; abrir: (id: string) => void }) {
  if (!itens.length) return <p className="p-6 text-[13px] text-[#6F6A5E]">Nenhum modelo com esse nome.</p>;
  return (
    <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 p-3.5">
      {itens.map((i) => {
        const d = defDe(i, edicoes);
        return (
          <button
            key={i.def.id}
            type="button"
            aria-current={i.def.id === selId}
            onClick={() => abrir(i.def.id)}
            className={`flex flex-col overflow-hidden rounded-2xl border border-[#E2DDD3] bg-white p-0 text-left ${FOCO} ${i.ativo ? "" : "opacity-55"} ${i.def.id === selId ? "outline-2 outline-[#17150F]" : ""}`}
          >
            <div className="relative">
              <Miniatura def={d} alta={200} />
              <div className="absolute top-2 left-2 flex flex-wrap gap-1">
                {padroes[i.def.sub] === i.def.id && <span className={`${CHIP} bg-[#E7EEE9] text-[#2C6A53]`}>★ Padrão</span>}
                {!i.embutido && <span className={`${CHIP} bg-[#E8EEFB] text-[#2F5BD3]`}>Novo</span>}
                {(i.rascunho || edicoes[i.def.id]) && <span className={`${CHIP} bg-[#FFF1D6] text-[#8A5A12]`}>Rascunho</span>}
              </div>
            </div>
            <div className="grid gap-1 px-3 py-2.5">
              <b className="truncate">{d.nome}</b>
              <small className="text-[#6F6A5E]">
                {ramoDe(i.def.sub)} · {i.ativo ? "ligado" : "desligado"}
              </small>
            </div>
          </button>
        );
      })}
    </div>
  );
}
