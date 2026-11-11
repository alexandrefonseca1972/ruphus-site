import { limitesDe } from "@/lib/scheduling";
import "server-only";
import { type DocumentSnapshot, FieldValue, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { UserError } from "@/lib/booking.server";
import { DadosFabrica, DadosNegocio, leadDoDono, NegocioInput, type Sub, SUBS, UtmInput } from "@/lib/gerador";
import { personalDe, registrosDoSite } from "@/lib/gerador.server";
import { FUSOS, todayIn } from "@/lib/datetime";
import { limiteStaffDe } from "@/lib/limites";
import { Role } from "@/lib/tenant-input";
import { validarContatoDoNegocio } from "@/lib/telefones-meta.server";
import { DEMO } from "@/lib/demo";

async function exigeContatoValido(db: Firestore, telefone: string, slug = "") {
  // a demonstração usa um contato fictício e nunca envia mensagens
  if (slug === DEMO || telefone === "5596999990000") return;
  const r = await validarContatoDoNegocio(db, telefone);
  if ("erro" in r) throw new UserError(r.erro);
}

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
export async function criarNegocio(db: Firestore, user: { uid: string; email?: string; name?: string }, input: unknown, utmBruta?: unknown, aceite?: Record<string, unknown>) {
  const parsed = NegocioInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
  // a origem do anúncio é informação a mais: se vier estranha, o cadastro segue sem ela
  const lida = UtmInput.safeParse(utmBruta);
  const utm = lida.success ? Object.fromEntries(Object.entries(lida.data).filter(([, v]) => v)) : {};
  const { slug, ...dados } = parsed.data;
  await exigeContatoValido(db, dados.telefone);
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
      utm: Object.keys(utm).length ? utm : null,
    })) {
      tx.set(e.ref, e.dados, { merge: true });
    }
    if (dados.fuso) tx.set(db.doc(`tenants/${slug}`), { site: { fuso: dados.fuso } }, { merge: true });
    // o membro do dono com e-mail e nome: é o que "Quem tem acesso" mostra
    tx.set(db.doc(`tenants/${slug}/members/${user.uid}`), {
      ...(user.email && { email: user.email }),
      ...(user.name && { nome: user.name }),
    }, { merge: true });
    // o aceite dos Termos (exigido por criarNegocioAction) entra na mesma transação:
    // se o negócio não for criado, o aceite também não fica gravado
    if (aceite) tx.set(db.collection("aceites").doc(), { ...aceite, slug });
  });
  // mensagens pré-pagas: o negócio novo nasce com o crédito de boas-vindas (uma vez só). Import na
  // hora: consumo.server abre o app do Admin SDK, e quem só importa este arquivo (testes) abre o seu
  await (await import("@/lib/consumo.server")).boasVindas(slug);
  return slug;
}

/** O que a aba "Meu negócio" mostra para editar. `fabrica`: site feito pela fábrica,
 *  estático — os dados mudam a bio e o agendamento, mas não a página. */
