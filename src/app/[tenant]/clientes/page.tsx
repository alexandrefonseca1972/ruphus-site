"use client";

import { orderBy, Timestamp, where } from "firebase/firestore";
import Link from "next/link";
import { useMemo, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ativosDesde, DIA_EM_MS, JANELAS, MAIOR_JANELA } from "@/lib/clientes";
import { whatsappLink } from "@/lib/datetime";
import { useCollection } from "@/lib/use-collection";
import { useTenant } from "../layout";
import { PlanForm } from "../plan-form";

const Customer = z.object({ name: z.string(), phone: z.string(), updatedAt: z.instanceof(Timestamp).optional() });

// Quem esteve aqui, e nao quem marcou: customers.updatedAt e a data do ultimo
// agendamento feito, e quem marcou ha 70 dias para ontem esteve aqui ontem.
// Cancelado e falta nao contam como visita; um horario futuro conta, porque
// essa pessoa esta voltando.
const Visita = z.object({
  customerKey: z.string(),
  start: z.instanceof(Timestamp),
  status: z.enum(["booked", "confirmed", "cancelled", "no_show"]),
});


const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function CustomersPage() {
  const tenant = useTenant();
  const [customers, error] = useCollection(tenant.id, "customers", Customer, [orderBy("name")]);
  const [search, setSearch] = useState("");
  const [planning, setPlanning] = useState(false);
  const [janela, setJanela] = useState<number | null>(null);
  const [copiado, setCopiado] = useState(false);

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
  const sumidos = janela === null ? null : (customers?.filter((c) => !ativos.has(c.id)) ?? []);

  const term = normalize(search.trim());
  const digits = search.replace(/\D/g, "");
  const base = sumidos ?? customers;
  const shown = base?.filter((c) => !term || normalize(c.name).includes(term) || (digits && c.id.includes(digits)));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Clientes</h1>
          {customers && <p className="text-sm text-muted-foreground">{customers.length} cliente(s)</p>}
        </div>
        {!planning && <Button onClick={() => setPlanning(true)}>Novo plano recorrente</Button>}
      </div>

      {planning && <PlanForm tenantId={tenant.id} onClose={() => setPlanning(false)} />}

      <div className="flex flex-wrap items-end gap-4">
        <div className="grid gap-2 sm:max-w-sm sm:grow">
          <Label htmlFor="search">Buscar por nome ou telefone</Label>
          <Input id="search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Sem vir há</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por tempo sem vir">
            <Button
              type="button"
              size="sm"
              variant={janela === null ? "default" : "outline"}
              aria-pressed={janela === null}
              onClick={() => { setJanela(null); setCopiado(false); }}
            >
              Todos
            </Button>
            {JANELAS.map((j) => (
              <Button
                key={j.dias}
                type="button"
                size="sm"
                variant={janela === j.dias ? "default" : "outline"}
                aria-pressed={janela === j.dias}
                onClick={() => { setJanela(j.dias); setCopiado(false); }}
              >
                {j.rotulo}
              </Button>
            ))}
          </div>
          {sumidos && shown && shown.length > 0 && (
            <Button
              type="button"
              variant="outline"
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
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {janela !== null && !term
            ? `Todo mundo passou por aqui nos últimos ${JANELAS.find((j) => j.dias === janela)?.rotulo}.`
            : customers?.length
              ? "Nenhum cliente encontrado."
              : "Os clientes aparecem aqui a partir do primeiro agendamento."}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {shown.map((c) => (
            <li key={c.id} className="flex items-center gap-1 pr-2 hover:bg-muted">
              {/* O <a> do WhatsApp e irmao do <Link>, nunca filho: link dentro de
                  link nao e clicavel e o teclado passa direto por um deles. */}
              <Link href={`/${tenant.id}/clientes/${c.id}`} className="flex grow flex-wrap items-center justify-between gap-2 p-3">
                <span className="font-medium">{c.name}</span>
                <span className="text-sm text-muted-foreground">{c.phone}</span>
              </Link>
              <a
                href={whatsappLink(c.phone)}
                target="_blank"
                rel="noreferrer"
                aria-label={`Falar com ${c.name} no WhatsApp`}
                className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.9-.9L3 20.5l1.6-4.9A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z" />
                </svg>
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
