import "server-only";
import { type DocumentSnapshot, FieldValue, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { UserError } from "@/lib/booking.server";
import { DadosNegocio, leadDoDono, NegocioInput, type Sub, SUBS } from "@/lib/gerador";
import { registrosDoSite } from "@/lib/gerador.server";
import { limiteStaffDe } from "@/lib/limites";

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

/** Cria o negócio com quem pediu como dono, se a conta ainda tem cota — e já com o
 *  site no ar, a agenda aberta (serviços do ramo e uma equipe) e a ficha no funil.
 *
 * Numa transação: dois cliques (ou duas abas) ao mesmo tempo não passam juntos
 * pela contagem, e o endereço já tomado falha antes de gravar qualquer coisa. */
export async function criarNegocio(db: Firestore, user: { uid: string; email?: string; name?: string }, input: unknown) {
  const parsed = NegocioInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
  const { slug, ...dados } = parsed.data;
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
    const n = { nicho: SUBS[dados.sub].nicho, sub: dados.sub, tipo: SUBS[dados.sub].tipo };
    for (const e of registrosDoSite(db, slug, leadDoDono(dados, user.email), n, {
      novo: true, ownerId: user.uid, origem: "cadastro", equipe: user.name, donoNome: user.name,
    })) {
      tx.set(e.ref, e.dados, { merge: true });
    }
    // o membro do dono com e-mail e nome: é o que "Quem tem acesso" mostra
    tx.set(db.doc(`tenants/${slug}/members/${user.uid}`), {
      ...(user.email && { email: user.email }),
      ...(user.name && { nome: user.name }),
    }, { merge: true });
  });
  return slug;
}

/** O que a aba "Meu negócio" mostra para editar. `fabrica`: site feito pela fábrica,
 *  estático — os dados mudam a bio e o agendamento, mas não a página. */
export async function lerNegocio(db: Firestore, slug: string) {
  const t = await db.doc(`tenants/${slug}`).get();
  if (!t.exists) throw new UserError("Negócio não encontrado.");
  const s = (campo: string) => String(t.get(campo) ?? "");
  return {
    name: s("name"),
    sub: (t.get("gerado.sub") as Sub | undefined) ?? "",
    telefone: s("site.phone"),
    cidade: s("site.city"),
    uf: s("site.uf"),
    bairro: s("gerado.bairro"),
    endereco: s("site.address"),
    instagram: s("site.instagram"),
    horario: s("gerado.horario"),
    fabrica: !t.get("gerado") && !!t.get("site.url"),
    /** entrada paga: sem faixa de proposta e no Google */
    publicado: !!t.get("gerado.publicadoEm"),
  };
}

/** Nota e avaliações do Google: o dono não edita (seria a própria nota); só o admin da plataforma informa. */
export const Google = z.object({ nota: z.number().min(0).max(5).nullable(), avaliacoes: z.number().int().min(0).nullable() });
export type Google = z.infer<typeof Google>;

/** De onde vem o site: sem-site (conta de antes do site automático), cadastro (o dono criou),
 *  prospeccao (planilha do gerador, com a faixa de proposta) ou fabrica (página estática). */
export type TipoSite = "sem-site" | "cadastro" | "prospeccao" | "fabrica";
const tipoDe = (t: DocumentSnapshot): TipoSite =>
  !t.get("gerado") ? (t.get("site.url") ? "fabrica" : "sem-site") : t.get("gerado.origem") === "cadastro" ? "cadastro" : "prospeccao";

/** O que a aba "Site" da gaveta do admin mostra: os dados do dono, o tipo e o Google. */
export async function lerSiteDoNegocio(db: Firestore, slug: string) {
  const [dados, t] = await Promise.all([lerNegocio(db, slug), db.doc(`tenants/${slug}`).get()]);
  const num = (c: string) => (typeof t.get(c) === "number" ? (t.get(c) as number) : null);
  return { ...dados, tipo: tipoDe(t), google: { nota: num("site.rating"), avaliacoes: num("site.reviews") } };
}

export type Mudanca = { campo: string; antes: string; depois: string };

