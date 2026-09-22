import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { ErroPrevisto } from "@/lib/erro-previsto";

// O CRM mora fora do tenant: nenhuma regra expõe a coleção "crm", então valor,
// anotações e estágio ficam só com quem administra a plataforma — o dono do
// negócio, que é membro do tenant, nunca lê isso.
const RAIZ = "crm";

export { ESTAGIOS, ROTULO } from "@/lib/crm-tipos";
import { ESTAGIOS as LISTA, MOTIVOS_PERDA, ORIGENS, ROTULO, type Crm, type Evento, type MotivoPerda, type Nota, type Origem } from "@/lib/crm-tipos";
export type { Crm, Evento, Nota };

/** Erro previsto: a mensagem chega à tela como está (o resto vira "não foi possível") */
export class CrmErro extends ErroPrevisto {}

const texto = (max: number) => z.string().trim().max(max).nullable().optional();

export const CrmInput = z.object({
  estagio: z.enum(LISTA).optional(),
  entradaCents: z.number().int().min(0).max(100_000_00).nullable().optional(),
  mensalCents: z.number().int().min(0).max(100_000_00).nullable().optional(),
  proximaAcao: z.string().trim().max(120).nullable().optional(),
  proximaData: z.iso.date().nullable().optional(),
  publicado: z.boolean().optional(),
  donoNome: texto(80),
  donoPapel: texto(40),
  donoWhatsapp: z.string().trim().regex(/^[\d\s()+-]{0,20}$/, "WhatsApp inválido").nullable().optional(),
  donoEmail: z.union([z.email("E-mail inválido"), z.literal("")]).nullable().optional(),
  motivoPerda: z.enum(Object.keys(MOTIVOS_PERDA) as [MotivoPerda, ...MotivoPerda[]]).nullable().optional(),
  detalhePerda: texto(300),
  origem: z.enum(Object.keys(ORIGENS) as [Origem, ...Origem[]]).nullable().optional(),
  indicadoPor: texto(80),
});
export type CrmInput = z.infer<typeof CrmInput>;

/** Um negócio como a tela precisa dele: só valores simples.
 *
 * Campo por campo de propósito. Espalhar o documento inteiro traz junto o
 * `atualizadoEm`, que é um Timestamp do Firestore — uma classe. O React
 * recusa classes na travessia servidor→cliente e derruba o painel inteiro,
 * e como o erro só aparece quando existe algum negócio salvo, ele passa
 * despercebido enquanto a coleção está vazia. */
export function negocio(d: { get: (campo: string) => unknown }): Crm {
  const estagio = d.get("estagio");
  return {
    estagio: (LISTA as readonly string[]).includes(String(estagio)) ? (estagio as Crm["estagio"]) : "novo",
    entradaCents: (d.get("entradaCents") as number | null) ?? null,
    mensalCents: (d.get("mensalCents") as number | null) ?? null,
    fechadoEm: (d.get("fechadoEm") as { toDate?: () => Date } | null)?.toDate?.().toISOString() ?? null,
    proximaAcao: (d.get("proximaAcao") as string | null) ?? null,
    proximaData: (d.get("proximaData") as string | null) ?? null,
    publicado: d.get("publicado") !== false,
    notas: (d.get("notas") as number | null) ?? 0,
    donoNome: (d.get("donoNome") as string | null) ?? null,
    donoPapel: (d.get("donoPapel") as string | null) ?? null,
    donoWhatsapp: (d.get("donoWhatsapp") as string | null) ?? null,
    donoEmail: (d.get("donoEmail") as string | null) ?? null,
    motivoPerda: (d.get("motivoPerda") as MotivoPerda | null) ?? null,
    detalhePerda: (d.get("detalhePerda") as string | null) ?? null,
    origem: (d.get("origem") as Origem | null) ?? null,
    indicadoPor: (d.get("indicadoPor") as string | null) ?? null,
    entrouEm: (d.get("entrouEm") as { toDate?: () => Date } | null)?.toDate?.().toISOString() ?? null,
    perdidoEm: (d.get("perdidoEm") as { toDate?: () => Date } | null)?.toDate?.().toISOString() ?? null,
  };
}

