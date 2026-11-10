"use client";

import { signOut } from "firebase/auth";
import { useEffect } from "react";
import { auth } from "@/lib/firebase";
import { MINUTOS_MAX } from "@/lib/limites";

export { MINUTOS_MAX };

/** Logout automático depois de X minutos parado, com X definido pelo admin da
 *  plataforma em config/sessao. 0 (o padrão) desliga.
 *
 *  A conta é por relógio, não por setTimeout: aba em segundo plano tem o timer
 *  estrangulado pelo navegador, e o computador que dorme não dispara nada. */

/** Sai da conta e apaga do aparelho os dados que o painel guardou para funcionar
 *  sem internet. O Firestore é carregado só aqui, e só se a página já o usava:
 *  o login e o admin não o baixam. Termina recarregando em /login: o Firestore encerrado
 *  não volta, e navegar sem recarregar (router) deixava o painel seguinte quebrado com
 *  "The client has already been terminated".
 *
 *  O destino vem daqui, e não dos listeners de sessão: o signOut também os acorda, e o
 *  router.replace deles perde para esta recarga. */
export async function sair(destino = "/login") {
  // aparelho compartilhado: quem entrar depois não recebe os avisos deste negócio
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await (await reg?.pushManager.getSubscription())?.unsubscribe();
  } catch {
    // sem service worker ou sem push: nada inscrito
  }
  await signOut(auth).catch(() => {});
  try {
    const { limparCacheLocal } = await import("@/lib/firebase-db");
    await limparCacheLocal();
  } catch {
    // sem IndexedDB (aba anônima antiga): não havia cache para apagar
  }
  window.location.replace(destino);
}

const EVENTOS = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
const OLHADA = 15_000;

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
      // o motivo e a tela vão na URL: o login avisa por que saiu e volta para cá depois
      await sair(`/login?expirou=${minutos}&next=${encodeURIComponent(location.pathname)}`);
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
