"use client";

import { useEffect, useState } from "react";
import { idToken as tokenAtual } from "@/lib/firebase";
import type { Caso, DefModelo } from "@/lib/modelos/tipos";
import { previaModelo } from "../modelos-actions";
import { CAMPO, FOCO, fotoDoKit, type Item, type Negocios, SERIFA } from "./util";

// O centro do Estúdio: formatos de tela, negócio, caso de teste, comparar e a faixa de vizinhos.

export const FORMATOS = {
  cel: { n: "Celular", w: 390, h: 780, cap: 300, borda: 16, moldura: "rounded-[26px] border-8 border-[#15171A]" },
  tab: { n: "Tablet", w: 820, h: 1100, cap: 520, borda: 20, moldura: "rounded-[20px] border-10 border-[#22252A]" },
  note: { n: "Notebook", w: 1280, h: 800, cap: 9999, borda: 12, moldura: "rounded-[10px_10px_4px_4px] border-6 border-[#2A2D33]" },
  mon: { n: "Monitor", w: 1920, h: 1080, cap: 9999, borda: 12, moldura: "rounded-[6px] border-6 border-[#111]" },
} as const;
type Chave = keyof typeof FORMATOS;
export type FormatoTela = Chave | "todos";
// em "Todos" cada tela fica com uma parte da largura, lado a lado
const PARTE: Record<Chave, number> = { mon: 0.34, note: 0.26, tab: 0.16, cel: 0.1 };

export type Previa = { html: string } | { url: string } | null;

const CASOS: [Caso, string][] = [
  ["normal", "Normal"], ["longo", "Nome longo"], ["semnota", "Sem avaliações"], ["poucas", "Só 1 foto"], ["umserv", "1 serviço"], ["semprec", "Sem preço"],
];

/** A prévia de uma def com os dados de um negócio. O site volta como HTML (srcDoc); a bio, como
 *  endereço assinado que vence em 10 min: renova sozinha aos 9. Espera 250 ms entre mudanças. */
export function usePrevia(def: DefModelo | null, slug: string, caso: Caso) {
  const [previa, setPrevia] = useState<Previa>(null);
  const [erro, setErro] = useState("");
  const [relogio, setRelogio] = useState(0);
  const chave = def && slug ? JSON.stringify({ def, slug, caso }) : "";
  useEffect(() => {
    if (!chave) return;
    const pedido = JSON.parse(chave) as { def: DefModelo; slug: string; caso: Caso };
    let atual = true;
    const t = setTimeout(async () => {
      const r = await previaModelo(await tokenAtual(), { ...pedido, tipo: pedido.def.tipo }).catch(() => null);
      if (!atual) return;
      if (r?.ok) {
        setPrevia(r.dados);
        setErro("");
      } else setErro(r?.error ?? "Não foi possível montar a prévia.");
    }, 250);
    const renova = pedido.def.tipo === "bio" ? setTimeout(() => setRelogio((x) => x + 1), 9 * 60_000) : undefined;
    return () => {
      atual = false;
      clearTimeout(t);
      clearTimeout(renova);
    };
  }, [chave, relogio]);
  return { previa: chave ? previa : null, erro };
}

