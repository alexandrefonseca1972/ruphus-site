"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { openExternal } from "@/lib/utils";

/** Divulgação: o link de agendamento vive em bio do Instagram, status do WhatsApp e posts. */
export function ShareLink({ tenantId, name }: { tenantId: string; name: string }) {
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
    <div className="ml-auto">
      <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
        Divulgar link ↗
      </Button>
      {open && (
        <div className="absolute inset-x-2 z-10 mt-2 grid gap-3 rounded-lg border bg-background p-3 shadow-lg sm:inset-x-auto sm:right-4 sm:w-96">
          <div>
            <p className="font-medium">Link de agendamento</p>
            <p className="text-sm text-muted-foreground">Coloque na bio do Instagram, no status do WhatsApp ou mande para o cliente.</p>
          </div>
          <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="h-11 text-sm md:h-8" />
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
        </div>
      )}
    </div>
  );
}
