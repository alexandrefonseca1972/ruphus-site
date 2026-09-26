"use client";

import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, serverTimestamp, Timestamp, updateDoc, where } from "firebase/firestore";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { auth, idToken } from "@/lib/firebase";
import { db } from "@/lib/firebase-db";
import { dateIn, formatBRL, formatLongDate, formatTime, whatsappLink } from "@/lib/datetime";
import { useCollection } from "@/lib/use-collection";
import { brDeIso, erroEmail, erroNascimento, idade, isoDeBR, mascaraData, mascaraEmail } from "@/lib/cliente-dados";
import { deleteCustomerAction, endPlanAction, renameCustomerAction, salvarDadosClienteAction } from "../../actions";
import { ConfirmDialog } from "../../confirm-dialog";
import { History } from "../../history";
import { useTenant } from "../../layout";
import { PlanForm, planLabel } from "../../plan-form";
import { STATUS } from "../../status";

const Appointment = z.object({
  serviceName: z.string(),
  staffName: z.string(),
  priceCents: z.number(),
  start: z.instanceof(Timestamp),
  status: z.enum(["booked", "confirmed", "cancelled", "no_show"]),
  planId: z.string().optional(),
});

const Plan = z.object({
  serviceName: z.string(),
  staffName: z.string(),
  weekday: z.number(),
  time: z.string(),
  firstDate: z.string(),
  lastDate: z.string(),
  count: z.number(),
  status: z.enum(["active", "ended"]),
  createdBy: z.string(),
  createdAt: z.instanceof(Timestamp),
});