/** O mesmo modelo num ou em vários tamanhos de tela, encolhido para caber na largura (ResizeObserver). */
export function Moldura({ previa, formato, titulo }: { previa: Previa; formato: FormatoTela; titulo: string }) {
  const [caixa, setCaixa] = useState<HTMLDivElement | null>(null);
  const [largura, setLargura] = useState(0);
  useEffect(() => {
    if (!caixa) return;
    // medido 0 (ainda sem layout, ou escondido numa troca de tela) não pode virar escala 0 nem
    // sumir com a prévia: cai na largura do pai ou da janela; o observador mede de novo depois
    const medir = () => setLargura(caixa.clientWidth || caixa.parentElement?.clientWidth || window.innerWidth);
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(caixa);
    window.addEventListener("resize", medir);
    return () => {
      obs.disconnect();
      window.removeEventListener("resize", medir);
    };
  }, [caixa]);
  const chaves: Chave[] = formato === "todos" ? ["mon", "note", "tab", "cel"] : [formato];
  const total = largura - 24;
  return (
    <div ref={setCaixa} className="w-full">
      <div className="flex w-full flex-wrap items-end justify-center gap-3.5">
        {largura > 0 &&
          chaves.map((k) => {
            const F = FORMATOS[k];
            // pelo menos 90 px de tela: a escala nunca fica 0 nem negativa em caixa estreita
            const larg = Math.max(90, Math.min(F.cap, formato === "todos" ? total * PARTE[k] : total) - F.borda);
            const s = larg / F.w;
            return (
              <figure key={k} className="m-0 grid justify-items-center gap-1.5">
                <div className={`relative overflow-hidden bg-white shadow-[0_14px_34px_rgba(0,0,0,.18)] ${F.moldura}`} style={{ width: larg + F.borda, height: F.h * s + F.borda }}>
                  {!previa ? (
                    <p className="p-3 text-[12px] text-[#6F6A5E]">Montando a prévia…</p>
                  ) : (
                    <iframe
                      title={`${titulo} em ${F.n}`}
                      tabIndex={-1}
                      {...("html" in previa ? { srcDoc: previa.html, sandbox: "allow-scripts" } : { src: previa.url })}
                      style={{ width: F.w, height: F.h, transform: `scale(${s})`, transformOrigin: "0 0" }}
                      className="block border-0 bg-white"
                    />
                  )}
                </div>
                <figcaption className="font-mono text-[11px] text-[#6F6A5E]">
                  {F.n} · {F.w}×{F.h}
                </figcaption>
              </figure>
            );
          })}
      </div>
    </div>
  );
}

/** Miniatura sem servidor: a foto de capa do kit e a cor de destaque. Renderizar dezenas de prévias
 *  reais seria uma Server Action por modelo, em fila. */
export function Miniatura({ def, alta = 120 }: { def: DefModelo; alta?: number }) {
  return (
    <div className="relative overflow-hidden bg-[#ddd]" style={{ height: alta }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- foto estática do kit, já otimizada */}
      <img src={fotoDoKit(def)} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
      <span className="absolute inset-x-0 bottom-0 h-1.5" style={{ background: def.paleta.acc }} />
    </div>
  );
}

type Props = {
  def: DefModelo;
  outros: Item[];
  edicoes: Record<string, DefModelo>;
  formato: FormatoTela;
  setFormato: (f: FormatoTela) => void;
  negocios: Negocios | null;
  slug: string;
  setSlug: (s: string) => void;
  caso: Caso;
  setCaso: (c: Caso) => void;
  comp: string;
  setComp: (id: string) => void;
  selecionar: (id: string) => void;
};