/** O que salvarNegocio mudaria, campo a campo, sem gravar: o admin confere antes de publicar. */
export async function previaDoSite(db: Firestore, slug: string, input: unknown, google: Google) {
  const parsed = DadosNegocio.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
  const d = parsed.data;
  const atual = await lerSiteDoNegocio(db, slug);
  const fabrica = atual.tipo === "fabrica";
  const n = (v: number | null) => (v == null ? "" : String(v).replace(".", ","));
  const pares: [string, string, string, boolean][] = [
    ["Nome", atual.name, d.name, true],
    ["Ramo", atual.sub ? SUBS[atual.sub as Sub].rotulo : "", SUBS[d.sub].rotulo, !fabrica],
    ["WhatsApp", atual.telefone, d.telefone, true],
    ["Cidade", atual.cidade, d.cidade, true],
    ["UF", atual.uf, d.uf, true],
    ["Bairro", atual.bairro, d.bairro, !fabrica],
    ["Endereço", atual.endereco, d.endereco, true],
    ["Instagram", atual.instagram, d.instagram, true],
    ["Horário", atual.horario, d.horario, !fabrica],
    ["Nota no Google", n(atual.google.nota), n(google.nota), !fabrica],
    ["Avaliações no Google", n(atual.google.avaliacoes), n(google.avaliacoes), !fabrica],
  ];
  const mudancas: Mudanca[] = pares.filter(([, a, b, conta]) => conta && a !== b).map(([campo, antes, depois]) => ({ campo, antes, depois }));
  return { tipo: atual.tipo, mudancas };
}

/** Grava o que o dono editou. Não mexe em serviços nem na equipe (são dele), nem na
 *  nota e nas avaliações do Google que o gerador trouxe — a não ser que o admin as
 *  mande em `google`. Negócio criado antes do site automático ganha o site aqui,
 *  quando o dono escolhe o ramo. */
export async function salvarNegocio(db: Firestore, slug: string, input: unknown, google?: Google) {
  const parsed = DadosNegocio.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
  const d = parsed.data;
  const ref = db.doc(`tenants/${slug}`);
  const t = await ref.get();
  if (!t.exists) throw new UserError("Negócio não encontrado.");

  if (!t.get("gerado") && t.get("site.url")) {
    // site da fábrica: a página é um arquivo; muda o que a bio e o agendamento leem
    await ref.set({
      name: d.name,
      site: { phone: d.telefone, city: d.cidade, uf: d.uf, address: d.endereco || null, instagram: d.instagram || null },
    }, { merge: true });
    return;
  }
  const origem = t.get("gerado.origem") === "cadastro" || !t.get("gerado") ? "cadastro" : "prospeccao";
  const [negocio] = registrosDoSite(db, slug, { ...leadDoDono(d), ...google }, { nicho: SUBS[d.sub].nicho, sub: d.sub, tipo: SUBS[d.sub].tipo }, {
    novo: false, ownerId: String(t.get("ownerId")), origem,
  });
  const { rating: _nota, reviews: _avaliacoes, ...site } = negocio.dados.site as Record<string, unknown>;
  await ref.set({ ...negocio.dados, site: google ? negocio.dados.site : site }, { merge: true });
}

/** O admin da plataforma libera (ou reduz) quantos negócios uma conta pode ter. */
export async function definirLimite(db: Firestore, uid: string, negocios: number) {
  if (!Number.isInteger(negocios) || negocios < 1 || negocios > 50) throw new UserError("O limite vai de 1 a 50 negócios.");
  await db.doc(`limites/${uid}`).set({ negocios, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
  return negocios;
}

/** Cria o profissional se o plano ainda tem vaga.
 *
 * Numa transação, e no servidor, porque regra do Firestore não sabe contar
 * documentos: a trava na tela sozinha é só um aviso educado. */
export async function criarProfissional(db: Firestore, tenantId: string, dados: Record<string, unknown>) {
  const tenant = db.doc(`tenants/${tenantId}`);
  const novo = tenant.collection("staff").doc();
  await db.runTransaction(async (tx) => {
    const [doc, equipe] = await Promise.all([tx.get(tenant), tx.get(tenant.collection("staff"))]);
    const limite = limiteStaffDe(doc.get("limiteStaff") as number | undefined);
    if (equipe.size >= limite) {
      throw new UserError(`Seu plano inclui ${limite} profissionais. Para abrir mais uma vaga, fale com a Ruphus.`);
    }
    tx.create(novo, dados);
  });
  return novo.id;
}
