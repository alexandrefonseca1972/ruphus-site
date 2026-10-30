"use client";

import { Dialog } from "@base-ui/react/dialog";
import { where } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/datetime";
import { Lancamento } from "@/lib/financeiro";
import { useCollection } from "@/lib/use-collection";

const nomeCurto = (mes: string) => {
  const s = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${mes}-15T12:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1).replace(".", "");
};

/** Comissão de um profissional mês a mês: quanto faturou pela agenda, quanto foi pago,
 *  quanto de estorno foi abatido e devolvido, e o saldo de estorno ainda a descontar. */
export function ComissoesHistorico({ tenantId, staffId, nome, pct, guardado, onClose }: { tenantId: string; staffId: string; nome: string; pct: number; guardado: number; onClose: () => void }) {
  // ponytail: lê tudo do profissional e mostra os 12 meses mais recentes; com anos de histórico,
  // filtrar por mês no Firestore (índice staffId + mes)
  const [itens, erro] = useCollection(tenantId, "lancamentos", Lancamento, [where("staffId", "==", staffId)], staffId);

  const meses = new Map<string, { faturou: number; pago?: number; abatido: number; estornado: number }>();
  for (const l of itens ?? []) {
    const m = meses.get(l.mes) ?? { faturou: 0, abatido: 0, estornado: 0 };
    if (l.tipo === "entrada") m.faturou += l.valorCents;
    else if (l.id.startsWith("cm-")) {
      m.pago = l.valorCents;
      m.abatido = l.descontoCents ?? 0;
    } else if (l.estornoDe) m.estornado += l.valorCents;
    meses.set(l.mes, m);
  }
  const linhas = [...meses].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12);
  const totalPago = linhas.reduce((t, [, m]) => t + (m.pago ?? 0), 0);

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 grid max-h-[92dvh] gap-5 overflow-y-auto rounded-t-2xl border bg-popover p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-popover-foreground shadow-xl outline-none sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-6">
          <div className="grid gap-1">
            <Dialog.Title className="font-serifa text-2xl leading-tight">Comissões de {nome}</Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">
              {pct ? `${String(pct).replace(".", ",")}% hoje` : "Sem % definido"}
              {guardado > 0 && ` · ${formatBRL(guardado)} de estorno a descontar no próximo pagamento`}
              {guardado < 0 && ` · ${formatBRL(-guardado)} de estorno desfeito a devolver no próximo pagamento`}
            </Dialog.Description>
          </div>

          {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
          {!itens ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : linhas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nada recebido pela agenda ainda.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm tabular-nums">
                <thead className="bg-muted/40 text-[13px] text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-normal">Mês</th>
                    <th scope="col" className="px-3 py-2 text-right font-normal">Faturou</th>
                    <th scope="col" className="px-3 py-2 text-right font-normal">Comissão paga</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map(([mes, m]) => (
                    <tr key={mes} className="border-t align-top">
                      <th scope="row" className="px-3 py-2.5 text-left font-medium">{nomeCurto(mes)}</th>
                      <td className="px-3 py-2.5 text-right">
                        {formatBRL(m.faturou)}
                        {m.estornado > 0 && <span className="block text-[13px] text-muted-foreground">− {formatBRL(m.estornado)} estornado</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {m.pago === undefined ? <span className="text-muted-foreground">não paga</span> : formatBRL(m.pago)}
                        {m.abatido > 0 && <span className="block text-[13px] text-muted-foreground">− {formatBRL(m.abatido)} de estorno</span>}
                        {m.abatido < 0 && <span className="block text-[13px] text-muted-foreground">+ {formatBRL(-m.abatido)} de estorno desfeito</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t font-semibold">
                    <th scope="row" className="px-3 py-2.5 text-left">Total</th>
                    <td className="px-3 py-2.5 text-right">{formatBRL(linhas.reduce((t, [, m]) => t + m.faturou - m.estornado, 0))}</td>
                    <td className="px-3 py-2.5 text-right">{formatBRL(totalPago)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <div className="flex justify-end">
            <Button type="button" variant="outline" className="h-11 px-4" onClick={onClose}>Fechar</Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