export function Tela({ def, outros, edicoes, formato, setFormato, negocios, slug, setSlug, caso, setCaso, comp, setComp, selecionar }: Props) {
  // comparar só com a mesma família de layout: o negócio da prévia precisa servir aos dois
  const comparaveis = outros.filter((i) => i.def.id !== def.id && (def.tipo === "bio" || i.def.layout === def.layout));
  const outro = comparaveis.find((i) => i.def.id === comp);
  const defOutro = outro ? (edicoes[outro.def.id] ?? outro.rascunho ?? outro.def) : null;
  const a = usePrevia(def, slug, caso);
  const b = usePrevia(defOutro, slug, caso);
  const vizinhos = outros.filter((i) => i.def.sub === def.sub || i.def.sub === "todos" || def.sub === "todos");
  const umFormato: FormatoTela = formato === "todos" ? (def.tipo === "site" ? "note" : "cel") : formato;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
        <div role="group" aria-label="Formato de tela" className="flex flex-wrap rounded-[10px] border border-[#E2DDD3] bg-[#FAF8F4] p-[3px]">
          {([...Object.keys(FORMATOS), "todos"] as FormatoTela[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={formato === k}
              onClick={() => setFormato(k)}
              className={`h-11 rounded-lg px-2.5 text-[12.5px] font-semibold ${FOCO} ${formato === k ? "bg-white text-[#17150F] shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "text-[#6F6A5E]"}`}
            >
              {k === "todos" ? "Todos" : FORMATOS[k].n}
            </button>
          ))}
        </div>
        <select aria-label="Ver com o negócio" value={slug} onChange={(e) => setSlug(e.target.value)} className={`${CAMPO} w-auto max-w-[260px]`}>
          {!negocios?.doRamo.length && <option value="">{negocios ? "Nenhum negócio no ramo" : "Carregando negócios…"}</option>}
          {negocios?.doRamo.map((x) => (
            <option key={x.slug} value={x.slug}>
              {x.nome}
              {x.cidade ? ` · ${x.cidade}` : ""}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[12px] font-semibold text-[#6F6A5E]">
          Caso
          <select value={caso} onChange={(e) => setCaso(e.target.value as Caso)} className={`${CAMPO} w-auto`}>
            {CASOS.map(([v, r]) => (
              <option key={v} value={v}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[12px] font-semibold text-[#6F6A5E]">
          Comparar com
          <select value={outro ? comp : ""} onChange={(e) => setComp(e.target.value)} className={`${CAMPO} w-auto max-w-[220px]`}>
            <option value="">Ninguém</option>
            {comparaveis.map((i) => (
              <option key={i.def.id} value={i.def.id}>
                {i.def.nome}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-none justify-center px-3.5 pt-1.5 pb-3.5">
        {!slug ? (
          <p className="p-6 text-[13px] text-[#6F6A5E]">{negocios ? "Nenhum negócio deste ramo para mostrar a prévia." : "Carregando…"}</p>
        ) : outro && defOutro ? (
          <div className="grid w-full grid-cols-2 gap-3">
            {[[def, a] as const, [defOutro, b] as const].map(([d, p], i) => (
              <div key={i} className="grid min-w-0 justify-items-center gap-2">
                <h3 className={`${SERIFA} m-0 text-[18px]`}>{d.nome}</h3>
                {p.erro ? <p className="text-[12.5px] text-[#8A2F2F]">{p.erro}</p> : <Moldura previa={p.previa} formato={umFormato} titulo={`Prévia de ${d.nome}`} />}
              </div>
            ))}
          </div>
        ) : a.erro ? (
          <p role="alert" className="p-6 text-[13px] text-[#8A2F2F]">{a.erro}</p>
        ) : (
          <Moldura previa={a.previa} formato={formato} titulo={`Prévia de ${def.nome}`} />
        )}
      </div>

      <div aria-label="Outros modelos do mesmo ramo" className="mt-auto flex flex-none gap-2.5 overflow-x-auto border-t border-[#D9D3C8] bg-[#EEEAE3] px-3.5 pt-2.5 pb-3.5">
        {vizinhos.map((i) => (
          <button
            key={i.def.id}
            type="button"
            aria-current={i.def.id === def.id}
            onClick={() => selecionar(i.def.id)}
            className={`w-24 flex-none overflow-hidden rounded-xl border-2 bg-white p-0 text-left ${FOCO} ${i.def.id === def.id ? "border-[#17150F]" : "border-transparent"}`}
          >
            <Miniatura def={i.def.id === def.id ? def : (edicoes[i.def.id] ?? i.rascunho ?? i.def)} alta={96} />
            <span className="block truncate px-1.5 py-1 text-[11px] font-semibold">{(edicoes[i.def.id] ?? i.rascunho ?? i.def).nome}</span>
          </button>
        ))}
      </div>
    </>
  );
}
