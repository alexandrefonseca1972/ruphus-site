import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { brCode, competenciaAtual, txidDe, vencimentoDe } from "@/lib/pix";

/** Erro que a tela mostra como está: valor inválido, cobrança já cancelada. */
export class CobrancaErro extends ErroPrevisto {}

// A cobrança mora fora do tenant, como o CRM: dinheiro do negócio não é assunto
// de quem usa a agenda, e aqui só o Admin SDK entra — nenhuma regra alcança.
const RAIZ = "cobrancas";
const PIX = "config/pix";

export type Tipo = "entrada" | "mensal";
export type Status = "aberta" | "paga" | "cancelada";

export type Cobranca = {
  id: string;
  slug: string;
  tipo: Tipo;
  competencia: string | null;
  valorCents: number;
  vencimento: string;
  status: Status;
  token: string;
  pagoEm: string | null;
  recebidoCents: number | null;
};

/** A cobrança como a página pública pode vê-la: sem CRM, sem slug, sem quem deu baixa. */
export type CobrancaPublica = {
  nome: string;
  tipo: Tipo;
  competencia: string | null;
  valorCents: number;
  vencimento: string;
  status: Status;
  txid: string;
  brCode: string | null;
};

export const PixInput = z.object({
  chave: z.string().trim().min(3, "Informe a chave Pix").max(77),
  nome: z.string().trim().min(2, "Informe o nome do recebedor").max(60),
  cidade: z.string().trim().min(2, "Informe a cidade").max(40),
  // o WhatsApp da Ruphus, para onde o comprovante vai
  whatsapp: z.string().trim().regex(/^[\d\s()+-]{10,20}$/, "Informe o WhatsApp da Ruphus"),
});
export type PixInput = z.infer<typeof PixInput>;

export async function lerPix(db: Firestore) {
  const snap = await db.doc(PIX).get();
  const dados = PixInput.safeParse(snap.data());
  if (!dados.success) throw new Error("Chave Pix da Ruphus não cadastrada");
  return dados.data;
}

/** null quando ainda não foi cadastrada, para a tela pedir em vez de explodir. */
export async function pixCadastrado(db: Firestore) {
  return await lerPix(db).catch(() => null);
}

