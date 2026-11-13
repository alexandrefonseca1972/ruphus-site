"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useRef, useState } from "react";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { FormMessage } from "@/components/form-message";
import { errorMessage } from "@/lib/auth-errors";
import { cn } from "@/lib/utils";

/** Confirmação modal no AlertDialog do shadcn, com a opção de avisar o cliente e o "Aguarde…"
 * enquanto a ação roda. Foco em "Voltar" (o lado seguro), Esc desiste. Aberta enquanto montada.
 * Para um confirm() simples, `confirmar` (src/components/confirmar.tsx). */
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
  const [erro, setErro] = useState("");
  const voltar = useRef<HTMLButtonElement>(null);
  const Icone = tom === "perigo" ? TriangleAlert : CircleCheck;

  return (
    <AlertDialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <AlertDialogContent initialFocus={voltar} className="max-w-[calc(100%-2rem)] gap-5 p-5 sm:max-w-md sm:p-6" aria-busy={busy}>
        <AlertDialogHeader>
          <AlertDialogMedia className={cn("size-11 rounded-xl", tom === "perigo" ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200")}>
            <Icone className="size-6" strokeWidth={1.8} aria-hidden="true" />
          </AlertDialogMedia>
          <AlertDialogTitle className="font-serifa text-2xl leading-tight">{title}</AlertDialogTitle>
          {description && <AlertDialogDescription className="text-left leading-relaxed">{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        {notifyLabel && (
          <label className="flex min-h-11 items-center gap-2.5 rounded-lg border px-3.5 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={notify} disabled={busy} onChange={(e) => setNotify(e.target.checked)} />
            {notifyLabel}
          </label>
        )}
        {erro && <FormMessage>{erro}</FormMessage>}
        <AlertDialogFooter className="-mx-5 -mb-5 p-4 sm:-mx-6 sm:-mb-6">
          <AlertDialogCancel ref={voltar} className="h-11 px-4" disabled={busy}>
            Voltar
          </AlertDialogCancel>
          <AlertDialogAction
            className={tom === "perigo" ? "h-11 bg-destructive px-4 text-white hover:bg-destructive/90" : "h-11 px-4"}
            disabled={busy}
            onClick={async () => {
              if (busy) return;
              setErro("");
              setBusy(true);
              try {
                await onConfirm(notify);
              } catch (err) {
                setErro(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Aguarde…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
