import "server-only";
import { randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { FieldValue, type Firestore } from "firebase-admin/firestore";

// O convite é um link: quem abrir e entrar com a conta dele vira admin do espaço.
// O segredo mora no Firestore (só o Admin SDK lê), então não precisa de variável
// de ambiente nova nem de deploy para começar a convidar.
//
// O link vale uma vez. Ele vai por WhatsApp, para um telefone tirado do site do
// negócio, e não há e-mail para vincular — então o que impede um link repassado
// de virar acesso de estranho é o jti ficar gravado em convitesUsados quando o
// dono entra.
const DOC = "config/convite";
const USADOS = "convitesUsados";
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
    .setJti(randomBytes(16).toString("hex"))
    .setIssuedAt()
    .setExpirationTime(VALIDADE)
    .sign(await segredo(db));
}

/** Devolve o tenant e o jti do convite, ou null se o link for inválido ou tiver vencido. */
export async function lerConvite(db: Firestore, token: string) {
  try {
    const { payload } = await jwtVerify(token, await segredo(db), { algorithms: ["HS256"] });
    return typeof payload.t === "string" && typeof payload.jti === "string"
      ? { tenantId: payload.t, jti: payload.jti }
      : null;
  } catch {
    return null;
  }
}

/** Queima o convite. Devolve false se este link já tiver sido usado. */
export async function consumirConvite(db: Firestore, jti: string, uid: string) {
  try {
    // create() falha se o documento já existe, então a corrida é resolvida pelo banco
    await db.doc(`${USADOS}/${jti}`).create({ uid, at: FieldValue.serverTimestamp() });
    return true;
  } catch {
    return false;
  }
}
