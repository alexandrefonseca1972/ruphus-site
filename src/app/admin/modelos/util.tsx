"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { GRUPOS, SUBS, type Sub } from "@/lib/gerador";
import type { DefModelo } from "@/lib/modelos/tipos";
import type { listarModelos } from "../modelos-actions";
import type { negociosDoModelo } from "./negocios-actions";

// Tipos e peças comuns do Estúdio de modelos (F6).

export type Tipo = "site" | "bio";
export type Lista = Extract<Awaited<ReturnType<typeof listarModelos>>, { ok: true }>["dados"];
export type Item = Lista["modelos"][number];
export type Negocios = Extract<Awaited<ReturnType<typeof negociosDoModelo>>, { ok: true }>["dados"];

// cópia de site-gaveta.tsx:19-20 (importar de lá prenderia o Estúdio à gaveta)
const BOTAO = "inline-flex h-11 items-center justify-center gap-2 rounded-[10px] px-4 text-[13px] font-semibold transition-colors disabled:opacity-60 motion-reduce:transition-none";
export const FOCO = "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#3388d2]";
export const BOTAO_CLARO = `${BOTAO} ${FOCO} border border-[#D8D2C6] bg-white text-[#17150F] hover:border-[#17150F]`;
export const BOTAO_ESCURO = `${BOTAO} ${FOCO} bg-[#17150F] text-white hover:bg-[#2E2B22]`;
export const CAMPO = `h-11 w-full rounded-[9px] border border-[#E2DDD3] bg-white px-2.5 text-[13.5px] ${FOCO}`;
export const ROTULO_GRUPO = "text-[10.5px] font-bold tracking-[.12em] text-[#6F6A5E] uppercase";
export const SERIFA = "font-[family-name:var(--fonte-serifa)]";

export const n = (x: number) => x.toLocaleString("pt-BR");
export const ramoDe = (sub: string) => (sub === "todos" ? "Todos" : (SUBS[sub as Sub]?.rotulo ?? sub));
export const familiaDe = (sub: string) => (sub === "todos" ? "Geral" : (GRUPOS.find(([, s]) => s.includes(sub as Sub))?.[0] ?? "Outros"));
/** A foto de capa do kit: pasta com hero.jpg (editorial e bio) ou foto do banco sem extensão (claro). */
export const fotoDoKit = (d: Pick<DefModelo, "layout" | "kit">) => (d.layout === "claro" ? `/s${d.kit}-800.jpg` : `/s${d.kit}/hero.jpg`);
/** O que o Estúdio mostra do modelo: a edição local, o rascunho salvo ou a publicada. */
export const defDe = (i: Item, edicoes: Record<string, DefModelo>) => edicoes[i.def.id] ?? i.rascunho ?? i.def;

export const ROTULO_LAYOUT: Record<string, string> = {
  editorial: "Editorial", claro: "Claro", atual: "Bio atual", clara: "Clara", galeria: "Galeria", agenda: "Agenda",
  cartaz: "Cartaz", vidro: "Vidro", painel: "Painel", noturno: "Noturno", stories: "Stories",
};
/** Layouts de bio que já têm código (F4); os outros entram na F4.5. */
export const BIO_PRONTOS = ["atual", "clara", "galeria", "agenda"];

/** O que mudou entre a publicada e o rascunho, em palavras. */
export function mudancas(antes: DefModelo, depois: DefModelo) {
  const m: string[] = [];
  if (antes.nome !== depois.nome) m.push(`nome: ${depois.nome}`);
  if (antes.layout !== depois.layout) m.push(`layout: ${ROTULO_LAYOUT[depois.layout] ?? depois.layout}`);
  if (antes.fonte !== depois.fonte) m.push(`fonte: ${depois.fonte ?? "do modelo"}`);
  if (antes.kit !== depois.kit) m.push(`fotos: ${depois.kit.split("/").pop()}`);
  if (JSON.stringify(antes.paleta) !== JSON.stringify(depois.paleta)) m.push(`cor: ${depois.paleta.acc}`);
  return m;
}

/** Diálogo modal nativo (<dialog> com showModal): foco preso, Esc fecha, clique fora fecha. */
export function Dialogo({ titulo, aoFechar, children }: { titulo: string; aoFechar: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  // sem close() na limpeza: no StrictMode o efeito roda duas vezes e o "close" fecharia o diálogo
  // (onClose → aoFechar). Sair do DOM já encerra o modal.
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="estudio-dialogo"
      onClose={aoFechar}
      onClick={(e) => e.target === ref.current && aoFechar()}
      className="m-auto max-h-[88vh] w-[min(520px,calc(100%-2rem))] overflow-auto rounded-[18px] bg-white p-0 text-[13.5px] text-[#17150F] backdrop:bg-[#17150F]/35"
    >
      <div className="grid gap-3 p-[18px]">
        <h2 id="estudio-dialogo" className={`${SERIFA} m-0 text-[26px] leading-[1.1]`}>{titulo}</h2>
        {children}
      </div>
    </dialog>
  );
}

/** Caixa de número grande com legenda (resumos de publicar, lote e uso). */
export function Numero({ valor, texto, destaque = false }: { valor: number; texto: string; destaque?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${destaque ? "border-[#E8A33D] bg-[#FFF7E6]" : "border-[#E2DDD3] bg-[#FAF8F4]"}`}>
      <div className={`${SERIFA} text-[32px] leading-none tabular-nums`}>{n(valor)}</div>
      <span className="text-[12px] text-[#6F6A5E]">{texto}</span>
    </div>
  );
}
