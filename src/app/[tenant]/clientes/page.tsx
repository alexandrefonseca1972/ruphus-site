"use client";

import { orderBy, Timestamp, where } from "firebase/firestore";
import Link from "next/link";
import { useMemo, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ativosDesde, DIA_EM_MS, JANELAS, MAIOR_JANELA, resumoPorCliente } from "@/lib/clientes";
import { formatBRL, whatsappLink } from "@/lib/datetime";
import { useCollection } from "@/lib/use-collection";
import { useTenant } from "../layout";
import { PageTitle } from "../page-title";
import { PlanForm } from "../plan-form";
import { cn } from "@/lib/utils";

const Customer = z.object({
  name: z.string(),
  phone: z.string(),
  updatedAt: z.instanceof(Timestamp).optional(),
  etiquetas: z.array(z.string()).optional(),
  semCampanha: z.boolean().optional(),
});

// Quem esteve aqui, e nao quem marcou: customers.updatedAt e a data do ultimo
// agendamento feito, e quem marcou ha 70 dias para ontem esteve aqui ontem.
// Cancelado e falta nao contam como visita; um horario futuro conta, porque
// essa pessoa esta voltando.
const Visita = z.object({
  customerKey: z.string(),
  start: z.instanceof(Timestamp),
  status: z.enum(["booked", "confirmed", "cancelled", "no_show"]),
  priceCents: z.number().optional(),
});

const POR_PAGINA = [10, 25, 50, 100];

// Nome em ordem alfabética; o resto começa pelo maior (quem veio por último, quem mais vem, quem mais gasta)
type Ordem = "nome" | "ultima" | "visitas" | "gasto";
const ORDENS: { id: Ordem; rotulo: string }[] = [
  { id: "nome", rotulo: "Nome" },
  { id: "ultima", rotulo: "Última visita" },
  { id: "visitas", rotulo: "Visitas" },
  { id: "gasto", rotulo: "Gasto 12m" },
];

function haQuanto(ms: number, agora: number) {
  const dias = Math.floor((agora - ms) / DIA_EM_MS);
  if (dias < 1) return "hoje";
  if (dias === 1) return "ontem";
  if (dias < 60) return `há ${dias} dias`;
  return `há ${Math.floor(dias / 30)} meses`;
}


