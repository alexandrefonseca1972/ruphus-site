"use client";

import { onAuthStateChanged, type User } from "firebase/auth";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AceiteContrato } from "@/components/aceite-contrato";
import { CONTRATO_RECUSADO } from "@/lib/contrato";
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
  const [aceito, setAceito] = useState(false);
  const [tentou, setTentou] = useState(false);
  const [busy, setBusy] = useState(false);

  async function aceitar(user: User, contrato = false) {
    // token renovado à força: quem acabou de confirmar o e-mail ainda carrega
    // um token dizendo que não confirmou, e o convite preso recusaria de novo
    const r = await aceitarConvite(await user.getIdToken(true), token, contrato);
    if (!r.ok) {
      setErro(r.error);
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
          <CardContent>
            <Button onClick={() => router.replace("/painel")}>Ir para o início</Button>
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
