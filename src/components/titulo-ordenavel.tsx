import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Título de coluna que ordena a lista: tocar ordena por ela, tocar de novo inverte.
 *  A seta diz o sentido; nas outras colunas, uma seta dupla clarinha avisa que dá para ordenar. */
export function TituloOrdenavel({ rotulo, ativo, sobe, onClick, className }: { rotulo: string; ativo: boolean; sobe: boolean; onClick: () => void; className?: string }) {
  const Seta = !ativo ? ArrowUpDown : sobe ? ArrowUp : ArrowDown;
  return (
    <span role="columnheader" aria-sort={ativo ? (sobe ? "ascending" : "descending") : "none"} className={className}>
      <button
        type="button"
        onClick={onClick}
        title={`Ordenar por ${rotulo.toLowerCase()}`}
        className={cn("group -mx-1 inline-flex min-h-8 items-center gap-1.5 rounded-md px-1 uppercase hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none", ativo && "text-foreground")}
      >
        {rotulo}
        <Seta aria-hidden="true" className={cn("size-3.5 shrink-0 transition-opacity", ativo ? "opacity-100" : "opacity-35 group-hover:opacity-80")} strokeWidth={2.25} />
      </button>
    </span>
  );
}
