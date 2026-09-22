import { Instrument_Serif } from "next/font/google";
import { useEffect } from "react";

// Serifa só nos títulos e números grandes do painel, como no /admin
export const serifa = Instrument_Serif({ weight: "400", subsets: ["latin"], variable: "--fonte-serifa" });

/** A fonte também no body: diálogos e menus abrem em portal, fora do wrapper .painel */
export function useSerifaNoBody() {
  useEffect(() => {
    document.body.classList.add(serifa.variable);
    return () => document.body.classList.remove(serifa.variable);
  }, []);
}
