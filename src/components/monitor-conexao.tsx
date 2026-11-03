"use client";

import { useEffect, useRef, useState } from "react";
import { esperaDe, RECONECTOU, recarregarUmaVez, versaoMudou } from "@/lib/conexao";
import { COMMIT } from "@/lib/versao";

type Estado = { tipo: "ok" } | { tipo: "sem-conexao"; falhas: number; proxima: number } | { tipo: "versao-nova" };

/** Fica de olho na conexão e na versão do painel. Sem conexão: faixa e nova tentativa com
 *  espera crescente (e na hora em que a internet ou a aba voltam). Voltou: avisa as telas
 *  (RECONECTOU). Versão nova no ar: faixa para atualizar; com a aba em segundo plano,
 *  atualiza sozinha. */
export function MonitorConexao() {
  const [estado, setEstado] = useState<Estado>({ tipo: "ok" });
  const [agora, setAgora] = useState(() => Date.now());
  const falhas = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let vivo = true;
    async function conferir() {
      clearTimeout(timer.current);
      let commit: string | null = null;
      try {
        if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("offline");
        // AbortController e não AbortSignal.timeout, que o Safari do iOS 15 não tem: lá o
        // fetch quebrava antes de sair e a faixa "Sem conexão" ficava para sempre
        const aborta = new AbortController();
        const prazo = setTimeout(() => aborta.abort(), 10_000);
        const r = await fetch("/api/versao", { cache: "no-store", signal: aborta.signal }).finally(() => clearTimeout(prazo));
        if (!r.ok) throw new Error(String(r.status));
        commit = ((await r.json()) as { commit?: string }).commit ?? null;
      } catch {
        if (!vivo) return;
        falhas.current += 1;
        const espera = esperaDe(falhas.current);
        setEstado({ tipo: "sem-conexao", falhas: falhas.current, proxima: Date.now() + espera });
        timer.current = setTimeout(conferir, espera);
        return;
      }
      if (!vivo) return;
      const voltou = falhas.current > 0;
      falhas.current = 0;
      if (versaoMudou(COMMIT, commit)) {
        setEstado({ tipo: "versao-nova" });
        if (document.hidden) recarregarUmaVez();
      } else {
        setEstado({ tipo: "ok" });
        if (voltou) window.dispatchEvent(new Event(RECONECTOU));
      }
      timer.current = setTimeout(conferir, 30_000);
    }
    const agoraMesmo = () => void conferir();
    const aoVoltarAba = () => {
      if (document.hidden) return;
      void conferir();
    };
    void conferir();
    window.addEventListener("online", agoraMesmo);
    window.addEventListener("offline", agoraMesmo);
    document.addEventListener("visibilitychange", aoVoltarAba);
    return () => {
      vivo = false;
      clearTimeout(timer.current);
      window.removeEventListener("online", agoraMesmo);
      window.removeEventListener("offline", agoraMesmo);
      document.removeEventListener("visibilitychange", aoVoltarAba);
    };
  }, []);

  // contagem da próxima tentativa
  useEffect(() => {
    if (estado.tipo !== "sem-conexao") return;
    const id = setInterval(() => setAgora(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [estado.tipo]);

  // versão nova: atualiza sozinha quando a pessoa sair da aba (sem perder o que está digitando)
  useEffect(() => {
    if (estado.tipo !== "versao-nova") return;
    const sair = () => document.hidden && recarregarUmaVez();
    document.addEventListener("visibilitychange", sair);
    return () => document.removeEventListener("visibilitychange", sair);
  }, [estado.tipo]);

  if (estado.tipo === "ok") return null;
  const segundos = estado.tipo === "sem-conexao" ? Math.max(0, Math.ceil((estado.proxima - agora) / 1000)) : 0;
  return (
    // no celular, acima da barra de navegação de baixo (painel e admin, ~57 px): tapava as abas
    <div role="status" aria-live="polite" className="fixed inset-x-0 bottom-0 z-[60] flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] max-sm:bottom-[calc(3.75rem+env(safe-area-inset-bottom))] max-sm:pb-3 print:hidden">
      <div className="flex max-w-xl flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-[#17150F] px-4 py-3 text-sm text-[#FAF9F5] shadow-lg">
        {estado.tipo === "sem-conexao" ? (
          <>
            <span>Sem conexão com o servidor. {segundos > 0 ? `Nova tentativa em ${segundos} s.` : "Tentando…"}</span>
            <button
              type="button"
              className="h-9 rounded-lg border border-white/30 px-3 font-semibold hover:bg-white/10"
              onClick={() => window.dispatchEvent(new Event("online"))}
            >
              Tentar agora
            </button>
          </>
        ) : (
          <>
            <span>Há uma versão nova do painel no ar.</span>
            <button type="button" className="h-9 rounded-lg bg-[#FAF9F5] px-3 font-semibold text-[#17150F]" onClick={() => location.reload()}>
              Atualizar
            </button>
          </>
        )}
      </div>
    </div>
  );
}
