import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { ErroPrevisto } from "@/lib/erro-previsto";

// O CRM mora fora do tenant: nenhuma regra expõe a coleção "crm", então valor,
// anotações e estágio ficam só com quem administra a plataforma — o dono do
// negócio, que é membro do tenant, nunca lê isso.
const RAIZ = "crm";

export { ESTAGIOS, ROTULO } from "@/lib/crm-tipos";
import { ESTAGIOS as LISTA, MOTIVOS_PERDA, ORIGENS, ROTULO, type Crm, type Evento, type MotivoPerda, type Nota, type Origem, type Utm } from "@/lib/crm-tipos";
export type { Crm, Evento, Nota };

/** Erro previsto: a mensagem chega à tela como está (o resto vira "não foi possível") */
export class CrmErro extends ErroPrevisto {}

const texto = (max: number) => z.string().trim().max(max).nullable().optional();

export const CrmInput = z.object({
  estagio: z.enum(LISTA).optional(),
  entradaCents: z.number().int().min(0).max(100_000_00).nullable().optional(),
  mensalCents: z.number().int().min(0).max(100_000_00).nullable().optional(),
  caixaCents: z.number().int().min(0).max(100_000_00).nullable().optional(),
  proximaAcao: z.string().trim().max(120).nullable().optional(),
  proximaData: z.iso.date().nullable().optional(),
  publicado: z.boolean().optional(),
  donoNome: texto(80),
  donoPapel: texto(40),
  donoWhatsapp: z.string().trim().regex(/^[\d\s()+-]{0,20}$/, "WhatsApp inválido").nullable().optional(),
  donoEmail: z.union([z.email("E-mail inválido"), z.literal("")]).nullable().optional(),
  outrosContatos: z.array(z.object({ nome: z.string().trim().max(60), whatsapp: z.string().regex(/^\d{10,11}$/, "WhatsApp com DDD: 10 ou 11 dígitos") })).max(10).optional(),
  motivoPerda: z.enum(Object.keys(MOTIVOS_PERDA) as [MotivoPerda, ...MotivoPerda[]]).nullable().optional(),
  detalhePerda: texto(300),
  origem: z.enum(Object.keys(ORIGENS) as [Origem, ...Origem[]]).nullable().optional(),
  indicadoPor: texto(80),
  fixadoAte: z.iso.date().nullable().optional(),
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
    caixaCents: (d.get("caixaCents") as number | null) ?? null,
    fechadoEm: (d.get("fechadoEm") as { toDate?: () => Date } | null)?.toDate?.().toISOString() ?? null,
    proximaAcao: (d.get("proximaAcao") as string | null) ?? null,
    proximaData: (d.get("proximaData") as string | null) ?? null,
    publicado: d.get("publicado") !== false,
    notas: (d.get("notas") as number | null) ?? 0,
    donoNome: (d.get("donoNome") as string | null) ?? null,
    donoPapel: (d.get("donoPapel") as string | null) ?? null,
    donoWhatsapp: (d.get("donoWhatsapp") as string | null) ?? null,
    donoEmail: (d.get("donoEmail") as string | null) ?? null,
    outrosContatos: (d.get("outrosContatos") as Crm["outrosContatos"] | undefined) ?? [],
    motivoPerda: (d.get("motivoPerda") as MotivoPerda | null) ?? null,
    detalhePerda: (d.get("detalhePerda") as string | null) ?? null,
    origem: (d.get("origem") as Origem | null) ?? null,
    indicadoPor: (d.get("indicadoPor") as string | null) ?? null,
    entrouEm: (d.get("entrouEm") as { toDate?: () => Date } | null)?.toDate?.().toISOString() ?? null,
    perdidoEm: (d.get("perdidoEm") as { toDate?: () => Date } | null)?.toDate?.().toISOString() ?? null,
    ultimoContatoEm: (d.get("ultimoContatoEm") as { toDate?: () => Date } | null)?.toDate?.().toISOString() ?? null,
    fixadoAte: (d.get("fixadoAte") as string | null) ?? null,
    utm: (d.get("utm") as Utm | null) ?? null,
  };
}

/** Importado que ninguém tocou: só a origem (e as notas do levantamento, cuja contagem a tela
 *  não mostra). É igual ao vazio que a tela usa para quem não tem CRM, que já conta como
 *  "novo" e "importado" — 12 mil dos 14 mil documentos, que não precisam ir ao navegador. */
export const trivial = (d: FirebaseFirestore.DocumentSnapshot) =>
  Object.keys(d.data() ?? {}).every((k) => k === "origem" || k === "notas") && (d.get("origem") ?? "importado") === "importado";

export async function lerCrm(db: Firestore, slugs?: string[]): Promise<Record<string, Crm>> {
  const docs = slugs
    ? slugs.length ? await db.getAll(...slugs.map((s) => db.collection(RAIZ).doc(s))) : []
    : (await db.collection(RAIZ).get()).docs;
  return Object.fromEntries(docs.filter((d) => d.exists && !trivial(d)).map((d) => [d.id, negocio(d)]));
}

/** Só os fechados (clientes): a carteira e a cobrança do mês, sem ler os 15 mil do CRM. */
export async function lerFechados(db: Firestore): Promise<Record<string, Crm>> {
  const q = await db.collection(RAIZ).where("estagio", "==", "fechado").get();
  return Object.fromEntries(q.docs.map((d) => [d.id, negocio(d)]));
}

/** A proposta que o próprio negócio pode tirar do ar pelo link: feita pela Ruphus (não pelo dono, no
 *  cadastro), ainda não publicada, com a Ruphus como dona, sem convite aceito e antes da negociação.
 *  Quem aceitou o convite ou está negociando é cliente em andamento: a página dele não sai por um
 *  link que qualquer um com o endereço abre. */
