"use client";

import { addDoc, collection, deleteDoc, doc, orderBy, setDoc, updateDoc } from "firebase/firestore";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/auth-errors";
import { db } from "@/lib/firebase-db";
import { formatBRL, formatDuration, maskBRL, precoDe, type TipoPreco } from "@/lib/datetime";
import { Service, Staff } from "@/lib/scheduling";
import { useCollection } from "@/lib/use-collection";
import { useTenant } from "../painel-layout";
import { PageTitle } from "../page-title";
import { ConfirmDialog } from "../confirm-dialog";
import { RowMenu } from "../row-menu";
import { TituloOrdenavel } from "@/components/titulo-ordenavel";
import { cn, handleSubmit } from "@/lib/utils";

const toCents = (masked: string) => Number(masked.replace(/\D/g, ""));

// a lista lê também "usos" (quantas vezes foi agendado: a ordem da página pública)
const ServicoNaLista = Service.extend({ usos: z.number().optional() });
const POR_PAGINA = [10, 25, 50];
type Ordem = "nome" | "duracao" | "preco" | "usos";
const ORDENS: { id: Ordem; rotulo: string }[] = [
  { id: "nome", rotulo: "Nome" },
  { id: "usos", rotulo: "Mais agendados" },
  { id: "preco", rotulo: "Preço" },
  { id: "duracao", rotulo: "Duração" },
];
type Filtro = "todos" | "noLink" | "fora" | "ninguem" | "ocultos";
const FILTROS: { id: Filtro; rotulo: string }[] = [
  { id: "todos", rotulo: "Todos" },
  { id: "noLink", rotulo: "No link" },
  { id: "fora", rotulo: "Fora do link" },
  { id: "ninguem", rotulo: "Ninguém faz" },
  { id: "ocultos", rotulo: "Ocultos" },
];

// As mensagens vêm do próprio schema: a regra que o formulário mostra é a que o salvamento aplica
const erroDe = (campo: "name" | "durationMin" | "priceCents", valor: unknown) => {
  const r = Service.shape[campo].safeParse(valor);
  return r.success ? "" : r.error.issues[0].message;
};

type Editando = (Service & { id: string }) | null;
const TIPOS: [TipoPreco, string][] = [
  ["fixo", "Fixo"],
  ["aPartir", "A partir de"],
  ["naoInformado", "Não informar"],
];

// "Limpeza de pele " e "limpeza de Pele" são o mesmo serviço para quem agenda
const chaveNome = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

