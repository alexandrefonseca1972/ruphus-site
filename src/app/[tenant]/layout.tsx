"use client";

import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useParams, useRouter } from "next/navigation";
import { createContext, use, useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { Tenant } from "@/lib/tenants";

const TenantContext = createContext<Tenant | null>(null);

export function useTenant() {
  const tenant = use(TenantContext);
  if (!tenant) throw new Error("useTenant fora de /[tenant]");
  return tenant;
}

export default function TenantLayout({ children }: { children: React.ReactNode }) {
  const { tenant: slug } = useParams<{ tenant: string }>();
  const router = useRouter();
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
  return <TenantContext value={state}>{children}</TenantContext>;
}
