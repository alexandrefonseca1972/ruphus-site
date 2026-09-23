"use client";

import { signOut } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { MINUTOS_MAX } from "@/lib/limites";

export { MINUTOS_MAX };

/** Logout automático depois de X minutos parado, com X definido pelo admin da
 *  plataforma em config/sessao. 0 (o padrão) desliga.
 *
 *  A conta é por relógio, não por setTimeout: aba em segundo plano tem o timer
 *  estrangulado pelo navegador, e o computador que dorme não dispara nada. */

/** Onde o motivo fica entre o logout e o redirecionamento. */
const MOTIVO = "ruphus.sessaoExpirou";

/** "/login" com o porquê, quando a saída foi por inatividade. Quem redireciona
 *  ao perder a sessão chama isto: o logout automático avisa por aqui. */
export function loginComMotivo(base = "/login") {
  let minutos = 0;
  try {
    minutos = Number(sessionStorage.getItem(MOTIVO)) || 0;
    if (minutos) sessionStorage.removeItem(MOTIVO);
  } catch {
    // sem sessionStorage, vai sem o aviso
  }
  return minutos ? `${base}${base.includes("?") ? "&" : "?"}expirou=${minutos}` : base;
}

const EVENTOS = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
const OLHADA = 15_000;

/** Os minutos configurados, acompanhados ao vivo.
 *
 * Quem já fala com o Firestore no cliente usa isto. O /admin não: ele recebe o
 * valor junto do resto do painel, na mesma viagem, em vez de abrir um canal só
 * para ler um documento de um campo enquanto a tela ainda está carregando. */
export function useMinutosInativo() {
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
  return minutos;
}

export function useAutoLogout(minutos: number) {
  useEffect(() => {
    if (!minutos) return;
    const limite = minutos * 60_000;
    let ultimo = Date.now();
    const marcar = () => {
      ultimo = Date.now();
    };
    const conferir = async () => {
      if (Date.now() - ultimo < limite || !auth.currentUser) return;
      // Antes do signOut: ele acorda os listeners de sessão, que mandam para
      // /login sem dizer por quê. O login lê daqui quando o parâmetro se perde.
      try {
        sessionStorage.setItem(MOTIVO, String(minutos));
      } catch {
        // navegador sem sessionStorage: resta o parâmetro na URL
      }
      await signOut(auth).catch(() => {});
      // Recarga de verdade, não router.push: sessão encerrada tem de limpar o
      // que já está em memória na tela (listas, gaveta aberta, rascunhos).
      window.location.replace(loginComMotivo());
    };
    // capture: "scroll" não borbulha, e aqui quem rola é a gaveta e as listas,
    // não o documento — sem isto, ler uma lista longa era ficar "parado"
    for (const e of EVENTOS) addEventListener(e, marcar, { passive: true, capture: true });
    // voltar para a aba conta como atividade, mas confere antes: pode ter dormido
    addEventListener("visibilitychange", conferir);
    const id = setInterval(conferir, OLHADA);
    return () => {
      for (const e of EVENTOS) removeEventListener(e, marcar, { capture: true });
      removeEventListener("visibilitychange", conferir);
      clearInterval(id);
    };
  }, [minutos]);
}
