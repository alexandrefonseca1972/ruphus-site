import "server-only";
import { randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { Firestore } from "firebase-admin/firestore";

// O convite é um link: quem abrir e entrar com a conta dele vira admin do espaço.
// O segredo mora no Firestore (só o Admin SDK lê), então não precisa de variável
// de ambiente nova nem de deploy para começar a convidar.
const DOC = "config/convite";
const VALIDADE = "30d";

async function segredo(db: Firestore) {
  const ref = db.doc(DOC);
  const snap = await ref.get();
  const atual = snap.get("secret");
  if (typeof atual === "string" && atual.length >= 32) return new TextEncoder().encode(atual);
  const novo = randomBytes(32).toString("hex");
  await ref.set({ secret: novo }, { merge: true });
  return new TextEncoder().encode(novo);
}

export async function criarConvite(db: Firestore, tenantId: string) {
  return new SignJWT({ t: tenantId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(VALIDADE)
    .sign(await segredo(db));
}

/** Devolve o tenant do convite, ou null se o link for inválido ou tiver vencido. */
export async function lerConvite(db: Firestore, token: string) {
  try {
    const { payload } = await jwtVerify(token, await segredo(db), { algorithms: ["HS256"] });
    return typeof payload.t === "string" ? payload.t : null;
  } catch {
    return null;
  }
}
