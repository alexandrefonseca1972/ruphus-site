"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { average, collection, count, DocumentSnapshot, getAggregateFromServer, getDocs, limit, orderBy, query, startAfter, Timestamp, where, type QueryConstraint } from "firebase/firestore";
import { Star } from "lucide-react";
import { z } from "zod";
import { db } from "@/lib/firebase-db";
import { useTenant } from "../painel-layout";
import { emParalelo } from "@/lib/paralelo";
import { Button } from "@/components/ui/button";

const POR_PAGINA = 25;
const Review = z.object({
  customerKey: z.string().nullish(),
  customerName: z.string(),
  serviceName: z.string(),
  staffId: z.string(),
  staffName: z.string(),
  notas: z.object({ servico: z.number(), profissional: z.number(), atendimento: z.number(), ambiente: z.number().nullable(), localizacao: z.number().nullable() }),
  notaGeral: z.number(),
  comentario: z.string().optional(),
  respondidaEm: z.instanceof(Timestamp),
});
type Review = z.infer<typeof Review> & { id: string };
type Resumo = { total: number; convites: number; geral: number | null; categorias: Record<string, number | null> };
type PorProfissional = { id: string; nome: string; total: number; media: number | null }[];

const fmt = (n: number | null) => n === null ? "—" : n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const data = (t: Timestamp) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(t.toDate());

