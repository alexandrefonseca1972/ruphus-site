"use client";

import { applyActionCode, confirmPasswordReset, verifyPasswordResetCode } from "firebase/auth";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/auth-errors";
import { auth } from "@/lib/firebase";

// Destino dos links dos e-mails do Firebase Auth (URL de ação personalizada nos
// modelos do console). Link no mesmo domínio do remetente: um link para
// firebaseapp.com num e-mail de ruphus.site leva a mensagem para o spam.

// Os modos que só aplicam o código. Pedem um clique em vez de rodar ao abrir:
// o Outlook e antivírus abrem os links do e-mail antes da pessoa, e o código
// vale uma vez só.
const APLICAR: Record<string, { titulo: string; botao: string; feito: string }> = {
  verifyEmail: { titulo: "Confirmar seu e-mail", botao: "Confirmar e-mail", feito: "E-mail confirmado." },
  verifyAndChangeEmail: { titulo: "Confirmar o novo e-mail", botao: "Confirmar novo e-mail", feito: "Seu e-mail de acesso foi alterado." },
  recoverEmail: {
    titulo: "Desfazer a troca de e-mail",
    botao: "Voltar ao e-mail anterior",
    feito: "Seu e-mail de acesso voltou ao anterior. Por segurança, troque a senha em “Esqueci a senha”.",
  },
  revertSecondFactorAddition: {
    titulo: "Remover a verificação em duas etapas",
    botao: "Remover",
    feito: "A verificação em duas etapas foi removida. Por segurança, troque a senha.",
  },
};

function Acao() {
  const params = useSearchParams();
  const modo = params.get("mode") ?? "";
  const codigo = params.get("oobCode") ?? "";
  const valido = Boolean(codigo) && (modo === "resetPassword" || Object.hasOwn(APLICAR, modo));

  const [erro, setErro] = useState(valido ? "" : "Este link está incompleto. Peça um novo.");
  const [feito, setFeito] = useState("");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");

  // Redefinição: confere o código antes de pedir a senha nova, para quem abriu
  // um link vencido saber disso antes de digitar
  useEffect(() => {
    if (!valido || modo !== "resetPassword") return;
    verifyPasswordResetCode(auth, codigo).then(setEmail, (e) => setErro(errorMessage(e)));
  }, [valido, modo, codigo]);

  async function rodar(acao: () => Promise<string>) {
    setErro("");
    setBusy(true);
    try {
      setFeito(await acao());
    } catch (e) {
      setErro(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const aplicar = Object.hasOwn(APLICAR, modo) ? APLICAR[modo] : undefined;
  const titulo = modo === "resetPassword" ? "Criar uma senha nova" : (aplicar?.titulo ?? "Link inválido");

  return (
    <main className="mx-auto w-full max-w-md p-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle as="h1">{titulo}</CardTitle>
          <CardDescription>
            {feito || (modo === "resetPassword" && email ? `Para a conta ${email}.` : "")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {erro && (
            <p role="alert" className="rounded-xl border border-[#E3C6BD] bg-[#FBEFEB] p-3 text-[13px] leading-snug text-[#8A3A22]">
              {erro}
            </p>
          )}

          {feito ? (
            <Link href="/login" className={buttonVariants()}>Entrar na Ruphus</Link>
          ) : modo === "resetPassword" ? (
            email && (
              <form
                className="grid gap-3"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  const senha = String(new FormData(ev.currentTarget).get("senha") ?? "");
                  rodar(() => confirmPasswordReset(auth, codigo, senha).then(() => "Senha trocada. Já pode entrar com ela."));
                }}
              >
                <label htmlFor="senha" className="text-sm font-medium">Senha nova</label>
                <Input id="senha" name="senha" type="password" autoComplete="new-password" minLength={6} required />
                <span className="text-xs text-[#8C8574]">Pelo menos 6 caracteres.</span>
                <Button type="submit" disabled={busy}>{busy ? "Um instante…" : "Salvar senha"}</Button>
              </form>
            )
          ) : aplicar ? (
            <Button disabled={busy} onClick={() => rodar(() => applyActionCode(auth, codigo).then(() => aplicar.feito))}>
              {busy ? "Um instante…" : aplicar.botao}
            </Button>
          ) : (
            <Link href="/login" className={buttonVariants({ variant: "outline" })}>Ir para o login</Link>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

export default function ContaPage() {
  return (
    <Suspense>
      <Acao />
    </Suspense>
  );
}
