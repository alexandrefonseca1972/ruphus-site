"use client";

import { collection, onSnapshot, orderBy, query, Timestamp, where } from "firebase/firestore";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { db } from "@/lib/firebase-db";
import { formatTime, TIMEZONE } from "@/lib/datetime";
import { useTenant } from "./painel-layout";

// Som e aviso na tela quando um cliente marca pelo link com o painel aberto. Com o painel
// fechado (ou o celular de tela apagada) quem avisa é o push (avisos.server). Só os do link:
// o painel marca sempre por plano (planId), e quem marcou ali não precisa ser avisado.

// ─── preferência: por aparelho, ligada por padrão ───────────────────────────
const CHAVE = "ruphus.somAgendamento";
const EVENTO = "ruphus:som-agendamento";
const lerSom = () => {
  try {
    return localStorage.getItem(CHAVE) !== "0";
  } catch {
    return true;
  }
};
const assinarSom = (avisar: () => void) => {
  addEventListener(EVENTO, avisar);
  addEventListener("storage", avisar); // outra aba mudou
  return () => {
    removeEventListener(EVENTO, avisar);
    removeEventListener("storage", avisar);
  };
};
export const useSomLigado = () => useSyncExternalStore(assinarSom, lerSom, () => true);
export function ligarSom(ligado: boolean) {
  try {
    localStorage.setItem(CHAVE, ligado ? "1" : "0");
  } catch {
    // sem localStorage (aba anônima antiga): vale até recarregar
  }
  dispatchEvent(new Event(EVENTO));
  if (ligado) tocar(); // amostra: e o toque já libera o áudio no navegador
}

// ─── o som: dois tons curtos gerados aqui, sem arquivo para baixar ──────────
let audio: AudioContext | null = null;
const contexto = () => {
  if (typeof AudioContext === "undefined") return null;
  audio ??= new AudioContext();
  return audio;
};
/** O navegador só toca depois de um toque na página: o primeiro toque destrava. */
const destravado = () => contexto()?.state === "running";

function tocar() {
  const ctx = contexto();
  if (!ctx) return;
  void ctx.resume().catch(() => {});
  const t = ctx.currentTime;
  for (const [i, freq] of [880, 1320].entries()) {
    const osc = ctx.createOscillator();
    const vol = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const ini = t + i * 0.16;
    vol.gain.setValueAtTime(0.0001, ini);
    vol.gain.exponentialRampToValueAtTime(0.25, ini + 0.02);
    vol.gain.exponentialRampToValueAtTime(0.0001, ini + 0.45);
    osc.connect(vol).connect(ctx.destination);
    osc.start(ini);
    osc.stop(ini + 0.5);
  }
}

type Novo = { id: string; nome: string; servico: string; quando: Date };

export function AvisoNovoAgendamento() {
  const tenant = useTenant();
  const somLigado = useSomLigado();
  const somRef = useRef(somLigado);
  useEffect(() => {
    somRef.current = somLigado;
  }, [somLigado]);
  const [novos, setNovos] = useState<Novo[]>([]);
  const [bloqueado, setBloqueado] = useState(false);
  // quem é da equipe ouve só os horários dele, como mexe só neles
  const soDe = !tenant.podeGerir && tenant.staffId ? tenant.staffId : null;

  // o primeiro toque em qualquer lugar destrava o áudio para depois
  useEffect(() => {
    const destravar = () => void contexto()?.resume().then(() => setBloqueado(false)).catch(() => {});
    addEventListener("pointerdown", destravar, { capture: true });
    addEventListener("keydown", destravar, { capture: true });
    return () => {
      removeEventListener("pointerdown", destravar, { capture: true });
      removeEventListener("keydown", destravar, { capture: true });
    };
  }, []);

  useEffect(() => {
    // 5 min para trás cobre relógio do aparelho adiantado; a primeira leitura só marca o que já havia
    const desde = Timestamp.fromMillis(Date.now() - 5 * 60_000);
    let primeira = true;
    return onSnapshot(
      query(collection(db, "tenants", tenant.id, "appointments"), where("createdAt", ">=", desde), orderBy("createdAt")),
      (snap) => {
        if (primeira) {
          primeira = false;
          return;
        }
        const chegaram = snap
          .docChanges()
          .filter((c) => c.type === "added" && !c.doc.metadata.hasPendingWrites)
          .map((c) => ({ id: c.doc.id, d: c.doc.data() }))
          .filter(({ d }) => !d.planId && d.status === "booked" && (!soDe || d.staffId === soDe) && d.start instanceof Timestamp)
          .map(({ id, d }): Novo => ({ id, nome: String(d.customerName ?? "Cliente"), servico: String(d.serviceName ?? ""), quando: (d.start as Timestamp).toDate() }));
        if (!chegaram.length) return;
        setNovos((atual) => [...chegaram, ...atual].slice(0, 3));
        if (somRef.current) {
          tocar();
          setBloqueado(!destravado());
        }
      },
      // sem a escuta o painel segue normal; o push continua avisando
      (e) => console.warn("[aviso de agendamento] escuta caiu", e),
    );
  }, [tenant.id, soDe]);

  // cada aviso some sozinho em 15 s
  useEffect(() => {
    if (!novos.length) return;
    const id = setTimeout(() => setNovos((n) => n.slice(0, -1)), 15_000);
    return () => clearTimeout(id);
  }, [novos]);

  if (!novos.length) return null;
  const fechar = (id: string) => setNovos((n) => n.filter((x) => x.id !== id));
  return (
    <div aria-live="polite" className="fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 grid gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-96">
      {novos.map((n) => (
        <div key={n.id} role="status" className="flex items-start gap-3 rounded-xl border bg-card p-4 text-sm shadow-lg">
          <span aria-hidden="true" className="mt-1 size-2.5 shrink-0 rounded-full bg-emerald-500" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Novo agendamento</p>
            <p className="truncate">
              {n.nome}
              {n.servico && ` · ${n.servico}`}
            </p>
            <p className="text-muted-foreground">
              {n.quando.toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short", timeZone: TIMEZONE })} às {formatTime(n.quando)}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <Link href={`/${tenant.id}`} onClick={() => fechar(n.id)} className="font-medium underline underline-offset-4">
                Ver na agenda
              </Link>
              {bloqueado && somLigado && (
                <button type="button" onClick={() => tocar()} className="font-medium underline underline-offset-4">
                  Ativar som
                </button>
              )}
            </div>
          </div>
          <button type="button" onClick={() => fechar(n.id)} aria-label="Fechar aviso" className="-m-1 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
