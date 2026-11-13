"use client";

import { onAuthStateChanged } from "firebase/auth";
import { collectionGroup, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { createContext, use, useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { MonitorConexao } from "@/components/monitor-conexao";
import { Button } from "@/components/ui/button";
import { AvisoSessao } from "@/components/aviso-sessao";
import { auth, idToken } from "@/lib/firebase";
import { formatBRL } from "@/lib/datetime";
import { resumoDoSaldoAction } from "./actions";
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
import { agendamentoLigado, telaDoPlano } from "@/lib/modulos";

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
  const [loaded, setLoaded] = useState<{ slug: string; value: TenantCtx | "denied" | "erro" } | null>(null);
  const state = loaded?.slug === slug ? loaded.value : "loading";
  // "Tentar de novo" refaz as leituras
  const [tentativa, setTentativa] = useState(0);

  useSerifaNoBody();
  // sai sozinho depois de X minutos parado, se o admin ligou; avisa um minuto antes
  const [avisoSessao, continuarSessao] = useAutoLogout(useMinutosInativo());

  useEffect(() => {
    let current = true;
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      // volta para a tela que abriu (link do aviso, favorito) depois de entrar
      if (!user) return router.replace(`/login?next=${encodeURIComponent(location.pathname)}`);
      let value: TenantCtx | "denied" | "erro";
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
      } catch (e) {
        // só a recusa das regras é "sem acesso"; rede caída ou dado estranho pede outra tentativa
        if ((e as { code?: string } | null)?.code === "permission-denied") value = "denied";
        else {
          console.error("[painel] não abriu o negócio", e);
          value = "erro";
        }
      }
      if (current) setLoaded({ slug, value });
    });
    return () => {
      current = false;
      unsubscribe();
    };
  }, [slug, router, tentativa]);

  if (state === "loading") return <p role="status" className="p-8">Carregando…</p>;
  if (state === "denied")
    return (
      <p role="alert" className="p-8">
        Você não tem acesso a este negócio. <Link href="/painel" className="underline underline-offset-4">Voltar aos seus negócios</Link>
      </p>
    );
  if (state === "erro")
    return (
      <div role="alert" className="grid gap-3 p-8">
        <p>Não foi possível abrir este negócio. Confira a internet e tente de novo.</p>
        <Button className="h-11 w-fit px-4" onClick={() => (setLoaded(null), setTentativa((t) => t + 1))}>Tentar de novo</Button>
      </div>
    );

  // Consumo é a conta de WhatsApp e SMS: só para o negócio que tem um dos dois ligado
  const usaMensagens = state.whatsapp?.canalOficial === true || state.sms?.ligado === true;
  // curto: o rótulo da barra de baixo no celular (até sete lado a lado em 360px: rótulos de até 8 letras) e das abas no tablet
  const links = [
    { href: `/${slug}`, label: "Agenda", curto: "Agenda", icone: ICONES.agenda },
    { href: `/${slug}/servicos`, label: "Serviços", curto: "Serviços", icone: ICONES.servicos },
    { href: `/${slug}/profissionais`, label: "Profissionais", curto: "Equipe", icone: ICONES.equipe },
    { href: `/${slug}/clientes`, label: "Clientes", curto: "Clientes", icone: ICONES.clientes },
    // Caixa incluído no plano; dinheiro só para quem gere
    ...(state.podeGerir ? [{ href: `/${slug}/caixa`, label: "Caixa", curto: "Caixa", icone: ICONES.caixa }] : []),
    // mensagens enviadas e saldo: custo é dinheiro, só para quem gere
    ...(state.podeGerir && usaMensagens ? [{ href: `/${slug}/consumo`, label: "Consumo", curto: "Consumo", icone: ICONES.consumo, soNoTopo: true }] : []),
    // os dados do negócio (site, bio, WhatsApp) só para quem gere
    ...(state.podeGerir ? [{ href: `/${slug}/negocio`, label: "Meu negócio", curto: "Negócio", icone: ICONES.negocio }] : []),
  ];
  // plano do negócio (/admin): sem agendamento fica só Serviços e Meu negócio; sem Caixa, sem a aba
  const doPlano = (href: string) => {
    const tela = href.split("/")[2] ?? "";
    return telaDoPlano(state.modulos, tela) && (tela !== "consumo" || usaMensagens);
  };
  const noPlano = links.filter((l) => doPlano(l.href));
  const prioridade = ["Agenda", "Clientes", "Serviços", "Caixa"];
  const deBaixo = prioridade.flatMap((nome) => {
    const link = noPlano.find((l) => l.label === nome);
    return link ? [link] : [];
  });
  for (const link of noPlano) {
    if (deBaixo.length < 4 && !deBaixo.includes(link)) deBaixo.push(link);
  }
  const restantes = noPlano.filter((l) => !deBaixo.includes(l));
  const isActive = (href: string) => pathname === href || (href !== `/${slug}` && pathname.startsWith(`${href}/`));
  return (
    <TenantContext value={{ ...state, atualizar: (parcial) => setLoaded({ slug, value: { ...state, ...parcial } }) }}>
      <div className={`painel ${serifa.variable} flex min-h-dvh flex-col bg-background`}>
        <MonitorConexao />
        {agendamentoLigado(state.modulos) && <AvisoNovoAgendamento />}
        <AvisoSessao aberto={avisoSessao} onContinuar={continuarSessao} />
      <header className="sticky top-0 z-10 border-b bg-card pt-[env(safe-area-inset-top)] sm:static">
        <div className="mx-auto flex max-w-6xl items-center gap-x-4 px-4 lg:gap-x-6">
          {/* O logo e o nome levam à página inicial do negócio (a agenda), para todo mundo.
              Trocar de negócio e voltar ao admin ficam no menu da conta. */}
          <Link href={agendamentoLigado(state.modulos) ? `/${slug}` : `/${slug}/negocio`} className="flex h-14 min-w-0 flex-1 items-center gap-2.5 sm:h-16 sm:flex-none">
            <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary font-serifa text-xl text-primary-foreground">
              {state.name.charAt(0)}
            </span>
            <span className="truncate font-semibold">{state.name}</span>
          </Link>
          {/* abas no topo só a partir do tablet; no celular elas vão para a barra de baixo */}
          <nav aria-label="Seções" className="hidden text-sm sm:flex">
            {noPlano.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={isActive(l.href) ? "page" : undefined}
                className={cn(
                  "flex h-16 items-center px-2 whitespace-nowrap text-muted-foreground hover:text-foreground lg:px-3.5",
                  // oito abas não cabem no tablet: o Consumo só aparece a partir do computador
                  noPlano.length > 7 && "soNoTopo" in l && "max-lg:hidden",
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
      <main className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)] gap-4 px-4 pt-5 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:pt-6 sm:pb-16">
        {/* o convite fala de avisos de agendamento: fora do plano só site */}
        {agendamentoLigado(state.modulos) && <AppInstalado />}
        {state.podeGerir && usaMensagens && agendamentoLigado(state.modulos) && <FaixaDeSaldo slug={slug} />}
        {/* tela fora do plano (link antigo, favorito): leva ao Meu negócio em vez de mostrar uma tela vazia */}
        {doPlano(pathname) ? children : <ForaDoPlano slug={slug} />}
      </main>
      {/* Celular: as seções no alcance do polegar, sempre à vista. */}
      <nav
        aria-label="Seções"
        className="fixed inset-x-0 bottom-0 z-10 grid border-t bg-card pb-[env(safe-area-inset-bottom)] sm:hidden"
        style={{ gridTemplateColumns: `repeat(${deBaixo.length + (restantes.length ? 1 : 0)}, minmax(0, 1fr))` }}
      >
        {deBaixo.map((l) => (
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
        {restantes.length > 0 && <MaisMenu key={pathname} links={restantes} isActive={isActive} />}
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
  caixa: icone(<><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M7 15h3" /></>),
  consumo: icone(<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>),
};

type LinkItem = { href: string; label: string; curto: string; icone: React.ReactNode; soNoTopo?: boolean };

export function MaisMenu({ links, isActive }: { links: LinkItem[]; isActive: (href: string) => boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const esc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", esc);
    return () => {
      document.body.style.overflow = anterior;
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <>
      <button type="button" aria-expanded={open} aria-controls="mais-secoes" onClick={() => setOpen((v) => !v)} className={cn("flex min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 py-1 text-[11px] leading-tight text-muted-foreground", open && "font-semibold text-foreground")}>
        <Menu className="size-[22px]" strokeWidth={1.8} aria-hidden="true" />Mais
      </button>
      {open && (
        <>
          <button type="button" aria-label="Fechar menu de seções" className="fixed inset-0 z-30 bg-black/25" onClick={() => setOpen(false)} />
          <section id="mais-secoes" role="dialog" aria-modal="true" aria-label="Mais seções" className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 rounded-2xl border bg-popover p-3 shadow-xl">
            <div className="flex items-center justify-between px-2 pb-2">
              <h2 className="font-serifa text-2xl">Mais seções</h2>
              <Button variant="ghost" size="icon-lg" className="size-11" aria-label="Fechar" onClick={() => setOpen(false)}><X className="size-5" aria-hidden="true" /></Button>
            </div>
            <nav className="grid gap-1" aria-label="Outras seções">
              {links.map((l) => (
                <Link key={l.href} href={l.href} onClick={() => setOpen(false)} aria-current={isActive(l.href) ? "page" : undefined} className={cn("flex min-h-12 items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground", isActive(l.href) && "bg-muted font-semibold text-foreground")}>
                  {l.icone}{l.label}
                </Link>
              ))}
            </nav>
          </section>
        </>
      )}
    </>
  );
}

/** Saldo de mensagens baixo ou zerado: a faixa leva à recarga. Fora do pré-pago, nada. */
function FaixaDeSaldo({ slug }: { slug: string }) {
  const pathname = usePathname();
  const [saldo, setSaldo] = useState<{ slug: string; nivel: string; saldoCents: number; dias: number | null; semSaldo: string } | null>(null);
  useEffect(() => {
    let atual = true;
    idToken()
      .then((t) => resumoDoSaldoAction(t, { tenantId: slug }))
      .then((r) => atual && setSaldo(r.ok && r.saldo ? { slug, ...r.saldo } : null), () => {});
    return () => {
      atual = false;
    };
  }, [slug]);
  // na própria tela de consumo o cartão do saldo já diz
  if (!saldo || saldo.slug !== slug || saldo.nivel === "ok" || pathname.startsWith(`/${slug}/consumo`)) return null;
  const zerado = saldo.saldoCents <= 0;
  return (
    <div role="status" className={cn("flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm", zerado ? "border-red-300 bg-red-50 text-red-950 dark:border-red-900 dark:bg-red-950 dark:text-red-100" : "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100")}>
      <p>
        <strong className="font-semibold">{zerado ? "Seu saldo de mensagens acabou." : "Seu saldo de mensagens está baixo."}</strong>{" "}
        {zerado
          ? saldo.semSaldo === "negativo"
            ? "As mensagens seguem por pouco tempo, no negativo."
            : saldo.semSaldo === "pausar-tudo"
              ? "Os avisos aos clientes estão pausados até a recarga."
              : "Os avisos aos clientes estão pausados até a recarga; o lembrete do dia e os pedidos para você continuam."
          : `Restam ${formatBRL(saldo.saldoCents)}${saldo.dias !== null && saldo.dias <= 30 ? `, para uns ${saldo.dias} ${saldo.dias === 1 ? "dia" : "dias"}` : ""}.`}
      </p>
      <Link href={`/${slug}/consumo/recarga`} className="inline-flex h-11 items-center rounded-lg bg-foreground px-3.5 font-semibold text-background">
        Recarregar
      </Link>
    </div>
  );
}

function ForaDoPlano({ slug }: { slug: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/${slug}/negocio`);
  }, [router, slug]);
  return <p role="status" className="text-sm text-muted-foreground">Esta parte não faz parte do plano deste negócio. Abrindo Meu negócio…</p>;
}