export async function salvarPix(db: Firestore, entrada: unknown) {
  const dados = PixInput.parse(entrada);
  await db.doc(PIX).set({ ...dados, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
}

export const idDe = (slug: string, tipo: Tipo, competencia: string | null) =>
  tipo === "entrada" ? `${slug}-entrada` : `${slug}-${competencia}`;

function cobranca(id: string, d: { get: (campo: string) => unknown }): Cobranca {
  // Campo por campo: espalhar o documento traria criadaEm, que é um Timestamp —
  // uma classe, e o React recusa classes na travessia servidor→cliente.
  return {
    id,
    slug: String(d.get("slug") ?? ""),
    tipo: d.get("tipo") === "entrada" ? "entrada" : "mensal",
    competencia: (d.get("competencia") as string | null) ?? null,
    valorCents: (d.get("valorCents") as number | null) ?? 0,
    vencimento: String(d.get("vencimento") ?? ""),
    status: (["aberta", "paga", "cancelada"] as const).find((s) => s === d.get("status")) ?? "aberta",
    token: String(d.get("token") ?? ""),
    pagoEm: (d.get("pagoEm") as string | null) ?? null,
    recebidoCents: (d.get("recebidoCents") as number | null) ?? null,
  };
}

/** Gera a cobrança, ou devolve a que já existe.
 *
 * O id é previsível (slug + competência) e a criação usa create(), que falha se
 * o documento existe: dois cliques em "cobrar o mês" não viram duas cobranças, e
 * a corrida é resolvida pelo banco. Uma cobrança cancelada libera o mês de novo,
 * com sufixo — é assim que se corrige um valor errado. */
export async function gerarCobranca(
  db: Firestore,
  a: { slug: string; tipo: Tipo; competencia: string | null; valorCents: number; vencimento?: string },
) {
  const base = idDe(a.slug, a.tipo, a.competencia);
  const vencimento = a.vencimento ?? vencimentoDe(a.competencia ?? competenciaAtual());
  for (let n = 1; n <= 9; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    const ref = db.collection(RAIZ).doc(id);
    const atual = await ref.get();
    if (atual.exists) {
      // aberta ou paga: é a cobrança do mês, e o valor dela não se reescreve
      if (atual.get("status") !== "cancelada") return { id, token: String(atual.get("token")), nova: false };
      continue;
    }
    const token = randomBytes(16).toString("hex");
    await ref.create({
      slug: a.slug,
      tipo: a.tipo,
      competencia: a.competencia,
      valorCents: a.valorCents,
      vencimento,
      status: "aberta",
      token,
      txid: txidDe(a.slug, a.tipo, a.competencia),
      pagoEm: null,
      recebidoCents: null,
      baixaPor: null,
      criadaEm: FieldValue.serverTimestamp(),
      atualizadoEm: FieldValue.serverTimestamp(),
    });
    return { id, token, nova: true };
  }
  throw new Error("Cobranças canceladas demais nesta competência");
}

export async function listarCobrancas(db: Firestore, slug: string) {
  const snap = await db.collection(RAIZ).where("slug", "==", slug).get();
  return snap.docs
    .map((d) => cobranca(d.id, d))
    .sort((a, b) => b.vencimento.localeCompare(a.vencimento) || a.tipo.localeCompare(b.tipo));
}

/** A porta da página pública: o token do link é a credencial, e nada mais sai daqui. */
export async function abrirCobranca(db: Firestore, id: string, token: string): Promise<CobrancaPublica | null> {
  const snap = await db.collection(RAIZ).doc(id).get();
  if (!snap.exists) return null;
  const guardado = String(snap.get("token") ?? "");
  const a = Buffer.from(guardado);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const c = cobranca(id, snap);
  const tenant = await db.collection("tenants").doc(c.slug).get();
  const pix = await pixCadastrado(db);
  return {
    nome: String(tenant.get("name") ?? c.slug),
    tipo: c.tipo,
    competencia: c.competencia,
    valorCents: c.valorCents,
    vencimento: c.vencimento,
    status: c.status,
    txid: String(snap.get("txid") ?? ""),
    // Cobrança paga ou cancelada não mostra Pix: ninguém deve pagar de novo
    brCode: c.status === "aberta" && pix ? brCode({ ...pix, valorCents: c.valorCents, txid: String(snap.get("txid") ?? "") }) : null,
  };
}

export async function baixar(db: Firestore, id: string, b: { recebidoCents: number; pagoEm: string; por: string }) {
  if (!Number.isInteger(b.recebidoCents) || b.recebidoCents <= 0) throw new CobrancaErro("Valor recebido inválido.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.pagoEm)) throw new CobrancaErro("Data de pagamento inválida.");
  const ref = db.collection(RAIZ).doc(id);
  const atual = await ref.get();
  if (!atual.exists) throw new CobrancaErro("Cobrança não encontrada.");
  // dar baixa no que foi cancelado esconde o cancelamento e bagunça a conciliação
  if (atual.get("status") === "cancelada") throw new CobrancaErro("Cobrança cancelada não recebe baixa.");
  await ref.update({
    status: "paga",
    recebidoCents: b.recebidoCents,
    pagoEm: b.pagoEm,
    baixaPor: b.por,
    atualizadoEm: FieldValue.serverTimestamp(),
  });
  // quem chamou decide o que a baixa desencadeia: a entrada publica o site
  return { slug: String(atual.get("slug") ?? ""), tipo: (atual.get("tipo") === "entrada" ? "entrada" : "mensal") as Tipo };
}

export async function cancelar(db: Firestore, id: string, por: string) {
  const ref = db.collection(RAIZ).doc(id);
  if (!(await ref.get()).exists) throw new Error("Cobrança não encontrada");
  await ref.update({ status: "cancelada", baixaPor: por, atualizadoEm: FieldValue.serverTimestamp() });
}

/** Abertas com vencimento no passado. O corte do site continua sendo clique humano. */
export async function atrasadas(db: Firestore, hoje: string) {
  // Filtra o status no banco e a data em memória: são dezenas de documentos, e
  // dois campos diferentes exigiriam índice composto novo.
  const snap = await db.collection(RAIZ).where("status", "==", "aberta").get();
  return snap.docs
    .map((d) => cobranca(d.id, d))
    .filter((c) => c.vencimento < hoje)
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
}
