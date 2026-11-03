"use client";

import { useEffect } from "react";

// Erro inesperado numa tela: em português e com "tentar de novo", no lugar do "Application error".
export default function Erro({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <main role="alert" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 bg-white px-6 text-[#17150F]">
      <h1 className="text-2xl font-semibold">Algo deu errado nesta tela</h1>
      <p className="text-[15px] leading-relaxed text-[#4A4639]">
        Nada do que você já salvou se perdeu. Tente de novo; se continuar, recarregue a página.
      </p>
      <button type="button" onClick={retry} className="inline-flex h-12 items-center justify-center rounded-xl bg-[#17150F] px-5 text-[15px] font-semibold text-white">
        Tentar de novo
      </button>
      {error.digest && <p className="text-xs text-[#6F6A5E]">Código: {error.digest}</p>}
    </main>
  );
}
