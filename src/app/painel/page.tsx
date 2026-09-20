"use client";

import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/auth-errors";
import { auth } from "@/lib/firebase";
import { createTenant, myTenantIds } from "@/lib/tenants";
import { handleSubmit } from "@/lib/utils";

const slugify = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 63);

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [tenants, setTenants] = useState<string[] | null>(null);
  const [slug, setSlug] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(
    () =>
      onAuthStateChanged(auth, async (u) => {
        if (!u) return router.replace("/login");
        setUser(u);
        try {
          setTenants(await myTenantIds());
        } catch (err) {
          setError(errorMessage(err));
          setTenants([]);
        }
      }),
    [router],
  );

  async function create(form: FormData) {
    setError("");
    setBusy(true);
    try {
      router.push(`/${await createTenant({ name: form.get("name") as string, slug })}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (!user || !tenants) return <p className="p-8">Carregando…</p>;

  return (
    <main className="mx-auto grid w-full max-w-md gap-6 p-4 py-12">
      <div className="flex items-center justify-between gap-4">
        <p className="truncate text-sm text-muted-foreground">{user.email}</p>
        <Button variant="ghost" size="sm" onClick={() => signOut(auth)}>
          Sair
        </Button>
      </div>

      {tenants.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle as="h1">Seus negócios</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {tenants.map((id) => (
              <Link key={id} href={`/${id}`} className={buttonVariants({ variant: "outline", className: "justify-start" })}>
                /{id}
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle as={tenants.length ? "h2" : "h1"}>{tenants.length ? "Cadastrar outro negócio" : "Cadastre o seu primeiro negócio"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(create)} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Nome</Label>
              <Input id="name" name="name" required maxLength={80} onChange={(e) => setSlug(slugify(e.target.value))} />
            </div>
            <div className="grid gap-2">
              {/* Vem preenchido do nome. "Endereço" sozinho convidava a escrever a rua, e
                  a validação recusava — trocar o valor certo por um errado era o caminho natural. */}
              <Label htmlFor="slug">Endereço do link</Label>
              <Input id="slug" value={slug} onChange={(e) => setSlug(e.target.value)} required />
              <p className="text-xs text-muted-foreground">ruphus.site/agendar/{slug || "seu-negocio"}</p>
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={busy}>Criar</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
