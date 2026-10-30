"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL, maskBRL } from "@/lib/datetime";
import { idToken } from "@/lib/firebase";
import { categorias, type Fixa } from "@/lib/financeiro";
import { cn } from "@/lib/utils";
import { adicionarFixaAction, removerFixaAction } from "./actions";
import { ConfirmDialog } from "./confirm-dialog";

/** Cadastro das contas que se repetem todo mês. Cada mudança grava na hora, uma de cada vez. */
export function ContasFixas({ tenantId, nicho, fixas, onClose }: { tenantId: string; nicho?: string; fixas: Fixa[]; onClose: () => void }) {
  const [nome, setNome] = useState("");
  const [valor, setValor] = useState("");
  const [dia, setDia] = useState("10");
  const [categoria, setCategoria] = useState("Aluguel");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [tirar, setTirar] = useState<Fixa | null>(null);

  async function gravar(f: () => Promise<{ ok: boolean; error?: string }>) {
    setErro("");
    setOcupado(true);
    const r = await f().catch(() => ({ ok: false, error: "Sem conexão. Tente de novo." }));
    setOcupado(false);
    if (!r.ok) return setErro(r.error ?? "Não foi possível salvar."), false;
    return true;
  }

  async function adicionar() {
    const centavos = Number(valor.replace(/\D/g, "")) || 0;
    const d = Number(dia);
    if (!nome.trim()) return setErro("Dê um nome à conta.");
    if (!centavos) return setErro("Informe o valor.");
    if (!Number.isInteger(d) || d < 1 || d > 31) return setErro("O dia vai de 1 a 31.");
    if (await gravar(async () => adicionarFixaAction(await idToken(), { tenantId, fixa: { nome: nome.trim(), valorCents: centavos, dia: d, categoria } }))) {
      setNome("");
      setValor("");
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && !ocupado && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 grid max-h-[92dvh] gap-5 overflow-y-auto rounded-t-2xl border bg-popover p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-popover-foreground shadow-xl outline-none sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-6">
          {/* Enter em qualquer campo adiciona a conta */}
          <form className="contents" onSubmit={(e) => (e.preventDefault(), void adicionar())}>
          <div className="grid gap-1">
            <Dialog.Title className="font-serifa text-2xl leading-tight">Contas fixas</Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">Aparecem todo mês em “Contas do mês”. Só viram saída quando você toca em Paguei.</Dialog.Description>
          </div>

          {fixas.length > 0 && (
            <ul className="grid rounded-xl border">
              {fixas.map((f) => (
                <li key={f.id} className="flex items-center gap-3 border-t px-3 py-2.5 first:border-t-0">
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate font-medium">{f.nome}</span>
                    <span className="text-[13px] text-muted-foreground">dia {f.dia} · {f.categoria}</span>
                  </span>
                  <span className="tabular-nums">{formatBRL(f.valorCents)}</span>
                  <Button type="button" variant="ghost" size="sm" className="h-10 text-destructive" disabled={ocupado} onClick={() => setTirar(f)} aria-label={`Tirar ${f.nome}`}>
                    Tirar
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-medium">Nova conta</legend>
            <Input value={nome} maxLength={40} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Aluguel da sala" className="h-11" />
            <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
              <label className="grid gap-1.5 text-sm text-muted-foreground">
                Valor
                <Input inputMode="numeric" placeholder="R$ 0,00" value={valor} onChange={(e) => setValor(maskBRL(e.target.value))} className="h-11 tabular-nums text-foreground" />
              </label>
              <label className="grid gap-1.5 text-sm text-muted-foreground">
                Vence dia
                <Input type="number" min={1} max={31} value={dia} onChange={(e) => setDia(e.target.value)} className="h-11 text-foreground" />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              {categorias("saida", nicho).map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={categoria === c}
                  onClick={() => setCategoria(c)}
                  className={cn("h-10 rounded-full border px-3.5 text-sm hover:bg-muted", categoria === c && "border-primary bg-primary text-primary-foreground hover:bg-primary/90")}
                >
                  {c}
                </button>
              ))}
            </div>
          </fieldset>

          {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" className="h-11 px-4" disabled={ocupado} onClick={onClose}>Fechar</Button>
            <Button type="submit" className="h-11 px-5" disabled={ocupado}>{ocupado ? "Salvando…" : "Adicionar conta"}</Button>
          </div>
          </form>
          {tirar && (
            <ConfirmDialog
              title={`Tirar ${tirar.nome}?`}
              description="A conta deixa de aparecer nos próximos meses. O que já foi pago continua no Caixa."
              confirmLabel="Sim, tirar"
              onConfirm={async () => {
                const id = tirar.id;
                setTirar(null);
                await gravar(async () => removerFixaAction(await idToken(), { tenantId, fixaId: id }));
              }}
              onCancel={() => setTirar(null)}
            />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
