"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { useAvisos } from "./avisos";
import { useTenant } from "./layout";

// O painel como app: registra o service worker, convida a instalar e avisa sem rede.
// O convite some depois de instalado ou dispensado (volta em 30 dias); dispensado, a opção
// fica fixa em Meu negócio.

const DISPENSADO = "ruphus.instalarDispensado";
const AVISOS_DISPENSADO = "ruphus.avisosDispensado";
const TRINTA_DIAS = 30 * 24 * 60 * 60 * 1000;

/** O evento que o Chrome (Android e computador) dispara quando o app pode ser instalado */
type ConviteInstalar = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

// O Chrome manda o convite de instalar uma vez por carregamento, às vezes antes de a tela
// montar. Guardado aqui fora, serve à faixa do topo e ao cartão fixo de Meu negócio.
type Instalacao = { convite: ConviteInstalar | null; instalado: boolean; dispensado: boolean; ios: boolean };
let instalacao: Instalacao | null = null;
const ouvintes = new Set<() => void>();
const NO_SERVIDOR: Instalacao = { convite: null, instalado: true, dispensado: true, ios: false };

const dispensadoEm = (chave: string) => {
  try {
    return Date.now() - Number(localStorage.getItem(chave) ?? 0) < TRINTA_DIAS;
  } catch {
    // sem localStorage: os convites aparecem, e "Agora não" só vale nesta visita
    return false;
  }
};
const marcarDispensado = (chave: string) => {
  try {
    localStorage.setItem(chave, String(Date.now()));
  } catch {
    // sem localStorage: vale só nesta visita
  }
};

/** Como o painel está aberto agora. Só roda no navegador. */
const atual = () =>
  (instalacao ??= {
    convite: null,
    instalado: matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true,
    dispensado: dispensadoEm(DISPENSADO),
    // Safari do iPhone/iPad não tem o evento de instalar: lá o caminho é pelo menu Compartilhar
    ios: /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
  });
const mudar = (m: Partial<Instalacao>) => {
  instalacao = { ...atual(), ...m };
  ouvintes.forEach((f) => f());
};
const assinar = (f: () => void) => (ouvintes.add(f), () => void ouvintes.delete(f));

if (typeof window !== "undefined") {
  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    mudar({ convite: e as ConviteInstalar });
  });
  addEventListener("appinstalled", () => mudar({ convite: null, instalado: true }));
}

/** Dá para instalar daqui (pelo botão no Chrome, pelo menu no Safari) e o que fazer. */
function useInstalar() {
  const i = useSyncExternalStore(assinar, atual, () => NO_SERVIDOR);
  return {
    ...i,
    pode: !i.instalado && (!!i.convite || i.ios),
    async instalar() {
      if (!i.convite) return;
      await i.convite.prompt();
      const { outcome } = await i.convite.userChoice;
      // o convite só serve uma vez
      mudar({ convite: null, instalado: outcome === "accepted" });
    },
    dispensar() {
      mudar({ dispensado: true });
      marcarDispensado(DISPENSADO);
    },
  };
}

const textoInstalar = (convite: boolean) =>
  convite
    ? "Abre direto da tela inicial, em tela cheia, e a agenda funciona mesmo com sinal fraco."
    : <>No Safari, toque em <b className="font-medium text-foreground">Compartilhar</b> e depois em <b className="font-medium text-foreground">Adicionar à Tela de Início</b>.</>;

/** Em Meu negócio, para quem dispensou a faixa do topo: a opção não some. */
export function InstalarPainel() {
  const { pode, dispensado, convite, instalar } = useInstalar();
  if (!pode || !dispensado) return null;
  return (
    <section aria-labelledby="instalar-fixo-titulo" className="grid gap-2.5 border-t pt-4">
      <h2 id="instalar-fixo-titulo" className="text-[15px] font-semibold">Painel no celular</h2>
      <p className="text-sm text-muted-foreground">{textoInstalar(!!convite)}</p>
      {convite && <Button variant="outline" onClick={instalar} className="h-11">Instalar o painel</Button>}
    </section>
  );
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
  const { pode, dispensado, convite, instalar, dispensar } = useInstalar();
  const mostrar = pode && !dispensado;
  const avisos = useAvisos(useTenant().id);
  const [mostrarAvisos, setMostrarAvisos] = useState(() => !dispensadoEm(AVISOS_DISPENSADO));
  const semRede = useSyncExternalStore(assinarRede, () => !navigator.onLine, () => false);

  useEffect(() => {
    // em desenvolvimento o cache do service worker esconderia as mudanças do código
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  function dispensarAvisos() {
    setMostrarAvisos(false);
    marcarDispensado(AVISOS_DISPENSADO);
  }

  return (
    <>
      {semRede && (
        <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          Sem conexão. Você está vendo o que ficou salvo neste aparelho; as mudanças sobem quando a internet voltar.
        </p>
      )}
      {!mostrar && mostrarAvisos && avisos.suportado && avisos.ativo === false && !avisos.bloqueado && (
        <section aria-labelledby="avisos-titulo" className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
          </svg>
          <div className="min-w-0 flex-1 basis-56">
            <h2 id="avisos-titulo" className="text-[15px] font-semibold">Receba um aviso a cada novo agendamento</h2>
            <p className="text-sm text-muted-foreground">
              {avisos.erro ?? "Chega neste aparelho na hora em que o cliente agenda pelo link. Dá para desligar no menu da sua conta."}
            </p>
          </div>
          <div className="flex gap-2 max-sm:w-full">
            <Button variant="ghost" onClick={dispensarAvisos} className="h-11 px-4 max-sm:flex-1">Agora não</Button>
            <Button onClick={avisos.ligar} disabled={avisos.ocupado} className="h-11 px-5 max-sm:flex-1">{avisos.ocupado ? "Ligando…" : "Ligar avisos"}</Button>
          </div>
        </section>
      )}
      {mostrar && (
        <section aria-labelledby="instalar-titulo" className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- ícone fixo de 44px em public/ */}
          <img src="/app/icone-192.png" alt="" width={44} height={44} className="size-11 shrink-0 rounded-[10px]" />
          <div className="min-w-0 flex-1 basis-56">
            <h2 id="instalar-titulo" className="text-[15px] font-semibold">Instale o painel no celular</h2>
            <p className="text-sm text-muted-foreground">
              {textoInstalar(!!convite)}
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
