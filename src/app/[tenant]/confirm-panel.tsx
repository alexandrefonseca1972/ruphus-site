"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/** Confirmação dentro da linha da lista, no lugar do confirm() nativo. */
export function ConfirmPanel(props: {
  title: string;
  description?: string;
  confirmLabel: string;
  /** Mostra "Avisar o cliente pelo WhatsApp" (marcado por padrão) */
  notifyLabel?: string;
  onConfirm: (notify: boolean) => unknown | Promise<unknown>;
  onCancel: () => void;
}) {
  const { title, description, confirmLabel, notifyLabel, onConfirm, onCancel } = props;
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Foco no painel para quem navega por teclado; Esc desiste
  useEffect(() => ref.current?.focus(), []);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alertdialog"
      aria-label={title}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
      className="grid gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm outline-none"
    >
      <div>
        <p className="font-medium">{title}</p>
        {description && <p className="text-muted-foreground">{description}</p>}
      </div>
      {notifyLabel && (
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4 accent-primary" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          {notifyLabel}
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="destructive"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm(notify);
            } finally {
              setBusy(false);
            }
          }}
        >
          {confirmLabel}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Voltar
        </Button>
      </div>
    </div>
  );
}
