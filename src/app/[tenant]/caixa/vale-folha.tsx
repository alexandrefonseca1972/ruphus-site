"use client";

import { Dialog } from "@base-ui/react/dialog";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL, maskBRL, todayIn } from "@/lib/datetime";
import { idToken } from "@/lib/firebase";
import { db } from "@/lib/firebase-db";
import { FORMAS, ROTULO_FORMA } from "@/lib/financeiro";
import { erroDoEmail, numeroDoRecibo, valorPorExtenso } from "@/lib/recibo";
import { darValeAction } from "../actions";
import { Chip } from "../lancamento-folha";

const POPUP = "fixed inset-x-0 bottom-0 z-50 grid max-h-[92dvh] gap-5 overflow-y-auto rounded-t-2xl border bg-popover p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-popover-foreground shadow-xl outline-none sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-6 print:static print:max-h-none print:translate-none print:overflow-visible print:border-0 print:p-0 print:shadow-none";

/** Vale: parte da comissão paga a qualquer dia. A confirmação vai sempre por e-mail ao
 *  profissional; o recibo para ele assinar é opcional, depois de registrado. */
export function ValeFolha({ tenantId, negocio, staff, onClose }: { tenantId: string; negocio: string; staff: { id: string; nome: string }; onClose: (aviso?: string) => void }) {
  const [valor, setValor] = useState("");
  const [forma, setForma] = useState<(typeof FORMAS)[number]>("pix");
  const [email, setEmail] = useState("");
  const [tocouEmail, setTocouEmail] = useState(false);
  // repetir o envio (a resposta caiu) não paga duas vezes
  const [id] = useState(() => `vl-${crypto.randomUUID().replace(/-/g, "")}`);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [feito, setFeito] = useState<{ aviso: string; data: string } | null>(null);
  const [recibo, setRecibo] = useState(false);
  const centavos = Number(valor.replace(/\D/g, "")) || 0;
  const erroEmail = tocouEmail ? erroDoEmail(email, "do profissional") : "";

  // o e-mail da conta do profissional (quem entrou pelo convite) já preenche o campo
  useEffect(() => {
    getDocs(query(collection(db, "tenants", tenantId, "members"), where("staffId", "==", staff.id)))
      .then((q) => {
        const e = q.docs.map((d) => d.get("email")).find((x) => typeof x === "string");
        if (e) setEmail((atual) => atual || e);
      })
      .catch(() => {});
  }, [tenantId, staff.id]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setTocouEmail(true);
    if (!centavos) return setErro("Informe o valor.");
    if (erroDoEmail(email)) return setErro("");
    setErro("");
    setOcupado(true);
    const r = await idToken()
      .then((t) => darValeAction(t, { tenantId, vale: { id, staffId: staff.id, valorCents: centavos, forma, email: email.trim() } }))
      .catch(() => ({ ok: false as const, error: "Sem conexão. Tente de novo." }));
    setOcupado(false);
    if (!r.ok) return setErro(r.error ?? "Não foi possível salvar.");
    setFeito({
      data: todayIn(),
      aviso: `Vale de ${formatBRL(centavos)} para ${staff.nome} registrado: sai do próximo pagamento de comissão. ${r.emailEnviado ? `Confirmação enviada para ${email.trim()}.` : "A confirmação por e-mail não saiu; avise o profissional."}`,
    });
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && !ocupado && onClose(feito?.aviso)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 print:hidden" />
        <Dialog.Popup className={POPUP}>
          {feito ? (
            <>
              <div className="grid gap-1 print:hidden">
                <Dialog.Title className="font-serifa text-2xl leading-tight">Vale registrado</Dialog.Title>
                <Dialog.Description className="text-sm text-muted-foreground">{feito.aviso}</Dialog.Description>
              </div>
              {recibo && (
                // o mesmo cupom de 80 mm do recibo do cliente: só ele sai na impressão (globals.css)
                <article className="recibo-impressao mx-auto grid w-full max-w-[80mm] gap-3 bg-white px-4 py-5 font-mono text-[12px] leading-snug text-black shadow-[0_1px_0_#0001,0_8px_24px_-12px_#0004] print:max-w-none print:px-0 print:shadow-none">
                  <p className="text-center font-sans text-[15px] font-bold">{negocio}</p>
                  <p className="text-center font-bold tracking-[0.2em]">RECIBO DE VALE</p>
                  <p className="text-center">Nº {numeroDoRecibo(id)} · {feito.data.split("-").reverse().join("/")}</p>
                  <p className="flex items-baseline justify-between font-bold"><span>VALOR</span><span className="text-[18px] tabular-nums">{formatBRL(centavos)}</span></p>
                  <p className="text-[11px]">
                    Recebi de {negocio} a importância de {formatBRL(centavos)} ({valorPorExtenso(centavos)}), pagos em {forma === "pix" ? "Pix" : ROTULO_FORMA[forma].toLowerCase()}, como vale (adiantamento de comissão), a ser descontado do próximo pagamento.
                  </p>
                  <div className="grid justify-items-center gap-1 pt-8 text-center">
                    <span className="w-4/5 border-t border-black" />
                    <p className="text-[11px]">{staff.nome}</p>
                  </div>
                  <p className="text-center text-[10px] tracking-wide text-neutral-600">NÃO É DOCUMENTO FISCAL</p>
                </article>
              )}
              <div className="grid gap-2 print:hidden sm:flex sm:justify-end">
                {recibo ? (
                  <Button type="button" variant="outline" className="h-11 px-4" onClick={() => window.print()}>Imprimir</Button>
                ) : (
                  <Button type="button" variant="outline" className="h-11 px-4" onClick={() => setRecibo(true)}>Gerar recibo para assinar</Button>
                )}
                <Button type="button" className="h-11 px-5" onClick={() => onClose(feito.aviso)}>Pronto</Button>
              </div>
            </>
          ) : (
            <form noValidate className="contents" onSubmit={salvar}>
              <div className="grid gap-1">
                <Dialog.Title className="font-serifa text-2xl leading-tight">Vale para {staff.nome}</Dialog.Title>
                <Dialog.Description className="text-sm text-muted-foreground">Parte da comissão paga agora. O valor sai do próximo pagamento de comissão.</Dialog.Description>
              </div>
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">Valor</span>
                <Input autoFocus inputMode="numeric" placeholder="R$ 0,00" value={valor} onChange={(e) => setValor(maskBRL(e.target.value))} className="h-14 font-serifa text-3xl tabular-nums text-red-700 md:text-3xl dark:text-red-300" />
              </label>
              <fieldset className="grid gap-2">
                <legend className="mb-2 text-sm font-medium">Pago com</legend>
                <div className="flex flex-wrap gap-2">
                  {FORMAS.map((f) => <Chip key={f} ativo={forma === f} onClick={() => setForma(f)}>{ROTULO_FORMA[f]}</Chip>)}
                </div>
              </fieldset>
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">E-mail do profissional</span>
                <Input
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={254}
                  placeholder="nome@gmail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value.replace(/\s/g, ""))}
                  onBlur={() => email && setTocouEmail(true)}
                  aria-invalid={!!erroEmail}
                  aria-describedby="vale-email-msg"
                  className="h-11"
                />
                <span id="vale-email-msg" className={erroEmail ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                  {erroEmail || "Ele recebe a confirmação do vale por e-mail."}
                </span>
              </label>
              {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
              <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
                <Button type="button" variant="outline" className="h-11 px-4" disabled={ocupado} onClick={() => onClose()}>Voltar</Button>
                <Button type="submit" className="h-11 px-5" disabled={ocupado}>{ocupado ? "Salvando…" : "Paguei o vale"}</Button>
              </div>
            </form>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
