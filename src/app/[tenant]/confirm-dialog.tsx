"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/** Confirmação modal, no lugar do confirm() nativo: título e texto do painel,
 * foco em "Voltar" (o lado seguro), Esc desiste. Aberta enquanto estiver montada. */
export function ConfirmDialog(props: {
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
  const voltar = useRef<HTMLButtonElement>(null);

  return (
    <AlertDialog.Root open onOpenChange={(open) => !open && !busy && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-40 bg-black/40 transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <AlertDialog.Popup
          initialFocus={voltar}
          className="fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-5 rounded-2xl border bg-popover p-6 text-popover-foreground shadow-xl outline-none transition-all data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0"
        >
          <div className="grid gap-2">
            <AlertDialog.Title className="font-serifa text-2xl leading-tight">{title}</AlertDialog.Title>
            {description && <AlertDialog.Description className="text-sm text-muted-foreground">{description}</AlertDialog.Description>}
          </div>
          {notifyLabel && (
            <label className="flex min-h-11 items-center gap-2.5 rounded-lg border px-3.5 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              {notifyLabel}
            </label>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button ref={voltar} variant="outline" className="h-11 px-4" disabled={busy} onClick={onCancel}>
              Voltar
            </Button>
            <Button
              className="h-11 bg-destructive px-4 text-white hover:bg-destructive/90"
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
              {busy ? "Aguarde…" : confirmLabel}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
