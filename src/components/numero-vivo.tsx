"use client";

import { useEffect, useRef, useState } from "react";

/** Número que corre até o valor novo (em ~0,8 s) em vez de pular: dá para ver a coleta andando.
 *  Quem pediu menos movimento no sistema vê o número trocar direto. */
export function NumeroVivo({ valor, className }: { valor: number; className?: string }) {
  const [mostrado, setMostrado] = useState(valor);
  const de = useRef(valor);

  useEffect(() => {
    const inicio = de.current;
    if (inicio === valor) return;
    const reduzir = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduzir || Math.abs(valor - inicio) < 2) {
      de.current = valor;
      setMostrado(valor);
      return;
    }
    let quadro = 0;
    const t0 = performance.now();
    const passo = (t: number) => {
      const x = Math.min(1, (t - t0) / 800);
      const suave = 1 - (1 - x) ** 3; // desacelera no fim
      const atual = Math.round(inicio + (valor - inicio) * suave);
      de.current = atual;
      setMostrado(atual);
      if (x < 1) quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [valor]);

  return <span className={`tabular-nums ${className ?? ""}`}>{mostrado.toLocaleString("pt-BR")}</span>;
}