function ServiceForm({ editing, emUso, onSave, onCancel }: { editing: Editando; emUso: Set<string>; onSave: (data: Service) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(editing?.name ?? "");
  const [duration, setDuration] = useState(String(editing?.durationMin ?? 30));
  const [tipo, setTipo] = useState<TipoPreco>(editing?.tipoPreco ?? "fixo");
  const [price, setPrice] = useState(editing && editing.tipoPreco !== "naoInformado" ? formatBRL(editing.priceCents) : "");
  // erro só aparece depois que a pessoa passou pelo campo (ou tentou salvar); daí em diante, a cada tecla
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const errors = {
    name: erroDe("name", name) || (emUso.has(chaveNome(name)) ? "Já existe um serviço com este nome" : ""),
    durationMin: duration ? erroDe("durationMin", Number(duration)) : "Informe a duração",
    price: tipo === "naoInformado" ? "" : price ? erroDe("priceCents", toCents(price)) : "Informe o preço",
  };
  const show = (f: keyof typeof errors) => (touched[f] ? errors[f] : "");
  const touch = (f: string) => () => setTouched((t) => ({ ...t, [f]: true }));

  async function submit() {
    setTouched({ name: true, durationMin: true, price: true });
    if (Object.values(errors).some(Boolean)) return;
    setBusy(true);
    try {
      await onSave({ name: name.trim(), durationMin: Number(duration), priceCents: tipo === "naoInformado" ? 0 : toCents(price), tipoPreco: tipo, active: editing?.active ?? true });
      if (!editing) {
        setName("");
        setDuration("30");
        setPrice("");
        setTipo("fixo");
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
        <Field id="price" label="Preço" error={show("price")} hint={tipo === "aPartir" ? "o menor valor" : undefined}>
          <Input
            id="price"
            className="h-11 bg-card px-3.5 text-[15px] tabular-nums"
            disabled={tipo === "naoInformado"}
            value={tipo === "naoInformado" ? "" : price}
            onChange={(e) => setPrice(maskBRL(e.target.value))}
            onBlur={touch("price")}
            inputMode="numeric"
            placeholder={tipo === "naoInformado" ? "Sem preço" : "R$ 0,00"}
            aria-invalid={!!show("price")}
            aria-describedby="price-msg"
          />
        </Field>
      </div>
      {/* Quem cobra conforme o caso mostra "a partir de"; quem prefere combinar, nenhum preço */}
      <div role="radiogroup" aria-labelledby="tipo-preco-t" className="flex flex-wrap items-center gap-2">
        <span id="tipo-preco-t" className="w-full text-sm font-medium sm:mr-1 sm:w-auto">Como o preço aparece</span>
        {TIPOS.map(([t, rotulo]) => (
          <label
            key={t}
            className={cn("flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-[13px]", tipo === t && "border-foreground bg-muted")}
          >
            <input type="radio" name="tipoPreco" checked={tipo === t} onChange={() => setTipo(t)} className="size-4 accent-foreground" />
            {rotulo}
          </label>
        ))}
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
  const [items, loadError] = useCollection(tenant.id, "services", ServicoNaLista, [orderBy("name")]);
  // busca, filtro, ordem e página: tudo na tela (um salão tem dezenas de serviços, não milhares)
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [quem, setQuem] = useState("");
  const [ordem, setOrdem] = useState<{ por: Ordem; sobe: boolean }>({ por: "nome", sobe: true });
  const [porPagina, setPorPagina] = useState(25);
  const [pagina, setPagina] = useState(1);
  const [staff] = useCollection(tenant.id, "staff", Staff, []);
  const [excluindo, setExcluindo] = useState<Editando>(null);
  const [editing, setEditing] = useState<Editando>(null);
  const [error, setError] = useState("");
  const col = collection(db, "tenants", tenant.id, "services");

  async function save(data: Service) {
    setError("");
    try {
      // merge: o formulário manda sempre todos os campos do serviço; sem merge, o setDoc apagava
      // usos e ordem (a ordem de popularidade da página pública), e na demo a regra recusava
      await (editing ? setDoc(doc(col, editing.id), data, { merge: true }) : addDoc(col, data));
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

  // no link de verdade: ativo e com alguém da equipe que faz (sem ninguém, o /agendar esconde)
  // equipe ainda carregando: conta pelo ativo, sem piscar "fora do link" em tudo
  const noLink = (s: { id: string; active: boolean }) => s.active && (!staff || fazemIds.has(s.id));
  const fazemIds = new Set(staff?.filter((p) => p.active).flatMap((p) => p.serviceIds) ?? []);
  const ativos = items?.filter(noLink).length ?? 0;
  // Os que já foram criados em dobro, de antes da validação: ficam marcados para excluir um
  const repetidos = new Map<string, number>();
  for (const s of items ?? []) repetidos.set(chaveNome(s.name), (repetidos.get(chaveNome(s.name)) ?? 0) + 1);
  const fazem = (id: string) => staff?.filter((p) => p.active && p.serviceIds.includes(id)).map((p) => p.name) ?? [];

  const termo = chaveNome(busca);
  const doProfissional = quem ? new Set(staff?.find((p) => p.id === quem)?.serviceIds ?? []) : null;
  const passa = (s: NonNullable<typeof items>[number]) =>
    (!termo || chaveNome(s.name).includes(termo)) &&
    (!doProfissional || doProfissional.has(s.id)) &&
    (filtro === "todos" ||
      (filtro === "noLink" && noLink(s)) ||
      (filtro === "fora" && s.active && !noLink(s)) ||
      (filtro === "ninguem" && !fazemIds.has(s.id)) ||
      (filtro === "ocultos" && !s.active));
  // sem preço informado fica sempre no fim, subindo ou descendo
  const valor = (s: NonNullable<typeof items>[number]) =>
    ordem.por === "duracao" ? s.durationMin : ordem.por === "usos" ? (s.usos ?? 0) : s.tipoPreco === "naoInformado" ? null : s.priceCents;
  const lista = (items ?? []).filter(passa).sort((a, b) => {
    if (ordem.por === "nome") return (ordem.sobe ? 1 : -1) * a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
    const [va, vb] = [valor(a), valor(b)];
    if (va === null || vb === null) return va === vb ? a.name.localeCompare(b.name, "pt-BR") : va === null ? 1 : -1;
    return (ordem.sobe ? va - vb : vb - va) || a.name.localeCompare(b.name, "pt-BR");
  });
  const paginas = Math.max(1, Math.ceil(lista.length / porPagina));
  // a lista encolheu (busca, filtro, exclusão) com a página lá no fim: fica na última que existe
  const atual = Math.min(pagina, paginas);
  const inicio = (atual - 1) * porPagina;
  const filtrando = !!termo || filtro !== "todos" || !!quem;
  const ordenar = (por: Ordem) => {
    setOrdem((o) => ({ por, sobe: o.por === por ? !o.sobe : por === "nome" }));
    setPagina(1);
  };
  const cabecalho = (por: Ordem, rotulo: string, className?: string) => (
    <TituloOrdenavel rotulo={rotulo} ativo={ordem.por === por} sobe={ordem.sobe} onClick={() => ordenar(por)} className={className} />
  );

  return (
    <>
      <PageTitle
        title="Serviços"
        sub={items && (items.length ? `${ativos} no link de agendamento${items.length > ativos ? ` · ${items.length - ativos} fora do link` : ""}` : "O que os clientes podem agendar")}
      />
      {/* preço e o que entra no link são do dono: o funcionário só consulta */}
      {tenant.podeGerir && <section aria-labelledby="form-servico" className="grid gap-5 rounded-2xl border bg-card p-5 sm:px-7 sm:py-6">
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
      </section>}

      {(error || loadError) && <p role="alert" className="text-sm text-destructive">{error || loadError}</p>}
      {items?.length === 0 && (
        <p className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Cadastre os serviços que seus clientes podem agendar.
        </p>
      )}
      {!!items?.length && (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-0 flex-1 basis-60">
              <Label htmlFor="busca-servico" className="sr-only">Buscar serviço</Label>
              <svg className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <Input
                id="busca-servico"
                type="search"
                value={busca}
                placeholder="Buscar serviço"
                onChange={(e) => (setBusca(e.target.value), setPagina(1))}
                className="h-11 bg-card pl-11 text-[15px]"
              />
            </div>
            {!!staff?.length && (
              <label className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground max-sm:w-full">
                Quem faz
                <select value={quem} onChange={(e) => (setQuem(e.target.value), setPagina(1))} className="h-11 min-w-0 flex-1 rounded-lg border bg-card px-2 text-foreground sm:h-10 sm:flex-none">
                  <option value="">Toda a equipe</option>
                  {staff.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            )}
          </div>
          <div role="group" aria-label="Filtrar serviços" className="flex w-fit max-w-full gap-0.5 justify-self-start overflow-x-auto rounded-lg bg-muted p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {FILTROS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filtro === f.id}
                onClick={() => (setFiltro(f.id), setPagina(1))}
                className={cn("h-9 shrink-0 rounded-md px-3 text-[13px] whitespace-nowrap text-muted-foreground hover:text-foreground max-sm:h-10", filtro === f.id && "bg-card font-medium text-foreground shadow-sm")}
              >
                {f.rotulo}
              </button>
            ))}
          </div>
        </div>
      )}
      {!!items?.length && lista.length === 0 && (
        <p className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Nenhum serviço encontrado.{" "}
          {filtrando && (
            <button type="button" className="font-medium text-foreground underline underline-offset-2" onClick={() => (setBusca(""), setFiltro("todos"), setQuem(""), setPagina(1))}>
              Limpar a busca e os filtros
            </button>
          )}
        </p>
      )}
      {!!lista.length && (
        <section aria-label="Serviços cadastrados" className="overflow-hidden rounded-2xl border bg-card">
          {/* clicar no título ordena; de novo, inverte */}
          <div role="row" className="hidden items-center gap-4 border-b bg-background px-6 py-2.5 text-xs font-medium tracking-wider text-muted-foreground uppercase sm:grid sm:grid-cols-[minmax(0,1fr)_7rem_8rem_11rem_7rem] lg:grid-cols-[minmax(0,1fr)_6rem_8rem_6.5rem_11rem_7rem]">
            {cabecalho("nome", "Serviço")}
            {cabecalho("duracao", "Duração")}
            {cabecalho("preco", "Preço")}
            {cabecalho("usos", "Agendados", "hidden lg:block")}
            <span>Link de agendamento</span>
            <span />
          </div>
          {/* no celular os títulos somem: a ordem vai num seletor */}
          <div className="flex items-center gap-2 border-b bg-background px-4 py-2.5 text-[13px] sm:hidden">
            <label htmlFor="ordem-servicos" className="shrink-0 text-muted-foreground">Ordenar por</label>
            <select
              id="ordem-servicos"
              value={`${ordem.por}:${ordem.sobe ? "sobe" : "desce"}`}
              onChange={(e) => {
                const [por, dir] = e.target.value.split(":");
                setOrdem({ por: por as Ordem, sobe: dir === "sobe" });
                setPagina(1);
              }}
              className="h-11 min-w-0 flex-1 rounded-md border bg-card px-2"
            >
              {ORDENS.flatMap(({ id, rotulo }) =>
                id === "nome"
                  ? [<option key="nome:sobe" value="nome:sobe">Nome (A–Z)</option>, <option key="nome:desce" value="nome:desce">Nome (Z–A)</option>]
                  : id === "usos"
                    ? [<option key="usos:desce" value="usos:desce">Mais agendados</option>, <option key="usos:sobe" value="usos:sobe">Menos agendados</option>]
                    : [<option key={`${id}:desce`} value={`${id}:desce`}>{rotulo} (maior primeiro)</option>, <option key={`${id}:sobe`} value={`${id}:sobe`}>{rotulo} (menor primeiro)</option>],
              )}
            </select>
          </div>
          <ul>
            {lista.slice(inicio, inicio + porPagina).map((s) => {
              const quem = fazem(s.id);
              return (
                <li key={s.id} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-t px-4 py-4 sm:grid-cols-[minmax(0,1fr)_7rem_8rem_11rem_7rem] lg:grid-cols-[minmax(0,1fr)_6rem_8rem_6.5rem_11rem_7rem] sm:px-6", !s.active && "text-muted-foreground")}>
                  <div className="grid min-w-0 gap-0.5">
                    <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                      {s.name}
                      {(repetidos.get(chaveNome(s.name)) ?? 0) > 1 && (
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">Nome repetido</span>
                      )}
                    </span>
                    <span className="text-[13px] text-muted-foreground">
                      {quem.length ? quem.join(", ") : "Ninguém faz ainda"}
                      <span className="sm:hidden"> · {formatDuration(s.durationMin)} · {precoDe(s) || "sem preço"}</span>
                    </span>
                  </div>
                  <span className="hidden tabular-nums sm:block">{formatDuration(s.durationMin)}</span>
                  <span className="hidden tabular-nums sm:block">
                    {s.tipoPreco === "naoInformado" ? (
                      <span className="text-muted-foreground">Não informado</span>
                    ) : (
                      <>
                        {s.tipoPreco === "aPartir" && <span className="block text-xs text-muted-foreground">a partir de</span>}
                        <span className="font-medium">{formatBRL(s.priceCents)}</span>
                      </>
                    )}
                  </span>
                  <span className="hidden tabular-nums lg:block" title="Vezes que foi agendado">{s.usos ?? 0}</span>
                  <label className="order-last col-span-2 flex min-h-11 items-center gap-2.5 text-[13px] text-muted-foreground sm:order-none sm:col-span-1">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={s.active}
                      disabled={!tenant.podeGerir}
                      onChange={() => run(updateDoc(doc(col, s.id), { active: !s.active }))}
                      // a chave é a vontade do dono ("mostrar"); se ninguém faz, ligada fica apagada
                      // e o texto ao lado diz por quê — antes ela dizia "aparece" sem aparecer
                      aria-label={`Mostrar ${s.name} no link de agendamento`}
                      aria-describedby={`sv-link-${s.id}`}
                      className="peer sr-only"
                    />
                    <span aria-hidden="true" className={`relative h-6 w-11 shrink-0 rounded-full bg-input transition-colors ${noLink(s) ? "peer-checked:bg-primary" : "peer-checked:bg-muted-foreground/40"} peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-card after:transition-transform peer-checked:after:translate-x-5`} />
                    <span id={`sv-link-${s.id}`}>{!s.active ? "Oculto" : noLink(s) ? "No link" : "Fora do link até alguém fazer"}</span>
                  </label>
                  {tenant.podeGerir && <div className="flex items-center justify-end gap-1">
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
                  </div>}
                </li>
              );
            })}
          </ul>
          <nav aria-label="Páginas da lista de serviços" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-3 text-[13px] text-muted-foreground sm:px-6">
            <span className="tabular-nums">
              {inicio + 1}–{Math.min(inicio + porPagina, lista.length)} de {lista.length}
              {filtrando && items && ` (de ${items.length})`}
            </span>
            <label className="flex items-center gap-2">
              Por página
              <select value={porPagina} onChange={(e) => (setPorPagina(Number(e.target.value)), setPagina(1))} className="h-9 rounded-md border bg-card px-2 text-foreground tabular-nums max-sm:h-11">
                {POR_PAGINA.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            {paginas > 1 && (
              <div className="ml-auto flex items-center gap-2 max-sm:w-full max-sm:justify-between">
                <Button variant="outline" className="h-10 px-3" disabled={atual <= 1} onClick={() => setPagina(atual - 1)}>Anterior</Button>
                <span aria-live="polite" className="min-w-0 text-center tabular-nums">Página {atual} de {paginas}</span>
                <Button variant="outline" className="h-10 px-3" disabled={atual >= paginas} onClick={() => setPagina(atual + 1)}>Próxima</Button>
              </div>
            )}
          </nav>
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
