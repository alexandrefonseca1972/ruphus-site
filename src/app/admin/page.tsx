"use client";

import { onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { auth } from "@/lib/firebase";
import { gerarConvite, listarAcessos, listarEspacos, revogarAcesso, type Acesso, type Espaco } from "./actions";

const PAGINA = 40;

async function token() {
  const user = auth.currentUser;
  if (!user) throw new Error("sem sessão");
  return user.getIdToken();
}

// contagem por cidade/nicho para mostrar quantos há em cada opção do filtro
const contar = (espacos: Espaco[], campo: (e: Espaco) => string | null) => {
  const m = new Map<string, number>();
  for (const e of espacos) {
    const v = campo(e);
    if (v) m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// relevância: nota pesa, mas um 5,0 com 3 avaliações não passa na frente de um 4,7 com 500
const relevancia = (e: Espaco) => (e.nota ?? 0) * Math.log10((e.avaliacoes ?? 0) + 1);

function Filtro({ valor, onChange, opcoes, rotulo }: {
  valor: string; onChange: (v: string) => void; opcoes: [string, number][]; rotulo: string;
}) {
  return (
    <select
      aria-label={rotulo}
      value={valor}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-md border bg-background px-2 text-sm"
    >
      <option value="">{rotulo}: todos</option>
      {opcoes.map(([v, n]) => (
        <option key={v} value={v}>{v} ({n})</option>
      ))}
    </select>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const [estado, setEstado] = useState<"carregando" | "negado" | "pronto">("carregando");
  const [espacos, setEspacos] = useState<Espaco[]>([]);
  const [busca, setBusca] = useState("");
  const [cidade, setCidade] = useState("");
  const [nicho, setNicho] = useState("");
  const [acesso, setAcesso] = useState("");
  const [ordem, setOrdem] = useState<"relevancia" | "nome" | "nota">("relevancia");
  // quantos itens mostrar, guardados junto com o filtro: trocou o filtro, volta ao início
  const [pagina, setPagina] = useState({ chave: "", n: PAGINA });
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

  const cidades = useMemo(() => contar(espacos, (e) => (e.cidade ? `${e.cidade}${e.uf ? `/${e.uf}` : ""}` : null)), [espacos]);
  const nichos = useMemo(() => contar(espacos, (e) => e.nicho), [espacos]);

  const lista = useMemo(() => {
    const termo = semAcento(busca.trim());
    const filtrada = espacos.filter((e) => {
      if (cidade && `${e.cidade ?? ""}${e.uf ? `/${e.uf}` : ""}` !== cidade) return false;
      if (nicho && e.nicho !== nicho) return false;
      if (acesso === "com" && e.acessos <= 1) return false;
      if (acesso === "sem" && e.acessos > 1) return false;
      if (!termo) return true;
      // busca por nome, endereço do site, cidade e telefone
      return semAcento(`${e.nome} ${e.slug} ${e.cidade ?? ""} ${e.telefone ?? ""}`).includes(termo);
    });
    const por = {
      relevancia: (a: Espaco, b: Espaco) => relevancia(b) - relevancia(a) || a.nome.localeCompare(b.nome, "pt-BR"),
      nota: (a: Espaco, b: Espaco) => (b.nota ?? 0) - (a.nota ?? 0) || (b.avaliacoes ?? 0) - (a.avaliacoes ?? 0),
      nome: (a: Espaco, b: Espaco) => a.nome.localeCompare(b.nome, "pt-BR"),
    }[ordem];
    return [...filtrada].sort(por);
  }, [espacos, busca, cidade, nicho, acesso, ordem]);

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

  const chave = [busca, cidade, nicho, acesso, ordem].join("|");
  const quantos = pagina.chave === chave ? pagina.n : PAGINA;
  const comCliente = espacos.filter((e) => e.acessos > 1).length;
  const filtrando = busca || cidade || nicho || acesso;

  return (
    <main className="mx-auto w-full max-w-4xl p-4 py-8">
      <h1 className="text-2xl font-semibold">Administração</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {espacos.length} espaços · {comCliente} com o cliente dentro · {espacos.length - comCliente} a convidar
      </p>

      <div className="sticky top-0 z-10 -mx-4 mt-6 border-b bg-background/95 px-4 pb-3 pt-2 backdrop-blur">
        <Input
          autoFocus
          placeholder="Buscar por nome, endereço, cidade ou telefone"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Filtro rotulo="Cidade" valor={cidade} onChange={setCidade} opcoes={cidades} />
          <Filtro rotulo="Nicho" valor={nicho} onChange={setNicho} opcoes={nichos} />
          <select
            aria-label="Acesso do cliente"
            value={acesso}
            onChange={(e) => setAcesso(e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="">Acesso: todos</option>
            <option value="sem">Sem o cliente</option>
            <option value="com">Com o cliente</option>
          </select>
          <select
            aria-label="Ordenar"
            value={ordem}
            onChange={(e) => setOrdem(e.target.value as typeof ordem)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="relevancia">Mais relevantes</option>
            <option value="nota">Melhor nota</option>
            <option value="nome">Nome (A-Z)</option>
          </select>
          {filtrando && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setBusca(""); setCidade(""); setNicho(""); setAcesso(""); }}
            >
              Limpar
            </Button>
          )}
          <span className="ml-auto text-sm text-muted-foreground">{lista.length} resultado(s)</span>
        </div>
      </div>

      {aviso && <p className="mt-3 text-sm text-muted-foreground">{aviso}</p>}

      <ul className="mt-4 grid gap-2">
        {lista.slice(0, quantos).map((e) => (
          <li key={e.slug} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{e.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {[
                    e.cidade ? `${e.cidade}${e.uf ? `/${e.uf}` : ""}` : "cidade não identificada",
                    e.nicho,
                    e.nota ? `★ ${e.nota.toFixed(1)}${e.avaliacoes ? ` · ${e.avaliacoes} avaliações` : ""}` : "sem nota",
                    e.acessos > 1 ? `${e.acessos - 1} pessoa(s) do cliente` : "cliente ainda não entrou",
                  ].join(" · ")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => convidar(e.slug)}>
                  {convite?.slug === e.slug ? "Copiado ✓" : "Convite"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => abrir(e.slug)}>
                  Acessos
                </Button>
                <a className="inline-flex h-9 items-center rounded-md border px-3 text-sm" href={`/${e.slug}`}>
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
              <p className="mt-3 break-all rounded bg-muted p-2 text-xs">{convite.url}</p>
            )}

            {aberto === e.slug && (
              <ul className="mt-3 grid gap-1 border-t pt-2 text-sm">
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
        {!lista.length && (
          <li className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nenhum espaço com esses filtros.
          </li>
        )}
      </ul>

      {lista.length > quantos && (
        <Button className="mt-4 w-full" variant="outline" onClick={() => setPagina({ chave, n: quantos + PAGINA })}>
          Mostrar mais ({lista.length - quantos} restantes)
        </Button>
      )}
    </main>
  );
}