export async function lerCrm(db: Firestore): Promise<Record<string, Crm>> {
  const snap = await db.collection(RAIZ).get();
  return Object.fromEntries(snap.docs.map((d) => [d.id, negocio(d)]));
}

export async function salvarCrm(db: Firestore, slug: string, entrada: CrmInput, autor = "sistema") {
  const parsed = CrmInput.safeParse(entrada);
  if (!parsed.success) throw new CrmErro(parsed.error.issues[0].message);
  const dados = parsed.data;
  const ref = db.collection(RAIZ).doc(slug);
  const atual = await ref.get();
  const antes = (atual.get("estagio") as Crm["estagio"] | undefined) ?? "novo";
  const mudou = dados.estagio && dados.estagio !== antes;
  // Sem o porquê, a perda não ensina nada: o motivo vem junto ou a mudança não passa
  if (mudou && dados.estagio === "perdido" && !dados.motivoPerda) throw new CrmErro("Escolha o motivo da perda.");
  // Voltando ao funil, o motivo antigo deixa de valer
  const saiuDePerdido = mudou && antes === "perdido";
  const virouFechado = dados.estagio === "fechado" && atual.get("estagio") !== "fechado";
  if (mudou) {
    await evento(db, slug, {
      tipo: "estagio",
      titulo: `${ROTULO[antes]} → ${ROTULO[dados.estagio!]}`,
      detalhe:
        dados.estagio === "perdido"
          ? [MOTIVOS_PERDA[dados.motivoPerda!], dados.detalhePerda].filter(Boolean).join(" · ")
          : null,
      autor,
    });
  }
  await ref.set(
    {
      ...dados,
      // a data de fechamento é gravada quando o negócio entra em "fechado" e some se sair
      ...(virouFechado ? { fechadoEm: FieldValue.serverTimestamp() } : {}),
      ...(dados.estagio && dados.estagio !== "fechado" ? { fechadoEm: FieldValue.delete() } : {}),
      ...(saiuDePerdido ? { motivoPerda: FieldValue.delete(), detalhePerda: FieldValue.delete(), perdidoEm: FieldValue.delete() } : {}),
      ...(mudou && dados.estagio === "perdido" ? { perdidoEm: FieldValue.serverTimestamp() } : {}),
      // o primeiro passo para fora de "novo" marca o começo da negociação, uma vez só
      ...(mudou && antes === "novo" && !atual.get("entrouEm") ? { entrouEm: FieldValue.serverTimestamp() } : {}),
      atualizadoEm: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function listarNotas(db: Firestore, slug: string): Promise<Nota[]> {
  const snap = await db.collection(`${RAIZ}/${slug}/notas`).orderBy("quando", "desc").limit(50).get();
  return snap.docs.map((d) => ({
    id: d.id,
    texto: String(d.get("texto") ?? ""),
    quando: d.get("quando")?.toDate?.().toISOString() ?? "",
    autor: String(d.get("autor") ?? ""),
  }));
}

export async function anotar(db: Firestore, slug: string, texto: string, autor: string) {
  const limpo = z.string().trim().min(1).max(600).parse(texto);
  const doc = await db.collection(`${RAIZ}/${slug}/notas`).add({
    texto: limpo,
    autor,
    quando: FieldValue.serverTimestamp(),
  });
  await db.collection(RAIZ).doc(slug).set({ notas: FieldValue.increment(1), atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
  return doc.id;
}

async function evento(db: Firestore, slug: string, e: { tipo: "estagio" | "mensagem"; titulo: string; detalhe: string | null; autor: string }) {
  await db.collection(`${RAIZ}/${slug}/eventos`).add({ ...e, quando: FieldValue.serverTimestamp() });
}

/** Mensagem pronta aberta no WhatsApp: fica na linha do tempo como contato feito. */
export async function registrarMensagem(db: Firestore, slug: string, modelo: string, para: string, autor: string) {
  const m = z.string().trim().min(1).max(40).parse(modelo);
  await evento(db, slug, { tipo: "mensagem", titulo: `Mensagem enviada: ${m}`, detalhe: para ? `para ${z.string().max(40).parse(para)}` : null, autor });
}

const iso = (v: unknown) => (v as { toDate?: () => Date } | null)?.toDate?.().toISOString() ?? null;

/** Tudo o que aconteceu com o negócio, do mais novo ao mais antigo.
 *
 * Notas, estágio e mensagens são gravados aqui no CRM. Convite aceito, primeiro
 * agendamento e cobranças são lidos de onde já moram — por isso a linha do tempo
 * nasce com o histórico, sem esperar que alguém volte a fazer as coisas. */
export async function linhaDoTempo(db: Firestore, slug: string): Promise<Evento[]> {
  const t = db.collection("tenants").doc(slug);
  const [notas, eventos, membros, primeiro, cobrancas] = await Promise.all([
    db.collection(`${RAIZ}/${slug}/notas`).orderBy("quando", "desc").limit(100).get(),
    db.collection(`${RAIZ}/${slug}/eventos`).orderBy("quando", "desc").limit(100).get(),
    t.collection("members").where("role", "==", "admin").get(),
    t.collection("appointments").orderBy("createdAt").limit(1).get(),
    db.collection("cobrancas").where("slug", "==", slug).get(),
  ]);
  const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const lista: Evento[] = [
    ...notas.docs.map((d) => ({ id: d.id, tipo: "nota" as const, titulo: "Nota", detalhe: String(d.get("texto") ?? ""), autor: String(d.get("autor") ?? ""), quando: iso(d.get("quando")) ?? "" })),
    ...eventos.docs.map((d) => ({
      id: d.id,
      tipo: d.get("tipo") as Evento["tipo"],
      titulo: String(d.get("titulo") ?? ""),
      detalhe: (d.get("detalhe") as string | null) ?? null,
      autor: String(d.get("autor") ?? ""),
      quando: iso(d.get("quando")) ?? "",
    })),
    ...membros.docs.flatMap((d) => {
      const quando = iso(d.get("createdAt"));
      const quem = (d.get("nome") as string | undefined) ?? (d.get("email") as string | undefined) ?? "o dono";
      return quando ? [{ id: `convite-${d.id}`, tipo: "convite" as const, titulo: "Convite aceito", detalhe: `${quem} entrou no painel`, autor: (d.get("email") as string | undefined) ?? "", quando }] : [];
    }),
    ...primeiro.docs.flatMap((d) => {
      const quando = iso(d.get("createdAt"));
      const inicio = (d.get("start") as { toDate?: () => Date } | null)?.toDate?.();
      const dia = inicio?.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      return quando ? [{ id: `agenda-${d.id}`, tipo: "agendamento" as const, titulo: "Primeiro agendamento", detalhe: [d.get("serviceName"), dia].filter(Boolean).join(" · "), autor: "pelo site", quando }] : [];
    }),
    ...cobrancas.docs.flatMap((d) => {
      const oque = d.get("tipo") === "entrada" ? "Entrada" : `Mensalidade ${String(d.get("competencia") ?? "")}`.trim();
      const valor = brl(Number(d.get("valorCents") ?? 0));
      const out: Evento[] = [];
      const criada = iso(d.get("criadaEm"));
      if (criada) out.push({ id: `cobr-${d.id}`, tipo: "cobranca", titulo: "Cobrança gerada", detalhe: `${oque} · ${valor}`, autor: "", quando: criada });
      const pago = d.get("pagoEm") as string | null;
      if (pago) out.push({ id: `pago-${d.id}`, tipo: "pagamento", titulo: "Pagamento recebido", detalhe: `${oque} · ${brl(Number(d.get("recebidoCents") ?? d.get("valorCents") ?? 0))}`, autor: String(d.get("baixaPor") ?? ""), quando: `${pago}T12:00:00.000Z` });
      return out;
    }),
  ];
  return lista.filter((e) => e.quando).sort((a, b) => b.quando.localeCompare(a.quando)).slice(0, 150);
}

/** Os slugs fora do ar, que o proxy consulta para fechar site, agendamento e minisite. */
export async function desativados(db: Firestore) {
  const snap = await db.collection(RAIZ).where("publicado", "==", false).get();
  return snap.docs.map((d) => d.id);
}
