"use client";

import { useEffect } from "react";

/** O PDF é esta mesma página impressa.
 *
 * O navegador já gera o arquivo em "Salvar como PDF", então não há segunda arte
 * para manter em sincronia com a proposta do link: o que o dono lê na tela é
 * exatamente o anexo que ele recebe. `?pdf=1` abre a caixa de impressão sozinha,
 * que é como o vendedor chega ao arquivo em um clique, vindo do painel. */
export function Imprimir({ auto = false }: { auto?: boolean }) {
  useEffect(() => {
    if (auto) print();
  }, [auto]);

  return (
    <button
      type="button"
      onClick={() => print()}
      className="flex h-9 items-center gap-2 self-start rounded-[10px] border border-[#D8D2C6] bg-white px-3 text-[13px] font-semibold hover:border-[#17150F] print:hidden"
    >
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 9V3h12v6M6 18H4v-6h16v6h-2M8 14h8v7H8z" />
      </svg>
      Baixar PDF
    </button>
  );
}
