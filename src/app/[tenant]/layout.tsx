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

  const links = [
    { href: `/${slug}`, label: "Agenda" },
    { href: `/${slug}/servicos`, label: "Serviços" },
    { href: `/${slug}/profissionais`, label: "Profissionais" },
    { href: `/${slug}/clientes`, label: "Clientes" },
    // os dados do negócio (site, bio, WhatsApp) só para quem gere
    ...(state.podeGerir ? [{ href: `/${slug}/negocio`, label: "Meu negócio" }] : []),
  ];
  const isActive = (href: string) => pathname === href || (href !== `/${slug}` && pathname.startsWith(`${href}/`));
  return (
    <TenantContext value={state}>
      <div className={`painel ${serifa.variable} flex min-h-dvh flex-col bg-background`}>
      <header className="relative border-b bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 px-4">
          {/* O nome era o unico link que parecia subir um nivel, e levava para "/",
              que e a landing page da Ruphus. Vai para /painel, que lista os
              negocios de quem entrou — ate aqui nao havia caminho de volta. */}
          <Link href="/painel" className="flex h-16 min-w-0 items-center gap-2.5">
            <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary font-serifa text-xl text-primary-foreground">
              {state.name.charAt(0)}
            </span>
            <span className="truncate font-semibold">{state.name}</span>
          </Link>
          <div className="order-last -mx-4 flex w-[calc(100%+2rem)] items-center gap-2 overflow-x-auto border-t px-4 text-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:order-none sm:mx-0 sm:w-auto sm:border-0 sm:px-0">
            <nav aria-label="Seções" className="flex">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={isActive(l.href) ? "page" : undefined}
                  className={cn(
                    "flex h-12 items-center px-3.5 whitespace-nowrap text-muted-foreground hover:text-foreground sm:h-16",
                    isActive(l.href) && "font-semibold text-foreground shadow-[inset_0_-2px_0_var(--foreground)]",
                  )}
                >
                  {l.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="ml-auto flex h-16 items-center gap-2">
            <ShareLink tenantId={slug} name={state.name} />
            <AccountMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-6xl gap-7 px-4 pt-10 pb-16">{children}</main>
      </div>
    </TenantContext>
  );
}
