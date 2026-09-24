"use client";

import { addDoc, collection, deleteDoc, doc, orderBy, setDoc, updateDoc } from "firebase/firestore";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/auth-errors";
import { db } from "@/lib/firebase-db";
import { formatBRL, formatDuration, maskBRL } from "@/lib/datetime";
import { Service, Staff } from "@/lib/scheduling";
import { useCollection } from "@/lib/use-collection";
import { useTenant } from "../layout";
import { PageTitle } from "../page-title";
import { ConfirmDialog } from "../confirm-dialog";
import { RowMenu } from "../row-menu";
import { cn, handleSubmit } from "@/lib/utils";

const toCents = (masked: string) => Number(masked.replace(/\D/g, ""));

// As mensagens vêm do próprio schema: a regra que o formulário mostra é a que o salvamento aplica
const erroDe = (campo: "name" | "durationMin" | "priceCents", valor: unknown) => {
  const r = Service.shape[campo].safeParse(valor);
  return r.success ? "" : r.error.issues[0].message;
};

type Editando = (Service & { id: string }) | null;

// "Limpeza de pele " e "limpeza de Pele" são o mesmo serviço para quem agenda
const chaveNome = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

function ServiceForm({ editing, emUso, onSave, onCancel }: { editing: Editando; emUso: Set<string>; onSave: (data: Service) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(editing?.name ?? "");
  const [duration, setDuration] = useState(String(editing?.durationMin ?? 30));
  const [price, setPrice] = useState(editing ? formatBRL(editing.priceCents) : "");
  // erro só aparece depois que a pessoa passou pelo campo (ou tentou salvar); daí em diante, a cada tecla
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const errors = {
    name: erroDe("name", name) || (emUso.has(chaveNome(name)) ? "Já existe um serviço com este nome" : ""),
    durationMin: duration ? erroDe("durationMin", Number(duration)) : "Informe a duração",
    price: price ? erroDe("priceCents", toCents(price)) : "Informe o preço",
  };
  const show = (f: keyof typeof errors) => (touched[f] ? errors[f] : "");
  const touch = (f: string) => () => setTouched((t) => ({ ...t, [f]: true }));

  async function submit() {
    setTouched({ name: true, durationMin: true, price: true });
    if (Object.values(errors).some(Boolean)) return;
    setBusy(true);
    try {
      await onSave({ name: name.trim(), durationMin: Number(duration), priceCents: toCents(price), active: editing?.active ?? true });
      if (!editing) {
        setName("");
        setDuration("30");
        setPrice("");
        setTouched({});
      }
    } catch {
      // a página já mostra o erro; os campos ficam como estão para a pessoa tentar de novo
    } finally {
      setBusy(false);
    }
  }

  const minutos = Number(duration);
  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem_11rem] sm:items-start">
        <Field id="name" label="Nome" error={show("name")} hint={`${name.length}/80`}>
          <Input
            id="name"
            className="h-11 bg-card px-3.5 text-[15px] tabular-nums"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={touch("name")}
            placeholder="Corte masculino"
            maxLength={80}
            aria-invalid={!!show("name")}
            aria-describedby="name-msg"
          />
        </Field>
        <Field id="durationMin" label="Duração" error={show("durationMin")} hint={minutos >= 60 && !errors.durationMin ? formatDuration(minutos) : "minutos"}>
          <Input
            id="durationMin"
            className="h-11 bg-card px-3.5 text-[15px] tabular-nums"
            value={duration}
            onChange={(e) => setDuration(e.target.value.replace(/\D/g, "").slice(0, 3))}
            onBlur={touch("durationMin")}
            inputMode="numeric"
            placeholder="30"
            aria-invalid={!!show("durationMin")}
            aria-describedby="durationMin-msg"
          />
        </Field>
        <Field id="price" label="Preço" error={show("price")}>
          <Input
            id="price"
            className="h-11 bg-card px-3.5 text-[15px] tabular-nums"
            value={price}
            onChange={(e) => setPrice(maskBRL(e.target.value))}
            onBlur={touch("price")}
            inputMode="numeric"
            placeholder="R$ 0,00"
            aria-invalid={!!show("price")}
            aria-describedby="price-msg"
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        {editing && <Button type="button" variant="ghost" className="h-10 px-4" onClick={onCancel}>Cancelar</Button>}
        <Button type="submit" disabled={busy} className="h-10 px-4">{editing ? "Salvar alterações" : "Adicionar serviço"}</Button>
      </div>
    </form>
  );
}

function Field({ id, label, error, hint, children }: { id: string; label: string; error: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {/* altura reservada: a mensagem aparecer não empurra o formulário */}
      <p id={`${id}-msg`} aria-live="polite" className={`min-h-4 text-xs ${error ? "text-destructive" : "text-muted-foreground"}`}>
        {error || hint}
      </p>
    </div>
  );
}

