"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

// O painel como app: registra o service worker, convida a instalar e avisa sem rede.
// O convite some depois de instalado ou dispensado (volta em 30 dias).

const DISPENSADO = "ruphus.instalarDispensado";
const TRINTA_DIAS = 30 * 24 * 60 * 60 * 1000;

/** O evento que o Chrome (Android e computador) dispara quando o app pode ser instalado */
type ConviteInstalar = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

/** Como o painel está aberto agora. Só roda no navegador: o layout mostra o painel
 *  depois do login, então este componente nunca é renderizado no servidor. */
function ambiente() {
  const instalado = matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  let dispensado = false;
  try {
    dispensado = Date.now() - Number(localStorage.getItem(DISPENSADO) ?? 0) < TRINTA_DIAS;
  } catch {
    // sem localStorage: o convite aparece, e "Agora não" só vale nesta visita
  }
  // Safari do iPhone/iPad não tem o evento de instalar: lá o caminho é pelo menu Compartilhar
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return { pode: !instalado && !dispensado, ios };
}

const assinarRede = (avisar: () => void) => {
  addEventListener("online", avisar);
  addEventListener("offline", avisar);
  return () => {
    removeEventListener("online", avisar);
    removeEventListener("offline", avisar);
  };
};

export function AppInstalado() {
  const [{ pode, ios }] = useState(ambiente);
  const [convite, setConvite] = useState<ConviteInstalar | null>(null);
  const [mostrar, setMostrar] = useState(pode);
  const semRede = useSyncExternalStore(assinarRede, () => !navigator.onLine, () => false);

  useEffect(() => {
    // em desenvolvimento o cache do service worker esconderia as mudanças do código
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    const aoConvidar = (e: Event) => {
      e.preventDefault();
      setConvite(e as ConviteInstalar);
    };
    const aoInstalar = () => setMostrar(false);
    addEventListener("beforeinstallprompt", aoConvidar);
    addEventListener("appinstalled", aoInstalar);
    return () => {
      removeEventListener("beforeinstallprompt", aoConvidar);
      removeEventListener("appinstalled", aoInstalar);
    };
  }, []);

  function dispensar() {
    setMostrar(false);
    try {
      localStorage.setItem(DISPENSADO, String(Date.now()));
    } catch {
      // sem localStorage: vale só nesta visita
    }
  }

  async function instalar() {
    if (!convite) return;
    await convite.prompt();
    const { outcome } = await convite.userChoice;
    setConvite(null);
    if (outcome === "accepted") setMostrar(false);
  }

  return (
    <>
      {semRede && (
        <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          Sem conexão. Você está vendo o que ficou salvo neste aparelho; as mudanças sobem quando a internet voltar.
        </p>
      )}
      {mostrar && (convite || ios) && (
        <section aria-labelledby="instalar-titulo" className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- ícone fixo de 44px em public/ */}
          <img src="/app/icone-192.png" alt="" width={44} height={44} className="size-11 shrink-0 rounded-[10px]" />
          <div className="min-w-0 flex-1 basis-56">
            <h2 id="instalar-titulo" className="text-[15px] font-semibold">Instale o painel no celular</h2>
            <p className="text-sm text-muted-foreground">
              {convite
                ? "Abre direto da tela inicial, em tela cheia, e a agenda funciona mesmo com sinal fraco."
                : <>No Safari, toque em <b className="font-medium text-foreground">Compartilhar</b> e depois em <b className="font-medium text-foreground">Adicionar à Tela de Início</b>.</>}
            </p>
          </div>
          <div className="flex gap-2 max-sm:w-full">
            <Button variant="ghost" onClick={dispensar} className="h-11 px-4 max-sm:flex-1">Agora não</Button>
            {convite && <Button onClick={instalar} className="h-11 px-5 max-sm:flex-1">Instalar</Button>}
          </div>
        </section>
      )}
    </>
  );
}
