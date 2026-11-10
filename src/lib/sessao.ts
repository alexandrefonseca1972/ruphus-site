"use client";

import { signOut } from "firebase/auth";
import { useCallback, useEffect, useRef, useState } from "react";
import { auth } from "@/lib/firebase";
import { faseDaSessao, MINUTOS_MAX } from "@/lib/limites";

export { MINUTOS_MAX };

/** Logout automático depois de X minutos parado, com X definido pelo admin da
 *  plataforma em config/sessao. 0 (o padrão) desliga.
 *
 *  A conta é por relógio, não por setTimeout: aba em segundo plano tem o timer
 *  estrangulado pelo navegador, e o computador que dorme não dispara nada.
 *
 *  O último toque é um só para todas as abas (localStorage): o signOut vale para o
 *  navegador inteiro, e a aba do Caixa esquecida aberta não pode deslogar quem
 *  está trabalhando na aba da agenda. */

/** Sai da conta e apaga do aparelho os dados que o painel guardou para funcionar
 *  sem internet. O Firestore é carregado só aqui, e só se a página já o usava:
 *  o login e o admin não o baixam. Termina recarregando em /login: o Firestore encerrado
 *  não volta, e navegar sem recarregar (router) deixava o painel seguinte quebrado com
 *  "The client has already been terminated".
 *
 *  O destino vem daqui, e não dos listeners de sessão: o signOut também os acorda, e o
 *  router.replace deles perde para esta recarga.
 *
 *  manterPush: o logout por inatividade não cancela os avisos de agendamento — a pessoa
 *  não escolheu sair, só ficou parada. Só o "Sair" de quem escolheu sair cancela. */
export async function sair(destino = "/login", { manterPush = false } = {}) {
  if (!manterPush) {
    // aparelho compartilhado: quem entrar depois não recebe os avisos deste negócio
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      await (await reg?.pushManager.getSubscription())?.unsubscribe();
    } catch {
      // sem service worker ou sem push: nada inscrito
    }
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
/** O último toque de todas as abas. Chave fixa: o Firebase Auth tem um usuário por navegador. */
const CHAVE = "sessao:ultimoToque";
/** Gravar a cada rolagem seria escrever no disco o tempo todo; 5 s não mudam um prazo de minutos. */
const GRAVAR_A_CADA = 5_000;
/** Diálogo aberto é alguém no meio de uma tarefa (lendo, preenchendo): não está parado. */
const DIALOGO = "dialog[open], [role=dialog], [role=alertdialog]";

const lerToque = () => {
  try {
    return Number(localStorage.getItem(CHAVE)) || 0;
  } catch {
    return 0; // sem localStorage (bloqueado): vale o relógio desta aba
  }
};
const gravarToque = (t: number) => {
  try {
    localStorage.setItem(CHAVE, String(t));
  } catch {
    // sem localStorage: vale o relógio desta aba
  }
};

/** Conta o tempo parado (somando as abas) e sai sozinho. Devolve [avisando, continuar]:
 *  quem chama mostra o <AvisoSessao> um minuto antes. */
export function useAutoLogout(minutos: number) {
  const [avisando, setAvisando] = useState(false);
  const marcarRef = useRef(() => {});

  useEffect(() => {
    if (!minutos) return;
    let ultimo = Date.now();
    let gravado = 0;
    const marcar = () => {
      ultimo = Date.now();
      if (ultimo - gravado >= GRAVAR_A_CADA) {
        gravarToque((gravado = ultimo));
        setAvisando(false);
      }
    };
    marcarRef.current = marcar;
    const conferir = async () => {
      if (!auth.currentUser) return;
      if (document.visibilityState === "visible" && document.querySelector(DIALOGO)) { setAvisando(false); return marcar(); }
      const fase = faseDaSessao(Date.now() - Math.max(ultimo, lerToque()), minutos);
      setAvisando(fase === "aviso");
      if (fase !== "sair") return;
      // o motivo e a tela vão na URL: o login avisa por que saiu e volta para cá depois
      await sair(`/login?expirou=${minutos}&next=${encodeURIComponent(location.pathname)}`, { manterPush: true });
    };
    // outra aba tocou: o aviso desta some na hora, sem esperar a próxima olhada
    const daOutraAba = (e: StorageEvent) => {
      if (e.key === CHAVE) void conferir();
    };
    marcar(); // abrir a tela conta como atividade
    // capture: "scroll" não borbulha, e aqui quem rola é a gaveta e as listas,
    // não o documento — sem isto, ler uma lista longa era ficar "parado"
    for (const e of EVENTOS) addEventListener(e, marcar, { passive: true, capture: true });
    // voltar para a aba conta como atividade, mas confere antes: pode ter dormido
    addEventListener("visibilitychange", conferir);
    addEventListener("storage", daOutraAba);
    const id = setInterval(conferir, OLHADA);
    return () => {
      for (const e of EVENTOS) removeEventListener(e, marcar, { capture: true });
      removeEventListener("visibilitychange", conferir);
      removeEventListener("storage", daOutraAba);
      clearInterval(id);
      marcarRef.current = () => {};
    };
  }, [minutos]);

  const continuar = useCallback(() => {
    marcarRef.current();
    setAvisando(false);
  }, []);
  // logout desligado no meio do aviso: o aviso some junto
  return [avisando && !!minutos, continuar] as const;
}
