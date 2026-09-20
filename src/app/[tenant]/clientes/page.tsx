"use client";

import { orderBy, Timestamp, where } from "firebase/firestore";
import Link from "next/link";
import { useMemo, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ativosNaJanela } from "@/lib/clientes";
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
const DIAS_SEM_VIR = 60;

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function CustomersPage() {
  const tenant = useTenant();
  const [customers, error] = useCollection(tenant.id, "customers", Customer, [orderBy("name")]);
  const [search, setSearch] = useState("");
  const [planning, setPlanning] = useState(false);
  const [soSumidos, setSoSumidos] = useState(false);
  const [copiado, setCopiado] = useState(false);

  // Instante fixo ao abrir a página, como na agenda: Date.now() durante o render
  // daria uma janela que anda sozinha a cada re-render.
  const [agora] = useState(Date.now);
  const desde = useMemo(() => Timestamp.fromMillis(agora - DIAS_SEM_VIR * 86_400_000), [agora]);
  const [visitas] = useCollection(tenant.id, "appointments", Visita, [where("start", ">=", desde)], "visitas");
  const ativos = useMemo(() => ativosNaJanela(visitas ?? []), [visitas]);
  const sumidos = customers?.filter((c) => !ativos.has(c.id)) ?? [];

  const term = normalize(search.trim());
  const digits = search.replace(/\D/g, "");
  const base = soSumidos ? sumidos : customers;
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
          <Button
            type="button"
            variant={soSumidos ? "default" : "outline"}
            aria-pressed={soSumidos}
            onClick={() => { setSoSumidos((v) => !v); setCopiado(false); }}
          >
            Sem vir há {DIAS_SEM_VIR} dias{visitas && customers ? ` (${sumidos.length})` : ""}
          </Button>
          {soSumidos && shown && shown.length > 0 && (
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

      {soSumidos && (
        <p className="text-sm text-muted-foreground">
          Quem não passou por aqui nos últimos {DIAS_SEM_VIR} dias e também não tem horário marcado. Copie os telefones
          para montar uma lista de transmissão, ou abra a ficha para falar com um de cada vez.
        </p>
      )}

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!shown ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : shown.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {soSumidos && !term
            ? `Todo mundo passou por aqui nos últimos ${DIAS_SEM_VIR} dias.`
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
