"use client";

import { useState } from "react";

/** O copia e cola do Pix: quem não aponta a câmera cola no app do banco. */
export function Copiar({ codigo }: { codigo: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(codigo);
            setCopiado(true);
            setTimeout(() => setCopiado(false), 2500);
          } catch {
            // navegador sem permissão de área de transferência: o código está à vista
            setCopiado(false);
          }
        }}
        className="flex h-12 items-center justify-center gap-2.5 rounded-[10px] bg-[#17150F] text-[15px] font-semibold text-[#FAF9F5]"
      >
        {copiado ? "Código copiado" : "Copiar código Pix"}
      </button>
      <code className="max-h-20 overflow-auto rounded-[10px] border border-[#E4E1D5] bg-white p-2.5 font-[family-name:var(--font-geist-mono)] text-[10px] break-all text-[#5C5747]">
        {codigo}
      </code>
    </div>
  );
}
