import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { UserError } from "@/lib/booking.server";
import { TenantInput } from "@/lib/tenant-input";

/** Negócios que cada conta pode ter, até o admin da plataforma liberar mais. */
export const LIMITE_PADRAO = 1;

// Conta quem manda no negócio: dono (criou) ou admin que entrou pelo convite do
// site importado. Admin sem "viaConvite" não conta: as regras deixam o dono de um
// negócio adicionar qualquer uid como admin, e isso não pode gastar a cota alheia.
// Funcionário ("member") também não conta.
const conta = (d: FirebaseFirestore.QueryDocumentSnapshot) =>
  d.ref.parent.parent?.parent.id === "tenants" && (d.get("role") === "owner" || (d.get("role") === "admin" && d.get("viaConvite") === true));

async function ehAdminDaPlataforma(db: Firestore, uid: string) {
  const uids = (await db.doc("config/admin").get()).get("uids");
  return Array.isArray(uids) && uids.includes(uid);
}

/** Quantos negócios a conta tem e quantos pode ter. `null` = sem limite (admin da plataforma). */
export async function cotaDe(db: Firestore, uid: string) {
  const [membros, limite, admin] = await Promise.all([
    db.collectionGroup("members").where("uid", "==", uid).get(),
    db.doc(`limites/${uid}`).get(),
    ehAdminDaPlataforma(db, uid),
  ]);
  const usados = membros.docs.filter(conta).length;
  return { usados, limite: admin ? null : ((limite.get("negocios") as number | undefined) ?? LIMITE_PADRAO) };
}

/** Cria o negócio com quem pediu como dono, se a conta ainda tem cota.
 *
 * Numa transação: dois cliques (ou duas abas) ao mesmo tempo não passam juntos
 * pela contagem, e o endereço já tomado falha no create em vez de sobrescrever. */
export async function criarNegocio(db: Firestore, user: { uid: string; email?: string; name?: string }, input: unknown) {
  const parsed = TenantInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
  const { slug, name } = parsed.data;
  const admin = await ehAdminDaPlataforma(db, user.uid);

  await db.runTransaction(async (tx) => {
    const [membros, limite, existente] = await Promise.all([
      tx.get(db.collectionGroup("members").where("uid", "==", user.uid)),
      tx.get(db.doc(`limites/${user.uid}`)),
      tx.get(db.doc(`tenants/${slug}`)),
    ]);
    if (existente.exists) throw new UserError("Esse endereço já está em uso. Escolha outro.");
    const usados = membros.docs.filter(conta).length;
    const max = (limite.get("negocios") as number | undefined) ?? LIMITE_PADRAO;
    if (!admin && usados >= max) {
      throw new UserError(
        max === 1
          ? "Sua conta inclui 1 negócio. Para cadastrar outro, fale com a Ruphus."
          : `Sua conta inclui ${max} negócios. Para cadastrar outro, fale com a Ruphus.`,
      );
    }
    const t = db.doc(`tenants/${slug}`);
    tx.create(t, { name, ownerId: user.uid, createdAt: FieldValue.serverTimestamp() });
    tx.create(t.collection("members").doc(user.uid), {
      uid: user.uid,
      role: "owner",
      ...(user.email && { email: user.email }),
      ...(user.name && { nome: user.name }),
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return slug;
}

/** O admin da plataforma libera (ou reduz) quantos negócios uma conta pode ter. */
export async function definirLimite(db: Firestore, uid: string, negocios: number) {
  if (!Number.isInteger(negocios) || negocios < 1 || negocios > 50) throw new UserError("O limite vai de 1 a 50 negócios.");
  await db.doc(`limites/${uid}`).set({ negocios, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
  return negocios;
}