const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function CustomersPage() {
  const tenant = useTenant();
  const [customers, error] = useCollection(tenant.id, "customers", Customer, [orderBy("name")]);
  const [search, setSearch] = useState("");
  const [planning, setPlanning] = useState(false);
  const [janela, setJanela] = useState<number | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [ordem, setOrdem] = useState<{ por: Ordem; sobe: boolean }>({ por: "nome", sobe: true });
  const [porPagina, setPorPagina] = useState(25);
  const [pagina, setPagina] = useState(1);

  // Instante fixo ao abrir a página, como na agenda: Date.now() durante o render
  // daria uma janela que anda sozinha a cada re-render.
  const [agora] = useState(Date.now);
  // Uma consulta só, na maior faixa: trocar de faixa depois é recorte em memória
  const desde = useMemo(() => Timestamp.fromMillis(agora - MAIOR_JANELA * DIA_EM_MS), [agora]);
  const [visitas] = useCollection(tenant.id, "appointments", Visita, [where("start", ">=", desde)], "visitas");
  const ativos = useMemo(
    () =>
      ativosDesde(
        (visitas ?? []).map((v) => ({ customerKey: v.customerKey, status: v.status, startMs: v.start.toMillis() })),
        agora - (janela ?? 0) * DIA_EM_MS,
      ),
    [visitas, janela, agora],
  );
  const resumo = useMemo(
    () => resumoPorCliente((visitas ?? []).map((v) => ({ customerKey: v.customerKey, status: v.status, startMs: v.start.toMillis(), priceCents: v.priceCents })), agora),
    [visitas, agora],
  );
  // Quem pediu para nao receber campanha fica fora do recorte: e o recorte que
  // existe justamente para mandar mensagem.
  const sumidos = janela === null ? null : (customers?.filter((c) => !ativos.has(c.id) && !c.semCampanha) ?? []);

  const term = normalize(search.trim());
  const digits = search.replace(/\D/g, "");
  const base = sumidos ?? customers;
  const filtrados = base?.filter((c) => !term || normalize(c.name).includes(term) || (digits && c.id.includes(digits)));
  const valor = (c: { id: string }) => {
    const r = resumo.get(c.id);
    return ordem.por === "ultima" ? (r?.ultimaMs ?? 0) : ordem.por === "visitas" ? (r?.visitas ?? 0) : (r?.gastoCents ?? 0);
  };
  const shown = filtrados && [...filtrados].sort((a, b) => {
    const d = ordem.por === "nome" ? a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }) : valor(a) - valor(b);
    return (ordem.sobe ? d : -d) || a.name.localeCompare(b.name, "pt-BR");
  });
  const paginas = Math.max(1, Math.ceil((shown?.length ?? 0) / porPagina));
  // a lista encolheu (busca, filtro, exclusão) com a página lá no fim: fica na última que existe
  const atual = Math.min(pagina, paginas);
  const inicio = (atual - 1) * porPagina;
  const ordenar = (por: Ordem) => {
    setOrdem((o) => ({ por, sobe: o.por === por ? !o.sobe : por === "nome" }));
    setPagina(1);
  };
  const cabecalho = (por: Ordem, rotulo: string, direita = false) => (
    <span role="columnheader" aria-sort={ordem.por === por ? (ordem.sobe ? "ascending" : "descending") : "none"} className={cn(direita && "text-right")}>
      <button type="button" onClick={() => ordenar(por)} className={cn("inline-flex items-center gap-1 uppercase hover:text-foreground", ordem.por === por && "text-foreground")}>
        {rotulo}
        <span aria-hidden="true" className={cn("text-[10px]", ordem.por !== por && "opacity-0")}>{ordem.sobe ? "▲" : "▼"}</span>
      </button>
    </span>
  );

  // Quem tem horário marcado pela frente não sumiu, mesmo sem visita passada (cliente novo)
  const comHorario = useMemo(
    () => new Set((visitas ?? []).filter((v) => v.start.toMillis() > agora && (v.status === "booked" || v.status === "confirmed")).map((v) => v.customerKey)),
    [visitas, agora],
  );
  const sumidos60 = customers?.filter((c) => {
    if (comHorario.has(c.id)) return false;
    const u = resumo.get(c.id)?.ultimaMs;
    return !u || agora - u > 60 * DIA_EM_MS;
  }).length;
  const filtro = (dias: number | null, rotulo: string) => (
    <button
      key={rotulo}
      type="button"
      aria-pressed={janela === dias}
      onClick={() => { setJanela(dias); setCopiado(false); setPagina(1); }}
      className={cn("h-9 rounded-md px-3 text-[13px] max-sm:h-10 whitespace-nowrap text-muted-foreground hover:text-foreground", janela === dias && "bg-card font-medium text-foreground shadow-sm")}
    >
      {rotulo}
    </button>
  );

  return (
    <>
      <PageTitle
        title="Clientes"
        sub={customers && visitas && (customers.length ? `${customers.length} cliente(s) · ${sumidos60} sem vir há mais de 60 dias` : "Aparecem aqui a partir do primeiro agendamento")}
      >
        {!planning && <Button className="h-10 px-4" onClick={() => setPlanning(true)}>Novo plano recorrente</Button>}
      </PageTitle>

      {planning && <PlanForm tenantId={tenant.id} onClose={() => setPlanning(false)} />}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-60 flex-1">
          <Label htmlFor="search" className="sr-only">Buscar por nome ou telefone</Label>
          <svg className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <Input
            id="search"
            type="search"
            value={search}
            placeholder="Buscar por nome ou telefone"
            onChange={(e) => { setSearch(e.target.value); setPagina(1); }}
            className="h-11 bg-card pl-11 text-[15px]"
          />
        </div>
        <div className="flex max-w-full min-w-0 items-center gap-2.5">
          <span className="shrink-0 text-[13px] text-muted-foreground">Sem vir há</span>
          <div role="group" aria-label="Filtrar por tempo sem vir" className="flex min-w-0 gap-0.5 overflow-x-auto rounded-lg bg-muted p-1">
            {filtro(null, "Todos")}
            {JANELAS.map((j) => filtro(j.dias, j.rotulo))}
          </div>
        </div>
        {sumidos && shown && shown.length > 0 && (
          <Button
            type="button"
            variant="outline"
            className="h-10 px-4"
            onClick={async () => {
              const ok = await navigator.clipboard
                .writeText(shown.map((c) => c.phone).join("\n"))
                .then(() => true, () => false);
              setCopiado(ok);
            }}
          >
            {copiado ? "Telefones copiados ✓" : "Copiar telefones"}
          </Button>
        )}
      </div>

      {janela !== null && visitas && (
        <p className="text-sm text-muted-foreground">
          {shown?.length ?? 0} de {customers?.length ?? 0} não passam por aqui há {JANELAS.find((j) => j.dias === janela)?.rotulo}
          {" "}e também não têm horário marcado. Copie os telefones para montar uma lista de transmissão, ou fale com um
          de cada vez pelo WhatsApp da linha.
        </p>
      )}

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!shown ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {janela !== null && !term
            ? `Todo mundo passou por aqui nos últimos ${JANELAS.find((j) => j.dias === janela)?.rotulo}.`
            : customers?.length
              ? "Nenhum cliente encontrado."
              : "Os clientes aparecem aqui a partir do primeiro agendamento."}
        </p>
      ) : (
        <section aria-label="Lista de clientes" className="overflow-hidden rounded-2xl border bg-card">
          {/* Visitas e gasto contam os últimos 12 meses: é a janela que a página já busca */}
          {/* Clicar no título ordena; de novo, inverte */}
          <div className="hidden grid-cols-[minmax(0,1fr)_11rem_9rem_6rem_8rem_2.75rem] gap-4 bg-background px-6 py-3 text-xs font-medium tracking-wider text-muted-foreground uppercase md:grid">
            {cabecalho("nome", "Cliente")}
            <span>WhatsApp</span>
            {cabecalho("ultima", "Última visita")}
            {cabecalho("visitas", "Visitas", true)}
            {cabecalho("gasto", "Gasto 12m", true)}
            <span />
          </div>
          {/* No celular os títulos somem: a ordem vira um seletor */}
          <div className="flex items-center gap-2 bg-background px-4 py-2.5 text-[13px] md:hidden">
            <label htmlFor="ordem" className="text-muted-foreground">Ordenar por</label>
            <select
              id="ordem"
              value={`${ordem.por}:${ordem.sobe ? "sobe" : "desce"}`}
              onChange={(e) => {
                const [por, dir] = e.target.value.split(":");
                setOrdem({ por: por as Ordem, sobe: dir === "sobe" });
                setPagina(1);
              }}
              className="h-10 min-w-0 flex-1 rounded-md border bg-card px-2"
            >
              {ORDENS.flatMap(({ id, rotulo }) =>
                id === "nome"
                  ? [<option key="nome:sobe" value="nome:sobe">Nome (A–Z)</option>, <option key="nome:desce" value="nome:desce">Nome (Z–A)</option>]
                  : [<option key={`${id}:desce`} value={`${id}:desce`}>{rotulo} (maior primeiro)</option>, <option key={`${id}:sobe`} value={`${id}:sobe`}>{rotulo} (menor primeiro)</option>],
              )}
            </select>
          </div>
          <ul>
            {shown.slice(inicio, inicio + porPagina).map((c) => {
              const r = resumo.get(c.id);
              const sumido = !comHorario.has(c.id) && (!r?.ultimaMs || agora - r.ultimaMs > 60 * DIA_EM_MS);
              return (
                <li key={c.id} className="group relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-t px-4 py-3 hover:bg-background md:grid-cols-[minmax(0,1fr)_11rem_9rem_6rem_8rem_2.75rem] md:px-6">
                  <div className="flex min-w-0 items-center gap-3">
                    <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-muted font-semibold">{c.name.charAt(0)}</span>
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      {/* O link cobre a linha inteira (after:inset-0); o do WhatsApp fica por cima, irmão e não filho */}
                      <Link href={`/${tenant.id}/clientes/${c.id}`} className="truncate text-[15px] font-semibold after:absolute after:inset-0 hover:underline">
                        {c.name}
                      </Link>
                      {c.etiquetas?.map((e) => (
                        <span key={e} className="rounded-full bg-muted px-2 py-0.5 text-xs">{e}</span>
                      ))}
                      {c.semCampanha && <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">sem campanha</span>}
                    </div>
                  </div>
                  <a
                    href={whatsappLink(c.phone)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Falar com ${c.name} no WhatsApp: ${c.phone}`}
                    className="relative z-10 flex min-h-11 items-center gap-2 rounded-md text-sm tabular-nums text-muted-foreground hover:text-foreground max-md:min-w-11 max-md:justify-center md:text-foreground"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.9-.9L3 20.5l1.6-4.9A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z" />
                    </svg>
                    <span className="hidden sm:inline">{c.phone}</span>
                  </a>
                  <span className="col-span-2 pl-13 text-[13px] md:col-span-1 md:pl-0 md:text-sm">
                    {r?.ultimaMs ? (
                      sumido ? (
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">{haQuanto(r.ultimaMs, agora)}</span>
                      ) : (
                        haQuanto(r.ultimaMs, agora)
                      )
                    ) : (
                      <span className="text-muted-foreground">{comHorario.has(c.id) ? "1ª visita marcada" : "sem visita no último ano"}</span>
                    )}
                    <span className="text-muted-foreground md:hidden"> · {r?.visitas ?? 0} visita(s) · {formatBRL(r?.gastoCents ?? 0)}</span>
                  </span>
                  <span className="hidden text-right tabular-nums md:block">{r?.visitas ?? 0}</span>
                  <span className="hidden text-right font-medium tabular-nums md:block">{formatBRL(r?.gastoCents ?? 0)}</span>
                  <span aria-hidden="true" className="hidden justify-self-end text-muted-foreground group-hover:text-foreground md:block">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </span>
                </li>
              );
            })}
          </ul>
          <nav aria-label="Páginas da lista" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-3 text-[13px] text-muted-foreground md:px-6">
            <span className="tabular-nums">
              {inicio + 1}–{Math.min(inicio + porPagina, shown.length)} de {shown.length}
            </span>
            <label className="flex items-center gap-2">
              Por página
              <select
                value={porPagina}
                onChange={(e) => {
                  setPorPagina(Number(e.target.value));
                  setPagina(1);
                }}
                className="h-9 rounded-md border bg-card px-2 text-foreground tabular-nums max-sm:h-11"
              >
                {POR_PAGINA.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" className="h-10 px-3" disabled={atual <= 1} onClick={() => setPagina(atual - 1)}>
                Anterior
              </Button>
              <span aria-live="polite" className="tabular-nums whitespace-nowrap">Página {atual} de {paginas}</span>
              <Button variant="outline" className="h-10 px-3" disabled={atual >= paginas} onClick={() => setPagina(atual + 1)}>
                Próxima
              </Button>
            </div>
          </nav>
        </section>
      )}
    </>
  );
}
