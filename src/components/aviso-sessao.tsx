"use client";

import { Button } from "@/components/ui/button";

/** "Sua sessão vai encerrar": faixa, não diálogo, de propósito — diálogo aberto adia o logout
 *  automático (src/lib/sessao.ts), e o próprio aviso se adiaria para sempre. */
export function AvisoSessao({ aberto, onContinuar }: { aberto: boolean; onContinuar: () => void }) {
  if (!aberto) return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-md flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-lg sm:bottom-6 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
    >
      <p>Sua sessão vai encerrar em 1 min por falta de uso.</p>
      <Button className="h-10 px-4" onClick={onContinuar}>Continuar</Button>
    </div>
  );
}
