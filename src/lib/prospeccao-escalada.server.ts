import "server-only";
import { FieldValue, Timestamp, type DocumentData, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { mascararDigitos } from "@/lib/sanitizar";
import { paraTelefoneNorm } from "@/lib/tipos-marca";

// Escaladas da prospecção (M-4 da terceira rodada): o agente grava escaladoEm e motivoEscalada em
// prospeccaoConversas/{telefone} e fica calado nessa conversa. Esta é a lista do admin e o "tratada",
// que apaga a escalada (o agente volta a atender) e deixa um evento no log da conversa.

const CONVERSAS = "prospeccaoConversas";
const LIMITE = 50;
/** LGPD: o mesmo prazo dos eventos do agente (TTL no campo expiraEm). */
const RETENCAO_MS = 365 * 86_400_000;

export const Escalado = z.object({
  /** a chave para "Marcar como tratada"; a tela mostra só telefoneMascarado */
  telefone: z.string(),
  telefoneMascarado: z.string(),
  /** só o slug confirmado pelo telefone (o alegado na mensagem não entra) */
  slug: z.string().nullable(),
  motivo: z.string(),
  em: z.number(),
  falas: z.array(z.object({ de: z.enum(["lead", "ruphus"]), texto: z.string() })).max(3),
});
export type Escalado = z.infer<typeof Escalado>;

const ms = (v: unknown) => (typeof v === "number" ? v : v instanceof Timestamp ? v.toMillis() : null);

/** Uma conversa escalada para a tela, ou null se o id não é telefone ou a escalada não tem data. */
export function paraEscalado(id: string, d: DocumentData): Escalado | null {
  const em = ms(d.escaladoEm);
  if (!paraTelefoneNorm(id) || em === null) return null;
  const falas = z.array(z.object({ de: z.enum(["lead", "ruphus"]), texto: z.string() })).catch([]).parse(d.historico);
  return Escalado.parse({
    telefone: id,
    telefoneMascarado: mascararDigitos(id),
    slug: typeof d.slug === "string" && d.slug ? d.slug : null,
    motivo: typeof d.motivoEscalada === "string" && d.motivoEscalada ? d.motivoEscalada.slice(0, 300) : "sem motivo registrado",
    em,
    falas: falas.slice(-3).map((f) => ({ de: f.de, texto: f.texto.slice(0, 500) })),
  });
}

/** As escaladas abertas, a mais recente primeiro. */
export async function listarEscalados(db: Firestore): Promise<Escalado[]> {
  const snap = await db.collection(CONVERSAS).where("escaladoEm", "!=", null).orderBy("escaladoEm", "desc").limit(LIMITE).get();
  return snap.docs.map((doc) => paraEscalado(doc.id, doc.data())).filter((e): e is Escalado => e !== null);
}

/** Apaga a escalada (o agente volta a responder a conversa) e registra quem tratou no log da conversa. */
export async function limparEscalada(db: Firestore, telefone: string, autor: string, agora = Date.now()) {
  const tel = paraTelefoneNorm(telefone);
  if (!tel) throw new ErroPrevisto("Telefone inválido.");
  const ref = db.doc(`${CONVERSAS}/${tel}`);
  await db.runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data();
    if (!d || d.escaladoEm == null) throw new ErroPrevisto("Essa conversa não está escalada.");
    tx.update(ref, { escaladoEm: FieldValue.delete(), motivoEscalada: FieldValue.delete() });
    tx.set(ref.collection("eventos").doc(), {
      tipo: "escalada_tratada",
      motivo: typeof d.motivoEscalada === "string" ? d.motivoEscalada.slice(0, 300) : null,
      escaladoEm: d.escaladoEm,
      por: autor,
      em: agora,
      expiraEm: Timestamp.fromMillis(agora + RETENCAO_MS),
    });
  });
}