function removivel(tenant: FirebaseFirestore.DocumentSnapshot, crm: FirebaseFirestore.DocumentSnapshot, convidados: number, plataforma: string[]) {
  if (!tenant.exists || !tenant.get("gerado") || tenant.get("gerado.origem") === "cadastro" || tenant.get("gerado.publicadoEm")) return false;
  if (convidados > 0 || (tenant.get("ownerId") && !plataforma.includes(tenant.get("ownerId")))) return false;
  return !["negociando", "fechado"].includes(crm.get("estagio"));
}

const contasDaPlataforma = async (db: Firestore) => ((await db.doc("config/admin").get()).get("uids") as string[] | undefined) ?? [];

export async function propostaRemovivel(db: Firestore, slug: string) {
  const [tenant, crm, convidados, plataforma] = await Promise.all([
    db.doc(`tenants/${slug}`).get(),
    db.collection(RAIZ).doc(slug).get(),
    db.collection(`tenants/${slug}/members`).where("viaConvite", "==", true).limit(1).get(),
    contasDaPlataforma(db),
  ]);
  if (!removivel(tenant, crm, convidados.size, plataforma)) return null;
  return { nome: String(tenant.get("name") ?? slug), removida: crm.get("publicado") === false };
}

/** "Pedir remoção" da faixa de proposta: a página sai do ar (a lista de desativados que o proxy lê)
 *  e o CRM registra o pedido. Numa transação: o admin fechar a venda no meio não vira "perdido".
 *  Já perdido, o motivo de antes fica; o estágio anterior é guardado para desfazer. */
export async function pedirRemocao(db: Firestore, slug: string) {
  const plataforma = await contasDaPlataforma(db);
  const ref = db.collection(RAIZ).doc(slug);
  return db.runTransaction(async (tx) => {
    const [tenant, crm, convidados] = await Promise.all([
      tx.get(db.doc(`tenants/${slug}`)),
      tx.get(ref),
      tx.get(db.collection(`tenants/${slug}/members`).where("viaConvite", "==", true).limit(1)),
    ]);
    if (!removivel(tenant, crm, convidados.size, plataforma)) return false;
    if (crm.get("publicado") === false) return true;
    const antes = ((crm.get("estagio") as Crm["estagio"] | undefined) ?? "novo") as Crm["estagio"];
    const agora = FieldValue.serverTimestamp();
    tx.set(
      ref,
      {
        publicado: false,
        remocaoPedidaEm: agora,
        estagioAntesDaRemocao: antes,
        ...(antes === "perdido" ? {} : { estagio: "perdido", motivoPerda: "remocao", perdidoEm: agora }),
        atualizadoEm: agora,
      },
      { merge: true },
    );
    tx.set(ref.collection("eventos").doc(), {
      tipo: "estagio",
      titulo: antes === "perdido" ? "Página tirada do ar" : `${ROTULO[antes]} → ${ROTULO.perdido}`,
      detalhe: MOTIVOS_PERDA.remocao,
      autor: "o próprio negócio, pelo link da página",
      quando: agora,
    });
    return true;
  });
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
  const m = z.string().trim().min(1).max(80).parse(modelo.slice(0, 80));
  await evento(db, slug, { tipo: "mensagem", titulo: `Mensagem enviada: ${m}`, detalhe: para ? `para ${String(para).slice(0, 80)}` : null, autor });
  // No doc do negócio também: a lista do /admin não carrega os eventos de 600 negócios
  await db.doc(`${RAIZ}/${slug}`).set({ ultimoContatoEm: FieldValue.serverTimestamp() }, { merge: true });
}

const iso = (v: unknown) => (v as { toDate?: () => Date } | null)?.toDate?.().toISOString() ?? null;

/** Tudo o que aconteceu com o negócio, do mais novo ao mais antigo.
 *
 * Notas, estágio e mensagens são gravados aqui no CRM. Convite aceito, primeiro
 * agendamento e cobranças são lidos de onde já moram — por isso a linha do tempo
 * nasce com o histórico, sem esperar que alguém volte a fazer as coisas. */
export async function linhaDoTempo(db: Firestore, slug: string): Promise<Evento[]> {
  const t = db.collection("tenants").doc(slug);
  const [notas, eventos, membros, primeiro, cobrancas, admins] = await Promise.all([
    db.collection(`${RAIZ}/${slug}/notas`).orderBy("quando", "desc").limit(100).get(),
    db.collection(`${RAIZ}/${slug}/eventos`).orderBy("quando", "desc").limit(100).get(),
    t.collection("members").where("role", "in", ["admin", "owner"]).get(),
    t.collection("appointments").orderBy("createdAt").limit(1).get(),
    db.collection("cobrancas").where("slug", "==", slug).get(),
    db.doc("config/admin").get(),
  ]);
  // o admin da plataforma é dono dos sites importados: a entrada dele não é do cliente
  const daPlataforma = new Set((admins.get("uids") as string[] | undefined) ?? []);
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
      if (daPlataforma.has(d.id)) return [];
      const quem = (d.get("nome") as string | undefined) ?? (d.get("email") as string | undefined) ?? "o dono";
      // dono pelo convite (site da fábrica que o cliente assumiu) não criou o negócio
      const criou = d.get("role") === "owner" && d.get("viaConvite") !== true;
      return quando ? [{ id: `convite-${d.id}`, tipo: "convite" as const, titulo: criou ? "Negócio criado" : "Convite aceito", detalhe: criou ? `${quem} criou o negócio pelo painel` : `${quem} entrou no painel`, autor: (d.get("email") as string | undefined) ?? "", quando }] : [];
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
