"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, openExternal } from "@/lib/utils";
import { QrDoLink } from "./qr-link";

/** Divulgação: o link de agendamento vive em bio do Instagram, status do WhatsApp e posts. */
/** `iconeNoCelular`: no cabeçalho vira só a seta no celular; no passo a passo o botão mantém o texto. */
export function ShareLink({ tenantId, name, iconeNoCelular = true }: { tenantId: string; name: string; iconeNoCelular?: boolean }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = typeof location === "undefined" ? "" : `${location.origin}/agendar/${tenantId}`;
  const message = `Agende seu horário na ${name} pelo link: ${url}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Sem permissão de área de transferência: o campo abaixo permite copiar à mão
      setCopied(false);
    }
  }

  return (
    <div>
      <Button variant="outline" aria-expanded={open} onClick={() => setOpen(!open)} aria-label="Divulgar link" className={cn("h-10 gap-2 px-4", iconeNoCelular && "max-sm:size-11 max-sm:px-0")}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M7 17 17 7" />
          <path d="M8 7h9v9" />
        </svg>
        <span className={cn(iconeNoCelular && "max-sm:sr-only")}>Divulgar link</span>
      </Button>
      {open && (
        <div className="absolute inset-x-2 z-30 mt-2 grid max-h-[calc(100dvh-8rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] gap-3 overflow-y-auto overscroll-contain rounded-lg border bg-background p-3 shadow-lg sm:inset-x-auto sm:right-4 sm:w-96">
          <div>
            <p className="font-medium">Link de agendamento</p>
            <p className="text-sm text-muted-foreground">Coloque na bio do Instagram, no status do WhatsApp ou mande para o cliente.</p>
          </div>
          <Input readOnly aria-label="Link de agendamento" value={url} onFocus={(e) => e.currentTarget.select()} className="h-11 text-sm md:h-8" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={copy}>{copied ? "Copiado ✓" : "Copiar link"}</Button>
            <Button size="sm" variant="outline" onClick={() => openExternal(`https://wa.me/?text=${encodeURIComponent(message)}`)}>
              Enviar no WhatsApp
            </Button>
            {typeof navigator !== "undefined" && "share" in navigator && (
              <Button size="sm" variant="outline" onClick={() => navigator.share({ title: name, text: message, url }).catch(() => {})}>
                Compartilhar
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => openExternal(url)}>Abrir página</Button>
          </div>
          {url && <QrDoLink url={url} rotulo={`Agendamento de ${name}`} arquivo={`qr-agenda-${tenantId}`} />}
        </div>
      )}
    </div>
  );
}
