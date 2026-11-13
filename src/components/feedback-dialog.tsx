"use client";

import { useRef, type ReactNode } from "react";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export type FeedbackTipo = "erro" | "aviso" | "sucesso";

const ESTILO = {
  erro: { icone: CircleAlert, titulo: "Não foi possível concluir", classe: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" },
  aviso: { icone: TriangleAlert, titulo: "Confira antes de continuar", classe: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200" },
  sucesso: { icone: CircleCheck, titulo: "Tudo certo", classe: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
};

export function FeedbackDialog({ tipo, titulo, mensagem, actions, closeLabel = "Entendi", onClose }: {
  tipo: FeedbackTipo;
  titulo?: string;
  mensagem: string;
  actions?: ReactNode;
  closeLabel?: string;
  onClose: () => void;
}) {
  const fechar = useRef<HTMLButtonElement>(null);
  const { icone: Icone, titulo: tituloPadrao, classe } = ESTILO[tipo];
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent initialFocus={fechar} className="max-w-[calc(100%-2rem)] gap-5 p-5 sm:max-w-md sm:p-6">
        <AlertDialogHeader>
          <AlertDialogMedia className={cn("size-11 rounded-xl", classe)}>
            <Icone className="size-6" strokeWidth={1.8} aria-hidden="true" />
          </AlertDialogMedia>
          <AlertDialogTitle className="font-serifa text-2xl leading-tight">{titulo ?? tituloPadrao}</AlertDialogTitle>
          <AlertDialogDescription className="text-left text-sm leading-relaxed text-balance">{mensagem}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="-mx-5 -mb-5 p-4 sm:-mx-6 sm:-mb-6">
          {actions}
          <AlertDialogCancel ref={fechar} className="h-11 px-4">{closeLabel}</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
