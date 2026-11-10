"use client";

import { onAuthStateChanged } from "firebase/auth";
import { collectionGroup, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { createContext, use, useEffect, useState } from "react";
import { MonitorConexao } from "@/components/monitor-conexao";
import { auth } from "@/lib/firebase";
import { db } from "@/lib/firebase-db";
import { Tenant } from "@/lib/tenants";
import { ehAdminDaPlataforma } from "@/app/admin/actions";
import { serifa, useSerifaNoBody } from "@/app/fonte-serifa";
import { useAutoLogout } from "@/lib/sessao";
import { useMinutosInativo } from "@/lib/sessao-config";
import { AccountMenu } from "./account-menu";
import { ShareLink } from "./share-link";
import { AppInstalado } from "./app-instalado";
import { AvisoNovoAgendamento } from "./aviso-novo-agendamento";
import { cn } from "@/lib/utils";

// podeGerir: dono ou admin do negócio, ou admin da plataforma. Só esconde botões —
// quem decide de verdade é o servidor/as regras. adminPlataforma: entrou sem ser da equipe.
// staffId: o profissional de quem entrou pelo convite da equipe (a agenda abre na dele)
// atualizar: o que uma tela gravou no servidor (a chave Pix) vale nas outras sem recarregar
// varios: a conta tem mais de um negócio. Com um só, "Meus negócios" não existe (o /painel
// já manda direto para ele) e o logo leva à agenda
type TenantCtx = Tenant & { podeGerir: boolean; adminPlataforma: boolean; varios: boolean; staffId?: string; atualizar?: (parcial: Partial<Tenant>) => void };
const TenantContext = createContext<TenantCtx | null>(null);

export function useTenant() {
  const tenant = use(TenantContext);
  if (!tenant) throw new Error("useTenant fora de /[tenant]");
  return tenant;
}

/** Fora de /[tenant] (o /painel usa o mesmo menu da conta) devolve null. */
export const useTenantSeHouver = () => use(TenantContext);

export function PainelLayout({ children }: { children: React.ReactNode }) {
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
      // volta para a tela que abriu (link do aviso, favorito) depois de entrar
      if (!user) return router.replace(`/login?next=${encodeURIComponent(location.pathname)}`);
      let value: TenantCtx | "denied";
      try {
        // As regras negam a leitura para quem não é membro
        // O admin da plataforma pode ser membro (é dono dos sites da fábrica até o cliente
        // entrar) ou não: só o servidor sabe (config/admin), e pergunta junto com as leituras
        const [snap, member, plataforma, membros] = await Promise.all([
          getDoc(doc(db, "tenants", slug)),
          getDoc(doc(db, "tenants", slug, "members", user.uid)),
          user.getIdToken().then(ehAdminDaPlataforma).catch(() => ({ ok: false })),
          // só precisa saber se há um segundo negócio: duas linhas bastam
          getDocs(query(collectionGroup(db, "members"), where("uid", "==", user.uid), limit(2))).catch(() => null),
        ]);
        const adminPlataforma = plataforma.ok;
        const podeGerir = adminPlataforma || ["owner", "admin"].includes(member.get("role"));
        const varios = (membros?.size ?? 2) > 1;
        value = snap.exists() ? { id: snap.id, ...Tenant.parse(snap.data()), podeGerir, adminPlataforma, varios, staffId: (member.get("staffId") as string | undefined) || undefined } : "denied";
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

  if (state === "loading") return <p role="status" className="p-8">Carregando…</p>;
  if (state === "denied")
    return (
      <p role="alert" className="p-8">
        Você não tem acesso a este negócio. <Link href="/painel" className="underline underline-offset-4">Voltar aos seus negócios</Link>
      </p>
    );

  // curto: o rótulo da barra de baixo no celular (até sete lado a lado em 360px: rótulos de até 8 letras) e das abas no tablet
  const links = [
    { href: `/${slug}`, label: "Agenda", curto: "Agenda", icone: ICONES.agenda },
    { href: `/${slug}/servicos`, label: "Serviços", curto: "Serviços", icone: ICONES.servicos },
    { href: `/${slug}/profissionais`, label: "Profissionais", curto: "Equipe", icone: ICONES.equipe },
    { href: `/${slug}/clientes`, label: "Clientes", curto: "Clientes", icone: ICONES.clientes },
    // Central de conversas: liberada por negócio (piloto) e, para a equipe, só com o dono deixando
    ...(state.modulos?.conversas && (state.podeGerir || state.conversas?.equipeAtende) ? [{ href: `/${slug}/conversas`, label: "Conversas", curto: "Chat", icone: ICONES.conversas }] : []),
    // dinheiro só para quem gere, e só com o Caixa ligado pelo admin da plataforma
    ...(state.podeGerir && state.modulos?.financeiro ? [{ href: `/${slug}/caixa`, label: "Caixa", curto: "Caixa", icone: ICONES.caixa }] : []),
    // os dados do negócio (site, bio, WhatsApp) só para quem gere
    ...(state.podeGerir ? [{ href: `/${slug}/negocio`, label: "Meu negócio", curto: "Negócio", icone: ICONES.negocio }] : []),
  ];
  const isActive = (href: string) => pathname === href || (href !== `/${slug}` && pathname.startsWith(`${href}/`));
  return (
    <TenantContext value={{ ...state, atualizar: (parcial) => setLoaded({ slug, value: { ...state, ...parcial } }) }}>
      <div className={`painel ${serifa.variable} flex min-h-dvh flex-col bg-background`}>
        <MonitorConexao />
        <AvisoNovoAgendamento />
      <header className="sticky top-0 z-10 border-b bg-card pt-[env(safe-area-inset-top)] sm:static">
        <div className="mx-auto flex max-w-6xl items-center gap-x-4 px-4 lg:gap-x-6">
          {/* O logo e o nome levam à página inicial do negócio (a agenda), para todo mundo.
              Trocar de negócio e voltar ao admin ficam no menu da conta. */}
          <Link href={`/${slug}`} className="flex h-14 min-w-0 flex-1 items-center gap-2.5 sm:h-16 sm:flex-none">
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
                  "flex h-16 items-center px-2 whitespace-nowrap text-muted-foreground hover:text-foreground lg:px-3.5",
                  isActive(l.href) && "font-semibold text-foreground shadow-[inset_0_-2px_0_var(--foreground)]",
                )}
              >
                {/* tablet: os rótulos curtos (Equipe, Negócio) para as sete abas caberem ao lado da conta */}
                <span className="lg:hidden">{l.curto}</span>
                <span className="max-lg:hidden">{l.label}</span>
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
        {/* conexão caiu: já esteve conectada (conectadoEm), a instância segue gravada (não foi o
            dono que desconectou) e agora está desconectada. Lembretes e avisos param calados até
            alguém abrir Meu negócio — a faixa avisa. Gerenciado pela plataforma: sem "Reconectar" */}
        {state.podeGerir && state.whatsapp?.instanceId && state.whatsapp.conectadoEm && state.whatsapp.status === "disconnected" && !pathname.endsWith("/negocio") && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
            <p>
              <strong className="font-semibold">Seu WhatsApp desconectou.</strong>{" "}
              {state.whatsapp.ownerManaged === false
                ? "Lembretes e avisos de agendamento estão parados. A Ruphus já foi avisada e vai reconectar."
                : "Lembretes e avisos de agendamento estão parados até reconectar."}
            </p>
            {state.whatsapp.ownerManaged !== false && (
              <Link href={`/${slug}/negocio#whatsapp`} className="inline-flex h-10 shrink-0 items-center rounded-lg bg-amber-900 px-4 font-medium text-white hover:bg-amber-950 dark:bg-amber-200 dark:text-amber-950">
                Reconectar
              </Link>
            )}
          </div>
        )}
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
              "flex min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 py-1 text-center text-[11px] leading-tight text-muted-foreground",
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
  conversas: icone(<path d="M4 5.5h16v10H9l-5 4z" />),
  caixa: icone(<><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M7 15h3" /></>),
};
