"use client";

import { addDoc, collection, deleteDoc, doc, orderBy, setDoc, updateDoc } from "firebase/firestore";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/auth-errors";
import { db } from "@/lib/firebase";
import { WEEKDAYS } from "@/lib/datetime";
import { Service, Staff } from "@/lib/scheduling";
import { useCollection } from "@/lib/use-collection";
import { useTenant } from "../layout";
import { PageTitle } from "../page-title";
import { ConfirmDialog } from "../confirm-dialog";
import { RowMenu } from "../row-menu";
import { cn, handleSubmit } from "@/lib/utils";

type Day = keyof Staff["hours"];
const DAYS = ["1", "2", "3", "4", "5", "6", "0"] as Day[]; // segunda primeiro
const DEFAULT_HOURS: Staff["hours"] = Object.fromEntries(
  ["1", "2", "3", "4", "5", "6"].map((d) => [d, { start: "09:00", end: "18:00" }]),
);

// "09:00" → "9", "18:30" → "18h30": sete dias cabem numa linha
const curta = (t: string) => {
  const [h, m] = t.split(":");
  return m === "00" ? String(Number(h)) : `${Number(h)}h${m}`;
};

export default function StaffPage() {
  const tenant = useTenant();
  const [staff, staffError] = useCollection(tenant.id, "staff", Staff, [orderBy("name")]);
  const [services] = useCollection(tenant.id, "services", Service, [orderBy("name")]);
  const [editing, setEditing] = useState<(Staff & { id: string }) | null>(null);
  const [salvos, setSalvos] = useState(0);
  const [excluindo, setExcluindo] = useState<(Staff & { id: string }) | null>(null);
  const [error, setError] = useState("");
  const col = collection(db, "tenants", tenant.id, "staff");
  const serviceName = new Map(services?.map((s) => [s.id, s.name]));

  async function save(form: FormData, el: HTMLFormElement) {
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
      el.reset();
      setEditing(null);
      setSalvos((n) => n + 1); // formulário novo, zerado (os serviços são controlados e o reset não os alcança)
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
  const ativos = staff?.filter((p) => p.active).length ?? 0;

  // Quase todo salão tem o mesmo horário de segunda a sexta: preenche uma vez, repete nos dias marcados
  function repetirSegunda(ev: React.MouseEvent<HTMLButtonElement>) {
    const f = ev.currentTarget.form!;
    const campo = (n: string) => f.elements.namedItem(n) as HTMLInputElement;
    for (const d of DAYS.slice(1)) {
      if (!campo(`on-${d}`).checked) continue;
      campo(`start-${d}`).value = campo("start-1").value;
      campo(`end-${d}`).value = campo("end-1").value;
    }
  }

  return (
    <>
      <PageTitle title="Profissionais" sub={staff && (staff.length ? `${ativos} atendendo pelo link` : "Quem atende, o que faz e quando")} />
      {(error || staffError) && <p role="alert" className="text-sm text-destructive">{error || staffError}</p>}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="grid gap-4">
          {staff?.length === 0 && (
            <p className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              Ninguém cadastrado ainda. Quem você adicionar aparece no link de agendamento.
            </p>
          )}
          {staff?.map((p) => (
            <article key={p.id} className={cn("grid gap-4 rounded-2xl border bg-card p-5 sm:p-6", !p.active && "opacity-70")}>
              <div className="flex items-center gap-3.5">
                <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-muted font-serifa text-2xl">{p.name.charAt(0)}</span>
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <h2 className="flex flex-wrap items-center gap-2 text-[17px] font-semibold">
                    {p.name}
                    {!p.active && <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">Fora do link</span>}
                  </h2>
                  <span className="text-[13px] text-muted-foreground">
                    {p.serviceIds.length} serviço(s) · {DAYS.filter((d) => p.hours[d]).length} dia(s) na semana
                  </span>
                </div>
                <Button variant="outline" className="h-10 px-4" onClick={() => { setEditing(p); document.getElementById("form-prof")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Editar</Button>
                <RowMenu
                  label={`Mais ações: ${p.name}`}
                  actions={[
                    { label: p.active ? "Tirar do link" : "Voltar para o link", onClick: () => run(updateDoc(doc(col, p.id), { active: !p.active })) },
                    { label: "Excluir", danger: true, onClick: () => setExcluindo(p) },
                  ]}
                />
              </div>
              {!!p.serviceIds.length && (
                <ul className="flex flex-wrap gap-2" aria-label="Serviços">
                  {p.serviceIds.map((id) => serviceName.get(id)).filter(Boolean).map((n) => (
                    <li key={n} className="rounded-full border px-3 py-1 text-[13px]">{n}</li>
                  ))}
                </ul>
              )}
              <dl className="grid grid-cols-7 gap-1.5">
                {DAYS.map((d) => {
                  const h = p.hours[d];
                  return (
                    <div key={d} className={cn("grid justify-items-center gap-1 rounded-xl border px-0.5 py-2.5 text-center", h ? "bg-muted" : "border-dashed")}>
                      <dt className="text-[11px] tracking-wider text-muted-foreground uppercase">{WEEKDAYS[Number(d)].slice(0, 3)}</dt>
                      <dd className={cn("text-xs font-medium tabular-nums sm:text-[13px]", !h && "text-muted-foreground")}>
                        {h ? `${curta(h.start)}–${curta(h.end)}` : "folga"}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </article>
          ))}
        </div>

        <section aria-labelledby="form-prof" className="grid gap-5 rounded-2xl border bg-card p-5 sm:p-6 lg:sticky lg:top-6">
          <h2 id="form-prof" className="font-semibold">{editing ? `Editar ${editing.name}` : "Novo profissional"}</h2>
          {services?.length === 0 ? (
            <p className="text-sm text-muted-foreground">Cadastre um serviço antes de adicionar profissionais.</p>
          ) : (
            <form key={editing?.id ?? `new-${salvos}`} onSubmit={handleSubmit(save)} className="grid gap-6">
              <div className="grid gap-1.5">
                <Label htmlFor="name">Nome</Label>
                <Input id="name" name="name" defaultValue={editing?.name} placeholder="Ex.: Bruna Oliveira" required maxLength={80} className="h-11 bg-card px-3.5 text-[15px]" />
              </div>

              <ServiceChecks services={services ?? []} initial={editing?.serviceIds ?? []} />

              <fieldset className="grid gap-1">
                <legend className="mb-2 text-sm font-medium">Horário de atendimento</legend>
                {DAYS.map((d) => (
                  <div key={d} className="group grid grid-cols-[5.5rem_1fr_1fr] items-center gap-2 text-sm">
                    <label className="flex min-h-11 items-center gap-2">
                      <input type="checkbox" name={`on-${d}`} defaultChecked={!!hours[d]} className="size-4 accent-primary" />
                      {WEEKDAYS[Number(d)].slice(0, 3)}
                    </label>
                    {/* desmarcado = folga: os campos ficam, apagados, para voltar com o mesmo horário */}
                    <Input type="time" name={`start-${d}`} aria-label={`Início ${WEEKDAYS[Number(d)]}`} defaultValue={hours[d]?.start ?? "09:00"} step={900} className="h-10 bg-card group-has-[input[type=checkbox]:not(:checked)]:opacity-40" />
                    <Input type="time" name={`end-${d}`} aria-label={`Fim ${WEEKDAYS[Number(d)]}`} defaultValue={hours[d]?.end ?? "18:00"} step={900} className="h-10 bg-card group-has-[input[type=checkbox]:not(:checked)]:opacity-40" />
                  </div>
                ))}
                <button type="button" onClick={repetirSegunda} className="mt-1 min-h-9 justify-self-start text-[13px] underline underline-offset-4 hover:text-muted-foreground">
                  Repetir o horário de segunda nos outros dias marcados
                </button>
              </fieldset>

              <div className="flex gap-2">
                <Button type="submit" className="h-11 flex-1 px-4">{editing ? "Salvar alterações" : "Adicionar profissional"}</Button>
                {editing && <Button type="button" variant="ghost" className="h-11 px-4" onClick={() => setEditing(null)}>Cancelar</Button>}
              </div>
            </form>
          )}
        </section>
      </div>
      {excluindo && (
        <ConfirmDialog
          title={`Excluir ${excluindo.name}?`}
          description="Sai do link de agendamento. Os agendamentos já feitos continuam na agenda. Para só pausar, use “Tirar do link”."
          confirmLabel="Excluir profissional"
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

/** Serviços do profissional. Controlado só para o "marcar todos" saber o que dizer;
 * o formulário continua lendo os checkboxes pelo name. */
function ServiceChecks({ services, initial }: { services: (Service & { id: string })[]; initial: string[] }) {
  const [marcados, setMarcados] = useState(() => new Set(initial));
  const todos = services.length > 0 && services.every((sv) => marcados.has(sv.id));
  const alterna = (id: string) =>
    setMarcados((m) => {
      const n = new Set(m);
      if (!n.delete(id)) n.add(id);
      return n;
    });

  return (
    <fieldset className="grid gap-2" aria-labelledby="servicos-prof">
      {/* O botão mora na legend para ficar na mesma linha do título; o nome do grupo vem só do span */}
      <legend className="mb-2.5 flex w-full items-center justify-between gap-3 text-sm font-medium">
        <span id="servicos-prof">Serviços que realiza</span>
        {services.length > 1 && (
          <button
            type="button"
            onClick={() => setMarcados(todos ? new Set() : new Set(services.map((sv) => sv.id)))}
            className="min-h-9 text-[13px] font-normal underline underline-offset-4 hover:text-muted-foreground"
          >
            {todos ? "Desmarcar todos" : "Marcar todos"}
          </button>
        )}
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {services.map((sv) => (
          <label key={sv.id} className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-3.5 py-2 text-sm has-checked:border-primary has-checked:bg-muted has-focus-visible:ring-3 has-focus-visible:ring-ring/50">
            <input type="checkbox" name="serviceIds" value={sv.id} checked={marcados.has(sv.id)} onChange={() => alterna(sv.id)} className="size-4 shrink-0 accent-primary" />
            {sv.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
