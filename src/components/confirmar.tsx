"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export type Pedido = {
  titulo: string;
  texto?: ReactNode;
  /** o verbo do botão que confirma: "Desconectar", "Enviar", "Gerar 12 sites" */
  acao: string;
  /** "perigo" (padrão): desfaz algo ou tira do ar, em vermelho. "normal": envia, gera, troca */
  tom?: "perigo" | "normal";
};

type Aberto = Pedido & { responder: (ok: boolean) => void };
let mostrar: ((p: Aberto) => void) | null = null;

function Confirmacao() {
  const [pedido, setPedido] = useState<Aberto | null>(null);
  // o pedido fica na tela durante a animação de saída: só `aberto` cai ao responder
  const [aberto, setAberto] = useState(false);
  const voltar = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    mostrar = (p) => {
      setPedido((antes) => {
        // um pedido novo com outro aberto: o de antes conta como "Voltar"
        if (antes && antes !== p) antes.responder(false);
        return p;
      });
      setAberto(true);
    };
    return () => {
      mostrar = null;
    };
  }, []);
  const fechar = (ok: boolean) => {
    pedido?.responder(ok);
    setAberto(false);
  };

  return (
    <AlertDialog open={aberto} onOpenChange={(abrir) => !abrir && fechar(false)}>
      <AlertDialogContent initialFocus={voltar} className="max-w-[calc(100%-2rem)] sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg font-semibold">{pedido?.titulo}</AlertDialogTitle>
          {pedido?.texto && <AlertDialogDescription>{pedido.texto}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel ref={voltar} className="h-11 px-4">
            Voltar
          </AlertDialogCancel>
          <Button
            className={pedido?.tom === "normal" ? "h-11 px-4" : "h-11 bg-destructive px-4 text-white hover:bg-destructive/90"}
            onClick={() => fechar(true)}
          >
            {pedido?.acao}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

let montada: Promise<void> | null = null;
/** A confirmação mora numa raiz própria, montada no primeiro uso: quem chama não precisa pôr nada
 *  no JSX, como no confirm() nativo. */
function montar() {
  return (montada ??= new Promise<void>((pronto) => {
    const lugar = document.createElement("div");
    document.body.appendChild(lugar);
    createRoot(lugar).render(<Confirmacao />);
    const esperar = () => (mostrar ? pronto() : requestAnimationFrame(esperar));
    esperar();
  }));
}

/** O confirm() da plataforma, no AlertDialog do shadcn: título e texto do painel, foco em "Voltar"
 *  (o lado seguro), Esc ou clique fora desistem. `if (!(await confirmar({ ... }))) return;` */
export async function confirmar(p: Pedido): Promise<boolean> {
  await montar();
  return new Promise<boolean>((responder) => mostrar!({ ...p, responder }));
}
