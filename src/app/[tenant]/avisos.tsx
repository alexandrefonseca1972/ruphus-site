"use client";

import { useCallback, useEffect, useState } from "react";
import { idToken } from "@/lib/firebase";
import { cancelarAvisosAction, inscreverAvisosAction } from "./actions";

// Avisos de novo agendamento neste aparelho (push). Cada pessoa liga no próprio
// celular; o servidor guarda a inscrição e manda o aviso quando um cliente agenda.

const CHAVE = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/** A chave pública VAPID (base64url) no formato que o pushManager pede. */
function chaveBinaria(base64url: string) {
  const b64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Push só existe com service worker (produção) e, no iPhone, com o painel instalado. */
function suportaPush() {
  if (!CHAVE || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return false;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const instalado = matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  return !ios || instalado;
}

export type Avisos = {
  /** este navegador consegue receber avisos */
  suportado: boolean;
  /** null enquanto descobre se este aparelho já está inscrito */
  ativo: boolean | null;
  /** a pessoa bloqueou as notificações no navegador: só ela desfaz, nas configurações */
  bloqueado: boolean;
  ocupado: boolean;
  erro: string | null;
  ligar: () => Promise<void>;
  desligar: () => Promise<void>;
};

export function useAvisos(tenantId: string): Avisos {
  const [suportado] = useState(suportaPush);
  const [ativo, setAtivo] = useState<boolean | null>(suportado ? null : false);
  const [bloqueado, setBloqueado] = useState(() => "Notification" in window && Notification.permission === "denied");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!suportado) return;
    let atual = true;
    navigator.serviceWorker.ready
      .then((r) => r.pushManager.getSubscription())
      .then((s) => atual && setAtivo(!!s))
      .catch(() => atual && setAtivo(false));
    return () => {
      atual = false;
    };
  }, [suportado]);

  const ligar = useCallback(async () => {
    setErro(null);
    setOcupado(true);
    try {
      const permissao = await Notification.requestPermission();
      if (permissao !== "granted") {
        setBloqueado(permissao === "denied");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveBinaria(CHAVE) }));
      const r = await inscreverAvisosAction(await idToken(), { tenantId, inscricao: sub.toJSON() });
      if (!r.ok) throw new Error(r.error);
      setAtivo(true);
    } catch {
      setErro("Não foi possível ligar os avisos. Verifique a conexão e tente de novo.");
    } finally {
      setOcupado(false);
    }
  }, [tenantId]);

  const desligar = useCallback(async () => {
    setErro(null);
    setOcupado(true);
    try {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (sub) {
        await cancelarAvisosAction(await idToken(), { tenantId, endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setAtivo(false);
    } catch {
      setErro("Não foi possível desligar os avisos. Tente de novo.");
    } finally {
      setOcupado(false);
    }
  }, [tenantId]);

  return { suportado, ativo, bloqueado, ocupado, erro, ligar, desligar };
}
