import "server-only";
import { randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { DIAS_CONVITE } from "@/lib/limites";
import { ErroPrevisto } from "@/lib/erro-previsto";

/** Falta o e-mail do dono. Erro previsto: a mensagem chega à tela como está. */
export class SemDestinatario extends ErroPrevisto {}

// O convite é um link: quem abrir e entrar com a conta dele vira admin do espaço
// (o dono) ou funcionário ("member", convite da equipe, feito pelo próprio dono).
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

/** Cria o link para uma conta. Sem e-mail não há convite: o destinatário é
 *  parte do convite, não um extra.
 *
 * O e-mail vai assinado dentro do token, não na URL: mudar o endereço no link
 * quebra a assinatura em vez de trocar o destinatário. */
export async function criarConvite(db: Firestore, tenantId: string, email: string, equipe?: { staffId: string }) {
  const para = mesmoEmail(email ?? "");
  if (!para) throw new SemDestinatario(equipe ? "Informe o e-mail de quem vai entrar." : "Cadastre o e-mail do dono antes de convidar.");
  // convite da equipe: entra como funcionário ("member"), preso ao profissional da agenda
  return new SignJWT({ t: tenantId, e: para, ...(equipe && { r: "member", p: equipe.staffId }) })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(randomBytes(16).toString("hex"))
    .setIssuedAt()
    .setExpirationTime(VALIDADE)
    .sign(await segredo(db));
}

/** Devolve o tenant, o jti e o e-mail a que o convite está preso, ou null se o
 *  link for inválido, tiver vencido, ou não disser para quem é.
 *
 *  Token sem destinatário não vale — mesmo tratamento que os links antigos sem
 *  jti receberam: é justamente o formato que abre para quem chegar primeiro. */
export async function lerConvite(db: Firestore, token: string) {
  try {
    const { payload } = await jwtVerify(token, await segredo(db), { algorithms: ["HS256"] });
    if (!(typeof payload.t === "string" && typeof payload.jti === "string" && typeof payload.e === "string" && payload.e)) return null;
    // sem papel no token é o convite do dono (admin), como sempre foi
    const equipe = payload.r === "member" && typeof payload.p === "string" && payload.p;
    return { tenantId: payload.t, jti: payload.jti, email: payload.e, ...(equipe ? { papel: "member" as const, staffId: payload.p as string } : { papel: "admin" as const }) };
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
  convite: { email: string },
  user: { email?: string; emailPendente?: string },
): { ok: true } | { ok: false; error: string } {
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

/** O cliente entra pelo convite do dono. Site da fábrica (o dono era a conta da Ruphus):
 *  o negócio passa a ser dele — vira "owner" e o ownerId muda —, e a Ruphus fica como
 *  admin, para o suporte e a contagem de acessos do /admin. Em qualquer outro caso
 *  entra como admin, como antes. viaConvite marca o cliente (conta na cota de negócios
 *  e diz ao gerador que o site não volta a ser da planilha). */
export async function assumirNegocio(db: Firestore, tenantId: string, uid: string, quem: Record<string, unknown>) {
  const tenant = db.doc(`tenants/${tenantId}`);
  const membro = tenant.collection("members").doc(uid);
  await db.runTransaction(async (tx) => {
    const [t, plataforma] = await tx.getAll(tenant, db.doc("config/admin"));
    const dono = String(t.get("ownerId") ?? "");
    const antigo = dono ? await tx.get(tenant.collection("members").doc(dono)) : null;
    const daRuphus = !!dono && (((plataforma.get("uids") as unknown[] | undefined) ?? []).includes(dono));
    tx.set(membro, { ...quem, uid, role: daRuphus ? "owner" : "admin", viaConvite: true });
    if (!daRuphus) return;
    tx.update(tenant, { ownerId: uid });
    if (antigo?.exists) tx.update(antigo.ref, { role: "admin" });
  });
}
