import "server-only";
import { randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { DIAS_CONVITE } from "@/lib/limites";

// O convite é um link: quem abrir e entrar com a conta dele vira admin do espaço.
// O segredo mora no Firestore (só o Admin SDK lê), então não precisa de variável
// de ambiente nova nem de deploy para começar a convidar.
//
// O link vale uma vez: o jti fica gravado em convitesUsados quando alguém entra.
//
// Uso único sozinho não diz QUEM entra — quem receber o link repassado antes do
// dono usa e vira admin do negócio. Por isso, quando o vendedor já registrou o
// e-mail do dono, ele viaja assinado no token e o convite só abre para essa
// conta, com o e-mail confirmado. Sem e-mail registrado o link segue valendo
// para a primeira conta que chegar, que é o que o canal (WhatsApp para o
// telefone do site) permite garantir.
const DOC = "config/convite";
const USADOS = "convitesUsados";
const VALIDADE = `${DIAS_CONVITE}d`;

async function segredo(db: Firestore) {
  const ref = db.doc(DOC);
  const snap = await ref.get();
  const atual = snap.get("secret");
  if (typeof atual === "string" && atual.length >= 32) return new TextEncoder().encode(atual);
  const novo = randomBytes(32).toString("hex");
  await ref.set({ secret: novo }, { merge: true });
  return new TextEncoder().encode(novo);
}

/** E-mail como chave de comparação: quem digita "Joao@Gmail.com" e quem digita
 *  "joao@gmail.com" é a mesma pessoa, e o Firebase guarda como veio. */
export const mesmoEmail = (e: string) => e.trim().toLowerCase();

/** Cria o link. Com `email`, o convite passa a valer só para essa conta.
 *
 * O e-mail vai assinado dentro do token, não na URL: mudar o endereço no link
 * quebra a assinatura em vez de trocar o destinatário. */
export async function criarConvite(db: Firestore, tenantId: string, email?: string | null) {
  const para = email ? mesmoEmail(email) : null;
  return new SignJWT(para ? { t: tenantId, e: para } : { t: tenantId })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(randomBytes(16).toString("hex"))
    .setIssuedAt()
    .setExpirationTime(VALIDADE)
    .sign(await segredo(db));
}

/** Devolve o tenant, o jti e o e-mail a que o convite está preso (null = qualquer
 *  conta), ou null se o link for inválido ou tiver vencido. */
export async function lerConvite(db: Firestore, token: string) {
  try {
    const { payload } = await jwtVerify(token, await segredo(db), { algorithms: ["HS256"] });
    return typeof payload.t === "string" && typeof payload.jti === "string"
      ? { tenantId: payload.t, jti: payload.jti, email: typeof payload.e === "string" ? payload.e : null }
      : null;
  } catch {
    return null;
  }
}

/** Se esta conta pode abrir este convite.
 *
 * Fora da action porque é a decisão de acesso: aqui ela roda em teste sem
 * Firestore nenhum. `email` é o do token JÁ confirmado pelo Firebase;
 * `emailPendente` é o não confirmado, que só serve para a mensagem. */
export function conviteAbrePara(
  convite: { email: string | null },
  user: { email?: string; emailPendente?: string },
): { ok: true } | { ok: false; error: string } {
  if (!convite.email) return { ok: true };   // link aberto: vale para quem chegar primeiro
  // Confirmado é a única prova: sem isso, criar conta com o e-mail alheio abriria o convite dos outros
  if (!user.email) {
    return {
      ok: false,
      error: user.emailPendente
        ? `Confirme o e-mail ${user.emailPendente} pelo link que enviamos e abra o convite de novo.`
        : "Este convite é de uma conta de e-mail. Entre com e-mail e senha, confirme o endereço e abra o link de novo.",
    };
  }
  if (mesmoEmail(user.email) !== convite.email) {
    return { ok: false, error: `Este convite é só para ${convite.email}. Entre com essa conta ou peça um link novo.` };
  }
  return { ok: true };
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
