import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";

// O CRM mora fora do tenant: nenhuma regra expõe a coleção "crm", então valor,
// anotações e estágio ficam só com quem administra a plataforma — o dono do
// negócio, que é membro do tenant, nunca lê isso.
const RAIZ = "crm";

export { ESTAGIOS, ROTULO } from "@/lib/crm-tipos";
import { ESTAGIOS as LISTA, type Crm, type Nota } from "@/lib/crm-tipos";
export type { Crm, Nota };

export const CrmInput = z.object({
  estagio: z.enum(LISTA).optional(),
  valorCents: z.number().int().min(0).max(100_000_00).nullable().optional(),
  proximaAcao: z.string().trim().max(120).nullable().optional(),
  proximaData: z.iso.date().nullable().optional(),
  publicado: z.boolean().optional(),
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
    valorCents: (d.get("valorCents") as number | null) ?? null,
    fechadoEm: (d.get("fechadoEm") as { toDate?: () => Date } | null)?.toDate?.().toISOString() ?? null,
    proximaAcao: (d.get("proximaAcao") as string | null) ?? null,
    proximaData: (d.get("proximaData") as string | null) ?? null,
    publicado: d.get("publicado") !== false,
    notas: (d.get("notas") as number | null) ?? 0,
  };
}

export async function lerCrm(db: Firestore): Promise<Record<string, Crm>> {
  const snap = await db.collection(RAIZ).get();
  return Object.fromEntries(snap.docs.map((d) => [d.id, negocio(d)]));
}

export async function salvarCrm(db: Firestore, slug: string, entrada: CrmInput) {
  const dados = CrmInput.parse(entrada);
  const ref = db.collection(RAIZ).doc(slug);
  const atual = await ref.get();
  const virouFechado = dados.estagio === "fechado" && atual.get("estagio") !== "fechado";
  await ref.set(
    {
      ...dados,
      // a data de fechamento é gravada quando o negócio entra em "fechado" e some se sair
      ...(virouFechado ? { fechadoEm: FieldValue.serverTimestamp() } : {}),
      ...(dados.estagio && dados.estagio !== "fechado" ? { fechadoEm: FieldValue.delete() } : {}),
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

/** Os slugs fora do ar, que o proxy consulta para fechar site, agendamento e minisite. */
export async function desativados(db: Firestore) {
  const snap = await db.collection(RAIZ).where("publicado", "==", false).get();
  return snap.docs.map((d) => d.id);
}
