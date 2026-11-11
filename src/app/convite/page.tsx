"use client";

import { onAuthStateChanged, sendEmailVerification, type User } from "firebase/auth";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AceiteContrato } from "@/components/aceite-contrato";
import { CONTRATO_RECUSADO } from "@/lib/contrato";
import { errorMessage } from "@/lib/auth-errors";
import { auth } from "@/lib/firebase";
import { aceitarConvite, negocioDoConvite } from "./actions";

const SEM_CONEXAO = "Não foi possível abrir o convite agora. Verifique a conexão e tente de novo.";

function Convite() {
  const router = useRouter();
  const token = useSearchParams().get("c") ?? "";
  // link sem token já nasce com erro: nada a sincronizar no efeito
  const [erro, setErro] = useState(token ? "" : "O link do convite está incompleto. Peça outro para quem enviou.");

  // convite do dono: antes de entrar, aceita os Termos de Contratação
  const [dono, setDono] = useState<{ nome: string; user: User } | null>(null);
  const [usuario, setUsuario] = useState<User | null>(null);
  const [precisaConfirmar, setPrecisaConfirmar] = useState(false);
  const [aviso, setAviso] = useState("");
  const [aceito, setAceito] = useState(false);
  const [tentou, setTentou] = useState(false);
  const [busy, setBusy] = useState(false);

  async function aceitar(user: User, contrato = false) {
    setErro("");
    setAviso("");
    // O reload atualiza emailVerified no objeto; o token renovado leva a confirmação ao servidor.
    await user.reload();
    const r = await aceitarConvite(await user.getIdToken(true), token, contrato);
    if (!r.ok) {
      setErro(r.error);
      setPrecisaConfirmar(!user.emailVerified);
      return false;
    }
    router.replace(`/${r.tenantId}`);
    return true;
  }

  useEffect(() => {
    if (!token) return;
    return onAuthStateChanged(auth, async (user) => {
      // Sem conta ainda: entra ou cria, e volta para cá para concluir
      if (!user) return router.replace(`/login?next=${encodeURIComponent(`/convite?c=${token}`)}`);
      setUsuario(user);
      try {
        const n = await negocioDoConvite(token);
        if (!n.ok) return setErro("Convite inválido ou vencido. Peça um link novo.");
        if (n.papel === "admin") return setDono({ nome: n.nome, user });
        await aceitar(user);
      } catch {
        setErro(SEM_CONEXAO);
      }
    });
    // aceitar só usa token e router, que já estão na lista
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, token]);

  async function confirmar() {
    setTentou(true);
    if (!dono || !aceito) return;
    setBusy(true);
    // no sucesso o botão fica travado até a navegação: um segundo clique gravaria outro aceite
    const ok = await aceitar(dono.user, true).catch(() => (setErro(SEM_CONEXAO), false));
    if (!ok) setBusy(false);
  }

  async function reenviarVerificacao() {
    if (!usuario) return;
    setBusy(true);
    setAviso("");
    try {
      const url = new URL(`/convite?c=${token}`, location.origin).toString();
      await sendEmailVerification(usuario, { url });
      setAviso(`Enviamos uma nova confirmação para ${usuario.email}. Depois de confirmar, volte aqui e toque em “Já confirmei, continuar”.`);
    } catch (err) {
      setErro(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function reverificar() {
    if (!usuario) return;
    setBusy(true);
    try {
      if (dono) {
        await usuario.reload();
        if (!usuario.emailVerified) {
          setErro("O e-mail ainda não consta como confirmado. Abra o link enviado e tente de novo.");
          return;
        }
        setPrecisaConfirmar(false);
        setErro("");
        return;
      }
      await aceitar(usuario);
    } catch {
      setErro(SEM_CONEXAO);
    } finally {
      setBusy(false);
    }
  }

  if (dono && !erro) {
    return (
      <main className="mx-auto w-full max-w-md p-4 py-16">
        <Card>
          <CardHeader>
            <CardTitle as="h1">Painel do {dono.nome}</CardTitle>
            <CardDescription>Para liberar o seu acesso, leia e aceite os Termos de Contratação da Ruphus.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <AceiteContrato aceito={aceito} onChange={setAceito} erro={tentou && !aceito} />
            {tentou && !aceito && <p role="alert" className="text-sm text-destructive">{CONTRATO_RECUSADO}</p>}
            <Button onClick={confirmar} disabled={busy}>{busy ? "Liberando…" : "Aceitar e entrar"}</Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-md p-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle as="h1">{erro ? "Convite não aceito" : "Liberando seu acesso…"}</CardTitle>
          <CardDescription>{erro || "Só um instante enquanto abrimos o painel do seu negócio."}</CardDescription>
        </CardHeader>
        {erro && (
          <CardContent className="grid gap-3">
            {aviso && <p role="status" className="text-sm text-muted-foreground">{aviso}</p>}
            {precisaConfirmar ? (
              <>
                <Button onClick={reverificar} disabled={busy || !usuario}>{busy ? "Conferindo…" : "Já confirmei, continuar"}</Button>
                <Button variant="outline" onClick={reenviarVerificacao} disabled={busy || !usuario}>Reenviar confirmação</Button>
                <Button variant="ghost" onClick={() => router.replace(`/login?trocar=1&next=${encodeURIComponent(`/convite?c=${token}`)}`)} disabled={busy}>Entrar com outra conta</Button>
              </>
            ) : (
              <Button onClick={() => router.replace("/painel")}>Ir para o início</Button>
            )}
          </CardContent>
        )}
      </Card>
    </main>
  );
}

export default function ConvitePage() {
  return (
    <Suspense>
      <Convite />
    </Suspense>
  );
}
