"use client";

import { Dialog } from "@base-ui/react/dialog";
import { doc, getDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPhone } from "@/lib/datetime";
import { db } from "@/lib/firebase-db";
import { idDoEstorno, Lancamento } from "@/lib/financeiro";
import { erroDoEmail, type Emissor, linhasDoRecibo, sugestaoDeEmail, textoDoRecibo } from "@/lib/recibo";
import { openExternal } from "@/lib/utils";

/** Recibo de um recebimento: para imprimir, mandar no WhatsApp do cliente ou por e-mail.
 *  O texto sai do lançamento; o cabeçalho, dos dados do negócio (os mesmos do site). */
export function Recibo({ tenantId, itens, onClose }: { tenantId: string; itens: Lancamento[]; onClose: () => void }) {
  const [lancamento] = itens;
  const ids = itens.map((i) => i.id).join(",");
  // o recibo só sai com tudo lido: sinal de outro mês, estornos e o emissor. Faltou um, não emite
  const [lido, setLido] = useState<{ ids: string; emissor: Emissor; itens: Lancamento[]; estornos: Record<string, number> } | null>(null);
  const [erro, setErro] = useState("");
  const [email, setEmail] = useState("");
  // o erro só aparece depois que a pessoa saiu do campo ou tentou enviar; daí, a cada tecla
  const [tocouEmail, setTocouEmail] = useState(false);

  useEffect(() => {
    let vivo = true;
    const t = doc(db, "tenants", tenantId);
    const lista = ids.split(",");
    // o sinal (sn-) e o restante (ag-) do mesmo atendimento podem estar em meses diferentes
    const faltam = [...new Set(lista.filter((id) => /^(ag|sn)-/.test(id)).flatMap((id) => [`ag-${id.slice(3)}`, `sn-${id.slice(3)}`]))].filter((id) => !lista.includes(id));
    (async () => {
      const [n, outros] = await Promise.all([getDoc(t), Promise.all(faltam.map((id) => getDoc(doc(t, "lancamentos", id))))]);
      const extras = outros.flatMap((d) => {
        const l = d.exists() ? Lancamento.safeParse(d.data()) : null;
        return l?.success && l.data.tipo === "entrada" ? [{ ...l.data, id: d.id }] : [];
      });
      const todos = [...itens, ...extras].sort((a, b) => a.id.localeCompare(b.id));
      // o estorno pode ter nascido noutro mês: lido um por um, não da lista da tela
      const es = await Promise.all(todos.map((i) => getDoc(doc(t, "lancamentos", idDoEstorno(i.id)))));
      // o e-mail do cadastro só preenche o campo: sem ele, o recibo sai do mesmo jeito
      const cliente = lancamento.customerKey ? await getDoc(doc(t, "customers", lancamento.customerKey)).catch(() => null) : null;
      if (!vivo) return;
      setLido({
        ids,
        itens: todos,
        estornos: Object.fromEntries(es.filter((e) => e.exists()).map((e) => [String(e.get("estornoDe")), Number(e.get("valorCents")) || 0])),
        emissor: {
          nome: String(n.get("name") ?? ""),
          telefone: n.get("site.phone") ? formatPhone(String(n.get("site.phone"))) : null,
          endereco: [n.get("site.address"), n.get("site.bairro")].filter(Boolean).join(", ") || null,
          cidade: n.get("site.city") ?? null,
          uf: n.get("site.uf") ?? null,
        },
      });
      const e = cliente?.get("email");
      if (typeof e === "string") setEmail(e);
    })().catch((err) => {
      console.error("[recibo] leitura", err);
      if (vivo) setErro("Não foi possível montar o recibo agora. Verifique a conexão e tente de novo.");
    });
    return () => {
      vivo = false;
    };
    // itens vem junto de ids: a lista muda quando os ids mudam
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, ids, lancamento.customerKey]);

  const r = lido?.ids === ids && !erro ? linhasDoRecibo(lido.itens.map((i) => ({ ...i, estornadoCents: lido.estornos[i.id] ?? 0 })), lido.emissor) : null;
  // o número do cliente vem do agendamento (55DDNNNNNNNNN); avulso abre o WhatsApp para escolher o contato
  const zap = () => r && openExternal(`https://wa.me/${(lancamento.customerKey ?? "").replace(/\D/g, "")}?text=${encodeURIComponent(textoDoRecibo(r, true))}`);
  const erroEmail = tocouEmail ? erroDoEmail(email) : "";
  const sugestao = sugestaoDeEmail(email);
  const foneCliente = lancamento.customerKey ? formatPhone(lancamento.customerKey) : "";
  function porEmail(e: React.FormEvent) {
    e.preventDefault();
    setTocouEmail(true);
    if (!r || erroDoEmail(email)) return;
    // pelo app de e-mail do aparelho: sai do endereço do próprio salão, e o cliente responde para ele.
    // O @ vai legível: alguns apps de e-mail não decodificam %40 no destinatário
    window.location.assign(`mailto:${encodeURIComponent(email.trim()).replace(/%40/g, "@")}?subject=${encodeURIComponent(`${r.titulo} · ${r.emissor[0] ?? ""}`)}&body=${encodeURIComponent(textoDoRecibo(r))}`);
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 print:hidden" />
        <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 grid max-h-[92dvh] gap-5 overflow-y-auto rounded-t-2xl border bg-popover p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-popover-foreground shadow-xl outline-none sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-6 print:static print:max-h-none print:translate-none print:overflow-visible print:border-0 print:p-0 print:shadow-none">
          <Dialog.Title className="font-serifa text-2xl leading-tight print:hidden">Recibo</Dialog.Title>
          {erro ? (
            <p role="alert" className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive">{erro}</p>
          ) : !r ? (
            <div className="mx-auto h-96 w-full max-w-[80mm] animate-pulse rounded-sm bg-muted" aria-hidden="true" />
          ) : (
            // cupom de 80 mm: o mesmo na tela e na impressora térmica. Só ele sai na impressão (globals.css)
            <article className="recibo-impressao mx-auto grid w-full max-w-[80mm] gap-3 bg-white px-4 py-5 font-mono text-[12px] leading-snug text-black shadow-[0_1px_0_#0001,0_8px_24px_-12px_#0004] [mask:radial-gradient(4px_at_50%_100%,#0000_98%,#000)_50%_100%/12px_100%] print:max-w-none print:px-0 print:shadow-none print:[mask:none]">
              <header className="grid justify-items-center gap-0.5 text-center">
                <p className="font-sans text-[15px] font-bold tracking-tight">{r.emissor[0]}</p>
                {r.emissor.slice(1).map((linha) => <p key={linha} className="break-words">{linha}</p>)}
              </header>
              <Tracejado />
              <div className="grid justify-items-center gap-0.5 text-center">
                <p className="font-bold tracking-[0.2em]">RECIBO</p>
                <p>{r.titulo.replace("Recibo ", "")} · {r.detalhes[0][1]}</p>
              </div>
              <Tracejado />
              <table className="w-full table-fixed border-collapse">
                <caption className="sr-only">Serviços realizados</caption>
                <thead>
                  <tr className="text-left">
                    <th scope="col" className="pb-1 font-bold">SERVIÇO</th>
                    <th scope="col" className="w-[34%] pb-1 text-right font-bold">VALOR</th>
                  </tr>
                </thead>
                <tbody>
                  {r.itens.map((i, n) => (
                    <tr key={n} className="align-top">
                      <td className="py-1 pr-2 break-words">
                        {String(n + 1).padStart(2, "0")} {i.servico}
                        {i.profissional && <span className="block pl-[3ch] text-[11px] text-neutral-600">{i.profissional}</span>}
                      </td>
                      <td className="py-1 text-right whitespace-nowrap tabular-nums">{i.valor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Tracejado />
              {/* como foi pago: o sinal do agendamento (Pix) e o resto no balcão, cada um com a sua parte */}
              <div className="grid gap-1">
                <p className="font-bold">PAGAMENTO</p>
                {r.pagamentos.map((p, n) => (
                  <p key={n} className="flex justify-between gap-2">
                    <span className="min-w-0 break-words">
                      {p.rotulo}
                      {p.detalhe && <span className="block text-[11px] text-neutral-600">{p.detalhe}</span>}
                    </span>
                    <span className="shrink-0 whitespace-nowrap tabular-nums">{p.valor}</span>
                  </p>
                ))}
              </div>
              <Tracejado />
              <div className="flex items-baseline justify-between gap-2 font-bold">
                <span className="text-[13px]">TOTAL</span>
                <span className="text-[18px] tabular-nums">{r.valor}</span>
              </div>
              {r.detalhes.slice(1).map(([k, v]) => (
                <p key={k} className="flex justify-between gap-2"><span>{k}</span><span className="text-right">{v}</span></p>
              ))}
              <Tracejado />
              <p className="text-[11px]">{r.declaracao}</p>
              <div className="grid justify-items-center gap-1 pt-6 text-center">
                <span className="w-4/5 border-t border-black" />
                <p className="text-[11px]">{r.emissor[0]}</p>
              </div>
              <p className="text-center text-[11px]">{r.rodape}</p>
              <Tracejado />
              <p className="text-center text-[10px] tracking-wide text-neutral-600">NÃO É DOCUMENTO FISCAL</p>
              <p className="text-center text-[11px]">Obrigado pela preferência!</p>
            </article>
          )}
          <div className="grid gap-4 print:hidden">
            <Button type="button" className="h-12 text-base" disabled={!r} onClick={() => window.print()}>Imprimir</Button>
            <section aria-labelledby="recibo-enviar" className="grid gap-3 rounded-xl border p-4">
              <h3 id="recibo-enviar" className="text-sm font-semibold">Enviar ao cliente</h3>
              <Button type="button" variant="outline" className="h-auto min-h-12 justify-between gap-3 px-4 py-2 text-left" disabled={!r} onClick={zap}>
                <span className="grid">
                  <span className="font-medium">WhatsApp</span>
                  <span className="text-xs font-normal text-muted-foreground">{foneCliente || "Você escolhe o contato"}</span>
                </span>
                <span aria-hidden="true">↗</span>
              </Button>
              <form noValidate onSubmit={porEmail} className="grid gap-1.5">
                <Label htmlFor="recibo-email">E-mail</Label>
                <div className="flex gap-2">
                  <Input
                    id="recibo-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="send"
                    maxLength={254}
                    placeholder="nome@gmail.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value.replace(/\s/g, ""))}
                    onBlur={() => email && setTocouEmail(true)}
                    aria-invalid={!!erroEmail}
                    aria-describedby="recibo-email-msg"
                    className="h-12 min-w-0 flex-1 sm:h-11"
                  />
                  <Button type="submit" variant="outline" className="h-12 shrink-0 px-4 sm:h-11" disabled={!r}>Enviar</Button>
                </div>
                <p id="recibo-email-msg" className={erroEmail ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                  {erroEmail ||
                    (sugestao ? (
                      <>
                        Você quis dizer{" "}
                        <button type="button" className="font-medium text-foreground underline underline-offset-2" onClick={() => setEmail(sugestao)}>{sugestao}</button>?
                      </>
                    ) : (
                      "Abre o seu app de e-mail com o recibo pronto para enviar."
                    ))}
                </p>
              </form>
            </section>
            <Button type="button" variant="ghost" className="h-11" onClick={onClose}>Fechar</Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const Tracejado = () => <hr className="border-0 border-t border-dashed border-black/60" />;