export default function AvaliacoesPage() {
  const tenant = useTenant();
  const [dias, setDias] = useState(30);
  const [staffId, setStaffId] = useState("");
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [equipe, setEquipe] = useState<PorProfissional>([]);
  const [profissionais, setProfissionais] = useState<{ id: string; nome: string }[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [ultimo, setUltimo] = useState<DocumentSnapshot | null>(null);
  const [temMais, setTemMais] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [mais, setMais] = useState(false);
  const [erro, setErro] = useState("");

  const consulta = useCallback((inicio: Date, constraints: QueryConstraint[] = []) => {
    const base: QueryConstraint[] = [where("respondidaEm", ">=", inicio), ...(staffId ? [where("staffId", "==", staffId)] : [])];
    return query(collection(db, "tenants", tenant.id, "avaliacoes"), ...base, ...constraints);
  }, [tenant.id, staffId]);

  const carregar = useCallback(async () => {
    if (!tenant.podeGerir) return;
    setCarregando(true);
    setErro("");
    const inicio = new Date(Date.now() - dias * 24 * 60 * 60_000);
    try {
      const respondidas = consulta(inicio);
      const convites = query(collection(db, "tenants", tenant.id, "avaliacoes"), where("enviadaEm", ">=", inicio), ...(staffId ? [where("staffId", "==", staffId)] : []));
      const staff = await getDocs(collection(db, "tenants", tenant.id, "staff"));
      setProfissionais(staff.docs.map((p) => ({ id: p.id, nome: String(p.get("name") ?? "") })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
      const porStaff: PorProfissional = [];
      const [notas, enviados, lista] = await Promise.all([
        getAggregateFromServer(respondidas, {
          total: count(), geral: average("notaGeral"), servico: average("notas.servico"), profissional: average("notas.profissional"),
          atendimento: average("notas.atendimento"), ambiente: average("notas.ambiente"), localizacao: average("notas.localizacao"),
        }),
        getAggregateFromServer(convites, { total: count() }),
        getDocs(query(respondidas, orderBy("respondidaEm", "desc"), limit(POR_PAGINA))),
        emParalelo(staff.docs.filter((p) => !staffId || p.id === staffId), 4, async (p) => {
          const r = await getAggregateFromServer(
            query(collection(db, "tenants", tenant.id, "avaliacoes"), where("staffId", "==", p.id), where("respondidaEm", ">=", inicio)),
            { total: count(), media: average("notaGeral") },
          );
          porStaff.push({ id: p.id, nome: String(p.get("name") ?? ""), total: r.data().total, media: r.data().media });
        }),
      ]);
      const a = notas.data();
      setResumo({ total: a.total, convites: enviados.data().total, geral: a.geral, categorias: { servico: a.servico, profissional: a.profissional, atendimento: a.atendimento, ambiente: a.ambiente, localizacao: a.localizacao } });
      setEquipe(porStaff.filter((p) => p.total > 0).sort((x, y) => y.total - x.total || x.nome.localeCompare(y.nome, "pt-BR")));
      setReviews(lista.docs.flatMap((d) => {
        const r = Review.safeParse(d.data());
        return r.success ? [{ ...r.data, id: d.id }] : [];
      }));
      setUltimo(lista.docs.at(-1) ?? null);
      setTemMais(lista.size === POR_PAGINA);
    } catch (e) {
      console.error("[avaliacoes] falha ao carregar painel", e);
      setErro("Não foi possível carregar as avaliações. Confira sua conexão e tente de novo.");
    } finally {
      setCarregando(false);
    }
  }, [tenant.id, tenant.podeGerir, dias, consulta, staffId]);

  useEffect(() => {
    const t = setTimeout(() => void carregar(), 0);
    return () => clearTimeout(t);
  }, [carregar]);

  async function carregarMais() {
    if (!ultimo || mais) return;
    setMais(true);
    try {
      const inicio = new Date(Date.now() - dias * 24 * 60 * 60_000);
      const lista = await getDocs(query(consulta(inicio), orderBy("respondidaEm", "desc"), startAfter(ultimo), limit(POR_PAGINA)));
      const novas = lista.docs.flatMap((d) => {
        const r = Review.safeParse(d.data());
        return r.success ? [{ ...r.data, id: d.id }] : [];
      });
      setReviews((atuais) => [...atuais, ...novas]);
      setUltimo(lista.docs.at(-1) ?? null);
      setTemMais(lista.size === POR_PAGINA);
    } catch {
      setErro("Não foi possível carregar mais avaliações. Tente de novo.");
    } finally {
      setMais(false);
    }
  }

  if (!tenant.podeGerir) return <p role="alert" className="rounded-xl border bg-card p-5 text-sm">Somente o dono ou um administrador do negócio pode ver as avaliações.</p>;

  return (
    <div className="grid gap-4">
      <section className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border bg-card p-5 sm:p-6">
        <div className="grid gap-1">
          <h1 className="font-serifa text-3xl">Avaliações</h1>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">Opiniões de clientes coletadas depois dos atendimentos concluídos. Estas notas são internas e não alteram a avaliação do Google.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <select aria-label="Período das avaliações" value={dias} onChange={(e) => setDias(Number(e.target.value))} className="h-11 rounded-lg border border-input bg-card px-3">
            <option value={30}>Últimos 30 dias</option><option value={90}>Últimos 90 dias</option>
          </select>
          <select aria-label="Filtrar por profissional" value={staffId} onChange={(e) => setStaffId(e.target.value)} className="h-11 max-w-[190px] rounded-lg border border-input bg-card px-3">
            <option value="">Todos os profissionais</option>
            {profissionais.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </div>
      </section>

      {!tenant.avaliacoes?.enabled && <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">Os pedidos automáticos estão desligados. <Link className="font-semibold underline underline-offset-2" href={`/${tenant.id}/negocio#whatsapp`}>Configurar no Meu negócio</Link>.</p>}
      {erro && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm"><span>{erro}</span><Button variant="outline" onClick={() => void carregar()}>Tentar de novo</Button></div>}

      <section aria-label="Resumo das avaliações" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cartao titulo="Respostas" valor={carregando ? "…" : String(resumo?.total ?? 0)} />
        <Cartao titulo="Média geral" valor={carregando ? "…" : fmt(resumo?.geral ?? null)} estrela />
        <Cartao titulo="Convites enviados" valor={carregando ? "…" : String(resumo?.convites ?? 0)} />
        <Cartao titulo="Taxa de resposta" valor={carregando ? "…" : resumo?.convites ? `${Math.round(resumo.total / resumo.convites * 100)}%` : "—"} />
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="font-semibold">Média por categoria</h2>
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[ ["servico", "Serviço"], ["profissional", "Profissional"], ["atendimento", "Atendimento"], ["ambiente", "Ambiente"], ["localizacao", "Localização"] ].map(([id, nome]) => (
            <div key={id} className="rounded-xl bg-muted/60 p-3"><dt className="text-xs text-muted-foreground">{nome}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{carregando ? "…" : fmt(resumo?.categorias[id] ?? null)}</dd></div>
          ))}
        </dl>
      </section>

      {equipe.length > 0 && <section className="rounded-2xl border bg-card p-5">
        <h2 className="font-semibold">Por profissional</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {equipe.map((p) => <li key={p.id} className="flex items-center justify-between gap-3 rounded-xl border p-3"><span className="min-w-0"><span className="block truncate font-medium">{p.nome}</span><span className="text-xs text-muted-foreground">{p.total} {p.total === 1 ? "resposta" : "respostas"}</span></span><strong className="inline-flex items-center gap-1 tabular-nums"><Star className="size-4 text-amber-700 dark:text-amber-300" fill="currentColor" aria-hidden="true" />{fmt(p.media)}</strong></li>)}
        </ul>
      </section>}

      <section className="overflow-hidden rounded-2xl border bg-card">
        <div className="p-5"><h2 className="font-semibold">Comentários e notas</h2></div>
        {carregando ? <p role="status" className="border-t p-6 text-sm text-muted-foreground">Carregando avaliações…</p> : reviews.length === 0 ? (
          <div className="grid justify-items-center gap-2 border-t px-5 py-10 text-center"><Star className="size-7 text-muted-foreground" aria-hidden="true" /><p className="text-sm text-muted-foreground">Nenhuma resposta neste período. Conclua atendimentos e aguarde os clientes responderem.</p></div>
        ) : (
          <ul className="grid border-t">
            {reviews.map((r) => <li key={r.id} className="grid gap-3 border-b p-5 last:border-b-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><p className="font-medium">{r.customerKey ? <Link href={`/${tenant.id}/clientes/${r.customerKey}`} className="underline-offset-4 hover:underline">{r.customerName}</Link> : r.customerName}</p><p className="text-sm text-muted-foreground">{r.serviceName} · {r.staffName}</p></div>
                <div className="text-right"><strong className="inline-flex items-center gap-1 tabular-nums"><Star className="size-4 text-amber-700 dark:text-amber-300" fill="currentColor" aria-hidden="true" />{fmt(r.notaGeral)}</strong><time className="block text-xs text-muted-foreground" dateTime={r.respondidaEm.toDate().toISOString()}>{data(r.respondidaEm)}</time></div>
              </div>
              <dl className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><div><dt className="inline">Serviço: </dt><dd className="inline font-medium text-foreground">{r.notas.servico}/5</dd></div><div><dt className="inline">Profissional: </dt><dd className="inline font-medium text-foreground">{r.notas.profissional}/5</dd></div><div><dt className="inline">Atendimento: </dt><dd className="inline font-medium text-foreground">{r.notas.atendimento}/5</dd></div><div><dt className="inline">Ambiente: </dt><dd className="inline font-medium text-foreground">{r.notas.ambiente ?? "N/A"}</dd></div><div><dt className="inline">Localização: </dt><dd className="inline font-medium text-foreground">{r.notas.localizacao ?? "N/A"}</dd></div></dl>
              {r.comentario && <p className="whitespace-pre-line rounded-xl bg-muted/60 p-3 text-sm leading-relaxed [overflow-wrap:anywhere]">{r.comentario}</p>}
            </li>)}
          </ul>
        )}
        {temMais && <div className="border-t p-4"><Button variant="outline" className="w-full" disabled={mais} onClick={() => void carregarMais()}>{mais ? "Carregando…" : "Carregar mais"}</Button></div>}
      </section>
    </div>
  );
}

function Cartao({ titulo, valor, estrela = false }: { titulo: string; valor: string; estrela?: boolean }) {
  return <div className="rounded-2xl border bg-card p-4"><p className="text-xs text-muted-foreground">{titulo}</p><p className="mt-2 inline-flex items-center gap-1.5 text-2xl font-semibold tabular-nums">{estrela && valor !== "—" && valor !== "…" && <Star className="size-5 text-amber-700 dark:text-amber-300" fill="currentColor" aria-hidden="true" />}{valor}</p></div>;
}
