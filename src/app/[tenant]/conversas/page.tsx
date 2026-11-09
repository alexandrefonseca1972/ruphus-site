"use client";

import { orderBy } from "firebase/firestore";
import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ConversaInbox, ResultadoBusca } from "@/lib/atendys";
import { formatTime } from "@/lib/datetime";
import { idToken } from "@/lib/firebase";
import { indiceDeClientes, juntarConversas, naoLida, nomeDaConversa, ordenarConversas, telefoneLegivel } from "@/lib/conversas";
import { useCollection } from "@/lib/use-collection";
import { cn } from "@/lib/utils";
import { buscarConversasAction, listarConversasAction, permitirEquipeNasConversasAction } from "../actions";
import { PageTitle } from "../page-title";
import { useTenant } from "../painel-layout";
import { Conversa } from "./conversa";

const Cliente = z.object({ name: z.string(), phone: z.string() });
type Filtro = "active" | "unread" | "archived";
const FILTROS: { id: Filtro; rotulo: string }[] = [
  { id: "active", rotulo: "Todas" },
  { id: "unread", rotulo: "Não lidas" },
  { id: "archived", rotulo: "Arquivadas" },
];
// ponytail: busca a cada 30 s com a aba à vista; a escuta do whatsappInbox (Fase 3.1) troca isto
const A_CADA_MS = 30_000;

const quando = (iso: string) => {
  const d = new Date(iso);
  return new Date().toDateString() === d.toDateString() ? formatTime(d) : d.toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
};

export default function ConversasPage() {
  return (
    <Suspense fallback={<p role="status">Carregando…</p>}>
      <Conversas />
    </Suspense>
  );
}

