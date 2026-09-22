"use client";

import { onAuthStateChanged, type User } from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ehAdminDaPlataforma } from "@/app/admin/actions";
import { AccountMenu } from "@/app/[tenant]/account-menu";
import { serifa, useSerifaNoBody } from "@/app/fonte-serifa";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/auth-errors";
import { auth } from "@/lib/firebase";
import { createTenant, mascaraSlug, myTenants, slugify, TenantInput, type Role } from "@/lib/tenants";
import { cn } from "@/lib/utils";
import { slugLivre } from "./actions";

type Negocio = Awaited<ReturnType<typeof myTenants>>[number];

const PAPEL: Record<Role, string> = { owner: "Dono", admin: "Admin", member: "Equipe" };

const PASSOS = [
  { titulo: "Crie o negócio", texto: "Nome e endereço do link." },
  { titulo: "Cadastre serviços e quem atende", texto: "Duração, preço e horários." },
  { titulo: "Divulgue o link", texto: "Bio do Instagram e status do WhatsApp." },
];

const Seta = ({ className }: { className?: string }) => (
  <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </svg>
);

export default function MeusNegocios() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [negocios, setNegocios] = useState<Negocio[] | null>(null);
  const [erro, setErro] = useState("");
  const [cadastrando, setCadastrando] = useState(false);
  const form = useRef<HTMLElement>(null);
  useSerifaNoBody();

  useEffect(
    () =>
      onAuthStateChanged(auth, async (u) => {
        if (!u) return router.replace("/login");
        // O admin da plataforma é membro de todos os negócios importados: aqui viraria
        // uma lista de centenas de slugs. O lugar dele é o /admin, como no login.
        const admin = await ehAdminDaPlataforma(await u.getIdToken()).catch(() => ({ ok: false as const }));
        if (admin.ok) return router.replace("/admin");
        setUser(u);
        try {
          setNegocios(await myTenants());
        } catch (err) {
          setErro(errorMessage(err));
          setNegocios([]);
        }
      }),
    [router],
  );

  function abrirCadastro() {
    setCadastrando(true);
    requestAnimationFrame(() => form.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  const primeiro = negocios?.length === 0;

  return (
    <div className={`painel ${serifa.variable} flex min-h-dvh flex-col bg-background`}>
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:h-16">
          <Link href="/" className="font-serifa text-[26px] leading-none sm:text-[28px]">Ruphus</Link>
          {user && (
            <div className="flex items-center gap-3">
              <span className="hidden text-[13px] text-muted-foreground sm:inline">{user.email}</span>
              <AccountMenu />
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-5xl gap-6 px-4 pt-7 pb-16 sm:gap-7 sm:pt-12">
        {!negocios ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : primeiro ? (
          <>
            <Titulo titulo="Seu primeiro negócio" sub="Três passos até o link começar a receber agendamentos." />
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-6">
              <section aria-labelledby="como" className="grid gap-4 lg:order-last lg:rounded-2xl lg:border lg:bg-card lg:p-6">
                <h2 id="como" className="sr-only text-[13px] font-medium tracking-wider text-muted-foreground uppercase lg:not-sr-only">Como funciona</h2>
                <ol className="grid gap-3.5 lg:gap-4.5">
                  {PASSOS.map((p, i) => (
                    <li key={p.titulo} className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-3 lg:grid-cols-[2rem_minmax(0,1fr)] lg:gap-3.5">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "grid size-7 place-items-center rounded-full font-serifa text-base lg:size-8 lg:text-lg",
                          i === 0 ? "bg-primary text-primary-foreground" : "border",
                        )}
                      >
                        {i + 1}
                      </span>
                      <div className="grid gap-px">
                        <span className="font-semibold">{p.titulo}</span>
                        <span className="text-[13px] text-muted-foreground lg:text-sm">{p.texto}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
              <NegocioForm titulo="Cadastrar negócio" onCriado={(slug) => router.push(`/${slug}`)} />
            </div>
          </>
        ) : (
          <>
            <Titulo titulo="Meus negócios" sub={`${negocios.length} negócio${negocios.length > 1 ? "s" : ""} nesta conta`}>
              {!cadastrando && (
                <Button variant="outline" className="hidden h-11 gap-2 px-4 sm:inline-flex" onClick={abrirCadastro}>
                  <Mais /> Cadastrar outro
                </Button>
              )}
            </Titulo>
            {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
            <ul aria-label="Negócios" className="grid gap-2.5 sm:gap-3">
              {negocios.map((n) => (
                <li key={n.id}>
                  <Link
                    href={`/${n.id}`}
                    className="group flex items-center gap-3.5 rounded-2xl border bg-card p-4 hover:border-foreground/40 sm:gap-4 sm:px-5.5 sm:py-5"
                  >
                    <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary font-serifa text-2xl text-primary-foreground sm:size-12 sm:text-[26px]">
                      {n.name.charAt(0)}
                    </span>
                    <span className="grid min-w-0 flex-1 gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-semibold sm:text-base">{n.name}</span>
                        <span className="hidden rounded-full bg-muted px-2.5 py-0.5 text-xs sm:inline">{PAPEL[n.role]}</span>
                      </span>
                      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground sm:text-[13px]">
                        <span className="rounded-full bg-muted px-2 py-px text-foreground sm:hidden">{PAPEL[n.role]}</span>
                        <span className="truncate">
                          <span className="hidden sm:inline">ruphus.site/agendar</span>/{n.id}
                        </span>
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 font-medium">
                      <span className="hidden sm:inline">Abrir painel</span>
                      <Seta className="transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {!cadastrando && (
              <Button variant="outline" className="h-12 w-full gap-2 text-[15px] sm:hidden" onClick={abrirCadastro}>
                <Mais /> Cadastrar outro negócio
              </Button>
            )}
            {cadastrando && (
              <NegocioForm
                ref={form}
                titulo="Cadastrar outro negócio"
                onCriado={(slug) => router.push(`/${slug}`)}
                onCancelar={() => setCadastrando(false)}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Titulo({ titulo, sub, children }: { titulo: string; sub: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="grid gap-1.5">
        <h1 className="font-serifa text-[38px] leading-none sm:text-5xl">{titulo}</h1>
        <p className="text-[15px] text-muted-foreground">{sub}</p>
      </div>
      {children}
    </div>
  );
}

const Mais = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
);

type Disponibilidade = "" | "verificando" | "livre" | "ocupado";

function NegocioForm({
  ref,
  titulo,
  onCriado,
  onCancelar,
}: {
  ref?: React.Ref<HTMLElement>;
  titulo: string;
  onCriado: (slug: string) => void;
  onCancelar?: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  // Enquanto a pessoa não mexe no endereço, ele acompanha o nome
  const [slugEditado, setSlugEditado] = useState(false);
  const [touched, setTouched] = useState({ name: false, slug: false });
  const [disp, setDisp] = useState<{ para: string; estado: Disponibilidade }>({ para: "", estado: "" });
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);

  const final = slugify(slug);
  const erroNome = TenantInput.shape.name.safeParse(name).error?.issues[0].message ?? "";
  const erroSlug = TenantInput.shape.slug.safeParse(final).error?.issues[0].message ?? "";
  const estado = disp.para === final ? disp.estado : erroSlug ? "" : "verificando";

  // Disponibilidade só depois de meio segundo sem digitar: uma consulta por pausa, não por tecla
  useEffect(() => {
    if (erroSlug) return;
    let atual = true;
    const t = setTimeout(() => {
      slugLivre(final)
        .then((livre) => atual && setDisp({ para: final, estado: livre ? "livre" : "ocupado" }))
        .catch(() => atual && setDisp({ para: final, estado: "" }));
    }, 500);
    return () => {
      atual = false;
      clearTimeout(t);
    };
  }, [final, erroSlug]);

  const msgNome = touched.name ? erroNome : "";
  const msgSlug = touched.slug || slugEditado || name ? erroSlug || (estado === "ocupado" ? "Esse endereço já está em uso" : "") : "";

  async function criar() {
    setTouched({ name: true, slug: true });
    setSlug(final);
    if (erroNome || erroSlug || estado !== "livre") return;
    setErro("");
    setBusy(true);
    try {
      onCriado(await createTenant({ name, slug: final }));
    } catch (err) {
      setErro(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <section ref={ref} aria-labelledby="form-negocio" className="grid scroll-mt-6 gap-5 rounded-2xl border bg-card p-5 sm:gap-5.5 sm:p-7">
      <div className="grid gap-1">
        <h2 id="form-negocio" className="text-[17px] font-semibold">{titulo}</h2>
        <p className="text-sm text-muted-foreground">O nome aparece no site e no link de agendamento. Dá para mudar depois.</p>
      </div>
      <form
        noValidate
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          criar();
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="negocio-nome">Nome do negócio</Label>
          <Input
            id="negocio-nome"
            value={name}
            maxLength={80}
            autoComplete="organization"
            placeholder="Ex.: Studio Bella Cabelos"
            aria-invalid={!!msgNome}
            aria-describedby="negocio-nome-msg"
            onChange={(e) => {
              setName(e.target.value);
              if (!slugEditado) setSlug(slugify(e.target.value));
            }}
            onBlur={() => setTouched((t) => ({ ...t, name: true }))}
            className="h-12 bg-card px-3.5 text-base sm:h-11 sm:text-[15px]"
          />
          <p id="negocio-nome-msg" aria-live="polite" className="min-h-4 text-xs text-destructive">{msgNome}</p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="negocio-slug">Endereço do link</Label>
          <div
            className={cn(
              "flex h-12 items-center overflow-hidden rounded-lg border border-input bg-card focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 sm:h-11",
              msgSlug && "border-destructive ring-3 ring-destructive/20",
            )}
          >
            {/* No celular o prefixo não cabe ao lado: vai para a prévia, abaixo */}
            <span aria-hidden="true" className="hidden h-full items-center border-r bg-muted px-3 text-sm text-muted-foreground sm:flex">
              ruphus.site/agendar/
            </span>
            <input
              id="negocio-slug"
              value={slug}
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="seu-negocio"
              aria-invalid={!!msgSlug}
              aria-describedby="negocio-slug-msg"
              onChange={(e) => {
                setSlug(mascaraSlug(e.target.value));
                setSlugEditado(true);
              }}
              onBlur={() => {
                setSlug(final);
                setTouched((t) => ({ ...t, slug: true }));
              }}
              className="h-full min-w-0 flex-1 bg-transparent px-3.5 text-base outline-none placeholder:text-muted-foreground sm:px-3 sm:text-[15px]"
            />
            <span className="hidden pr-2.5 sm:block">
              <Estado estado={estado} vazio={!final || !!erroSlug} />
            </span>
          </div>
          <div id="negocio-slug-msg" aria-live="polite" className="grid min-h-4 gap-1.5 text-xs">
            {msgSlug ? (
              <p className="text-destructive">{msgSlug}</p>
            ) : (
              <p className="text-muted-foreground sm:hidden">
                ruphus.site/agendar/<b className="font-medium break-all text-foreground">{final || "seu-negocio"}</b>
              </p>
            )}
            <span className="sm:hidden">
              <Estado estado={estado} vazio={!final || !!erroSlug} />
            </span>
            {!msgSlug && <p className="hidden text-muted-foreground sm:block">Preenchido a partir do nome. Só letras minúsculas, números e hífen.</p>}
          </div>
        </div>

        {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {onCancelar && (
            <Button type="button" variant="ghost" className="h-12 px-4 sm:h-11" onClick={onCancelar}>
              Cancelar
            </Button>
          )}
          <Button type="submit" disabled={busy} className="h-12 gap-2 px-5 text-[15px] sm:h-11 sm:text-sm">
            {busy ? "Criando…" : "Criar negócio"}
            {!busy && <Seta />}
          </Button>
        </div>
      </form>
    </section>
  );
}

function Estado({ estado, vazio }: { estado: Disponibilidade; vazio: boolean }) {
  if (vazio || !estado || estado === "ocupado") return null;
  return estado === "verificando" ? (
    <span className="text-xs text-muted-foreground">Verificando…</span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m5 12 5 5 9-10" />
      </svg>
      Disponível
    </span>
  );
}
