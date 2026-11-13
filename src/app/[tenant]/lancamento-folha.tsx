"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useState } from "react";
import { ArrowLeft, Check, QrCode, ReceiptText, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/form-message";
import { Input } from "@/components/ui/input";
import { formatBRL, maskBRL, todayIn } from "@/lib/datetime";
import { idToken } from "@/lib/firebase";
import { categorias, ehSinal, ehVale, ehVinculado, FORMAS, ROTULO_FORMA, type Lancamento } from "@/lib/financeiro";
import { cn } from "@/lib/utils";
import { baixarAgendamentoAction, editarLancamentoAction, estornarAction, excluirLancamentoAction, lancarAction, pagarAction } from "./actions";
import { ConfirmDialog } from "./confirm-dialog";
import { PixQr } from "@/components/pix-qr";
import { txidLivre } from "@/lib/pix";
import { useTenant } from "./painel-layout";

/** O que a folha faz: entrada/saída nova, corrigir uma que existe, receber um atendimento
 *  ou pagar a conta fixa / a comissão do mês. */
export type Folha =
  | { modo: "novo"; tipo: "entrada" | "saida"; data: string }
  | { modo: "editar"; lancamento: Lancamento }
  | { modo: "baixa"; atendimento: { id: string; customerName: string; customerPhone?: string; serviceName: string; priceCents: number; precoAberto?: boolean; sinalCents: number } }
  | { modo: "pagar"; titulo: string; detalhe: string; valorCents: number; pagamento: { tipo: "fixa" | "comissao"; alvoId: string; mes: string; descontoCents?: number } };

export const Chip = ({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button
    type="button"
    aria-pressed={ativo}
    onClick={onClick}
    className={cn("h-10 rounded-full border px-3.5 text-sm hover:bg-muted", ativo && "border-primary bg-primary text-primary-foreground hover:bg-primary/90")}
  >
    {children}
  </button>
);

/** A última forma usada em cada tipo: quem recebe quase tudo em dinheiro não precisa trocar
 *  o Pix toda vez (e não grava Pix sem olhar). Só neste aparelho; sem armazenamento, fica o Pix. */
const chaveForma = (tipo: string) => `caixa:forma:${tipo}`;
function ultimaForma(tipo: string): (typeof FORMAS)[number] {
  try {
    const f = localStorage.getItem(chaveForma(tipo));
    return FORMAS.find((x) => x === f) ?? "pix";
  } catch {
    return "pix";
  }
}
const lembrarForma = (tipo: string, forma: string) => {
  try {
    localStorage.setItem(chaveForma(tipo), forma);
  } catch {}
};
// a máscara põe os dígitos pela direita: "35" vira R$ 0,35. Abaixo de R$ 1 pede confirmação
const POUCO = 100;

/** Folha curta do Caixa: valor primeiro, o resto em toques. Fecha sozinha ao salvar. */
export function LancamentoFolha({ tenantId, nicho, folha, estornado, onClose, onRecibo }: { tenantId: string; nicho?: string; folha: Folha; estornado?: boolean; onClose: (aviso?: string) => void; onRecibo?: () => void }) {
  const base = folha.modo === "editar" ? folha.lancamento : null;
  const tipo = folha.modo === "novo" ? folha.tipo : folha.modo === "baixa" ? "entrada" : folha.modo === "pagar" ? "saida" : folha.lancamento.tipo;
  const valorInicial = base?.valorCents ?? (folha.modo === "baixa" ? folha.atendimento.priceCents : folha.modo === "pagar" ? folha.valorCents : 0);
  const [valor, setValor] = useState(valorInicial ? formatBRL(valorInicial) : "");
  // Valores calculados ou cadastrados não podem ser alterados durante a quitação.
  const comissao = (folha.modo === "pagar" && folha.pagamento.tipo === "comissao") || (folha.modo === "editar" && folha.lancamento.id.startsWith("cm-"));
  const valorFixo = comissao || folha.modo === "pagar" || (folha.modo === "editar" && folha.lancamento.id.startsWith("fx-")) || (folha.modo === "baixa" && !folha.atendimento.precoAberto);
  const [categoria, setCategoria] = useState(base?.categoria ?? (folha.modo === "baixa" ? "Atendimento" : ""));
  const [forma, setForma] = useState<(typeof FORMAS)[number]>(() => base?.forma ?? ultimaForma(tipo));
  // entrada/saída avulsa: o id nasce aqui, e repetir o envio (a resposta caiu) não duplica
  const [idNovo] = useState(() => `mn-${crypto.randomUUID().replace(/-/g, "")}`);
  const [confirmarPouco, setConfirmarPouco] = useState(false);
  // lançamento novo nasce no mês que está na tela, não no de hoje
  const [data, setData] = useState(base?.data ?? (folha.modo === "novo" ? folha.data : todayIn()));
  const [descricao, setDescricao] = useState(base?.descricao ?? "");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [apagar, setApagar] = useState(false);
  // "Estornar" troca a folha de correção pela de devolução: valor (todo ou parte) e forma
  const [estornando, setEstornando] = useState(false);
  // o valor digitado antes de tocar em "Estornar": "Voltar" devolve ele, não o original
  const [valorAntes, setValorAntes] = useState("");
  const [confirmarEstorno, setConfirmarEstorno] = useState(false);
  const centavos = Number(valor.replace(/\D/g, "")) || 0;
  const eSinal = ehSinal(base?.id ?? "");
  const daAgenda = folha.modo === "baixa" || !!base?.appointmentId || eSinal;
  // conta fixa, comissão e estorno: categoria e mês vêm de onde nasceram
  const ePagamento = folha.modo === "pagar" || ehVinculado(base?.id ?? "");
  const eEstorno = !!base?.estornoDe;
  const vinculado = daAgenda || ePagamento;
  const podeEstornar = !!base && base.tipo === "entrada" && !estornado;
  const deQuem = base?.customerName ?? base?.descricao ?? base?.categoria ?? "";
  // receber por Pix na hora: o QR com o valor, na chave do salão
  const tenant = useTenant();
  const { pix, id: slug, podeGerir } = tenant;
  const [mostrarPix, setMostrarPix] = useState(false);
  const [txid] = useState(() => txidLivre(slug));
  const podePix = !!pix && forma === "pix" && !estornando && (folha.modo === "baixa" || (folha.modo === "novo" && tipo === "entrada"));

  const titulo = estornando
    ? `Estornar ${deQuem}`
    : folha.modo === "baixa" ? `Receber de ${folha.atendimento.customerName}` : folha.modo === "pagar" ? folha.titulo : folha.modo === "editar" ? (estornado ? "Lançamento estornado" : "Corrigir lançamento") : tipo === "entrada" ? "Nova entrada" : "Nova saída";

  async function rodar(f: () => Promise<{ ok: boolean; error?: string }>, aviso: string) {
    setErro("");
    setOcupado(true);
    const r = await f().catch(() => ({ ok: false, error: "Sem conexão. Tente de novo." }));
    setOcupado(false);
    if (!r.ok) return setErro(r.error ?? "Não foi possível salvar.");
    if (folha.modo !== "editar" && !estornando) lembrarForma(tipo, forma);
    onClose(aviso);
  }

  function salvar(valorBaixoConfirmado = false) {
    // comissão toda abatida por estorno: R$ 0 registra o acerto do mês
    const zeroPorEstorno =
      (folha.modo === "pagar" && folha.valorCents === 0 && (folha.pagamento.descontoCents ?? 0) > 0) ||
      // o mesmo pagamento de R$ 0 depois, para corrigir a forma ou a descrição
      (folha.modo === "editar" && folha.lancamento.id.startsWith("cm-") && (folha.lancamento.descontoCents ?? 0) > 0);
    if (!centavos && !zeroPorEstorno) return setErro("Informe o valor do lançamento.");
    if (centavos && centavos < POUCO && !valorBaixoConfirmado) {
      setErro("");
      setConfirmarPouco(true);
      return;
    }
    if (estornando && base) {
      if (centavos > base.valorCents) return setErro(`O estorno vai até ${formatBRL(base.valorCents)}, o valor recebido.`);
      return setConfirmarEstorno(true);
    }
    if (folha.modo === "baixa") {
      return rodar(async () => baixarAgendamentoAction(await idToken(), { tenantId, baixa: { appointmentId: folha.atendimento.id, valorCents: centavos, forma, sinalCents: folha.atendimento.sinalCents } }), `Recebido: ${formatBRL(centavos)}.`);
    }
    if (folha.modo === "pagar") {
      return rodar(async () => pagarAction(await idToken(), { tenantId, pagamento: { ...folha.pagamento, valorCents: centavos, forma } }), `Pago: ${formatBRL(centavos)}.`);
    }
    if (!categoria) return setErro("Escolha a categoria.");
    const lancamento = { tipo, valorCents: centavos, data, categoria, forma, descricao: descricao.trim() || undefined };
    // datado em outro mês, some da tela aberta: o aviso diz onde ficou
    const mesDaTela = (folha.modo === "novo" ? folha.data : folha.lancamento.data).slice(0, 7);
    const outroMes = data.slice(0, 7) !== mesDaTela ? ` Ficou em ${data.split("-").reverse().join("/")}: mude o mês para ver.` : "";
    return folha.modo === "editar"
      ? rodar(async () => editarLancamentoAction(await idToken(), { tenantId, id: folha.lancamento.id, lancamento }), `Lançamento corrigido.${outroMes}`)
      : rodar(async () => lancarAction(await idToken(), { tenantId, lancamento, id: idNovo }), `${tipo === "entrada" ? "Entrada" : "Saída"} de ${formatBRL(centavos)} lançada.${outroMes}`);
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && !ocupado && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40" />
        {/* no celular sobe de baixo; no desktop mantém o contexto ao lado */}
        <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 grid max-h-[92dvh] gap-5 overflow-y-auto overscroll-contain rounded-t-2xl border bg-popover p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-popover-foreground shadow-xl outline-none motion-safe:animate-in motion-safe:slide-in-from-bottom-4 sm:inset-y-0 sm:right-0 sm:left-auto sm:h-dvh sm:max-h-none sm:w-full sm:max-w-[440px] sm:rounded-none sm:rounded-l-2xl sm:p-6 motion-safe:sm:slide-in-from-bottom-0 motion-safe:sm:slide-in-from-right-8">
          {/* formulário: Enter no valor já salva, sem caçar o botão */}
          <form noValidate className="contents" onSubmit={(e) => (e.preventDefault(), void salvar())}>
          <div className="grid gap-1">
            <Dialog.Title className="font-serifa text-2xl leading-tight">{titulo}</Dialog.Title>
            {(folha.modo === "baixa" || folha.modo === "pagar") && <Dialog.Description className="text-sm text-muted-foreground">{folha.modo === "baixa" ? `${folha.atendimento.serviceName}${folha.atendimento.sinalCents ? ` · sinal de ${formatBRL(folha.atendimento.sinalCents)} já pago, cobre só o restante` : ""}` : folha.detalhe}</Dialog.Description>}
            {estornando && base && <Dialog.Description className="text-sm text-muted-foreground">Recebido {formatBRL(base.valorCents)}. Devolva tudo ou só uma parte.</Dialog.Description>}
            {!estornando && estornado && <Dialog.Description className="text-sm text-muted-foreground">Já tem estorno. Para desfazer, apague o estorno.</Dialog.Description>}
          </div>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Valor</span>
            <Input
              autoFocus={!valorFixo}
              readOnly={valorFixo}
              inputMode="numeric"
              placeholder="R$ 0,00"
              value={valor}
              required={!valorFixo}
              aria-invalid={!!erro && !centavos}
              aria-describedby={`valor-dica${erro ? " erro-lancamento" : ""}`}
              onChange={(e) => (setValor(maskBRL(e.target.value)), setConfirmarPouco(false), setMostrarPix(false), setErro(""))}
              className={cn("h-14 font-serifa text-3xl tabular-nums md:text-3xl", (tipo === "saida" || estornando) && "text-red-700 dark:text-red-300", valorFixo && "bg-muted/50")}
            />
            <span id="valor-dica" className="text-xs text-muted-foreground">{comissao ? "Calculado pelo faturamento e pelo % do profissional." : valorFixo ? "Valor definido no atendimento ou na conta. Para alterar, edite o cadastro correspondente." : "Só números, com os centavos: 3500 = R$ 35,00"}</span>
          </label>

          {!vinculado && !estornando && (
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">Categoria</legend>
              <div className="flex flex-wrap gap-2">
                {categorias(tipo, nicho).map((c) => (
                  <Chip key={c} ativo={categoria === c} onClick={() => { setCategoria(c); setErro(""); }}>{c}</Chip>
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

          {!pix && podeGerir && forma === "pix" && !estornando && (folha.modo === "baixa" || (folha.modo === "novo" && tipo === "entrada")) && (
            <p className="text-sm text-muted-foreground">
              Para mostrar o QR do Pix com o valor, cadastre sua chave em{" "}
              <a href={`/${slug}/negocio`} className="font-medium underline underline-offset-2">Meu negócio</a>.
            </p>
          )}

          {podePix && pix && (
            mostrarPix && centavos ? (
              <PixQr key={centavos} recebedor={pix} valorCents={centavos} txid={txid} telefone={folha.modo === "baixa" ? folha.atendimento.customerPhone : null} />
            ) : (
              <Button type="button" variant="outline" className="h-11" disabled={!centavos} onClick={() => setMostrarPix(true)}>
                <QrCode aria-hidden="true" />Mostrar QR do Pix
              </Button>
            )
          )}

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

          {erro && <FormMessage id="erro-lancamento">{erro}</FormMessage>}

          {/* no celular os botões ficam presos no rodapé da folha: com o teclado aberto, Lançar
              continua à vista (o teclado numérico do iPhone não tem Enter) */}
          <div className="flex flex-col-reverse gap-2 max-sm:sticky max-sm:-bottom-[calc(1.25rem+env(safe-area-inset-bottom))] max-sm:-mx-5 max-sm:-mb-[calc(1.25rem+env(safe-area-inset-bottom))] max-sm:border-t max-sm:bg-popover max-sm:px-5 max-sm:pt-3 max-sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:mt-auto sm:flex-row sm:justify-between">
            {folha.modo === "editar" && !estornando ? (
              <div className="flex flex-wrap gap-2 max-sm:justify-between">
                {/* recibo do que entrou: impressão, WhatsApp ou e-mail */}
                {tipo === "entrada" && onRecibo && <Button type="button" variant="outline" className="h-11 px-4" disabled={ocupado} onClick={onRecibo}><ReceiptText aria-hidden="true" />Recibo</Button>}
                {/* estornado não se apaga: primeiro apaga o estorno */}
                {!estornado && <Button
                  type="button"
                  variant="ghost"
                  className="h-11 px-4 text-destructive"
                  disabled={ocupado}
                  onClick={() => setApagar(true)}
                >
                  <Trash2 aria-hidden="true" />Apagar
                </Button>}
                {podeEstornar && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 px-4"
                    disabled={ocupado}
                    onClick={() => (setErro(""), setConfirmarPouco(false), setValorAntes(valor), setValor(formatBRL(folha.lancamento.valorCents)), setEstornando(true))}
                  >
                    <RotateCcw aria-hidden="true" />Estornar
                  </Button>
                )}
              </div>
            ) : <span />}
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row">
              <Button type="button" variant="outline" className="h-11 px-4" disabled={ocupado} onClick={() => (estornando ? (setErro(""), setConfirmarPouco(false), setValor(valorAntes), setForma(base?.forma ?? "pix"), setEstornando(false)) : onClose())}><ArrowLeft aria-hidden="true" />Voltar</Button>
              <Button type="submit" className="h-11 px-5" disabled={ocupado}>
                {!ocupado && <Check aria-hidden="true" />}{ocupado ? "Salvando…" : estornando ? "Estornar" : folha.modo === "baixa" ? "Recebi" : folha.modo === "pagar" ? "Paguei" : folha.modo === "novo" ? `Lançar ${tipo === "entrada" ? "entrada" : "saída"}` : "Salvar"}
              </Button>
            </div>
          </div>
          </form>
          {confirmarPouco && (
            <ConfirmDialog
              title={`Confirmar valor de ${formatBRL(centavos)}?`}
              description="O valor está abaixo de R$ 1. Para registrar R$ 35,00, volte e digite 3500. Se o valor estiver correto, confirme para continuar."
              confirmLabel="Sim, usar este valor"
              tom="normal"
              onConfirm={() => {
                setConfirmarPouco(false);
                return salvar(true);
              }}
              onCancel={() => setConfirmarPouco(false)}
            />
          )}
          {/* apagar não tem volta: um toque errado no celular não pode sumir com dinheiro */}
          {apagar && folha.modo === "editar" && (
            <ConfirmDialog
              title={`Apagar ${folha.lancamento.tipo === "entrada" ? "entrada" : "saída"} de ${formatBRL(folha.lancamento.valorCents)}?`}
              description={eEstorno ? "O dinheiro volta a contar como recebido, e a comissão também." : eSinal ? "O sinal sai do Caixa. Se o atendimento ainda não foi recebido, ele entra junto no recebimento." : daAgenda ? "O atendimento volta para “A receber da agenda”." : ePagamento ? "O pagamento volta a aparecer para pagar neste mês." : "O lançamento sai do Caixa e não dá para desfazer."}
              confirmLabel="Sim, apagar"
              onConfirm={async () => {
                setApagar(false);
                await rodar(async () => excluirLancamentoAction(await idToken(), { tenantId, id: folha.lancamento.id }), eEstorno ? "Estorno apagado: o recebimento voltou a valer." : eSinal ? "Sinal apagado do Caixa." : daAgenda ? "Recebimento apagado: o atendimento voltou para “A receber da agenda”." : ehVale(base?.id ?? "") ? "Vale apagado." : ePagamento ? "Pagamento apagado: voltou para as contas do mês." : "Lançamento apagado.");
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