export default function ServicesPage() {
  const tenant = useTenant();
  const [items, loadError] = useCollection(tenant.id, "services", Service, [orderBy("name")]);
  const [staff] = useCollection(tenant.id, "staff", Staff, []);
  const [excluindo, setExcluindo] = useState<Editando>(null);
  const [editing, setEditing] = useState<Editando>(null);
  const [error, setError] = useState("");
  const col = collection(db, "tenants", tenant.id, "services");

  async function save(data: Service) {
    setError("");
    try {
      await (editing ? setDoc(doc(col, editing.id), data) : addDoc(col, data));
      setEditing(null);
    } catch (err) {
      setError(errorMessage(err));
      throw err;
    }
  }

  async function run(action: Promise<unknown>) {
    try {
      await action;
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const ativos = items?.filter((s) => s.active).length ?? 0;
  // Os que já foram criados em dobro, de antes da validação: ficam marcados para excluir um
  const repetidos = new Map<string, number>();
  for (const s of items ?? []) repetidos.set(chaveNome(s.name), (repetidos.get(chaveNome(s.name)) ?? 0) + 1);
  const fazem = (id: string) => staff?.filter((p) => p.active && p.serviceIds.includes(id)).map((p) => p.name) ?? [];

  return (
    <>
      <PageTitle
        title="Serviços"
        sub={items && (items.length ? `${ativos} no link de agendamento${items.length > ativos ? ` · ${items.length - ativos} oculto(s)` : ""}` : "O que os clientes podem agendar")}
      />
      <section aria-labelledby="form-servico" className="grid gap-5 rounded-2xl border bg-card p-5 sm:px-7 sm:py-6">
        <h2 id="form-servico" className="font-semibold">{editing ? `Editar “${editing.name}”` : "Novo serviço"}</h2>
        {/* key recria o formulário com os valores do item em edição */}
        <ServiceForm
          key={editing?.id ?? "new"}
          editing={editing}
          // o próprio serviço em edição pode manter o nome
          emUso={new Set(items?.filter((s) => s.id !== editing?.id).map((s) => chaveNome(s.name)))}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      </section>

      {(error || loadError) && <p role="alert" className="text-sm text-destructive">{error || loadError}</p>}
      {items?.length === 0 && (
        <p className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Cadastre os serviços que seus clientes podem agendar.
        </p>
      )}
      {!!items?.length && (
        <section aria-label="Serviços cadastrados" className="overflow-hidden rounded-2xl border bg-card">
          <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_7rem_8rem_11rem_7rem] gap-4 bg-background px-6 py-3 text-xs font-medium tracking-wider text-muted-foreground uppercase sm:grid">
            <span>Serviço</span>
            <span>Duração</span>
            <span>Preço</span>
            <span>Link de agendamento</span>
            <span />
          </div>
          <ul>
            {items.map((s) => {
              const quem = fazem(s.id);
              return (
                <li key={s.id} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-t px-4 py-4 sm:grid-cols-[minmax(0,1fr)_7rem_8rem_11rem_7rem] sm:px-6", !s.active && "text-muted-foreground")}>
                  <div className="grid min-w-0 gap-0.5">
                    <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                      {s.name}
                      {(repetidos.get(chaveNome(s.name)) ?? 0) > 1 && (
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">Nome repetido</span>
                      )}
                    </span>
                    <span className="text-[13px] text-muted-foreground">
                      {quem.length ? quem.join(", ") : "Ninguém faz ainda"}
                      <span className="sm:hidden"> · {formatDuration(s.durationMin)} · {formatBRL(s.priceCents)}</span>
                    </span>
                  </div>
                  <span className="hidden tabular-nums sm:block">{formatDuration(s.durationMin)}</span>
                  <span className="hidden font-medium tabular-nums sm:block">{formatBRL(s.priceCents)}</span>
                  <label className="order-last col-span-2 flex items-center gap-2.5 text-[13px] text-muted-foreground sm:order-none sm:col-span-1">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={s.active}
                      onChange={() => run(updateDoc(doc(col, s.id), { active: !s.active }))}
                      aria-label={`${s.name} aparece no link de agendamento`}
                      className="peer sr-only"
                    />
                    <span aria-hidden="true" className="relative h-6 w-11 shrink-0 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-card after:transition-transform peer-checked:after:translate-x-5" />
                    {s.active ? "No link" : "Oculto"}
                  </label>
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" className="h-10 px-3" onClick={() => setEditing(s)}>Editar</Button>
                    <RowMenu
                      label={`Mais ações: ${s.name}`}
                      actions={[
                        {
                          label: "Excluir",
                          danger: true,
                          onClick: () => setExcluindo(s),
                        },
                      ]}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {excluindo && (
        <ConfirmDialog
          title={`Excluir “${excluindo.name}”?`}
          description="Some do link de agendamento. Os agendamentos já feitos continuam na agenda."
          confirmLabel="Excluir serviço"
          onConfirm={async () => {
            await run(deleteDoc(doc(col, excluindo.id)));
            setExcluindo(null);
          }}
          onCancel={() => setExcluindo(null)}
        />
      )}
    </>
  );
}
