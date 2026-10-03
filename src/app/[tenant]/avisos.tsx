"use client";

import { useCallback, useEffect, useState } from "react";
import { idToken } from "@/lib/firebase";
import { avisosLigadosAction, cancelarAvisosAction, inscreverAvisosAction } from "./actions";

// Avisos de novo agendamento neste aparelho (push). Cada pessoa liga no próprio
// celular; o servidor guarda a inscrição e manda o aviso quando um cliente agenda.

const CHAVE = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
/** O convite e o menu da conta usam cada um o seu useAvisos: este evento mantém os dois iguais. */
const MUDOU = "ruphus:avisos";

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

  // Ligado é por negócio: a inscrição do navegador é uma só, e o servidor diz se este negócio a tem
  useEffect(() => {
    if (!suportado) return;
    let atual = true;
    navigator.serviceWorker.ready
      .then((r) => r.pushManager.getSubscription())
      .then(async (s) => {
        const r = s && (await avisosLigadosAction(await idToken(), { tenantId, endpoint: s.endpoint }));
        if (atual) setAtivo(!!r && r.ok && r.ligado);
      })
      .catch(() => atual && setAtivo(false));
    const aoMudar = (e: Event) => {
      const d = (e as CustomEvent<{ tenantId: string; ativo: boolean }>).detail;
      if (d.tenantId === tenantId) setAtivo(d.ativo);
    };
    addEventListener(MUDOU, aoMudar);
    return () => {
      atual = false;
      removeEventListener(MUDOU, aoMudar);
    };
  }, [suportado, tenantId]);

  const mudou = useCallback((ativo: boolean) => dispatchEvent(new CustomEvent(MUDOU, { detail: { tenantId, ativo } })), [tenantId]);

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
      mudou(true);
    } catch {
      setErro("Não foi possível ligar os avisos. Verifique a conexão e tente de novo.");
    } finally {
      setOcupado(false);
    }
  }, [tenantId, mudou]);

  const desligar = useCallback(async () => {
    setErro(null);
    setOcupado(true);
    try {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      // só este negócio: a inscrição do navegador continua servindo aos outros (sair() cancela tudo)
      if (sub) {
        const r = await cancelarAvisosAction(await idToken(), { tenantId, endpoint: sub.endpoint });
        if (!r.ok) throw new Error(r.error);
      }
      mudou(false);
    } catch {
      setErro("Não foi possível desligar os avisos. Tente de novo.");
    } finally {
      setOcupado(false);
    }
  }, [tenantId, mudou]);

  return { suportado, ativo, bloqueado, ocupado, erro, ligar, desligar };
}
