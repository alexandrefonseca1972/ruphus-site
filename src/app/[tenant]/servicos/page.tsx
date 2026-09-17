"use client";

import { addDoc, collection, deleteDoc, doc, orderBy, setDoc, updateDoc } from "firebase/firestore";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/auth-errors";
import { db } from "@/lib/firebase";
import { formatBRL, formatDuration } from "@/lib/datetime";
import { Service } from "@/lib/scheduling";
import { useCollection } from "@/lib/use-collection";
import { useTenant } from "../layout";
import { handleSubmit } from "@/lib/utils";

const toCents = (v: string) => Math.round(Number(v.replace(/\./g, "").replace(",", ".")) * 100);
const fromCents = (c: number) => (c / 100).toFixed(2).replace(".", ",");

export default function ServicesPage() {
  const tenant = useTenant();
  const [items, loadError] = useCollection(tenant.id, "services", Service, [orderBy("name")]);
  const [editing, setEditing] = useState<(Service & { id: string }) | null>(null);
  const [error, setError] = useState("");
  const col = collection(db, "tenants", tenant.id, "services");

  async function save(form: FormData, el: HTMLFormElement) {
    setError("");
    try {
      const data = Service.parse({
        name: form.get("name"),
        durationMin: Number(form.get("durationMin")),
        priceCents: toCents(String(form.get("price"))),
        active: editing?.active ?? true,
      });
      await (editing ? setDoc(doc(col, editing.id), data) : addDoc(col, data));
      el.reset();
      setEditing(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function run(action: Promise<unknown>) {
    try {
      await action;
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">Serviços</h1>
      <Card>
        <CardHeader>
          <CardTitle>{editing ? `Editar “${editing.name}”` : "Novo serviço"}</CardTitle>
        </CardHeader>
        <CardContent>
          {/* key recria o formulário com os valores do item em edição */}
          <form key={editing?.id ?? "new"} onSubmit={handleSubmit(save)} className="grid gap-4 sm:grid-cols-[1fr_8rem_8rem_auto] sm:items-end">
            <div className="grid gap-2">
              <Label htmlFor="name">Nome</Label>
              <Input id="name" name="name" defaultValue={editing?.name} placeholder="Corte masculino" required maxLength={80} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="durationMin">Duração (min)</Label>
              <Input id="durationMin" name="durationMin" type="number" min={5} max={480} step={5} defaultValue={editing?.durationMin ?? 30} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="price">Preço (R$)</Label>
              <Input id="price" name="price" inputMode="decimal" pattern="\d+([.,]\d{1,2})?" defaultValue={editing ? fromCents(editing.priceCents) : ""} placeholder="45,00" required />
            </div>
            <div className="flex gap-2">
              <Button type="submit">{editing ? "Salvar" : "Adicionar"}</Button>
              {editing && <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>}
            </div>
          </form>
        </CardContent>
      </Card>

      {(error || loadError) && <p role="alert" className="text-sm text-destructive">{error || loadError}</p>}
      {items?.length === 0 && (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Cadastre os serviços que seus clientes podem agendar.
        </p>
      )}
      {!!items?.length && (
        <ul className="divide-y rounded-lg border">
          {items.map((s) => (
            <li key={s.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 p-3 ${s.active ? "" : "opacity-60"}`}>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{s.name}{!s.active && <span className="ml-2 text-xs font-normal">(inativo)</span>}</p>
                <p className="text-sm text-muted-foreground">{formatDuration(s.durationMin)} · {formatBRL(s.priceCents)}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>Editar</Button>
              <Button variant="ghost" size="sm" onClick={() => run(updateDoc(doc(col, s.id), { active: !s.active }))}>
                {s.active ? "Desativar" : "Ativar"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => confirm(`Excluir “${s.name}”? Agendamentos já feitos continuam na agenda.`) && run(deleteDoc(doc(col, s.id)))}
              >
                Excluir
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
