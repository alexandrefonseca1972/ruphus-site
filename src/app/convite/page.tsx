"use client";

import { onAuthStateChanged } from "firebase/auth";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/firebase";
import { aceitarConvite } from "./actions";

function Convite() {
  const router = useRouter();
  const token = useSearchParams().get("c") ?? "";
  // link sem token já nasce com erro: nada a sincronizar no efeito
  const [erro, setErro] = useState(token ? "" : "O link do convite está incompleto. Peça outro para quem enviou.");

  useEffect(() => {
    if (!token) return;
    return onAuthStateChanged(auth, async (user) => {
      // Sem conta ainda: entra ou cria, e volta para cá para concluir
      if (!user) return router.replace(`/login?next=${encodeURIComponent(`/convite?c=${token}`)}`);
      const r = await aceitarConvite(await user.getIdToken(), token);
      if (!r.ok) return setErro(r.error);
      router.replace(`/${r.tenantId}`);
    });
  }, [router, token]);

  return (
    <main className="mx-auto w-full max-w-md p-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle>{erro ? "Convite não aceito" : "Liberando seu acesso…"}</CardTitle>
          <CardDescription>{erro || "Só um instante enquanto abrimos o painel do seu negócio."}</CardDescription>
        </CardHeader>
        {erro && (
          <CardContent>
            <Button onClick={() => router.replace("/")}>Ir para o início</Button>
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
