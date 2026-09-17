"use client";

import { orderBy, Timestamp } from "firebase/firestore";
import Link from "next/link";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCollection } from "@/lib/use-collection";
import { useTenant } from "../layout";
import { PlanForm } from "../plan-form";

const Customer = z.object({ name: z.string(), phone: z.string(), updatedAt: z.instanceof(Timestamp).optional() });

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function CustomersPage() {
  const tenant = useTenant();
  const [customers, error] = useCollection(tenant.id, "customers", Customer, [orderBy("name")]);
  const [search, setSearch] = useState("");
  const [planning, setPlanning] = useState(false);

  const term = normalize(search.trim());
  const digits = search.replace(/\D/g, "");
  const shown = customers?.filter((c) => !term || normalize(c.name).includes(term) || (digits && c.id.includes(digits)));

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

      <div className="grid gap-2 sm:max-w-sm">
        <Label htmlFor="search">Buscar por nome ou telefone</Label>
        <Input id="search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!shown ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : shown.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {customers?.length ? "Nenhum cliente encontrado." : "Os clientes aparecem aqui a partir do primeiro agendamento."}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {shown.map((c) => (
            <li key={c.id}>
              <Link href={`/${tenant.id}/clientes/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 p-3 hover:bg-muted">
                <span className="font-medium">{c.name}</span>
                <span className="text-sm text-muted-foreground">{c.phone}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