function Conversas() {
  const tenant = useTenant();
  const router = useRouter();
  const pathname = usePathname();
  const aberta = useSearchParams().get("c");
  const liberado = tenant.modulos?.conversas === true && (tenant.podeGerir || tenant.conversas?.equipeAtende === true);

  const [filtro, setFiltro] = useState<Filtro>("active");
  const [conversas, setConversas] = useState<ConversaInbox[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [rodada, setRodada] = useState(0);
  const [termo, setTermo] = useState("");
  const [achados, setAchados] = useState<ResultadoBusca[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erroBusca, setErroBusca] = useState("");

  // nome do cadastro quando o telefone casa (com ou sem o 9º dígito)
  const [clientes] = useCollection(liberado ? tenant.id : "", "customers", Cliente, [orderBy("name")]);
  const doCadastro = useMemo(() => indiceDeClientes((clientes ?? []).map((c) => ({ key: c.id, name: c.name, phone: c.phone }))), [clientes]);

  const buscar = useCallback(
    async (f: Filtro, depois?: string) => listarConversasAction(await idToken(), { tenantId: tenant.id, filtro: f, cursor: depois, limite: 50 }),
    [tenant.id],
  );
  const aplicar = useCallback((r: Awaited<ReturnType<typeof buscar>>, depois?: string) => {
    if (!r.ok) {
      setErro(r.error);
      return;
    }
    setErro("");
    setConversas((atual) => (depois && atual ? juntarConversas(atual, r.pagina.items) : r.pagina.items));
    // recarregar a primeira página não perde o ponto onde "Mais conversas" parou
    setCursor((c) => (depois ? r.pagina.nextCursor : (c ?? r.pagina.nextCursor)));
  }, []);
  const carregar = useCallback(async (depois?: string) => aplicar(await buscar(filtro, depois), depois), [buscar, aplicar, filtro]);

  // ao abrir e ao trocar de filtro (a troca já limpa a lista no clique)
  useEffect(() => {
    if (!liberado) return;
    let vivo = true;
    void buscar(filtro).then((r) => vivo && aplicar(r));
    return () => {
      vivo = false;
    };
  }, [liberado, filtro, buscar, aplicar]);

  // de tempos em tempos, só com a aba à vista; a conversa aberta recarrega junto (rodada)
  useEffect(() => {
    if (!liberado) return;
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void carregar();
      setRodada((n) => n + 1);
    }, A_CADA_MS);
    return () => clearInterval(id);
  }, [liberado, carregar]);

  const abrir = (id: string | null) => {
    const q = new URLSearchParams();
    if (id) q.set("c", id);
    // empilha ao abrir: o "voltar" do celular fecha a conversa e volta para a lista
    (id ? router.push : router.replace)(`${pathname}${q.size ? `?${q}` : ""}`, { scroll: false });
  };

  if (!tenant.modulos?.conversas) {
    return (
      <div className="grid gap-4">
        <PageTitle title="Conversas" />
        <p className="text-muted-foreground">A central de conversas ainda não está liberada para este negócio. Fale com o suporte da Ruphus.</p>
      </div>
    );
  }
  if (!liberado) {
    return (
      <div className="grid gap-4">
        <PageTitle title="Conversas" />
        <p className="text-muted-foreground">Só o dono atende as conversas deste negócio. Peça a ele para liberar a equipe.</p>
      </div>
    );
  }

  const lista = conversas && ordenarConversas(conversas);
  const atual = aberta ? conversas?.find((c) => c.id === aberta) : undefined;
  const totalNaoLidas = conversas?.filter(naoLida).length ?? 0;

  return (
    <div className="grid gap-5">
      <PageTitle
        title="Conversas"
        sub={conversas ? (totalNaoLidas ? `${totalNaoLidas} com mensagem nova` : "Tudo em dia") : "Clientes que falaram com o WhatsApp do negócio"}
      >
        {tenant.podeGerir && <EquipeAtende />}
      </PageTitle>

      <div className="grid gap-4 lg:h-[calc(100dvh-15rem)] lg:min-h-[32rem] lg:grid-cols-[22rem_minmax(0,1fr)]">
        <section aria-label="Lista de conversas" className={cn("flex min-h-0 flex-col gap-3", atual && "max-lg:hidden")}>
          {tenant.podeGerir && (
            <form
              role="search"
              className="relative"
              onSubmit={async (e) => {
                e.preventDefault();
                if (termo.trim().length < 3) {
                  setErroBusca("Digite pelo menos 3 letras.");
                  return;
                }
                setBuscando(true);
                const r = await buscarConversasAction(await idToken(), { tenantId: tenant.id, termo });
                setBuscando(false);
                if (!r.ok) setErroBusca(r.error);
                else {
                  setErroBusca("");
                  setAchados(r.pagina.items);
                }
              }}
            >
              <Label htmlFor="busca-conversas" className="sr-only">
                Buscar nas mensagens
              </Label>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                id="busca-conversas"
                type="search"
                value={termo}
                onChange={(e) => {
                  setTermo(e.target.value);
                  if (!e.target.value) {
                    setAchados(null);
                    setErroBusca("");
                  }
                }}
                placeholder="Buscar nas mensagens"
                className="h-10 bg-card pl-9 max-sm:h-11"
              />
            </form>
          )}
          {erroBusca && (
            <p role="alert" className="text-sm text-destructive">
              {erroBusca}
            </p>
          )}

          {achados ? (
            <div className="grid min-h-0 gap-2 overflow-y-auto">
              <div className="flex items-center justify-between text-sm">
                <p aria-live="polite">{buscando ? "Buscando…" : `${achados.length} ${achados.length === 1 ? "resultado" : "resultados"}`}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setAchados(null);
                    setTermo("");
                  }}
                >
                  Limpar busca
                </Button>
              </div>
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
                {achados.map((a) => {
                  const c = conversas?.find((x) => x.id === a.conversationId);
                  return (
                    <li key={a.id}>
                      <button type="button" onClick={() => abrir(a.conversationId)} className="grid w-full grid-cols-[minmax(0,1fr)] gap-0.5 rounded-lg border bg-card p-3 text-left hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                        <span className="flex justify-between gap-2 text-sm font-medium">
                          <span className="truncate">{c ? nomeDaConversa(c, doCadastro(c.contactPhone)) : "Conversa"}</span>
                          <span className="shrink-0 text-xs font-normal text-muted-foreground">{quando(a.at)}</span>
                        </span>
                        <span className="line-clamp-2 text-sm text-muted-foreground">
                          {a.direction === "out" && "Você: "}
                          {a.text}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <>
              <div role="tablist" aria-label="Filtro" className="flex gap-1 rounded-lg bg-muted p-1 text-sm">
                {FILTROS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="tab"
                    aria-selected={filtro === f.id}
                    onClick={() => {
                      if (f.id === filtro) return;
                      setConversas(null);
                      setCursor(null);
                      setFiltro(f.id);
                    }}
                    className={cn("h-9 flex-1 rounded-md px-2 max-sm:h-10", filtro === f.id ? "bg-background font-semibold shadow-sm" : "text-muted-foreground hover:text-foreground")}
                  >
                    {f.rotulo}
                  </button>
                ))}
              </div>
              {erro && (
                <p role="alert" className="text-sm text-destructive">
                  {erro}
                </p>
              )}
              {!lista && !erro && <p className="text-sm text-muted-foreground">Carregando as conversas…</p>}
              {lista?.length === 0 && (
                <p className="text-sm text-muted-foreground">{filtro === "unread" ? "Nenhuma mensagem nova." : filtro === "archived" ? "Nenhuma conversa arquivada." : "Nenhuma conversa ainda."}</p>
              )}
              <ul className="grid min-h-0 grid-cols-[minmax(0,1fr)] content-start gap-1 overflow-y-auto">
                {lista?.map((c) => {
                  const nova = naoLida(c);
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => abrir(c.id)}
                        aria-current={c.id === aberta ? "true" : undefined}
                        className={cn(
                          "grid w-full grid-cols-[minmax(0,1fr)] gap-0.5 rounded-lg border bg-card p-3 text-left hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                          c.id === aberta && "border-foreground/40 bg-muted",
                        )}
                      >
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={cn("truncate", nova && "font-semibold")}>{nomeDaConversa(c, doCadastro(c.contactPhone))}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{quando(c.lastActivityAt)}</span>
                        </span>
                        <span className="flex items-center justify-between gap-2">
                          <span className={cn("truncate text-sm", nova ? "text-foreground" : "text-muted-foreground")}>
                            {c.lastMessage?.direction === "out" && "Você: "}
                            {c.lastMessage?.text ?? (c.lastMessage?.mediaKind ? "Arquivo" : telefoneLegivel(c.contactPhone))}
                          </span>
                          {nova && (
                            <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
                              {c.unreadCount || "•"}
                              <span className="sr-only"> não lidas</span>
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {cursor && (
                  <li className="pt-1 text-center">
                    <Button variant="ghost" size="sm" onClick={() => void carregar(cursor)}>
                      Mais conversas
                    </Button>
                  </li>
                )}
              </ul>
            </>
          )}
        </section>

        {atual ? (
          <Conversa key={atual.id} conversa={atual} cliente={doCadastro(atual.contactPhone)} onVoltar={() => abrir(null)} onMudou={() => void carregar()} atualizar={rodada} />
        ) : (
          <div className="hidden place-items-center rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground lg:grid">
            {aberta && conversas ? "Essa conversa não está nesta lista. Troque o filtro ou escolha outra." : "Escolha uma conversa para ler e responder."}
          </div>
        )}
      </div>
    </div>
  );
}

/** "Equipe pode atender conversas": padrão só o dono. */
function EquipeAtende() {
  const tenant = useTenant();
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const ligado = tenant.conversas?.equipeAtende === true;
  return (
    <div className="grid gap-1">
      <label className="flex min-h-10 items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4"
          checked={ligado}
          disabled={salvando}
          onChange={async (e) => {
            setSalvando(true);
            setErro("");
            const r = await permitirEquipeNasConversasAction(await idToken(), { tenantId: tenant.id, equipeAtende: e.target.checked });
            setSalvando(false);
            if (r.ok) tenant.atualizar?.({ conversas: { equipeAtende: r.equipeAtende } });
            else setErro(r.error);
          }}
        />
        Equipe também pode atender
      </label>
      {erro && (
        <p role="alert" className="text-xs text-destructive">
          {erro}
        </p>
      )}
    </div>
  );
}
