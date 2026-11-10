"use client";

import { useEffect, useState } from "react";
import type { CreditoTela, PainelConsumo } from "@/lib/consumo-painel.server";
import { idToken } from "@/lib/firebase";
import { useValores } from "@/lib/valores";
import { cn } from "@/lib/utils";
import { consumoAction } from "../actions";

const TZ = "America/Sao_Paulo";
export const diaCurto = (ms: number) => new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" }).format(new Date(ms));
export const hora = (ms: number) => new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
const diaDe = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(ms));

/** "Hoje 15:30", "Ontem 19:02" ou "07/11 14:11". */
export function quando(ms: number, hoje: string) {
  const d = diaDe(ms);
  const ontem = new Date(`${hoje}T12:00:00Z`);
  ontem.setUTCDate(ontem.getUTCDate() - 1);
  if (d === hoje) return `Hoje ${hora(ms)}`;
  if (d === ontem.toISOString().slice(0, 10)) return `Ontem ${hora(ms)}`;
  return `${diaCurto(ms)} ${hora(ms)}`;
}

export const mesAtual = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date()).slice(0, 7);

/** Os dados da tela de consumo de um mês (null: carregando). Erro volta como texto. */
export function useConsumo(slug: string, mes: string, leve = false) {
  const [estado, setEstado] = useState<{ chave: string; dados: PainelConsumo | null; erro: string } | null>(null);
  const [vez, setVez] = useState(0);
  const chave = `${slug}/${mes}/${leve}/${vez}`;
  useEffect(() => {
    let atual = true;
    idToken()
      .then((t) => consumoAction(t, { tenantId: slug, mes, leve }))
      .then(
        (r) => atual && setEstado({ chave, dados: r.ok ? r.dados : null, erro: r.ok ? "" : r.error }),
        () => atual && setEstado({ chave, dados: null, erro: "Não foi possível carregar o consumo. Confira a internet e tente de novo." }),
      );
    return () => {
      atual = false;
    };
  }, [slug, mes, leve, chave]);
  const pronto = estado?.chave === chave ? estado : null;
  return { dados: pronto?.dados ?? null, erro: pronto?.erro ?? "", carregando: !pronto, recarregar: () => setVez((v) => v + 1) };
}

function rotulo(c: CreditoTela, brl: (n: number) => string) {
  if (c.tipo === "consumo") return { titulo: "Consumo", detalhe: c.id.startsWith("consumo:") ? `dia ${c.id.slice(-2)}/${c.id.slice(-5, -3)}` : diaCurto(c.em) };
  if (c.tipo === "estorno") return { titulo: "Devolução de falhas", detalhe: c.id.startsWith("estorno:") ? `dia ${c.id.slice(-2)}/${c.id.slice(-5, -3)}` : diaCurto(c.em) };
  if (c.tipo === "recarga")
    return { titulo: "Recarga via Pix", detalhe: `${diaCurto(c.em)}${c.pacote ? ` · ${brl(c.pacote.valorCents)}${c.pacote.bonusCents ? ` + bônus ${brl(c.pacote.bonusCents)}` : ""}` : ""}` };
  if (c.tipo === "boas-vindas") return { titulo: "Crédito de boas-vindas", detalhe: `${diaCurto(c.em)} · cortesia da Ruphus` };
  if (c.tipo === "ajuste") return { titulo: c.valorCents >= 0 ? "Crédito da Ruphus" : "Ajuste da Ruphus", detalhe: `${diaCurto(c.em)}${c.motivo ? ` · ${c.motivo}` : ""}` };
  if (c.tipo === "aviso") return { titulo: "Aviso de saldo baixo", detalhe: `${diaCurto(c.em)} ${hora(c.em)}` };
  return { titulo: c.tipo, detalhe: diaCurto(c.em) };
}

/** Extrato do saldo: recargas, consumo do dia, devoluções, ajustes e avisos. */
export function Extrato({ creditos, limite }: { creditos: CreditoTela[]; limite?: number }) {
  const { brl } = useValores();
  const [todos, setTodos] = useState(false);
  if (!creditos.length) return <p className="text-sm text-muted-foreground">Nada no extrato ainda. Recargas, o consumo de cada dia e os créditos da Ruphus aparecem aqui.</p>;
  const lista = todos || !limite ? creditos : creditos.slice(0, limite);
  return (
    <div className="grid gap-2">
      <ul className="divide-y">
        {lista.map((c) => {
          const r = rotulo(c, brl);
          return (
            <li key={c.id} className="flex items-center justify-between gap-4 py-3">
              <div className="grid min-w-0 gap-0.5">
                <span className="text-sm font-medium">{r.titulo}</span>
                <span className="truncate text-[13px] text-muted-foreground">{r.detalhe}</span>
              </div>
              <div className="grid shrink-0 justify-items-end gap-0.5 tabular-nums">
                <span className={cn("text-sm font-semibold", c.valorCents > 0 ? "text-emerald-700 dark:text-emerald-400" : c.valorCents < 0 ? "" : "text-muted-foreground")}>
                  {c.valorCents > 0 ? "+ " : c.valorCents < 0 ? "− " : ""}
                  {brl(Math.abs(c.valorCents))}
                </span>
                <span className="text-xs text-muted-foreground">saldo {brl(c.saldoAposCents)}</span>
              </div>
            </li>
          );
        })}
      </ul>
      {limite && creditos.length > limite && !todos && (
        <button type="button" onClick={() => setTodos(true)} className="min-h-11 justify-self-start rounded-lg px-1 text-sm font-medium underline underline-offset-4">
          Ver mais ({creditos.length - limite})
        </button>
      )}
    </div>
  );
}
