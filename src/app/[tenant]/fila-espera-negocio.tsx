"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { EstadoEspera } from "@/lib/espera-solicitacao.server";
import { confirmar } from "@/components/confirmar";
import { Button } from "@/components/ui/button";
import { idToken } from "@/lib/firebase";
import { cancelarSolicitacaoEsperaAction, estadoEsperaAction, solicitarEsperaAction } from "./actions";
import { useTenant } from "./painel-layout";

type Resposta = { ok: true; dados: EstadoEspera } | { ok: false; error: string };

const ERRO_GERAL = "Não foi possível concluir agora. Tente de novo.";
const dataCurta = (em: number) => new Date(em).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });

/** Fila de espera: o dono pede o serviço extra; a Ruphus liga no /admin e avisa. */
export function FilaEsperaNegocio() {
  const tenant = useTenant();
  // undefined = carregando; null = a leitura falhou
  const [estado, setEstado] = useState<EstadoEspera | null | undefined>(undefined);
  const [tentativa, setTentativa] = useState(0);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    idToken()
      .then((t) => estadoEsperaAction(t, { tenantId: tenant.id }))
      .then((r: Resposta) => {
        if (vivo) setEstado(r.ok ? r.dados : null);
      })
      .catch(() => {
        if (vivo) setEstado(null);
      });
    return () => {
      vivo = false;
    };
  }, [tenant.id, tentativa]);

  async function executar(fazer: (t: string) => Promise<Resposta>) {
    setBusy(true);
    setErro(null);
    const r = await idToken().then(fazer).catch(() => null);
    setBusy(false);
    if (!r) return setErro(ERRO_GERAL);
    if (!r.ok) return setErro(r.error);
    setEstado(r.dados);
  }

  async function cancelar() {
    const ok = await confirmar({ titulo: "Cancelar o pedido?", acao: "Cancelar pedido" });
    if (ok) void executar((t) => cancelarSolicitacaoEsperaAction(t, { tenantId: tenant.id }));
  }

  let corpo;
  if (estado === undefined) {
    corpo = <p className="text-sm text-muted-foreground">Carregando…</p>;
  } else if (estado === null) {
    corpo = (
      <div className="grid gap-3">
        <p role="alert" className="text-sm text-destructive">Não foi possível carregar.</p>
        <div>
          <Button type="button" variant="outline" onClick={() => (setEstado(undefined), setTentativa((n) => n + 1))} className="h-12 px-5 text-[15px] sm:h-11 sm:text-sm">
            Tentar de novo
          </Button>
        </div>
      </div>
    );
  } else if (estado.ligado) {
    corpo = (
      <div className="grid gap-3">
        <p className="flex items-start gap-2 text-sm">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-300" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          <span>Ativo. Os horários ocupados aparecem no seu agendamento online com a opção de aviso.</span>
        </p>
        <div>
          <Link href="/ajuda#fila-espera" className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-2">
            Como funciona
          </Link>
        </div>
      </div>
    );
  } else if (estado.pedido?.status === "pendente") {
    corpo = (
      <div className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          Pedido enviado em {dataCurta(estado.pedido.em)}. A equipe Ruphus vai ativar o serviço.
        </p>
        <div>
          <Button type="button" variant="outline" disabled={busy} onClick={cancelar} className="h-12 px-5 text-[15px] sm:h-11 sm:text-sm">
            {busy ? "Cancelando…" : "Cancelar pedido"}
          </Button>
        </div>
      </div>
    );
  } else {
    corpo = (
      <div className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          Quando um horário está ocupado, o cliente pode pedir para ser avisado no WhatsApp se ele vagar. Se vagar, ele agenda com um toque. Cada aviso custa 5¢ do saldo de mensagens.
        </p>
        <div>
          <Button type="button" disabled={busy} onClick={() => executar((t) => solicitarEsperaAction(t, { tenantId: tenant.id }))} className="h-12 px-5 text-[15px] sm:h-11 sm:text-sm">
            {busy ? "Enviando…" : "Quero este serviço"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <section aria-labelledby="fila-espera-t" className="grid scroll-mt-20 gap-4 rounded-2xl border bg-card p-5 sm:p-7 lg:col-start-1">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="fila-espera-t" className="text-[15px] font-semibold">Fila de espera</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Serviço extra</span>
      </div>
      <div aria-live="polite">{corpo}</div>
      {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
    </section>
  );
}
