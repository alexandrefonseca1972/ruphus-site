"use client";

import { alternarValores, useValores } from "@/lib/valores";

/** Título das telas do painel: serifa grande, uma linha de contexto e as ações à direita. */
/** valores: a tela mostra dinheiro; ganha o olho que esconde os valores neste aparelho. */
export function PageTitle({ title, sub, valores, children }: { title: string; sub?: React.ReactNode; valores?: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="grid gap-1.5">
        <div className="flex items-center gap-2">
          <h1 className="font-serifa text-4xl leading-none tracking-tight sm:text-5xl">{title}</h1>
          {valores && <OlhoValores />}
        </div>
        {sub && <p className="text-[15px] text-muted-foreground">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

function OlhoValores() {
  const { oculto } = useValores();
  return (
    <button
      type="button"
      onClick={alternarValores}
      aria-pressed={oculto}
      aria-label={oculto ? "Mostrar os valores" : "Esconder os valores"}
      title={oculto ? "Mostrar os valores" : "Esconder os valores"}
      className="flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
        <circle cx="12" cy="12" r="3" />
        {oculto && <path d="M4 4l16 16" />}
      </svg>
    </button>
  );
}
