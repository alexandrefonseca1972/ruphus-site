"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useState } from "react";
import { z } from "zod";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { idToken } from "@/lib/firebase";
import { convidarEquipeAction, tirarAcessoEquipeAction } from "../actions";
import { ConfirmDialog } from "../confirm-dialog";

/** Quem da equipe já entra no painel: o convite da equipe grava o profissional no membro. */
export const Membro = z.object({ uid: z.string(), role: z.string(), email: z.string().optional(), staffId: z.string().optional() });
export type Membro = z.infer<typeof Membro> & { id: string };

/** O acesso de um profissional ao painel: quem já entra (e tirar) ou o convite para entrar. */
export function AcessoProfissional({ tenantId, negocio, staffId, nome, membro }: { tenantId: string; negocio: string; staffId: string; nome: string; membro?: Membro }) {
  const [convidando, setConvidando] = useState(false);
  const [tirando, setTirando] = useState(false);
  const [erro, setErro] = useState("");

  if (membro) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        <span className="text-muted-foreground">Entra no painel com <span className="font-medium text-foreground">{membro.email ?? "a conta dele"}</span></span>
        <button type="button" onClick={() => setTirando(true)} className="min-h-9 text-destructive underline underline-offset-4">Tirar acesso</button>
        {erro && <span role="alert" className="text-destructive">{erro}</span>}
        {tirando && (
          <ConfirmDialog
            title={`Tirar o acesso de ${nome}?`}
            description="A conta deixa de abrir o painel deste negócio. O cadastro do profissional e a agenda continuam como estão."
            confirmLabel="Tirar acesso"
            onConfirm={async () => {
              setTirando(false);
              const r = await tirarAcessoEquipeAction(await idToken(), { tenantId, uid: membro.uid }).catch(() => ({ ok: false as const, error: "Sem conexão. Tente de novo." }));
              setErro(r.ok ? "" : r.error);
            }}
            onCancel={() => setTirando(false)}
          />
        )}
      </div>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setConvidando(true)} className="min-h-9 justify-self-start text-[13px] underline underline-offset-4 hover:text-muted-foreground">
        Dar acesso ao painel
      </button>
      {convidando && <Convite tenantId={tenantId} negocio={negocio} staffId={staffId} nome={nome} onClose={() => setConvidando(false)} />}
    </>
  );
}

function Convite({ tenantId, negocio, staffId, nome, onClose }: { tenantId: string; negocio: string; staffId: string; nome: string; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [link, setLink] = useState<{ url: string; dias: number; email: string } | null>(null);
  const [copiado, setCopiado] = useState(false);

  async function gerar() {
    setErro("");
    setOcupado(true);
    const r = await convidarEquipeAction(await idToken(), { tenantId, staffId, email }).catch(() => ({ ok: false as const, error: "Sem conexão. Tente de novo." }));
    setOcupado(false);
    if (!r.ok) return setErro(r.error);
    setLink({ url: r.url, dias: r.dias, email: email.trim() });
  }

  const texto = link && `Oi, ${nome.split(" ")[0]}! Este link libera seu acesso à agenda do ${negocio}: ${link.url}\n\nEntre ou crie a conta com o e-mail ${link.email}. O link vale ${link.dias} dias e só funciona uma vez.`;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && !ocupado && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 grid max-h-[92dvh] gap-5 overflow-y-auto rounded-t-2xl border bg-popover p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-popover-foreground shadow-xl outline-none sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-6">
          <div className="grid gap-1">
            <Dialog.Title className="font-serifa text-2xl leading-tight">Acesso de {nome}</Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">
              Vê a agenda e os clientes, e marca, confirma e remarca horários. Não vê o Caixa nem os dados do negócio.
            </Dialog.Description>
          </div>

          {!link ? (
            <form className="grid gap-3" onSubmit={(e) => (e.preventDefault(), void gerar())}>
              <label className="grid gap-1.5 text-sm font-medium">
                E-mail de {nome.split(" ")[0]}
                <Input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@gmail.com" className="h-11 font-normal" />
              </label>
              <p className="text-[13px] text-muted-foreground">O link só abre para quem entrar com este e-mail, depois de confirmado.</p>
              {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" className="h-11 px-4" disabled={ocupado} onClick={onClose}>Cancelar</Button>
                <Button type="submit" className="h-11 px-5" disabled={ocupado}>{ocupado ? "Gerando…" : "Gerar link"}</Button>
              </div>
            </form>
          ) : (
            <div className="grid gap-3">
              <p className="text-sm">Mande o link para {nome.split(" ")[0]}. Ele vale {link.dias} dias e só funciona uma vez.</p>
              <Input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} className="h-11 font-mono text-xs" aria-label="Link de acesso" />
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" className="h-11 px-4" onClick={onClose}>Fechar</Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 px-4"
                  onClick={() => navigator.clipboard.writeText(texto!).then(() => setCopiado(true), () => setErro("Não deu para copiar. Selecione o link e copie."))}
                >
                  {copiado ? "Copiado" : "Copiar mensagem"}
                </Button>
                <a href={`https://wa.me/?text=${encodeURIComponent(texto!)}`} target="_blank" rel="noopener" className={buttonVariants({ className: "h-11 px-5" })}>
                  Enviar no WhatsApp
                </a>
              </div>
              {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
