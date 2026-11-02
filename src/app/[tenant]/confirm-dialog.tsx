"use client";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/** Confirmação modal no AlertDialog do shadcn, com a opção de avisar o cliente e o "Aguarde…"
 * enquanto a ação roda. Foco em "Voltar" (o lado seguro), Esc desiste. Aberta enquanto montada.
 * Para um confirm() simples, `useConfirmar` (src/components/confirmar.tsx). */
export function ConfirmDialog(props: {
  title: string;
  description?: string;
  confirmLabel: string;
  /** Mostra "Avisar o cliente pelo WhatsApp" (marcado por padrão) */
  notifyLabel?: string;
  onConfirm: (notify: boolean) => unknown | Promise<unknown>;
  onCancel: () => void;
  /** "normal": a ação confirma algo bom (ex.: dinheiro recebido), sem o vermelho de perigo */
  tom?: "perigo" | "normal";
}) {
  const { title, description, confirmLabel, notifyLabel, onConfirm, onCancel, tom = "perigo" } = props;
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const voltar = useRef<HTMLButtonElement>(null);

  return (
    <AlertDialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <AlertDialogContent initialFocus={voltar} className="max-w-[calc(100%-2rem)] gap-5 p-6 sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-serifa text-2xl leading-tight">{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        {notifyLabel && (
          <label className="flex min-h-11 items-center gap-2.5 rounded-lg border px-3.5 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            {notifyLabel}
          </label>
        )}
        <AlertDialogFooter className="-mx-6 -mb-6 p-4">
          <AlertDialogCancel ref={voltar} className="h-11 px-4" disabled={busy}>
            Voltar
          </AlertDialogCancel>
          <Button
            className={tom === "perigo" ? "h-11 bg-destructive px-4 text-white hover:bg-destructive/90" : "h-11 px-4"}
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
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
