"use client";

import { sendEmailVerification, type User } from "firebase/auth";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/auth-errors";
import { sair } from "@/lib/sessao";

const INTERVALO_MS = 3000;
const ESPERA_REENVIO_S = 60;

/** Antes do formulário do negócio: quem criou conta com senha confirma o e-mail primeiro, em vez
 *  de preencher tudo e esbarrar no fim. A tela confere sozinha (a cada 3 s e quando a aba volta
 *  ao foco) e segue quando o link do e-mail for aberto, aqui ou em outro aparelho. */
export function ConfirmarEmail({ user, onConfirmado }: { user: User; onConfirmado: () => void }) {
  const [espera, setEspera] = useState(0);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    let conferindo = false;
    async function conferir() {
      if (conferindo || document.visibilityState !== "visible") return;
      conferindo = true;
      try {
        await user.reload();
        if (!vivo || !user.emailVerified) return;
        // o servidor lê a confirmação do token: renova antes de mostrar o formulário
        await user.getIdToken(true);
        if (vivo) onConfirmado();
      } catch {
        // sem rede: tenta na próxima volta
      } finally {
        conferindo = false;
      }
    }
    const t = setInterval(conferir, INTERVALO_MS);
    document.addEventListener("visibilitychange", conferir);
    window.addEventListener("focus", conferir);
    return () => {
      vivo = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", conferir);
      window.removeEventListener("focus", conferir);
    };
  }, [user, onConfirmado]);

  useEffect(() => {
    if (!espera) return;
    const t = setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  async function reenviar() {
    setAviso(null);
    setEspera(ESPERA_REENVIO_S);
    try {
      await sendEmailVerification(user, { url: `${location.origin}/painel` });
      setAviso({ ok: true, texto: "Enviamos de novo. Confira também a caixa de spam e promoções." });
    } catch (e) {
      setAviso({ ok: false, texto: errorMessage(e) });
    }
  }

  return (
    <section aria-labelledby="confirmar-t" className="grid gap-5 rounded-2xl border bg-card p-5 sm:p-7">
      <div className="grid gap-2">
        <h2 id="confirmar-t" className="text-[17px] font-semibold">Confirme seu e-mail para continuar</h2>
        <p className="text-[15px] text-muted-foreground">
          Enviamos um link para <b className="font-medium break-all text-foreground">{user.email}</b>. Abra o e-mail e toque em
          {" "}<b className="font-medium text-foreground">Confirmar e-mail</b>. Esta tela continua sozinha assim que você confirmar, mesmo que seja pelo celular.
        </p>
      </div>
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-primary" />
        Aguardando a confirmação…
      </p>
      {aviso && <p role={aviso.ok ? "status" : "alert"} className={aviso.ok ? "text-sm text-emerald-800" : "text-sm text-destructive"}>{aviso.texto}</p>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="outline" className="h-12 px-4 sm:h-11" disabled={espera > 0} onClick={() => void reenviar()}>
          {espera > 0 ? `Reenviar em ${espera} s` : "Reenviar e-mail"}
        </Button>
        {/* e-mail digitado errado: a conta nova é o caminho mais curto (trocar exigiria confirmar o novo do mesmo jeito) */}
        <Button type="button" variant="ghost" className="h-12 px-4 sm:h-11" onClick={() => void sair("/login?criar=1&trocar=1")}>
          Usar outro e-mail
        </Button>
      </div>
    </section>
  );
}
