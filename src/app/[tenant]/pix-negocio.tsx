"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { idToken } from "@/lib/firebase";
import { salvarPixAction } from "./actions";
import { useTenant } from "./layout";

/** A chave Pix do salão: com ela, o Caixa mostra o QR com o valor na hora de receber. */
export function PixNegocio() {
  const tenant = useTenant();
  const inicial = { chave: tenant.pix?.chave ?? "", nome: tenant.pix?.nome ?? "", cidade: tenant.pix?.cidade ?? "" };
  const [pix, setPix] = useState(inicial);
  const [salvo, setSalvo] = useState(inicial);
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const mudou = pix.chave !== salvo.chave || pix.nome !== salvo.nome || pix.cidade !== salvo.cidade;
  const campo = (k: keyof typeof pix) => (e: React.ChangeEvent<HTMLInputElement>) => (setPix({ ...pix, [k]: e.target.value }), setAviso(null));

  async function salvar() {
    setBusy(true);
    setAviso(null);
    const r = await salvarPixAction(await idToken(), { tenantId: tenant.id, pix }).catch(() => null);
    setBusy(false);
    if (!r) return setAviso({ ok: false, texto: "Não foi possível salvar. Verifique a conexão e tente de novo." });
    if (!r.ok) return setAviso({ ok: false, texto: r.error });
    // a chave volta como o banco espera (ex.: celular com +55): é a que o QR usa
    const gravado = r.pix ?? { chave: "", nome: "", cidade: "" };
    setPix(gravado);
    setSalvo(gravado);
    tenant.atualizar?.({ pix: r.pix ?? undefined });
    setAviso({ ok: true, texto: r.pix ? "Salvo. No Caixa, escolha Pix ao receber e toque em \"Mostrar QR do Pix\"." : "Chave removida." });
  }

  return (
    <form
      noValidate
      className="grid gap-4 rounded-2xl border bg-card p-5 sm:p-7 lg:max-w-[calc(100%-24rem)]"
      onSubmit={(e) => {
        e.preventDefault();
        void salvar();
      }}
    >
      <div className="grid gap-1">
        <h2 className="text-[15px] font-semibold">Pix para receber</h2>
        <p className="text-sm text-muted-foreground">
          Opcional. Com a sua chave, o Caixa mostra o QR com o valor para o cliente pagar na hora. O dinheiro cai direto na sua conta: confira no app do banco antes de dar baixa.
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="pix-chave">Chave Pix</Label>
        <Input id="pix-chave" value={pix.chave} maxLength={100} onChange={campo("chave")} placeholder="CPF, CNPJ, e-mail, celular ou chave aleatória" className="h-12 bg-card px-3.5 text-base sm:h-11 sm:text-[15px]" />
        <p className="text-xs text-muted-foreground">Celular que também é um CPF válido? Escreva com +55 na frente.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="pix-nome">Nome de quem recebe</Label>
          <Input id="pix-nome" value={pix.nome} maxLength={100} onChange={campo("nome")} placeholder="Como está no banco" className="h-12 bg-card px-3.5 text-base sm:h-11 sm:text-[15px]" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pix-cidade">Cidade</Label>
          <Input id="pix-cidade" value={pix.cidade} maxLength={60} onChange={campo("cidade")} className="h-12 bg-card px-3.5 text-base sm:h-11 sm:text-[15px]" />
        </div>
      </div>
      {aviso && (
        <p role={aviso.ok ? "status" : "alert"} className={aviso.ok ? "text-sm text-emerald-700 dark:text-emerald-300" : "text-sm text-destructive"}>
          {aviso.texto}
        </p>
      )}
      <div className="flex items-center justify-end gap-3">
        {mudou && !busy && <span className="text-xs text-muted-foreground">Alterações não salvas</span>}
        <Button type="submit" disabled={busy || !mudou} className="h-12 px-5 text-[15px] sm:h-11 sm:text-sm">{busy ? "Salvando…" : "Salvar Pix"}</Button>
      </div>
    </form>
  );
}
