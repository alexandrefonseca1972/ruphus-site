"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL, maskBRL, todayIn } from "@/lib/datetime";
import { idToken } from "@/lib/firebase";
import { categorias, ehVinculado, FORMAS, ROTULO_FORMA, type Lancamento } from "@/lib/financeiro";
import { cn } from "@/lib/utils";
import { baixarAgendamentoAction, editarLancamentoAction, estornarAction, excluirLancamentoAction, lancarAction, pagarAction } from "./actions";
import { ConfirmDialog } from "./confirm-dialog";

/** O que a folha faz: entrada/saída nova, corrigir uma que existe, receber um atendimento
 *  ou pagar a conta fixa / a comissão do mês. */
export type Folha =
  | { modo: "novo"; tipo: "entrada" | "saida"; data: string }
  | { modo: "editar"; lancamento: Lancamento }
  | { modo: "baixa"; atendimento: { id: string; customerName: string; serviceName: string; priceCents: number } }
  | { modo: "pagar"; titulo: string; detalhe: string; valorCents: number; pagamento: { tipo: "fixa" | "comissao"; alvoId: string; mes: string; descontoCents?: number } };

const Chip = ({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button
    type="button"
    aria-pressed={ativo}
    onClick={onClick}
    className={cn("h-10 rounded-full border px-3.5 text-sm hover:bg-muted", ativo && "border-primary bg-primary text-primary-foreground hover:bg-primary/90")}
  >
    {children}
  </button>
);

/** Folha curta do Caixa: valor primeiro, o resto em toques. Fecha sozinha ao salvar. */
export function LancamentoFolha({ tenantId, nicho, folha, estornado, onClose }: { tenantId: string; nicho?: string; folha: Folha; estornado?: boolean; onClose: (aviso?: string) => void }) {
  const base = folha.modo === "editar" ? folha.lancamento : null;
  const tipo = folha.modo === "novo" ? folha.tipo : folha.modo === "baixa" ? "entrada" : folha.modo === "pagar" ? "saida" : folha.lancamento.tipo;
  const valorInicial = base?.valorCents ?? (folha.modo === "baixa" ? folha.atendimento.priceCents : folha.modo === "pagar" ? folha.valorCents : 0);
  const [valor, setValor] = useState(valorInicial ? formatBRL(valorInicial) : "");
  const [categoria, setCategoria] = useState(base?.categoria ?? (folha.modo === "baixa" ? "Atendimento" : ""));
  const [forma, setForma] = useState<(typeof FORMAS)[number]>(base?.forma ?? "pix");
  // lançamento novo nasce no mês que está na tela, não no de hoje
  const [data, setData] = useState(base?.data ?? (folha.modo === "novo" ? folha.data : todayIn()));
  const [descricao, setDescricao] = useState(base?.descricao ?? "");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [apagar, setApagar] = useState(false);
  // "Estornar" troca a folha de correção pela de devolução: valor (todo ou parte) e forma
  const [estornando, setEstornando] = useState(false);
  const [confirmarEstorno, setConfirmarEstorno] = useState(false);
  const centavos = Number(valor.replace(/\D/g, "")) || 0;
  const daAgenda = folha.modo === "baixa" || !!base?.appointmentId;
  // conta fixa, comissão e estorno: categoria e mês vêm de onde nasceram
  const ePagamento = folha.modo === "pagar" || ehVinculado(base?.id ?? "");
  const eEstorno = !!base?.estornoDe;
  const vinculado = daAgenda || ePagamento;
  const podeEstornar = !!base && base.tipo === "entrada" && !estornado;
  const deQuem = base?.customerName ?? base?.descricao ?? base?.categoria ?? "";

  const titulo = estornando
    ? `Estornar ${deQuem}`
    : folha.modo === "baixa" ? `Receber de ${folha.atendimento.customerName}` : folha.modo === "pagar" ? folha.titulo : folha.modo === "editar" ? (estornado ? "Lançamento estornado" : "Corrigir lançamento") : tipo === "entrada" ? "Nova entrada" : "Nova saída";

  async function rodar(f: () => Promise<{ ok: boolean; error?: string }>, aviso: string) {
    setErro("");
    setOcupado(true);
    const r = await f().catch(() => ({ ok: false, error: "Sem conexão. Tente de novo." }));
    setOcupado(false);
    if (!r.ok) return setErro(r.error ?? "Não foi possível salvar.");
    onClose(aviso);
  }

  function salvar() {
    // comissão toda abatida por estorno: R$ 0 registra o acerto do mês
    const zeroPorEstorno = folha.modo === "pagar" && folha.valorCents === 0 && (folha.pagamento.descontoCents ?? 0) > 0;
    if (!centavos && !zeroPorEstorno) return setErro("Informe o valor.");
    if (estornando && base) {
      if (centavos > base.valorCents) return setErro(`O estorno vai até ${formatBRL(base.valorCents)}, o valor recebido.`);
      return setConfirmarEstorno(true);
    }
    if (folha.modo === "baixa") {
      return rodar(async () => baixarAgendamentoAction(await idToken(), { tenantId, baixa: { appointmentId: folha.atendimento.id, valorCents: centavos, forma } }), `Recebido: ${formatBRL(centavos)}.`);
    }
    if (folha.modo === "pagar") {
      return rodar(async () => pagarAction(await idToken(), { tenantId, pagamento: { ...folha.pagamento, valorCents: centavos, forma } }), `Pago: ${formatBRL(centavos)}.`);
    }
    if (!categoria) return setErro("Escolha a categoria.");
    const lancamento = { tipo, valorCents: centavos, data, categoria, forma, descricao: descricao.trim() || undefined };
    return folha.modo === "editar"
      ? rodar(async () => editarLancamentoAction(await idToken(), { tenantId, id: folha.lancamento.id, lancamento }), "Lançamento corrigido.")
      : rodar(async () => lancarAction(await idToken(), { tenantId, lancamento }), `${tipo === "entrada" ? "Entrada" : "Saída"} de ${formatBRL(centavos)} lançada.`);
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && !ocupado && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40" />
        {/* no celular sobe de baixo, no alcance do polegar; no computador fica no meio */}
        <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 grid max-h-[92dvh] gap-5 overflow-y-auto rounded-t-2xl border bg-popover p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-popover-foreground shadow-xl outline-none sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-6">
          {/* formulário: Enter no valor já salva, sem caçar o botão */}
          <form className="contents" onSubmit={(e) => (e.preventDefault(), void salvar())}>
          <div className="grid gap-1">
            <Dialog.Title className="font-serifa text-2xl leading-tight">{titulo}</Dialog.Title>
            {(folha.modo === "baixa" || folha.modo === "pagar") && <Dialog.Description className="text-sm text-muted-foreground">{folha.modo === "baixa" ? folha.atendimento.serviceName : folha.detalhe}</Dialog.Description>}
            {estornando && base && <Dialog.Description className="text-sm text-muted-foreground">Recebido {formatBRL(base.valorCents)}. Devolva tudo ou só uma parte.</Dialog.Description>}
            {!estornando && estornado && <Dialog.Description className="text-sm text-muted-foreground">Já tem estorno. Para desfazer, apague o estorno.</Dialog.Description>}
          </div>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Valor</span>
            <Input
              autoFocus
              inputMode="numeric"
              placeholder="R$ 0,00"
              value={valor}
              onChange={(e) => setValor(maskBRL(e.target.value))}
              className={cn("h-14 font-serifa text-3xl tabular-nums md:text-3xl", (tipo === "saida" || estornando) && "text-red-700 dark:text-red-300")}
            />
          </label>

          {!vinculado && !estornando && (
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">Categoria</legend>
              <div className="flex flex-wrap gap-2">
                {categorias(tipo, nicho).map((c) => (
                  <Chip key={c} ativo={categoria === c} onClick={() => setCategoria(c)}>{c}</Chip>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">{estornando ? "Devolvido com" : tipo === "entrada" ? "Recebido em" : "Pago com"}</legend>
            <div className="flex flex-wrap gap-2">
              {FORMAS.map((f) => (
                <Chip key={f} ativo={forma === f} onClick={() => setForma(f)}>{ROTULO_FORMA[f]}</Chip>
              ))}
            </div>
          </fieldset>

          {folha.modo !== "baixa" && folha.modo !== "pagar" && !estornando && (
            <div className={cn("grid gap-3", !vinculado && "sm:grid-cols-[10rem_minmax(0,1fr)]")}>
              {/* o recebimento da agenda fica no dia do atendimento; o pagamento, no mês dele */}
              {!vinculado && <label className="grid gap-1.5">
                <span className="text-sm font-medium">Data</span>
                <Input type="date" value={data} onChange={(e) => e.target.value && setData(e.target.value)} className="h-11" />
              </label>}
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">Descrição <span className="font-normal text-muted-foreground">(opcional)</span></span>
                <Input value={descricao} maxLength={80} onChange={(e) => setDescricao(e.target.value)} placeholder={tipo === "entrada" ? "Ex.: venda de shampoo" : "Ex.: conta de luz"} className="h-11" />
              </label>
            </div>
          )}

          {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            {folha.modo === "editar" && !estornando ? (
              <div className="flex gap-2 max-sm:justify-between">
                {/* estornado não se apaga: primeiro apaga o estorno */}
                {!estornado && <Button
                  type="button"
                  variant="ghost"
                  className="h-11 px-4 text-destructive"
                  disabled={ocupado}
                  onClick={() => setApagar(true)}
                >
                  Apagar
                </Button>}
                {podeEstornar && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 px-4"
                    disabled={ocupado}
                    onClick={() => (setErro(""), setValor(formatBRL(folha.lancamento.valorCents)), setEstornando(true))}
                  >
                    Estornar
                  </Button>
                )}
              </div>
            ) : <span />}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" className="h-11 px-4" disabled={ocupado} onClick={() => (estornando ? (setErro(""), setValor(formatBRL(valorInicial)), setForma(base?.forma ?? "pix"), setEstornando(false)) : onClose())}>Voltar</Button>
              <Button type="submit" className="h-11 px-5" disabled={ocupado}>
                {ocupado ? "Salvando…" : estornando ? "Estornar" : folha.modo === "baixa" ? "Recebi" : folha.modo === "pagar" ? "Paguei" : folha.modo === "novo" ? `Lançar ${tipo === "entrada" ? "entrada" : "saída"}` : "Salvar"}
              </Button>
            </div>
          </div>
          </form>
          {/* apagar não tem volta: um toque errado no celular não pode sumir com dinheiro */}
          {apagar && folha.modo === "editar" && (
            <ConfirmDialog
              title={`Apagar ${folha.lancamento.tipo === "entrada" ? "entrada" : "saída"} de ${formatBRL(folha.lancamento.valorCents)}?`}
              description={eEstorno ? "O dinheiro volta a contar como recebido, e a comissão também." : daAgenda ? "O atendimento volta para o fechamento do dia." : ePagamento ? "O pagamento volta a aparecer para pagar neste mês." : "O lançamento sai do Caixa e não dá para desfazer."}
              confirmLabel="Sim, apagar"
              onConfirm={async () => {
                setApagar(false);
                await rodar(async () => excluirLancamentoAction(await idToken(), { tenantId, id: folha.lancamento.id }), eEstorno ? "Estorno apagado: o recebimento voltou a valer." : daAgenda ? "Recebimento apagado: o atendimento voltou para o fechamento do dia." : ePagamento ? "Pagamento apagado: voltou para as contas do mês." : "Lançamento apagado.");
              }}
              onCancel={() => setApagar(false)}
            />
          )}
          {confirmarEstorno && base && (
            <ConfirmDialog
              title={`Estornar ${formatBRL(centavos)} de ${deQuem}?`}
              description={`Entra como saída de hoje no Caixa${base.staffName ? `. A comissão de ${base.staffName} sobre esse valor sai do próximo pagamento de comissão` : ""}. O recebimento continua no histórico, marcado como estornado. Só dá para estornar uma vez.`}
              confirmLabel="Sim, estornar"
              onConfirm={async () => {
                setConfirmarEstorno(false);
                await rodar(
                  async () => estornarAction(await idToken(), { tenantId, estorno: { lancamentoId: base.id, valorCents: centavos, forma } }),
                  `Estorno de ${formatBRL(centavos)} lançado${base.staffName ? `: a comissão de ${base.staffName} desconta no próximo pagamento` : ""}.`,
                );
              }}
              onCancel={() => setConfirmarEstorno(false)}
            />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
