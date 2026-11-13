"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useState } from "react";
import { orderBy, where } from "firebase/firestore";
import { useValores } from "@/lib/valores";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/form-message";
import { ehVale, Lancamento, mesDaComissao } from "@/lib/financeiro";
import { usePaginatedCollection } from "@/lib/use-paginated-collection";

const nomeCurto = (mes: string) => {
  const s = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${mes}-15T12:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1).replace(".", "");
};

export function ComissoesHistorico({ tenantId, staffId, nome, pct, guardado, onClose }: { tenantId: string; staffId: string; nome: string; pct: number; guardado: number; onClose: () => void }) {
  const { brl } = useValores();
  const [tentativa, setTentativa] = useState(0);
  const { items: itens, error: erro, descartados, hasMore, loadMore, busy } = usePaginatedCollection(tenantId, "lancamentos", Lancamento, [where("staffId", "==", staffId), orderBy("data", "desc")], `${staffId}/${tentativa}`);
  const meses = new Map<string, { faturou: number; pago?: number; vale: number; abatido: number; estornado: number }>();
  for (const l of itens ?? []) {
    const mesDaLinha = l.tipo === "entrada" ? mesDaComissao(l) : l.mes;
    if (!mesDaLinha) continue;
    const m = meses.get(mesDaLinha) ?? { faturou: 0, vale: 0, abatido: 0, estornado: 0 };
    if (l.tipo === "entrada") m.faturou += l.valorCents;
    else if (l.id.startsWith("cm-")) {
      m.pago = l.valorCents;
      m.abatido = l.descontoCents ?? 0;
    } else if (ehVale(l.id)) m.vale += l.valorCents;
    else if (l.estornoDe) m.estornado += l.valorCents;
    meses.set(mesDaLinha, m);
  }
  const linhas = [...meses].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12);
  const totalPago = linhas.reduce((t, [, m]) => t + (m.pago ?? 0) + m.vale, 0);

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 grid max-h-[92dvh] gap-5 overflow-y-auto overscroll-contain rounded-t-2xl border bg-popover p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-popover-foreground shadow-xl outline-none sm:inset-y-0 sm:right-0 sm:left-auto sm:h-dvh sm:max-h-none sm:w-full sm:max-w-[440px] sm:rounded-none sm:rounded-l-2xl sm:p-6">
          <div className="grid gap-1">
            <Dialog.Title className="font-serifa text-2xl leading-tight">Comissões de {nome}</Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">
              {pct ? `${String(pct).replace(".", ",")}% hoje` : "Sem % definido"}
              {guardado > 0 && ` · ${brl(guardado)} de vale e estorno a descontar no próximo pagamento`}
              {guardado < 0 && ` · ${brl(-guardado)} de estorno desfeito a devolver no próximo pagamento`}
            </Dialog.Description>
          </div>
          {descartados.length > 0 && <FormMessage tone="warning">Alguns registros não puderam ser lidos e ficaram fora deste resumo.</FormMessage>}
          {erro && <FormMessage><span className="grid flex-1 gap-2">{erro}<Button variant="outline" size="sm" className="h-10 w-fit bg-card" onClick={itens?.length ? loadMore : () => setTentativa((t) => t + 1)}>Tentar novamente</Button></span></FormMessage>}
          {!itens && !erro ? <p role="status" className="text-sm text-muted-foreground">Carregando…</p> : linhas.length === 0 ? <p className="text-sm text-muted-foreground">Nada recebido pela agenda ainda.</p> : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm tabular-nums">
                <thead className="bg-muted/40 text-[13px] text-muted-foreground"><tr><th scope="col" className="px-3 py-2 text-left font-normal">Mês</th><th scope="col" className="px-3 py-2 text-right font-normal">Faturou</th><th scope="col" className="px-3 py-2 text-right font-normal">Comissão paga</th></tr></thead>
                <tbody>{linhas.map(([mes, m]) => <tr key={mes} className="border-t align-top"><th scope="row" className="px-3 py-2.5 text-left font-medium">{nomeCurto(mes)}</th><td className="px-3 py-2.5 text-right">{brl(m.faturou)}{m.estornado > 0 && <span className="block text-[13px] text-muted-foreground">− {brl(m.estornado)} estornado</span>}</td><td className="px-3 py-2.5 text-right">{m.pago === undefined && !m.vale ? <span className="text-muted-foreground">não paga</span> : brl((m.pago ?? 0) + m.vale)}{m.vale > 0 && <span className="block text-[13px] text-muted-foreground">{brl(m.vale)} em vale{m.pago === undefined ? " · resto não pago" : ""}</span>}{m.abatido > 0 && <span className="block text-[13px] text-muted-foreground">− {brl(m.abatido)} de vale e estorno</span>}{m.abatido < 0 && <span className="block text-[13px] text-muted-foreground">+ {brl(-m.abatido)} de estorno desfeito</span>}</td></tr>)}</tbody>
                <tfoot><tr className="border-t font-semibold"><th scope="row" className="px-3 py-2.5 text-left">Total exibido</th><td className="px-3 py-2.5 text-right">{brl(linhas.reduce((t, [, m]) => t + m.faturou - m.estornado, 0))}</td><td className="px-3 py-2.5 text-right">{brl(totalPago)}</td></tr></tfoot>
              </table>
            </div>
          )}
          {hasMore && <Button variant="outline" className="h-11" disabled={busy} onClick={loadMore}>{busy ? "Carregando…" : "Carregar mais 30 registros"}</Button>}
          <div className="flex justify-end"><Button type="button" variant="outline" className="h-11 px-4" onClick={onClose}>Fechar</Button></div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
