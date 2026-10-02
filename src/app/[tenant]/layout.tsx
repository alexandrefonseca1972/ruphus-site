"use client";

import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { createContext, use, useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { db } from "@/lib/firebase-db";
import { Tenant } from "@/lib/tenants";
import { ehAdminDaPlataforma } from "@/app/admin/actions";
import { serifa, useSerifaNoBody } from "@/app/fonte-serifa";
import { loginComMotivo, useAutoLogout } from "@/lib/sessao";
import { useMinutosInativo } from "@/lib/sessao-config";
import { AccountMenu } from "./account-menu";
import { ShareLink } from "./share-link";
import { AppInstalado } from "./app-instalado";
import { cn } from "@/lib/utils";

// podeGerir: dono ou admin do negócio, ou admin da plataforma. Só esconde botões —
// quem decide de verdade é o servidor/as regras.
type TenantCtx = Tenant & { podeGerir: boolean };
const TenantContext = createContext<TenantCtx | null>(null);

export function useTenant() {
  const tenant = use(TenantContext);
  if (!tenant) throw new Error("useTenant fora de /[tenant]");
  return tenant;
}

export default function TenantLayout({ children }: { children: React.ReactNode }) {
  const { tenant: slug } = useParams<{ tenant: string }>();
  const router = useRouter();
  const pathname = usePathname();
  // Resultado guardado com o slug: ao trocar de espaço nunca mostra o anterior
  const [loaded, setLoaded] = useState<{ slug: string; value: TenantCtx | "denied" } | null>(null);
  const state = loaded?.slug === slug ? loaded.value : "loading";

  useSerifaNoBody();
  useAutoLogout(useMinutosInativo());   // sai sozinho depois de X minutos parado, se o admin ligou

  useEffect(() => {
    let current = true;
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) return router.replace(loginComMotivo());
      let value: TenantCtx | "denied";
      try {
        // As regras negam a leitura para quem não é membro
        const [snap, member] = await Promise.all([getDoc(doc(db, "tenants", slug)), getDoc(doc(db, "tenants", slug, "members", user.uid))]);
        // sem documento de membro e mesmo assim lendo: é o admin da plataforma (config/admin só o servidor lê)
        const podeGerir = member.exists()
          ? ["owner", "admin"].includes(member.get("role"))
          : (await ehAdminDaPlataforma(await user.getIdToken()).catch(() => ({ ok: false }))).ok;
        value = snap.exists() ? { id: snap.id, ...Tenant.parse(snap.data()), podeGerir } : "denied";
      } catch {
        value = "denied";
      }
      if (current) setLoaded({ slug, value });
    });
    return () => {
      current = false;
      unsubscribe();
    };
  }, [slug, router]);

  if (state === "loading") return <p className="p-8">Carregando…</p>;
  if (state === "denied") return <p className="p-8">Negócio não encontrado, ou você não tem acesso a ele.</p>;

  // curto: o rótulo da barra de baixo no celular, onde cinco cabem lado a lado
  const links = [
    { href: `/${slug}`, label: "Agenda", curto: "Agenda", icone: ICONES.agenda },
    { href: `/${slug}/servicos`, label: "Serviços", curto: "Serviços", icone: ICONES.servicos },
    { href: `/${slug}/profissionais`, label: "Profissionais", curto: "Equipe", icone: ICONES.equipe },
    { href: `/${slug}/clientes`, label: "Clientes", curto: "Clientes", icone: ICONES.clientes },
    // os dados do negócio (site, bio, WhatsApp) só para quem gere
    ...(state.podeGerir ? [{ href: `/${slug}/negocio`, label: "Meu negócio", curto: "Negócio", icone: ICONES.negocio }] : []),
  ];
  const isActive = (href: string) => pathname === href || (href !== `/${slug}` && pathname.startsWith(`${href}/`));
  return (
    <TenantContext value={state}>
      <div className={`painel ${serifa.variable} flex min-h-dvh flex-col bg-background`}>
      <header className="sticky top-0 z-10 border-b bg-card pt-[env(safe-area-inset-top)] sm:static">
        <div className="mx-auto flex max-w-6xl items-center gap-x-6 px-4">
          {/* O nome era o unico link que parecia subir um nivel, e levava para "/",
              que e a landing page da Ruphus. Vai para /painel, que lista os
              negocios de quem entrou — ate aqui nao havia caminho de volta. */}
          <Link href="/painel" className="flex h-14 min-w-0 flex-1 items-center gap-2.5 sm:h-16 sm:flex-none">
            <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary font-serifa text-xl text-primary-foreground">
              {state.name.charAt(0)}
            </span>
            <span className="truncate font-semibold">{state.name}</span>
          </Link>
          {/* abas no topo só a partir do tablet; no celular elas vão para a barra de baixo */}
          <nav aria-label="Seções" className="hidden text-sm sm:flex">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={isActive(l.href) ? "page" : undefined}
                className={cn(
                  "flex h-16 items-center px-3.5 whitespace-nowrap text-muted-foreground hover:text-foreground",
                  isActive(l.href) && "font-semibold text-foreground shadow-[inset_0_-2px_0_var(--foreground)]",
                )}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex h-14 shrink-0 items-center gap-2 sm:h-16">
            <ShareLink tenantId={slug} name={state.name} />
            <AccountMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)] gap-7 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:pt-10 sm:pb-16">
        <AppInstalado />
        {children}
      </main>
      {/* Celular: as seções no alcance do polegar, sempre à vista. */}
      <nav
        aria-label="Seções"
        className="fixed inset-x-0 bottom-0 z-10 grid border-t bg-card pb-[env(safe-area-inset-bottom)] sm:hidden"
        style={{ gridTemplateColumns: `repeat(${links.length}, minmax(0, 1fr))` }}
      >
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={isActive(l.href) ? "page" : undefined}
            className={cn(
              "flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground",
              isActive(l.href) && "font-semibold text-foreground",
            )}
          >
            {l.icone}
            {l.curto}
          </Link>
        ))}
      </nav>
      </div>
    </TenantContext>
  );
}

const icone = (d: React.ReactNode) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
const ICONES = {
  agenda: icone(<><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>),
  servicos: icone(<><path d="M6 4h12M6 9h12M6 14h8" /><circle cx="17.5" cy="17.5" r="3" /></>),
  equipe: icone(<><circle cx="12" cy="7.5" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>),
  clientes: icone(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" /></>),
  negocio: icone(<><path d="M4 10.5 12 4l8 6.5V20H4z" /><path d="M9.5 20v-5h5v5" /></>),
};
