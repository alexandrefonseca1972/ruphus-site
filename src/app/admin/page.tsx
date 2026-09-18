"use client";

import { onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { auth } from "@/lib/firebase";
import { gerarConvite, listarAcessos, listarEspacos, revogarAcesso, type Acesso, type Espaco } from "./actions";

async function token() {
  const user = auth.currentUser;
  if (!user) throw new Error("sem sessão");
  return user.getIdToken();
}

export default function AdminPage() {
  const router = useRouter();
  const [estado, setEstado] = useState<"carregando" | "negado" | "pronto">("carregando");
  const [espacos, setEspacos] = useState<Espaco[]>([]);
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);
  const [acessos, setAcessos] = useState<Acesso[]>([]);
  const [convite, setConvite] = useState<{ slug: string; url: string } | null>(null);
  const [aviso, setAviso] = useState("");

  useEffect(
    () =>
      onAuthStateChanged(auth, async (user) => {
        if (!user) return router.replace(`/login?next=${encodeURIComponent("/admin")}`);
        const r = await listarEspacos(await user.getIdToken());
        if (!r.ok) return setEstado("negado");
        setEspacos(r.dados);
        setEstado("pronto");
      }),
    [router],
  );

  async function abrir(slug: string) {
    setAviso("");
    if (aberto === slug) return setAberto(null);
    setAberto(slug);
    setAcessos([]);
    const r = await listarAcessos(await token(), slug);
    if (r.ok) setAcessos(r.dados);
  }

  async function convidar(slug: string) {
    setAviso("");
    const r = await gerarConvite(await token(), slug);
    if (!r.ok) return setAviso(r.error);
    setConvite({ slug, url: r.dados });
    await navigator.clipboard.writeText(r.dados).catch(() => {});
  }

  async function revogar(slug: string, uid: string) {
    const r = await revogarAcesso(await token(), slug, uid);
    setAviso(r.ok ? r.dados : r.error);
    if (r.ok) {
      setAcessos((a) => a.filter((x) => x.uid !== uid));
      setEspacos((e) => e.map((x) => (x.slug === slug ? { ...x, acessos: x.acessos - 1 } : x)));
    }
  }

  if (estado === "carregando") return <main className="p-8 text-sm text-muted-foreground">Carregando…</main>;
  if (estado === "negado")
    return (
      <main className="mx-auto max-w-md p-8">
        <Card>
          <CardHeader>
            <CardTitle>Área restrita</CardTitle>
            <CardDescription>Esta conta não administra a plataforma.</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );

  const termo = busca.trim().toLowerCase();
  const lista = termo
    ? espacos.filter((e) => e.nome.toLowerCase().includes(termo) || e.slug.includes(termo))
    : espacos;
  const comCliente = espacos.filter((e) => e.acessos > 1).length;

  return (
    <main className="mx-auto w-full max-w-3xl p-4 py-8">
      <h1 className="text-2xl font-semibold">Administração</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {espacos.length} espaços · {comCliente} já com acesso do cliente
      </p>

      <Input
        className="mt-6"
        placeholder="Buscar por nome ou endereço"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
      />
      {aviso && <p className="mt-3 text-sm text-muted-foreground">{aviso}</p>}

      <ul className="mt-4 grid gap-2">
        {lista.slice(0, 60).map((e) => (
          <li key={e.slug} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{e.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {e.slug} · {e.acessos > 1 ? `${e.acessos - 1} pessoa(s) do cliente` : "só você"}
                  {e.categoria ? ` · ${e.categoria}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => convidar(e.slug)}>
                  Link de convite
                </Button>
                <Button size="sm" variant="outline" onClick={() => abrir(e.slug)}>
                  Acessos
                </Button>
                <a
                  className="inline-flex h-9 items-center rounded-md border px-3 text-sm"
                  href={`/${e.slug}`}
                >
                  Painel
                </a>
                <a
                  className="inline-flex h-9 items-center rounded-md border px-3 text-sm"
                  href={`https://${e.slug}.ruphus.site/`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Site ↗
                </a>
              </div>
            </div>

            {convite?.slug === e.slug && (
              <p className="mt-3 break-all rounded bg-muted p-2 text-xs">
                Copiado: {convite.url}
              </p>
            )}

            {aberto === e.slug && (
              <ul className="mt-3 grid gap-1 text-sm">
                {acessos.map((a) => (
                  <li key={a.uid} className="flex items-center justify-between gap-2">
                    <span className="truncate text-muted-foreground">
                      {a.papel} · {a.uid}
                    </span>
                    {a.papel !== "owner" && (
                      <Button size="sm" variant="ghost" onClick={() => revogar(e.slug, a.uid)}>
                        Remover
                      </Button>
                    )}
                  </li>
                ))}
                {!acessos.length && <li className="text-muted-foreground">Carregando acessos…</li>}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {lista.length > 60 && (
        <p className="mt-3 text-sm text-muted-foreground">
          Mostrando 60 de {lista.length}. Use a busca para chegar no espaço.
        </p>
      )}
    </main>
  );
}
