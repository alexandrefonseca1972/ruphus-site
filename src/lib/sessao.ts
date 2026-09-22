"use client";

import { signOut } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";

/** Logout automático depois de X minutos parado, com X definido pelo admin da
 *  plataforma em config/sessao. 0 (o padrão) desliga.
 *
 *  A conta é por relógio, não por setTimeout: aba em segundo plano tem o timer
 *  estrangulado pelo navegador, e o computador que dorme não dispara nada. */

export const MINUTOS_MAX = 720;

const EVENTOS = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
const OLHADA = 15_000;

export function useAutoLogout() {
  const [minutos, setMinutos] = useState(0);

  useEffect(
    () =>
      onSnapshot(
        doc(db, "config", "sessao"),
        (d) => setMinutos(Number(d.get("minutos")) || 0),
        () => setMinutos(0), // sem permissão ou offline: não tranca ninguém fora
      ),
    [],
  );

  useEffect(() => {
    if (!minutos) return;
    const limite = minutos * 60_000;
    let ultimo = Date.now();
    const marcar = () => {
      ultimo = Date.now();
    };
    const conferir = async () => {
      if (Date.now() - ultimo < limite || !auth.currentUser) return;
      await signOut(auth).catch(() => {});
      // Recarga de verdade, não router.push: sessão encerrada tem de limpar o
      // que já está em memória na tela (listas, gaveta aberta, rascunhos).
      window.location.replace(`/login?expirou=${minutos}`);
    };
    for (const e of EVENTOS) addEventListener(e, marcar, { passive: true });
    // voltar para a aba conta como atividade, mas confere antes: pode ter dormido
    addEventListener("visibilitychange", conferir);
    const id = setInterval(conferir, OLHADA);
    return () => {
      for (const e of EVENTOS) removeEventListener(e, marcar);
      removeEventListener("visibilitychange", conferir);
      clearInterval(id);
    };
  }, [minutos]);

  return minutos;
}
