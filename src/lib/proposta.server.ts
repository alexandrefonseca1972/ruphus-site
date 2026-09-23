import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { PRECO_PADRAO } from "@/lib/crm-tipos";
import { pixCadastrado } from "@/lib/cobranca";

/** A proposta é uma página com link, não um PDF nem um bloco de texto.
 *
 * O vendedor manda o mesmo link pelo WhatsApp e pelo e-mail; o dono abre no
 * celular, lê, e fecha pelo botão — sem anexo para baixar e sem PDF que
 * ninguém lê no ônibus. O preço vem do CRM, então a proposta é sempre a que
 * foi combinada com aquele negócio. */

export class PropostaErro extends ErroPrevisto {}

const RAIZ = "crm";
const SLUG = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;
/** Quanto tempo a proposta fica de pé. Curto de propósito: proposta sem prazo não fecha. */
export const DIAS_PROPOSTA = 7;

export type PropostaPublica = {
  slug: string;
  nome: string;
  cidade: string | null;
  donoNome: string | null;
  entradaCents: number;
  mensalCents: number;
  /** AAAA-MM-DD, último dia em que vale */
  valeAte: string;
  vencida: boolean;
  /** WhatsApp da Ruphus, para o botão de fechar */
  whatsapp: string | null;
};

const diaMais = (dias: number) => {
  const d = new Date(Date.now() + dias * 86_400_000);
  return d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
};

/** Cria (ou reaproveita) o link da proposta daquele negócio.
 *
 * Reaproveitar importa: o vendedor manda o link pelo WhatsApp e depois pelo
 * e-mail, e os dois têm de abrir a mesma proposta. "Refazer" gera outro. */
export async function gerarProposta(db: Firestore, slug: string, refazer = false) {
  if (!SLUG.test(slug)) throw new PropostaErro("Negócio inválido.");
  const ref = db.collection(RAIZ).doc(slug);
  const atual = await ref.get();
  const guardado = String(atual.get("propostaToken") ?? "");
  const token = !refazer && guardado ? guardado : randomBytes(16).toString("hex");
  const valeAte = diaMais(DIAS_PROPOSTA);
  await ref.set({ propostaToken: token, propostaValeAte: valeAte, propostaEm: FieldValue.serverTimestamp() }, { merge: true });
  return { token, valeAte, nova: token !== guardado };
}

/** A porta da página pública: o token é a credencial, e só sai daqui o que a
 *  página mostra. Token errado e negócio inexistente devolvem a mesma coisa. */
export async function abrirProposta(db: Firestore, slug: string, token: string): Promise<PropostaPublica | null> {
  if (!SLUG.test(slug)) return null;
  const [crm, tenant] = await Promise.all([db.collection(RAIZ).doc(slug).get(), db.collection("tenants").doc(slug).get()]);
  if (!crm.exists || !tenant.exists) return null;

  const guardado = String(crm.get("propostaToken") ?? "");
  const a = Buffer.from(guardado);
  const b = Buffer.from(token);
  if (!guardado || a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const valeAte = String(crm.get("propostaValeAte") ?? diaMais(DIAS_PROPOSTA));
  const cidade = tenant.get("site.city") as string | null;
  const uf = tenant.get("site.uf") as string | null;
  const pix = await pixCadastrado(db);
  return {
    slug,
    nome: String(tenant.get("name") ?? slug),
    cidade: cidade ? `${cidade}${uf ? `/${uf}` : ""}` : null,
    donoNome: (crm.get("donoNome") as string | null) ?? null,
    entradaCents: (crm.get("entradaCents") as number | null) ?? PRECO_PADRAO.entradaCents,
    mensalCents: (crm.get("mensalCents") as number | null) ?? PRECO_PADRAO.mensalCents,
    valeAte,
    // vencida não esconde nada: ela continua legível, só avisa que o preço pode mudar
    vencida: valeAte < diaMais(0),
    whatsapp: pix?.whatsapp ?? null,
  };
}