export async function lerNegocio(db: Firestore, slug: string) {
  const [t, zap] = await Promise.all([db.doc(`tenants/${slug}`).get(), db.doc(`tenants/${slug}/privado/whatsapp`).get()]);
  if (!t.exists) throw new UserError("Negócio não encontrado.");
  const s = (campo: string) => String(t.get(campo) ?? "");
  const contato = await validarContatoDoNegocio(db, s("site.phone"));
  return {
    name: s("name"),
    erroContato: "erro" in contato ? contato.erro : null,
    sub: (t.get("gerado.sub") as Sub | undefined) ?? "",
    telefone: s("site.phone"),
    cidade: s("site.city"),
    uf: s("site.uf"),
    /** fuso escolhido à mão; vazio = automático pela UF */
    fuso: s("site.fuso"),
    // site da fábrica não tem gerado.*: bairro e horário ficam em site.*
    bairro: s("gerado.bairro") || s("site.bairro"),
    endereco: s("site.address"),
    instagram: s("site.instagram"),
    horario: s("gerado.horario") || s("site.horario"),
    /** recado da tela de confirmação do agendamento; vazio = texto padrão */
    recado: s("agenda.recado"),
    /** agenda pelo link ligada; ausente = ligada (todo negócio nasce agendando) */
    agendaOnline: t.get("agenda.online") !== false,
    /** quantos serviços e quanto tempo somado o cliente marca de uma vez pelo link */
    limites: limitesDe(t.get("agenda")),
    fabrica: !t.get("gerado") && !!t.get("site.url"),
    /** entrada paga: sem faixa de proposta e no Google */
    publicado: !!t.get("gerado.publicadoEm"),
    /** WhatsApp pelo canal oficial: ligado e se o dono confirmou o número dele ("Sou eu") */
    whatsapp: { canalOficial: t.get("whatsapp.canalOficial") === true, donoConfirmado: !!zap.get("ownerPhoneVerifiedAt") },
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
  const escolha = t.get("gerado.escolha") as { kit?: number; cor?: number } | undefined;
  return { ...dados, tipo: tipoDe(t), escolha, google: { nota: num("site.rating"), avaliacoes: num("site.reviews") } };
}

export type Mudanca = { campo: string; antes: string; depois: string };

/** O que salvarNegocio mudaria, campo a campo, sem gravar: o admin confere antes de publicar. */
export async function previaDoSite(db: Firestore, slug: string, input: unknown, google: Google) {
  const atual = await lerSiteDoNegocio(db, slug);
  const fabrica = atual.tipo === "fabrica";
  // o mesmo schema que salvarNegocio aplica: fábrica não tem ramo
  const parsed = (fabrica ? DadosFabrica : DadosNegocio).safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
  const d = parsed.data as DadosNegocio;
  await exigeContatoValido(db, d.telefone, slug);
  const n = (v: number | null) => (v == null ? "" : String(v).replace(".", ","));
  const pares: [string, string, string, boolean][] = [
    ["Nome", atual.name, d.name, true],
    ["Ramo", atual.sub ? SUBS[atual.sub as Sub].rotulo : "", fabrica ? "" : SUBS[d.sub].rotulo, !fabrica],
    ["WhatsApp", atual.telefone, d.telefone, true],
    ["Cidade", atual.cidade, d.cidade, true],
    ["UF", atual.uf, d.uf, true],
    ["Fuso", atual.fuso ? FUSOS[atual.fuso] ?? atual.fuso : "Pela UF", d.fuso ? FUSOS[d.fuso] : "Pela UF", true],
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
  const ref = db.doc(`tenants/${slug}`);
  const t = await ref.get();
  if (!t.exists) throw new UserError("Negócio não encontrado.");

  if (!t.get("gerado") && t.get("site.url")) {
    // site da fábrica: a página é um arquivo e não tem ramo (não há modelo a escolher);
    // o que o dono edita vale para a bio e o agendamento, e fica em site.*
    const parsed = DadosFabrica.safeParse(input);
    if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
    const d = parsed.data;
    await exigeContatoValido(db, d.telefone, slug);
    await ref.set({
      name: d.name,
      site: { phone: d.telefone, city: d.cidade, uf: d.uf, fuso: d.fuso || null, address: d.endereco || null, instagram: d.instagram || null, bairro: d.bairro || null, horario: d.horario || null },
    }, { merge: true });
    return;
  }
  const parsed = DadosNegocio.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
  const d = parsed.data;
  await exigeContatoValido(db, d.telefone, slug);
  const origem = t.get("gerado.origem") === "cadastro" || !t.get("gerado") ? "cadastro" : "prospeccao";
  // o modelo (kit e cor) é de um ramo: noutro ramo os índices apontam para fotos e
  // paletas que não existem. Trocou o ramo, volta ao visual padrão do ramo novo.
  const mudouRamo = t.get("gerado.sub") !== d.sub;
  const [negocio] = registrosDoSite(db, slug, { ...leadDoDono(d), ...google }, { nicho: SUBS[d.sub].nicho, sub: d.sub, tipo: SUBS[d.sub].tipo }, {
    // fotos, cores e textos próprios são do negócio, não do ramo: ficam mesmo trocando o ramo
    novo: false, ownerId: String(t.get("ownerId")), origem, escolha: mudouRamo ? undefined : t.get("gerado.escolha"), personal: personalDe(t.get("gerado.personal")),
  });
  const { rating: _nota, reviews: _avaliacoes, ...site } = negocio.dados.site as Record<string, unknown>;
  // editadoEm: a planilha e a coleta (gerarNoBanco) não regravam o que foi editado aqui
  await ref.set({ ...negocio.dados, gerado: { ...(negocio.dados.gerado as Record<string, unknown>), editadoEm: FieldValue.serverTimestamp() }, site: { ...(google ? negocio.dados.site : site), fuso: d.fuso || null } }, { merge: true });
  if (mudouRamo && t.get("gerado.escolha")) await ref.update({ "gerado.escolha": FieldValue.delete() });
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

/** Os negócios de uma conta, com o nome e o papel de cada um, por nome. */
export async function negociosDe(db: Firestore, uid: string) {
  const snap = await db.collectionGroup("members").where("uid", "==", uid).get();
  // só membros em tenants/{id}/members (defesa contra coleções "members" aninhadas)
  const membros = snap.docs.filter((d) => d.ref.parent.parent?.parent.id === "tenants");
  // ponytail: uma leitura por negócio; quem tem muitos (o admin da plataforma) vai para o /admin antes
  const docs = membros.length ? await db.getAll(...membros.map((d) => d.ref.parent.parent!)) : [];
  return membros
    .map((d, i) => ({ id: d.ref.parent.parent!.id, name: (docs[i].get("name") as string | undefined) ?? d.ref.parent.parent!.id, role: Role.catch("member").parse(d.get("role")) }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** Cota diária dos e-mails que um negócio dispara pela Ruphus (convite da equipe, recibo): sem
 *  ela, uma conta manda milhares de e-mails em nome de noreply@/contato@ruphus.site e queima o
 *  domínio. Conta por dia de São Paulo, numa transação, em tenants/{id}/limites (as regras não
 *  deixam o app ler nem gravar ali). Estoura com UserError, que a tela mostra. */
export async function gastarCota(db: Firestore, tenantId: string, tipo: "convites" | "recibos", teto: number) {
  const ref = db.doc(`tenants/${tenantId}/limites/${tipo}-${todayIn()}`);
  await db.runTransaction(async (tx) => {
    const usados = ((await tx.get(ref)).get("usados") as number | undefined) ?? 0;
    if (usados >= teto) throw new UserError(`Limite de ${teto} envios por dia atingido. Tente amanhã ou fale com a Ruphus.`);
    tx.set(ref, { usados: usados + 1, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
  });
}
