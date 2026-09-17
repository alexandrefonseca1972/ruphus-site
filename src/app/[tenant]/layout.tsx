"use client";

import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { createContext, use, useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { Tenant } from "@/lib/tenants";
import { cn } from "@/lib/utils";

const TenantContext = createContext<Tenant | null>(null);

export function useTenant() {
  const tenant = use(TenantContext);
  if (!tenant) throw new Error("useTenant fora de /[tenant]");
  return tenant;
}

export default function TenantLayout({ children }: { children: React.ReactNode }) {
  const { tenant: slug } = useParams<{ tenant: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<Tenant | "loading" | "denied">("loading");

  useEffect(
    () =>
      onAuthStateChanged(auth, async (user) => {
        if (!user) return router.replace("/login");
        try {
          // As regras negam a leitura para quem não é membro
          const snap = await getDoc(doc(db, "tenants", slug));
          setState(snap.exists() ? { id: snap.id, ...Tenant.parse(snap.data()) } : "denied");
        } catch {
          setState("denied");
        }
      }),
    [slug, router],
  );

  if (state === "loading") return <p className="p-8">Carregando…</p>;
  if (state === "denied") return <p className="p-8">Tenant não encontrado ou sem acesso.</p>;

  const links = [
    { href: `/${slug}`, label: "Agenda" },
    { href: `/${slug}/servicos`, label: "Serviços" },
    { href: `/${slug}/profissionais`, label: "Profissionais" },
    { href: `/${slug}/clientes`, label: "Clientes" },
  ];
  const isActive = (href: string) => pathname === href || (href !== `/${slug}` && pathname.startsWith(`${href}/`));
  return (
    <TenantContext value={state}>
      <header className="border-b">
        <nav className="mx-auto flex max-w-4xl flex-wrap items-center gap-1 p-2 text-sm">
          <Link href="/" className="mr-2 px-2 font-semibold">{state.name}</Link>
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(l.href) ? "page" : undefined}
              className={cn("rounded-md px-3 py-1.5 hover:bg-muted", isActive(l.href) && "bg-muted font-medium")}
            >
              {l.label}
            </Link>
          ))}
          <a href={`/agendar/${slug}`} target="_blank" rel="noreferrer" className="ml-auto rounded-md px-3 py-1.5 text-muted-foreground hover:bg-muted">
            Página de agendamento ↗
          </a>
        </nav>
      </header>
      <main className="mx-auto grid w-full max-w-4xl gap-6 p-4">{children}</main>
    </TenantContext>
  );
}
