"use client";

import { addDoc, collection, deleteDoc, doc, orderBy, setDoc, updateDoc } from "firebase/firestore";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/auth-errors";
import { db } from "@/lib/firebase";
import { Service, Staff, WEEKDAYS } from "@/lib/scheduling";
import { useCollection } from "@/lib/use-collection";
import { useTenant } from "../layout";

type Day = keyof Staff["hours"];
const DAYS = ["1", "2", "3", "4", "5", "6", "0"] as Day[]; // segunda primeiro
const DEFAULT_HOURS: Staff["hours"] = Object.fromEntries(
  ["1", "2", "3", "4", "5", "6"].map((d) => [d, { start: "09:00", end: "18:00" }]),
);

const summary = (hours: Staff["hours"]) =>
  DAYS.filter((d) => hours[d])
    .map((d) => `${WEEKDAYS[Number(d)].slice(0, 3)} ${hours[d]!.start}–${hours[d]!.end}`)
    .join(" · ") || "Sem horários";

export default function StaffPage() {
  const tenant = useTenant();
  const [staff, staffError] = useCollection(tenant.id, "staff", Staff, [orderBy("name")]);
  const [services] = useCollection(tenant.id, "services", Service, [orderBy("name")]);
  const [editing, setEditing] = useState<(Staff & { id: string }) | null>(null);
  const [error, setError] = useState("");
  const col = collection(db, "tenants", tenant.id, "staff");
  const serviceName = new Map(services?.map((s) => [s.id, s.name]));

  async function save(form: FormData) {
    setError("");
    try {
      const data = Staff.parse({
        name: form.get("name"),
        serviceIds: form.getAll("serviceIds"),
        hours: Object.fromEntries(
          DAYS.filter((d) => form.get(`on-${d}`)).map((d) => [d, { start: form.get(`start-${d}`), end: form.get(`end-${d}`) }]),
        ),
        active: editing?.active ?? true,
      });
      await (editing ? setDoc(doc(col, editing.id), data) : addDoc(col, data));
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

  const hours = editing?.hours ?? DEFAULT_HOURS;

  return (
    <>
      <h1 className="text-2xl font-semibold">Profissionais</h1>
      <Card>
        <CardHeader>
          <CardTitle>{editing ? `Editar ${editing.name}` : "Novo profissional"}</CardTitle>
        </CardHeader>
        <CardContent>
          {services?.length === 0 ? (
            <p className="text-sm text-muted-foreground">Cadastre um serviço antes de adicionar profissionais.</p>
          ) : (
            <form key={editing?.id ?? "new"} action={save} className="grid gap-6">
              <div className="grid gap-2 sm:max-w-sm">
                <Label htmlFor="name">Nome</Label>
                <Input id="name" name="name" defaultValue={editing?.name} required maxLength={80} />
              </div>

              <fieldset className="grid gap-2">
                <legend className="mb-2 text-sm font-medium">Serviços que realiza</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {services?.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="serviceIds" value={s.id} defaultChecked={editing?.serviceIds.includes(s.id)} className="size-4 accent-primary" />
                      {s.name}
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="grid gap-2">
                <legend className="mb-2 text-sm font-medium">Horário de atendimento</legend>
                {DAYS.map((d) => (
                  <div key={d} className="grid grid-cols-[7rem_1fr_1fr] items-center gap-2 text-sm sm:max-w-md">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name={`on-${d}`} defaultChecked={!!hours[d]} className="size-4 accent-primary" />
                      {WEEKDAYS[Number(d)]}
                    </label>
                    <Input type="time" name={`start-${d}`} aria-label={`Início ${WEEKDAYS[Number(d)]}`} defaultValue={hours[d]?.start ?? "09:00"} step={900} />
                    <Input type="time" name={`end-${d}`} aria-label={`Fim ${WEEKDAYS[Number(d)]}`} defaultValue={hours[d]?.end ?? "18:00"} step={900} />
                  </div>
                ))}
              </fieldset>

              <div className="flex gap-2">
                <Button type="submit">{editing ? "Salvar" : "Adicionar"}</Button>
                {editing && <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>}
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      {(error || staffError) && <p role="alert" className="text-sm text-destructive">{error || staffError}</p>}
      {!!staff?.length && (
        <ul className="divide-y rounded-lg border">
          {staff.map((p) => (
            <li key={p.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 p-3 ${p.active ? "" : "opacity-60"}`}>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{p.name}{!p.active && <span className="ml-2 text-xs font-normal">(inativo)</span>}</p>
                <p className="text-sm text-muted-foreground">{p.serviceIds.map((id) => serviceName.get(id)).filter(Boolean).join(", ")}</p>
                <p className="text-xs text-muted-foreground">{summary(p.hours)}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>Editar</Button>
              <Button variant="ghost" size="sm" onClick={() => run(updateDoc(doc(col, p.id), { active: !p.active }))}>
                {p.active ? "Desativar" : "Ativar"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => confirm(`Excluir ${p.name}?`) && run(deleteDoc(doc(col, p.id)))}>
                Excluir
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