const shortDate = (date: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

const Nota = z.object({
  texto: z.string(),
  quando: z.instanceof(Timestamp).optional(),
  porNome: z.string().optional(),
});

export default function CustomerPage() {
  const tenant = useTenant();
  const { customer: rawKey } = useParams<{ customer: string }>();
  const key = /^\d{10,15}$/.test(rawKey) ? rawKey : ""; // id do cliente = telefone só com dígitos
  const [customer, setCustomer] = useState<
    { name: string; phone: string; etiquetas: string[]; semCampanha: boolean; nascimento: string; email: string } | null | undefined
  >(undefined);
  const [appointments] = useCollection(tenant.id, "appointments", Appointment, [where("customerKey", "==", key), orderBy("start", "desc")], key);
  const [plans] = useCollection(tenant.id, "plans", Plan, [where("customerKey", "==", key)], key);
  const [notas] = useCollection(tenant.id, `customers/${key}/notas`, Nota, [orderBy("quando", "desc")], key);
  const [planning, setPlanning] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState("");
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  const [endingPlan, setEndingPlan] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();
  const [error, setError] = useState("");
  const [now] = useState(Date.now);

  useEffect(() => {
    if (!key) return setCustomer(null); // eslint-disable-line react-hooks/set-state-in-effect -- chave inválida na URL
    return onSnapshot(
        doc(db, "tenants", tenant.id, "customers", key),
        (snap) =>
          setCustomer(
            snap.exists()
              ? {
                  name: snap.get("name"),
                  phone: snap.get("phone"),
                  etiquetas: (snap.get("etiquetas") as string[] | undefined) ?? [],
                  semCampanha: snap.get("semCampanha") === true,
                  nascimento: String(snap.get("nascimento") ?? ""),
                  email: String(snap.get("email") ?? ""),
                }
              : null,
          ),
      () => setCustomer(null),
    );
  }, [tenant.id, key]);

  async function endPlan(planId: string) {
    setEndingPlan(null);
    setError("");
    try {
      const res = await endPlanAction(await idToken(), { tenantId: tenant.id, planId });
      if (!res.ok) setError(res.error);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove() {
    setError("");
    const res = await deleteCustomerAction(await idToken(), { tenantId: tenant.id, customerId: key }).catch((err: Error) => ({ ok: false as const, error: err.message }));
    if (!res.ok) {
      setDeleting(false);
      return setError(res.error);
    }
    router.replace(`/${tenant.id}/clientes`);
  }

  if (customer === undefined) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (customer === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Cliente não encontrado. <Link href={`/${tenant.id}/clientes`} className="underline">Ver clientes</Link>
      </p>
    );
  }

  const past = appointments?.filter((a) => a.start.toMillis() <= now) ?? [];
  const count = (status: string) => appointments?.filter((a) => a.status === status).length ?? 0;
  const attended = past.filter((a) => a.status === "booked" || a.status === "confirmed");
  const upcoming = appointments?.filter((a) => a.start.toMillis() > now && (a.status === "booked" || a.status === "confirmed")).length ?? 0;
  const stats = [
    { label: "Agendamentos", value: appointments?.length ?? 0 },
    { label: "Próximos", value: upcoming },
    { label: "Atendidos", value: attended.length },
    { label: "Faltas", value: count("no_show") },
    { label: "Cancelados", value: count("cancelled") },
    { label: "Total gasto", value: formatBRL(attended.reduce((sum, a) => sum + a.priceCents, 0)) },
  ];
  const sortedPlans = plans?.toSorted((a, b) => (a.status === b.status ? b.createdAt.toMillis() - a.createdAt.toMillis() : a.status === "active" ? -1 : 1));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href={`/${tenant.id}/clientes`} className="text-sm text-muted-foreground underline-offset-4 hover:underline">← Clientes</Link>
          {renaming ? (
            <form
              onSubmit={async (ev) => {
                ev.preventDefault();
                const campo = ev.currentTarget.elements.namedItem("nome") as HTMLInputElement;
                setRenameError("");
                const r = await renameCustomerAction(await idToken(), {
                  tenantId: tenant.id,
                  customerId: key,
                  name: campo.value,
                });
                if (!r.ok) return setRenameError(r.error);
                setRenaming(false);
              }}
              className="flex flex-wrap items-center gap-2 py-1"
            >
              <label htmlFor="nome" className="sr-only">Nome do cliente</label>
              <Input id="nome" name="nome" defaultValue={customer.name} maxLength={80} required className="h-10 w-full max-sm:h-11 sm:w-56" />
              <Button type="submit" size="sm">Salvar</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => { setRenaming(false); setRenameError(""); }}>
                Cancelar
              </Button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold">{customer.name}</h1>
              {/* O nome vem do que a pessoa digitou ao agendar e ficava assim para sempre */}
              <button
                type="button"
                onClick={() => setRenaming(true)}
                className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                corrigir
              </button>
            </div>
          )}
          {renameError && <p role="alert" className="text-sm text-destructive">{renameError}</p>}
          <a href={whatsappLink(customer.phone)} target="_blank" rel="noreferrer" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            {customer.phone} · WhatsApp
          </a>
        </div>
        <div className="flex flex-wrap gap-2">
          {tenant.podeGerir && !deleting && <Button variant="ghost" onClick={() => setDeleting(true)}>Excluir cliente</Button>}
          {!planning && <Button onClick={() => setPlanning(true)}>Novo plano recorrente</Button>}
        </div>
      </div>
      {deleting && (
        <ConfirmDialog
          title={`Excluir ${customer.name}?`}
          description="Some da lista de clientes junto com as anotações. Os atendimentos passados continuam na agenda e no histórico."
          confirmLabel="Excluir cliente"
          onConfirm={remove}
          onCancel={() => setDeleting(false)}
        />
      )}

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border p-3">
            <dt className="text-xs text-muted-foreground">{s.label}</dt>
            <dd className={`text-lg font-semibold tabular-nums ${s.label === "Faltas" && s.value ? "text-red-700 dark:text-red-400" : ""}`}>{s.value}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="sobre" className="grid gap-3 rounded-lg border p-4">
        <h2 id="sobre" className="font-medium">O que você sabe sobre {customer.name.split(" ")[0]}</h2>

        <DadosDoCliente
          tenantId={tenant.id}
          customerId={key}
          nascimento={customer.nascimento}
          email={customer.email}
          podeEditar={tenant.podeGerir}
        />

        <div className="flex flex-wrap items-center gap-2">
          {customer.etiquetas.map((e) => (
            <span key={e} className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
              {e}
              <button
                type="button"
                aria-label={`Tirar a etiqueta ${e}`}
                onClick={() => updateDoc(doc(db, "tenants", tenant.id, "customers", key), { etiquetas: customer.etiquetas.filter((x) => x !== e) })}
                className="text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </span>
          ))}
          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              const campo = ev.currentTarget.elements.namedItem("etiqueta") as HTMLInputElement;
              const nova = campo.value.trim().slice(0, 24);
              // Oito e o teto das regras; repetida nao entra duas vezes
              if (!nova || customer.etiquetas.includes(nova) || customer.etiquetas.length >= 8) return;
              updateDoc(doc(db, "tenants", tenant.id, "customers", key), { etiquetas: [...customer.etiquetas, nova] });
              campo.value = "";
            }}
          >
            <label htmlFor="etiqueta" className="sr-only">Nova etiqueta</label>
            <Input id="etiqueta" name="etiqueta" placeholder="+ etiqueta" maxLength={24} className="h-8 w-36 text-xs max-sm:h-11 max-sm:w-full" />
          </form>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={customer.semCampanha}
            onChange={(ev) => updateDoc(doc(db, "tenants", tenant.id, "customers", key), { semCampanha: ev.target.checked })}
            className="size-4"
          />
          Não receber campanhas
        </label>

        <form
          onSubmit={async (ev) => {
            ev.preventDefault();
            const campo = ev.currentTarget.elements.namedItem("nota") as HTMLInputElement;
            const texto = campo.value.trim();
            if (!texto) return;
            const user = auth.currentUser;
            if (!user) return;
            await addDoc(collection(db, "tenants", tenant.id, "customers", key, "notas"), {
              texto,
              quando: serverTimestamp(),
              por: user.uid,
              porNome: user.email,
            });
            campo.value = "";
          }}
          className="flex gap-2"
        >
          <label htmlFor="nota" className="sr-only">Anotação</label>
          <Input id="nota" name="nota" maxLength={600} placeholder="Alergias, preferências, o que combinaram…" />
          <Button type="submit">Anotar</Button>
        </form>

        {!!notas?.length && (
          <ul className="grid gap-2">
            {notas.map((n) => (
              <li key={n.id} className="flex items-start gap-3 border-t pt-2 text-sm first:border-t-0 first:pt-0">
                <span className="w-24 shrink-0 text-xs text-muted-foreground tabular-nums">
                  {n.quando ? n.quando.toDate().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "agora"}
                </span>
                <p className="grow whitespace-pre-line">{n.texto}</p>
                <span className="shrink-0 text-xs text-muted-foreground">{n.porNome?.split("@")[0]}</span>
                <button
                  type="button"
                  aria-label="Apagar anotação"
                  onClick={() => deleteDoc(doc(db, "tenants", tenant.id, "customers", key, "notas", n.id))}
                  className="shrink-0 text-xs text-muted-foreground hover:text-destructive"
                >
                  apagar
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {planning && <PlanForm tenantId={tenant.id} customer={customer} onClose={() => setPlanning(false)} />}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {!!sortedPlans?.length && (
        <section className="grid gap-2">
          <h2 className="font-medium">Planos recorrentes</h2>
          <ul className="divide-y rounded-lg border">
            {sortedPlans.map((p) => {
              const label = planLabel(p.weekday, p.time);
              return (
                <li key={p.id} className="grid gap-2 p-3">
                  <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 ${p.status === "ended" ? "opacity-60" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium first-letter:uppercase">
                      {label}
                      {p.status === "ended" && <span className="ml-2 text-xs font-normal">(encerrado)</span>}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {p.serviceName} · {p.staffName} · {p.count} agendamento(s), de {shortDate(p.firstDate)} a {shortDate(p.lastDate)}
                    </p>
                    <p className="text-xs text-muted-foreground">Criado por {p.createdBy}</p>
                  </div>
                  {p.status === "active" && p.lastDate >= dateIn(new Date(now)) && (
                    <Button variant="outline" size="sm" onClick={() => setEndingPlan(p.id)}>Encerrar plano</Button>
                  )}
                  </div>
                  {endingPlan === p.id && (
                    <ConfirmDialog
                      title={`Encerrar o plano ${label}?`}
                      description="Os agendamentos futuros deste plano serão cancelados. Os passados continuam no histórico."
                      confirmLabel="Sim, encerrar plano"
                      onConfirm={() => endPlan(p.id)}
                      onCancel={() => setEndingPlan(null)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="grid gap-2">
        <h2 className="font-medium">Histórico de agendamentos</h2>
        {!appointments ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : appointments.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum agendamento.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {appointments.map((a) => (
              <li key={a.id} className="grid gap-2 p-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      <span className="first-letter:uppercase">{formatLongDate(a.start.toDate())}, {formatTime(a.start.toDate())}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-normal ${STATUS[a.status].className}`}>{STATUS[a.status].label}</span>
                      {a.planId && <span className="rounded-full border px-2 py-0.5 text-xs font-normal">Recorrente</span>}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {a.serviceName} · {a.staffName} · {formatBRL(a.priceCents)}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" aria-expanded={openHistory === a.id} onClick={() => setOpenHistory(openHistory === a.id ? null : a.id)}>
                    Histórico
                  </Button>
                </div>
                {openHistory === a.id && <History tenantId={tenant.id} appointmentId={a.id} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** Nascimento e e-mail: o dono registra, a equipe vê. Máscara ao digitar, erro no campo
 *  (ao sair dele, e a cada tecla depois disso) e o servidor confere de novo ao salvar. */
function DadosDoCliente({
  tenantId,
  customerId,
  nascimento,
  email,
  podeEditar,
}: {
  tenantId: string;
  customerId: string;
  nascimento: string;
  email: string;
  podeEditar: boolean;
}) {
  const [data, setData] = useState(brDeIso(nascimento));
  const [mail, setMail] = useState(email);
  const [vistos, setVistos] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  if (!podeEditar) {
    if (!nascimento && !email) return null;
    return (
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {nascimento && (
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Nascimento</dt>
            <dd>{brDeIso(nascimento)} · {idade(nascimento)} anos</dd>
          </div>
        )}
        {email && (
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">E-mail</dt>
            <dd>{email}</dd>
          </div>
        )}
      </dl>
    );
  }

  const erros = { data: erroNascimento(data), email: erroEmail(mail) };
  // a data completa já diz se vale, sem esperar a pessoa sair do campo
  const mostra = (c: "data" | "email") => (vistos.has(c) || (c === "data" && data.length === 10) ? erros[c] : "");
  const ver = (c: string) => setVistos((v) => new Set(v).add(c));
  const mudou = isoDeBR(data) !== nascimento || mail !== email;
  const iso = isoDeBR(data);

  async function salvar(ev: React.FormEvent) {
    ev.preventDefault();
    setVistos(new Set(["data", "email"]));
    setAviso(null);
    if (erros.data || erros.email) return;
    setBusy(true);
    const r = await salvarDadosClienteAction(await idToken(), { tenantId, customerId, dados: { nascimento: iso, email: mail } }).catch(() => null);
    setBusy(false);
    if (!r) return setAviso({ ok: false, texto: "Não foi possível salvar. Verifique a conexão." });
    setAviso(r.ok ? { ok: true, texto: "Salvo." } : { ok: false, texto: r.error });
  }

  const campo = (erro: string) => `h-10 max-sm:h-11 ${erro ? "border-destructive focus-visible:border-destructive" : ""}`;
  return (
    <form noValidate onSubmit={salvar} className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-start">
      <div className="grid gap-1">
        <label htmlFor="nascimento" className="text-xs text-muted-foreground">Nascimento</label>
        <Input
          id="nascimento"
          inputMode="numeric"
          autoComplete="off"
          placeholder="DD/MM/AAAA"
          value={data}
          onChange={(e) => setData(mascaraData(e.target.value))}
          onBlur={() => ver("data")}
          aria-invalid={!!mostra("data")}
          aria-describedby="nascimento-aviso"
          className={`${campo(mostra("data"))} tabular-nums`}
        />
        <p id="nascimento-aviso" aria-live="polite" className={`min-h-4 text-xs ${mostra("data") ? "text-destructive" : "text-muted-foreground"}`}>
          {mostra("data") || (iso && !erros.data ? `${idade(iso)} anos` : "")}
        </p>
      </div>
      <div className="grid gap-1">
        <label htmlFor="email-cliente" className="text-xs text-muted-foreground">E-mail</label>
        <Input
          id="email-cliente"
          type="email"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="nome@exemplo.com"
          value={mail}
          onChange={(e) => setMail(mascaraEmail(e.target.value))}
          onBlur={() => ver("email")}
          aria-invalid={!!mostra("email")}
          aria-describedby="email-cliente-aviso"
          className={campo(mostra("email"))}
        />
        <p id="email-cliente-aviso" aria-live="polite" className="min-h-4 text-xs text-destructive">{mostra("email")}</p>
      </div>
      <div className="grid gap-1 sm:pt-5">
        <Button type="submit" size="sm" disabled={busy || !mudou} className="max-sm:h-11">
          {busy ? "Salvando…" : "Salvar"}
        </Button>
        {aviso && (
          <p role={aviso.ok ? "status" : "alert"} className={`text-xs ${aviso.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}>
            {aviso.texto}
          </p>
        )}
      </div>
    </form>
  );
}
