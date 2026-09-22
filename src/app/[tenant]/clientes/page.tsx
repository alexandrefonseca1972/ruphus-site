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

const PAGINA = 50;

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
  const [limite, setLimite] = useState(PAGINA);

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
  const shown = base?.filter((c) => !term || normalize(c.name).includes(term) || (digits && c.id.includes(digits)));

  const sumidos60 = customers?.filter((c) => {
    const u = resumo.get(c.id)?.ultimaMs;
    return !u || agora - u > 60 * DIA_EM_MS;
  }).length;
  const filtro = (dias: number | null, rotulo: string) => (
    <button
      key={rotulo}
      type="button"
      aria-pressed={janela === dias}
      onClick={() => { setJanela(dias); setCopiado(false); setLimite(PAGINA); }}
      className={cn("h-9 rounded-md px-3 text-[13px] whitespace-nowrap text-muted-foreground hover:text-foreground", janela === dias && "bg-card font-medium text-foreground shadow-sm")}
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
            onChange={(e) => { setSearch(e.target.value); setLimite(PAGINA); }}
            className="h-11 bg-card pl-11 text-[15px]"
          />
        </div>
        <div className="flex max-w-full items-center gap-2.5">
          <span className="shrink-0 text-[13px] text-muted-foreground">Sem vir há</span>
          <div role="group" aria-label="Filtrar por tempo sem vir" className="flex gap-0.5 overflow-x-auto rounded-lg bg-muted p-1">
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
          <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_11rem_9rem_6rem_8rem_2.75rem] gap-4 bg-background px-6 py-3 text-xs font-medium tracking-wider text-muted-foreground uppercase md:grid">
            <span>Cliente</span>
            <span>WhatsApp</span>
            <span>Última visita</span>
            <span className="text-right">Visitas</span>
            <span className="text-right">Gasto 12m</span>
            <span />
          </div>
          <ul>
            {shown.slice(0, limite).map((c) => {
              const r = resumo.get(c.id);
              const sumido = !r?.ultimaMs || agora - r.ultimaMs > 60 * DIA_EM_MS;
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
                    className="relative z-10 flex min-h-11 items-center gap-2 rounded-md text-sm tabular-nums text-muted-foreground hover:text-foreground md:text-foreground"
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
                      <span className="text-muted-foreground">há mais de 1 ano</span>
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
          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3.5 text-[13px] text-muted-foreground md:px-6">
            <span>Mostrando {Math.min(limite, shown.length)} de {shown.length}</span>
            {shown.length > limite && (
              <Button variant="outline" className="h-10 px-4" onClick={() => setLimite(limite + PAGINA)}>Carregar mais</Button>
            )}
          </div>
        </section>
      )}
    </>
  );
}
