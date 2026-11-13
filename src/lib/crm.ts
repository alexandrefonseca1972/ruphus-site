import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { addDays, phoneError, todayIn } from "@/lib/datetime";
import { ErroPrevisto, LimiteAtingido } from "@/lib/erro-previsto";
import { varianteDoNegocio } from "@/lib/prospeccao";
import { cancelarPendentes } from "@/lib/prospeccao-fila";
import { varianteDoId } from "@/lib/prospeccao-variantes";
import { paraTelefoneNorm, paraVarianteId, type VarianteId } from "@/lib/tipos-marca";

// O CRM mora fora do tenant: nenhuma regra expõe a coleção "crm", então valor,
// anotações e estágio ficam só com quem administra a plataforma — o dono do
// negócio, que é membro do tenant, nunca lê isso.
const RAIZ = "crm";

export { ESTAGIOS, ROTULO } from "@/lib/crm-tipos";
import { barradoPeloPareDoAgente, CADENCIA, daCadencia, DEPOIS_DA_RESPOSTA, DETALHE_PAROU, EnvioConfirmado, ESTAGIOS as LISTA, etapaDoModelo, EventoProspeccao, MOTIVOS_PERDA, ORIGENS, ROTULO, tipoNaTela, TOQUES_MAX, type Crm, type Evento, type MotivoPerda, type Nota, type Origem, type Utm } from "@/lib/crm-tipos";
export type { Crm, Evento, Nota };

/** Erro previsto: a mensagem chega à tela como está (o resto vira "não foi possível") */
export class CrmErro extends ErroPrevisto {}

/** Campos da medição F1 lidos do doc com Zod: dado torto vira null, não um tipo mentiroso. */
const VarianteDoDoc = z.string().nullable().catch(null);
const UltimoEnvio = z.object({ id: z.string(), varianteId: z.string().nullable(), textoEnviado: z.string(), etapa: z.string().optional(), em: z.number().optional() });
/** Campos do doc lidos com Zod, sem cast: número torto vira 0, data torta vira null. */
const Contagem = z.number().int().min(0).catch(0);
const DataDoDoc = z
  .custom<{ toDate: () => Date }>((v) => typeof v === "object" && v !== null && "toDate" in v && typeof v.toDate === "function")
  .transform((v) => v.toDate().toISOString())
  .nullable()
  .catch(null);
const ContatoDoDoc = z.object({ nome: z.string().catch(""), whatsapp: z.string() });
/** Outros contatos: o item torto sai, os outros ficam (um item ruim não apaga os telefones do PARE). */
const ContatosDoDoc = z
  .array(z.unknown())
  .catch([])
  .transform((l) => l.flatMap((c) => {
    const r = ContatoDoDoc.safeParse(c);
    return r.success ? [r.data] : [];
  }));

/** Dois envios confirmados da mesma etapa ao mesmo lead, com envioId diferente, em menos disto: o
 *  segundo é o mesmo lead aberto em outra aba (cada aba gera o seu envioId). Recusado. */
export const JANELA_ENVIO_REPETIDO_MS = 60_000;

/** Os telefones do negócio (site, CRM, dono e outros contatos): quem fala por ele. */
export function telefonesDoNegocio(tenant: { get: (k: string) => unknown } | null, crm: { get: (k: string) => unknown } | null): string[] {
  return [
    tenant?.get("site.phone"),
    tenant?.get("site.whatsapp"),
    crm?.get("telefone"),
    crm?.get("donoWhatsapp"),
    ...ContatosDoDoc.parse(crm?.get("outrosContatos")).map((c) => c.whatsapp),
  ].filter((t): t is string => typeof t === "string" && !!t);
}

/** Os telefones do negócio normalizados, sem repetição. */
const telefonesNorm = (tenant: { get: (k: string) => unknown } | null, crm: { get: (k: string) => unknown } | null) =>
  [...new Set(telefonesDoNegocio(tenant, crm).map(paraTelefoneNorm).filter((t) => t !== null))];

/** As conversas do número de prospecção (F3) com os telefones do negócio. */
const conversasDoNegocio = (db: Firestore, tenant: { get: (k: string) => unknown } | null, crm: { get: (k: string) => unknown } | null) =>
  telefonesNorm(tenant, crm).map((t) => db.doc(`prospeccaoConversas/${t}`));

/** Algum telefone do negócio pediu PARE no número de prospecção (prospeccaoConversas/{telefone}),
 *  mesmo sem o slug confirmado pelo agente: a cadência e o copiloto não saem. */
export async function paradoNaProspeccao(db: Firestore, slug: string) {
  const [tenant, crm] = await Promise.all([db.doc(`tenants/${slug}`).get(), db.doc(`${RAIZ}/${slug}`).get()]);
  const refs = conversasDoNegocio(db, tenant, crm);
  return refs.length > 0 && (await db.getAll(...refs)).some((d) => !!d.get("naoContatarEm"));
}

/** Falha do copiloto ou do agente de IA vira evento na linha do tempo, com o código do erro (não a
 *  mensagem: a do provedor pode trazer corpo e ids). A telemetria em iaChamadas segue à parte. */
export async function registrarFalhaIA(db: Firestore, slug: string, origem: "copiloto" | "agente", erro: unknown) {
  const x = (erro ?? {}) as { codigo?: unknown; name?: unknown };
  const codigo = String(x.codigo ?? x.name ?? "desconhecido").slice(0, 60);
  const ev = { tipo: "ia_falha" as const, origem, codigo };
  EventoProspeccao.parse(ev);
  await db.collection(`${RAIZ}/${slug}/eventos`).add({
    ...ev,
    titulo: origem === "copiloto" ? "Copiloto de IA falhou" : "Agente de IA falhou",
    detalhe: codigo,
    autor: origem === "copiloto" ? "copiloto" : "agente-prospeccao",
    quando: FieldValue.serverTimestamp(),
  });
}

/** Os números de cada variante (F2): prospeccaoVariantes/{varianteId}, com incremento atômico na
 *  mesma transação do evento. O evento tem id fixo e nasce com create(): o número sobe uma vez só. */
const STATS = "prospeccaoVariantes";
const TIPO_LIGADO = { respondeu: "resposta_humana", automatica: "resposta_automatica", parar: "optout" } as const;
const CAMPO_STATS = { resposta_humana: "respostas", resposta_automatica: "automaticas", optout: "optouts" } as const;

const texto = (max: number) => z.string().trim().max(max).nullable().optional();

export const CrmInput = z.object({
  estagio: z.enum(LISTA).optional(),
  entradaCents: z.number().int().min(0).max(100_000_00).nullable().optional(),
  mensalCents: z.number().int().min(0).max(100_000_00).nullable().optional(),
  caixaCents: z.number().int().min(0).max(100_000_00).nullable().optional(),
  proximaAcao: z.string().trim().max(120).nullable().optional(),
  proximaData: z.iso.date().nullable().optional(),
  publicado: z.boolean().optional(),
  donoNome: texto(80),
  donoPapel: texto(40),
  // a mesma regra da tela (phoneError): grava só os dígitos, sem o 55; vazio vira null
  donoWhatsapp: z
    .string()
    .max(30)
    .transform((s) => s.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, ""))
    .refine((d) => !d || (d.length <= 11 && !phoneError(d)), "WhatsApp inválido: confira o DDD e o número")
    .transform((d) => d || null)
    .nullable()
    .optional(),
  donoEmail: z.union([z.email("E-mail inválido"), z.literal("")]).nullable().optional(),
  outrosContatos: z.array(z.object({ nome: z.string().trim().max(60), whatsapp: z.string().regex(/^\d{10,11}$/, "WhatsApp com DDD: 10 ou 11 dígitos") })).max(10).optional(),
  motivoPerda: z.enum(Object.keys(MOTIVOS_PERDA) as [MotivoPerda, ...MotivoPerda[]]).nullable().optional(),
  detalhePerda: texto(300),
  origem: z.enum(Object.keys(ORIGENS) as [Origem, ...Origem[]]).nullable().optional(),
  indicadoPor: texto(80),
  fixadoAte: z.iso.date().nullable().optional(),
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
    entradaCents: (d.get("entradaCents") as number | null) ?? null,
    mensalCents: (d.get("mensalCents") as number | null) ?? null,
    caixaCents: (d.get("caixaCents") as number | null) ?? null,
    fechadoEm: (d.get("fechadoEm") as { toDate?: () => Date } | null)?.toDate?.().toISOString() ?? null,
    proximaAcao: (d.get("proximaAcao") as string | null) ?? null,
    proximaData: (d.get("proximaData") as string | null) ?? null,
    publicado: d.get("publicado") !== false,
    notas: (d.get("notas") as number | null) ?? 0,
    donoNome: (d.get("donoNome") as string | null) ?? null,
    donoPapel: (d.get("donoPapel") as string | null) ?? null,
    donoWhatsapp: (d.get("donoWhatsapp") as string | null) ?? null,
    donoEmail: (d.get("donoEmail") as string | null) ?? null,
    outrosContatos: ContatosDoDoc.parse(d.get("outrosContatos")),
    motivoPerda: (d.get("motivoPerda") as MotivoPerda | null) ?? null,
    detalhePerda: (d.get("detalhePerda") as string | null) ?? null,
    origem: (d.get("origem") as Origem | null) ?? null,
    indicadoPor: (d.get("indicadoPor") as string | null) ?? null,
    entrouEm: (d.get("entrouEm") as { toDate?: () => Date } | null)?.toDate?.().toISOString() ?? null,
    perdidoEm: (d.get("perdidoEm") as { toDate?: () => Date } | null)?.toDate?.().toISOString() ?? null,
    ultimoContatoEm: (d.get("ultimoContatoEm") as { toDate?: () => Date } | null)?.toDate?.().toISOString() ?? null,
    fixadoAte: (d.get("fixadoAte") as string | null) ?? null,
    utm: (d.get("utm") as Utm | null) ?? null,
    toques: Contagem.parse(d.get("toques")),
    respondeuEm: DataDoDoc.parse(d.get("respondeuEm")),
    naoContatarEm: DataDoDoc.parse(d.get("naoContatarEm")),
    propostaVistaEm: (d.get("propostaVistaEm") as { toDate?: () => Date } | null)?.toDate?.().toISOString() ?? null,
    varianteId: VarianteDoDoc.parse(d.get("varianteId") ?? null),
    siteVistoEm: DataDoDoc.parse(d.get("siteVistoEm")),
  };
}

/** Importado que ninguém tocou: só a origem (e as notas do levantamento, cuja contagem a tela
 *  não mostra). É igual ao vazio que a tela usa para quem não tem CRM, que já conta como
 *  "novo" e "importado" — 12 mil dos 14 mil documentos, que não precisam ir ao navegador. */
export const trivial = (d: FirebaseFirestore.DocumentSnapshot) =>
  Object.keys(d.data() ?? {}).every((k) => k === "origem" || k === "notas") && (d.get("origem") ?? "importado") === "importado";

export async function lerCrm(db: Firestore, slugs?: string[]): Promise<Record<string, Crm>> {
  const docs = slugs
    ? slugs.length ? await db.getAll(...slugs.map((s) => db.collection(RAIZ).doc(s))) : []
    : (await db.collection(RAIZ).get()).docs;
  return Object.fromEntries(docs.filter((d) => d.exists && !trivial(d)).map((d) => [d.id, negocio(d)]));
}

/** Só os fechados (clientes): a carteira e a cobrança do mês, sem ler os 15 mil do CRM. */
export async function lerFechados(db: Firestore): Promise<Record<string, Crm>> {
  const q = await db.collection(RAIZ).where("estagio", "==", "fechado").get();
  return Object.fromEntries(q.docs.map((d) => [d.id, negocio(d)]));
}

/** A proposta que o próprio negócio pode tirar do ar pelo link: feita pela Ruphus (não pelo dono, no
 *  cadastro), ainda não publicada, com a Ruphus como dona, sem convite aceito e antes da negociação.
 *  Quem aceitou o convite ou está negociando é cliente em andamento: a página dele não sai por um
 *  link que qualquer um com o endereço abre. */
function removivel(tenant: FirebaseFirestore.DocumentSnapshot, crm: FirebaseFirestore.DocumentSnapshot, convidados: number, plataforma: string[]) {
  if (!tenant.exists || !tenant.get("gerado") || tenant.get("gerado.origem") === "cadastro" || tenant.get("gerado.publicadoEm")) return false;
  if (convidados > 0 || (tenant.get("ownerId") && !plataforma.includes(tenant.get("ownerId")))) return false;
  return !["negociando", "fechado"].includes(crm.get("estagio"));
}

const contasDaPlataforma = async (db: Firestore) => ((await db.doc("config/admin").get()).get("uids") as string[] | undefined) ?? [];

export async function propostaRemovivel(db: Firestore, slug: string) {
  const [tenant, crm, convidados, plataforma] = await Promise.all([
    db.doc(`tenants/${slug}`).get(),
    db.collection(RAIZ).doc(slug).get(),
    db.collection(`tenants/${slug}/members`).where("viaConvite", "==", true).limit(1).get(),
    contasDaPlataforma(db),
  ]);
  if (!removivel(tenant, crm, convidados.size, plataforma)) return null;
  return { nome: String(tenant.get("name") ?? slug), removida: crm.get("publicado") === false };
}

/** "Pedir remoção" da faixa de proposta: a página sai do ar (a lista de desativados que o proxy lê)
 *  e o CRM registra o pedido. Numa transação: o admin fechar a venda no meio não vira "perdido".
 *  Já perdido, o motivo de antes fica; o estágio anterior é guardado para desfazer. */
// O link de remoção leva uma assinatura fixa por slug, impressa na própria página: quem raspar as
// propostas consegue todas. A trava do dia limita o estrago a um punhado, que o admin desfaz.
// ponytail: teto global por dia; token aleatório por proposta se alguém bater nele de verdade
export const REMOCOES_POR_DIA = 20;

/** O teto do dia já foi: a página de remoção mostra o aviso em vez do botão. */
export async function remocoesEsgotadas(db: Firestore) {
  return ((await db.collection("limitesRemocao").doc(todayIn()).get()).get("count") ?? 0) >= REMOCOES_POR_DIA;
}

/** true: removida (ou já estava); false: não pode pelo link; "cheio": passou do teto do dia. */
export async function pedirRemocao(db: Firestore, slug: string): Promise<boolean | "cheio"> {
  const plataforma = await contasDaPlataforma(db);
  const ref = db.collection(RAIZ).doc(slug);
  const dia = todayIn();
  const cota = db.collection("limitesRemocao").doc(dia);
  return db.runTransaction(async (tx) => {
    const [tenant, crm, convidados, usadas] = await Promise.all([
      tx.get(db.doc(`tenants/${slug}`)),
      tx.get(ref),
      tx.get(db.collection(`tenants/${slug}/members`).where("viaConvite", "==", true).limit(1)),
      tx.get(cota),
    ]);
    if (!removivel(tenant, crm, convidados.size, plataforma)) return false;
    if (crm.get("publicado") === false) return true;
    if ((usadas.get("count") ?? 0) >= REMOCOES_POR_DIA) return "cheio";
    tx.set(cota, { count: FieldValue.increment(1), dia }, { merge: true });
    const antes = ((crm.get("estagio") as Crm["estagio"] | undefined) ?? "novo") as Crm["estagio"];
    const agora = FieldValue.serverTimestamp();
    tx.set(
      ref,
      {
        publicado: false,
        remocaoPedidaEm: agora,
        estagioAntesDaRemocao: antes,
        ...(antes === "perdido" ? {} : { estagio: "perdido", motivoPerda: "remocao", perdidoEm: agora }),
        atualizadoEm: agora,
      },
      { merge: true },
    );
    tx.set(ref.collection("eventos").doc(), {
      tipo: "estagio",
      titulo: antes === "perdido" ? "Página tirada do ar" : `${ROTULO[antes]} → ${ROTULO.perdido}`,
      detalhe: MOTIVOS_PERDA.remocao,
      autor: "o próprio negócio, pelo link da página",
      quando: agora,
    });
    return true;
  });
}

export async function salvarCrm(db: Firestore, slug: string, entrada: CrmInput, autor = "sistema") {
  const parsed = CrmInput.safeParse(entrada);
  if (!parsed.success) throw new CrmErro(parsed.error.issues[0].message);
  const dados = parsed.data;
  const ref = db.collection(RAIZ).doc(slug);
  // Numa transação: dois salvamentos ao mesmo tempo liam o mesmo estágio de antes e gravavam
  // a mudança duas vezes na linha do tempo; e evento sem o doc gravado ficava órfão
  await db.runTransaction(async (tx) => {
    const atual = await tx.get(ref);
    const antes = (atual.get("estagio") as Crm["estagio"] | undefined) ?? "novo";
    const mudou = dados.estagio && dados.estagio !== antes;
    // Sem o porquê, a perda não ensina nada: o motivo vem junto ou a mudança não passa
    if (mudou && dados.estagio === "perdido" && !dados.motivoPerda) throw new CrmErro("Escolha o motivo da perda.");
    // Voltando ao funil, o motivo antigo deixa de valer
    const saiuDePerdido = mudou && antes === "perdido";
    const virouFechado = dados.estagio === "fechado" && atual.get("estagio") !== "fechado";
    // fechou ou perdeu: o toque que a cadência agendou não vale mais (sem isto o perdido voltava em "Atrasados")
    const saiDaCadencia =
      mudou && (dados.estagio === "fechado" || dados.estagio === "perdido") && daCadencia(atual.get("proximaAcao")) && dados.proximaData === undefined
        ? { proximaAcao: FieldValue.delete(), proximaData: FieldValue.delete() }
        : {};
    if (mudou) {
      tx.set(ref.collection("eventos").doc(), {
        tipo: "estagio",
        titulo: `${ROTULO[antes]} → ${ROTULO[dados.estagio!]}`,
        detalhe:
          dados.estagio === "perdido"
            ? [MOTIVOS_PERDA[dados.motivoPerda!], dados.detalhePerda].filter(Boolean).join(" · ")
            : null,
        autor,
        quando: FieldValue.serverTimestamp(),
      });
    }
    tx.set(
      ref,
      {
        ...dados,
        ...saiDaCadencia,
        // a data de fechamento é gravada quando o negócio entra em "fechado" e some se sair
        ...(virouFechado ? { fechadoEm: FieldValue.serverTimestamp() } : {}),
        ...(dados.estagio && dados.estagio !== "fechado" ? { fechadoEm: FieldValue.delete() } : {}),
        ...(saiuDePerdido ? { motivoPerda: FieldValue.delete(), detalhePerda: FieldValue.delete(), perdidoEm: FieldValue.delete() } : {}),
        ...(mudou && dados.estagio === "perdido" ? { perdidoEm: FieldValue.serverTimestamp() } : {}),
        // o primeiro passo para fora de "novo" marca o começo da negociação, uma vez só
        ...(mudou && antes === "novo" && !atual.get("entrouEm") ? { entrouEm: FieldValue.serverTimestamp() } : {}),
        atualizadoEm: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });
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

/** Mensagem pronta aberta no WhatsApp: fica na linha do tempo como contato feito.
 *
 * Mensagem da cadência de prospecção, para quem ainda não respondeu, já agenda o próximo
 * toque: sem isso o lead contatado e calado sumia de todas as filas. Quem pediu para parar
 * não recebe prospecção — só cliente fechado segue recebendo (cobrança, implantação).
 *
 * Toque da cadência só com `envio` (o vendedor confirmou "Sim" ou "Editei", ou a fila confirmou o
 * POST): sem ele, CrmErro e nada é gravado. Cobrança, proposta e boas-vindas não são cadência.
 * Com `envio`, um toque da cadência vira o evento
 * `envio_confirmado` com id `slug__etapa__envioId`, criado com create(): a segunda confirmação do
 * mesmo envio acha o evento e não grava nada (nem conta o toque de novo). Devolve false nesse caso.
 * Mensagem fora da cadência confirmada no "Enviou?" (proposta, boas-vindas, implantação) tem id
 * `slug__mensagem__envioId`, com a mesma trava, e não conta toque.
 * O número do toque sai de `toques` no doc e a variante do tenant (gerado.sub), nunca do cliente;
 * texto editado não leva variante (não mede o texto da variante). Passou de TOQUES_MAX, recusa.
 * Outra aba com o mesmo lead (outro envioId, mesma etapa, menos de JANELA_ENVIO_REPETIDO_MS): recusa.
 * PARE: a cadência não sai para ninguém que pediu (cliente fechado também, e o PARE dado no número
 * de prospecção também); a proposta não sai para quem pediu (no CRM ou no número de prospecção, M-7) e não é cliente; as mensagens de cliente
 * fechado (proposta, boas-vindas, implantação, cobrança) seguem. */
/** opcoes.varianteId: a variante que a fila da prospecção (F5) escolheu (no salão, primeiro contato, a
 *  do A/B: varianteAB, a mesma que varianteDoNegocio dá aqui; fora disso, escolherVariante); sem ela, a
 *  do A/B (varianteDoNegocio), só no primeiro contato sem edição. */
export async function registrarMensagem(db: Firestore, slug: string, modelo: string, para: string, autor: string, envio?: EnvioConfirmado, agora = Date.now(), opcoes: { varianteId?: VarianteId } = {}) {
  const m = z.string().trim().min(1).max(80).parse(modelo.slice(0, 80));
  const confirmado = envio ? EnvioConfirmado.parse(envio) : null;
  const etapa = etapaDoModelo(m);
  const ref = db.doc(`${RAIZ}/${slug}`);
  const evento = confirmado ? ref.collection("eventos").doc(`${slug}__${etapa ?? "mensagem"}__${confirmado.envioId}`) : ref.collection("eventos").doc();
  // só o primeiro contato sem edição mede variante; a cadência lê o tenant pelos telefones (PARE no número de prospecção)
  const medeVariante = !!confirmado && etapa === "primeiro" && !confirmado.editado;
  // L-9: Object.hasOwn, não CADENCIA[m]: "constructor" ou "toString" vêm do protótipo e virariam cadência
  const cadencia = Object.hasOwn(CADENCIA, m);
  if (cadencia && !confirmado) throw new CrmErro("O toque da cadência só é registrado com o envio confirmado (Sim ou Editei): nada foi gravado.");
  return db.runTransaction(async (tx) => {
    const [atual, ja, tenant] = await Promise.all([tx.get(ref), tx.get(evento), medeVariante || cadencia || m === "Proposta" ? tx.get(db.doc(`tenants/${slug}`)) : null]);
    if (ja.exists) return false;
    const estagio = (atual.get("estagio") as Crm["estagio"] | undefined) ?? "novo";
    const conversas = barradoPeloPareDoAgente(m, estagio) ? await Promise.all(conversasDoNegocio(db, tenant, atual).map((c) => tx.get(c))) : [];
    const toques = z.number().int().min(0).catch(0).parse(atual.get("toques") ?? 0);
    if (cadencia && toques >= TOQUES_MAX) throw new LimiteAtingido(`Este contato já recebeu ${TOQUES_MAX} toques: o envio não foi registrado. Encerre como "não respondeu".`);
    const varianteId = confirmado && etapa && !confirmado.editado && opcoes.varianteId ? opcoes.varianteId : tenant && medeVariante ? (varianteDoNegocio(slug, tenant.get("gerado.sub"))?.id ?? null) : null;
    // F1-12: o PARE grava o opt-out da prospecção (vale até para cliente fechado); a proposta é de
    // cliente só para o fechado. E-mail de proposta e cobrança são pedidos pelo vendedor, um a um
    const parou = !!atual.get("naoContatarEm");
    if (parou && (cadencia || (m === "Proposta" && estagio !== "fechado"))) throw new CrmErro("Este contato pediu para não receber mensagens.");
    // F3-L2: o PARE dado no número de prospecção (sem slug confirmado não chega ao CRM); M-7: a proposta
    // de quem não é cliente também não sai
    if (conversas.some((c) => c.get("naoContatarEm"))) throw new CrmErro(`Este contato pediu PARE no número de prospecção: ${cadencia ? "a cadência" : "a proposta"} não sai.`);
    // F2-12: outra aba (outro envioId) confirmando a mesma etapa logo depois é o mesmo envio
    const anterior = UltimoEnvio.safeParse(atual.get("ultimoEnvio"));
    if (confirmado && etapa && anterior.success && anterior.data.etapa === etapa && anterior.data.em !== undefined && agora - anterior.data.em < JANELA_ENVIO_REPETIDO_MS) {
      throw new CrmErro("Este toque já foi registrado há menos de um minuto (outra aba?): nada foi gravado de novo.");
    }
    // o que o vendedor combinou à mão fica; a cadência só ocupa o espaço vazio ou o dela mesma
    const livre = !atual.get("proximaData") || daCadencia(atual.get("proximaAcao"));
    const passo = estagio === "novo" && !atual.get("respondeuEm") && livre && cadencia ? CADENCIA[m] : undefined;
    const base = { titulo: `Mensagem enviada: ${m}`, detalhe: para ? `para ${String(para).slice(0, 80)}` : null, autor, quando: FieldValue.serverTimestamp() };
    if (confirmado && etapa) {
      const { textoEnviado, editado } = confirmado;
      const ev = { tipo: "envio_confirmado" as const, etapa, toque: toques + 1, varianteId, textoEnviado, editado };
      EventoProspeccao.parse(ev);
      tx.create(evento, { ...base, ...ev });
      // F4: a variante pode ser só do Firestore (versão nova, rascunho aprovado): conta pelo id; nicho e
      // etapa só para as do código (o doc das outras já os tem)
      const v = varianteDoId(varianteId);
      if (varianteId) tx.set(db.doc(`${STATS}/${varianteId}`), { enviados: FieldValue.increment(1), ultimoEnvioEm: FieldValue.serverTimestamp(), ...(v && { nicho: v.nicho, etapa: v.etapa }) }, { merge: true });
    } else if (confirmado) tx.create(evento, { ...base, tipo: "mensagem", textoEnviado: confirmado.textoEnviado });
    else tx.set(evento, { ...base, tipo: "mensagem" });
    // proposta confirmada no "Enviou?" move o Novo para Oferta enviada: o vendedor não precisa marcar a etapa
    const virouOferta = m === "Proposta" && !!confirmado && estagio === "novo";
    if (virouOferta) tx.set(ref.collection("eventos").doc(), { tipo: "estagio", titulo: `${ROTULO.novo} → ${ROTULO.oferta}`, detalhe: "proposta enviada", autor, quando: FieldValue.serverTimestamp() });
    // No doc do negócio também: a lista do /admin não carrega os eventos de 600 negócios
    tx.set(
      ref,
      {
        ultimoContatoEm: FieldValue.serverTimestamp(),
        ...(virouOferta ? { estagio: "oferta" } : {}),
        ...(estagio === "novo" && !atual.get("respondeuEm") && cadencia ? { toques: FieldValue.increment(1) } : {}),
        ...(passo ? { proximaAcao: passo.proxima, proximaData: addDays(todayIn(), passo.dias) } : {}),
        // a resposta e o opt-out se ligam a este envio; a variante do primeiro contato fica no doc
        ...(confirmado && etapa ? { ultimoEnvio: { id: evento.id, varianteId, textoEnviado: confirmado.textoEnviado, etapa, em: agora } } : {}),
        // na raiz, só a do primeiro contato (é a que a resposta e o opt-out medem)
        ...(varianteId && etapa === "primeiro" ? { varianteId } : {}),
      },
      { merge: true },
    );
    return true;
  });
}

/** O que o lead fez com a prospecção: respondeu, ou pediu para parar. "liberar" desfaz o pedido. */
export async function marcarContato(db: Firestore, slug: string, oque: "respondeu" | "automatica" | "parar" | "liberar", autor: string) {
  const ref = db.doc(`${RAIZ}/${slug}`);
  const fones = await db.runTransaction(async (tx) => {
    const atual = await tx.get(ref);
    // PARE: a fila da prospecção (F5) de todos os telefones do negócio para, como no agente
    const parar = oque === "parar" ? telefonesNorm(await tx.get(db.doc(`tenants/${slug}`)), atual) : [];
    const estagio = (atual.get("estagio") as Crm["estagio"] | undefined) ?? "novo";
    const agora = FieldValue.serverTimestamp();
    // o próximo passo agendado pela cadência deixa de valer; o que o vendedor combinou fica
    const livre = !atual.get("proximaData") || daCadencia(atual.get("proximaAcao"));
    const novo = (dados: Record<string, unknown>, titulo: string, detalhe: string | null = null) => {
      tx.set(ref, { ...dados, atualizadoEm: agora }, { merge: true });
      tx.set(ref.collection("eventos").doc(), { tipo: dados.estagio ? "estagio" : "mensagem", titulo, detalhe, autor, quando: agora });
    };
    // a resposta e o opt-out ligados ao último envio confirmado (F1). A variante é sempre a da RAIZ do doc
    // (a do primeiro contato; decisão 6 da Revisão F2), nunca a do ultimoEnvio: o lembrete confirmado
    // troca o ultimoEnvio (com a variante dele, se veio da fila), e a resposta que chega depois ainda é
    // efeito do primeiro contato. É a mesma variante da tabela do funil (porVariante lê a raiz)
    const lido = UltimoEnvio.safeParse(atual.get("ultimoEnvio"));
    const envio = lido.success ? lido.data : null;
    const varianteId = VarianteDoDoc.parse(atual.get("varianteId") ?? null);
    // com envio, o evento tem id fixo (`envioId__tipo`): o segundo clique não grava nem conta de novo
    const tipoLigado = oque === "liberar" ? null : TIPO_LIGADO[oque];
    const fixo = envio && tipoLigado ? ref.collection("eventos").doc(`${envio.id}__${tipoLigado}`) : null;
    const jaLigado = fixo ? (await tx.get(fixo)).exists : false;
    // clique repetido no mesmo envio não muda nada (nem estado sem evento). Exceção: PARE depois de
    // "liberar" vale de novo, com estado e um evento sem id fixo
    if (jaLigado && !(oque === "parar" && !atual.get("naoContatarEm"))) return parar;
    const ligado = (tipo: "resposta_humana" | "resposta_automatica" | "optout", titulo: string, detalhe: string | null = null) => {
      const dados = { tipo, titulo, detalhe, autor, quando: agora, envioId: envio?.id ?? null, varianteId, textoEnviado: envio?.textoEnviado ?? null };
      EventoProspeccao.parse(dados);
      if (!fixo || jaLigado) return void tx.set(ref.collection("eventos").doc(), dados);
      tx.create(fixo, dados);
      // a variante conta cada tipo uma vez por lead: a resposta ao primeiro contato e a ao lembrete não somam duas
      // o id vem do doc: só na forma de slug vira caminho no Firestore
      if (!varianteId || !paraVarianteId(varianteId) || atual.get(`contadoNaVariante.${tipo}`) === true) return;
      tx.set(db.doc(`${STATS}/${varianteId}`), { [CAMPO_STATS[tipo]]: FieldValue.increment(1) }, { merge: true });
      tx.set(ref, { contadoNaVariante: { [tipo]: true } }, { merge: true });
    };
    // Respondeu (gente, não a saudação automática): a cadência para, e o próximo passo é falar com
    // ele hoje — sem isto o melhor lead ficava sem data e sem alerta. Conta como contato: o alerta
    // da proposta vista se resolve
    if (oque === "respondeu") {
      tx.set(ref, { respondeuEm: agora, ultimoContatoEm: agora, ...(livre ? { proximaAcao: DEPOIS_DA_RESPOSTA, proximaData: todayIn() } : {}), atualizadoEm: agora }, { merge: true });
      return ligado("resposta_humana", "Respondeu");
    }
    // a saudação do WhatsApp Business não é resposta: a cadência segue, só fica registrada
    if (oque === "automatica") return ligado("resposta_automatica", "Resposta automática");
    if (oque === "liberar") {
      // perdido pelo próprio "pediu para parar": desfazer devolve ao funil
      const pelaParada = estagio === "perdido" && atual.get("detalhePerda") === DETALHE_PAROU;
      return novo(
        {
          naoContatarEm: FieldValue.delete(),
          ...(pelaParada ? { estagio: "novo", motivoPerda: FieldValue.delete(), detalhePerda: FieldValue.delete(), perdidoEm: FieldValue.delete() } : {}),
        },
        pelaParada ? `${ROTULO.perdido} → ${ROTULO.novo}` : "Pode receber mensagens de novo",
        pelaParada ? "Pode receber mensagens de novo" : null,
      );
    }
    // Pediu para parar: sai do funil como perdido, e nenhuma fila volta a mostrá-lo. Um evento só
    // (o optout ligado ao envio), com a mudança de estágio no detalhe
    const sai = estagio !== "fechado" && estagio !== "perdido";
    tx.set(
      ref,
      {
        naoContatarEm: agora,
        proximaAcao: FieldValue.delete(),
        proximaData: FieldValue.delete(),
        ...(sai ? { estagio: "perdido", motivoPerda: "sem_interesse", detalhePerda: DETALHE_PAROU, perdidoEm: agora, fechadoEm: FieldValue.delete() } : {}),
        atualizadoEm: agora,
      },
      { merge: true },
    );
    ligado("optout", "Respondeu PARE", sai ? `${ROTULO[estagio]} → ${ROTULO.perdido} · ${MOTIVOS_PERDA.sem_interesse}` : DETALHE_PAROU);
    return parar;
  });
  for (const telefone of fones ?? []) await cancelarPendentes(db, { telefone }, "optout");
}

/** O que a Ruphus já mandou ao lead, do mais antigo ao mais novo: os envios confirmados recentes (da
 *  cadência e, fora dela, proposta e boas-vindas confirmadas: tipo "mensagem" com textoEnviado) e o
 *  ultimoEnvio do doc. É o histórico do copiloto, montado aqui e nunca aceito da tela. Só orderBy:
 *  o filtro por tipo fica em memória para não pedir índice composto. */
export async function historicoDoCopiloto(db: Firestore, slug: string, max = 10): Promise<{ de: "ruphus"; texto: string }[]> {
  const ref = db.collection(RAIZ).doc(slug);
  const [doc, eventos] = await Promise.all([ref.get(), ref.collection("eventos").orderBy("quando", "desc").limit(50).get()]);
  const envios = eventos.docs.filter((d) => (d.get("tipo") === "envio_confirmado" || d.get("tipo") === "mensagem") && typeof d.get("textoEnviado") === "string").map((d) => ({ id: d.id, texto: String(d.get("textoEnviado")) }));
  const ultimo = UltimoEnvio.safeParse(doc.get("ultimoEnvio"));
  if (ultimo.success && !envios.some((e) => e.id === ultimo.data.id)) envios.unshift({ id: ultimo.data.id, texto: ultimo.data.textoEnviado });
  return envios.slice(0, max).reverse().map((e) => ({ de: "ruphus" as const, texto: e.texto }));
}

/** O dono abriu o link da proposta: a primeira vez vira evento, e é o melhor momento para falar. */
export async function registrarVistaDaProposta(db: Firestore, slug: string) {
  const ref = db.doc(`${RAIZ}/${slug}`);
  await db.runTransaction(async (tx) => {
    const atual = await tx.get(ref);
    if (atual.get("propostaVistaEm")) return;
    const agora = FieldValue.serverTimestamp();
    tx.set(ref, { propostaVistaEm: agora }, { merge: true });
    tx.set(ref.collection("eventos").doc(), { tipo: "mensagem", titulo: "Abriu a proposta", detalhe: null, autor: "o dono, pelo link", quando: agora });
  });
}

/** Visita real ao site demo (beacon, já sem prévia de link e dentro do limite da rota). Só conta
 *  site feito pela Ruphus de quem ainda não é cliente: a primeira grava `siteVistoEm` (a visita
 *  ao site % do funil por variante) e cada uma vira evento. false: não contou. */
export async function registrarVisita(db: Firestore, slug: string) {
  const ref = db.doc(`${RAIZ}/${slug}`);
  return db.runTransaction(async (tx) => {
    const [tenant, atual] = await Promise.all([tx.get(db.doc(`tenants/${slug}`)), tx.get(ref)]);
    if (!tenant.exists || !tenant.get("gerado") || atual.get("estagio") === "fechado") return false;
    const agora = FieldValue.serverTimestamp();
    if (!atual.get("siteVistoEm")) tx.set(ref, { siteVistoEm: agora }, { merge: true });
    tx.set(ref.collection("eventos").doc(), { tipo: "site_visto", titulo: "Abriu o site", detalhe: null, autor: "o visitante, pelo site", quando: agora });
    return true;
  });
}

const iso = (v: unknown) => (v as { toDate?: () => Date } | null)?.toDate?.().toISOString() ?? null;

/** Tudo o que aconteceu com o negócio, do mais novo ao mais antigo.
 *
 * Notas, estágio e mensagens são gravados aqui no CRM. Convite aceito, primeiro
 * agendamento e cobranças são lidos de onde já moram — por isso a linha do tempo
 * nasce com o histórico, sem esperar que alguém volte a fazer as coisas. */
export async function linhaDoTempo(db: Firestore, slug: string): Promise<Evento[]> {
  const t = db.collection("tenants").doc(slug);
  const [notas, eventos, membros, primeiro, cobrancas, admins] = await Promise.all([
    db.collection(`${RAIZ}/${slug}/notas`).orderBy("quando", "desc").limit(100).get(),
    db.collection(`${RAIZ}/${slug}/eventos`).orderBy("quando", "desc").limit(100).get(),
    t.collection("members").where("role", "in", ["admin", "owner"]).get(),
    t.collection("appointments").orderBy("createdAt").limit(1).get(),
    db.collection("cobrancas").where("slug", "==", slug).get(),
    db.doc("config/admin").get(),
  ]);
  // o admin da plataforma é dono dos sites importados: a entrada dele não é do cliente
  const daPlataforma = new Set((admins.get("uids") as string[] | undefined) ?? []);
  const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  // notas, estágio e mensagens só nascem no /admin: quem fez é a Ruphus. O gravado é o e-mail
  // da conta (admin@…, um login, não uma caixa), e solto embaixo de "para a recepção" lia
  // como destinatário
  const PELA_RUPHUS = "por Ruphus";
  const lista: Evento[] = [
    ...notas.docs.map((d) => ({ id: d.id, tipo: "nota" as const, titulo: "Nota", detalhe: String(d.get("texto") ?? ""), autor: PELA_RUPHUS, quando: iso(d.get("quando")) ?? "" })),
    ...eventos.docs.map((d) => ({
      id: d.id,
      tipo: tipoNaTela(d.get("tipo")),
      titulo: String(d.get("titulo") ?? ""),
      detalhe: (d.get("detalhe") as string | null) ?? null,
      // o que o próprio negócio fez pelo link (abriu a proposta, pediu remoção) diz quem foi
      autor: String(d.get("autor") ?? "").startsWith("o ") ? String(d.get("autor")) : PELA_RUPHUS,
      quando: iso(d.get("quando")) ?? "",
    })),
    ...membros.docs.flatMap((d) => {
      const quando = iso(d.get("createdAt"));
      if (daPlataforma.has(d.id)) return [];
      const quem = (d.get("nome") as string | undefined) ?? (d.get("email") as string | undefined) ?? "o dono";
      // dono pelo convite (site da fábrica que o cliente assumiu) não criou o negócio
      const criou = d.get("role") === "owner" && d.get("viaConvite") !== true;
      return quando ? [{ id: `convite-${d.id}`, tipo: "convite" as const, titulo: criou ? "Negócio criado" : "Convite aceito", detalhe: criou ? `${quem} criou o negócio pelo painel` : `${quem} entrou no painel`, autor: (d.get("email") as string | undefined) ?? "", quando }] : [];
    }),
    ...primeiro.docs.flatMap((d) => {
      const quando = iso(d.get("createdAt"));
      const inicio = (d.get("start") as { toDate?: () => Date } | null)?.toDate?.();
      const dia = inicio?.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      return quando ? [{ id: `agenda-${d.id}`, tipo: "agendamento" as const, titulo: "Primeiro agendamento", detalhe: [d.get("serviceName"), dia].filter(Boolean).join(" · "), autor: "pelo site", quando }] : [];
    }),
    ...cobrancas.docs.flatMap((d) => {
      const oque = d.get("tipo") === "entrada" ? "Taxa de ativação" : d.get("tipo") === "recarga" ? "Recarga de mensagens" : `Mensalidade ${String(d.get("competencia") ?? "")}`.trim();
      const valor = brl(Number(d.get("valorCents") ?? 0));
      const out: Evento[] = [];
      const criada = iso(d.get("criadaEm"));
      if (criada) out.push({ id: `cobr-${d.id}`, tipo: "cobranca", titulo: "Cobrança gerada", detalhe: `${oque} · ${valor}`, autor: "", quando: criada });
      const pago = d.get("pagoEm") as string | null;
      if (pago) out.push({ id: `pago-${d.id}`, tipo: "pagamento", titulo: "Pagamento recebido", detalhe: `${oque} · ${brl(Number(d.get("recebidoCents") ?? d.get("valorCents") ?? 0))}`, autor: String(d.get("baixaPor") ?? ""), quando: `${pago}T12:00:00.000Z` });
      return out;
    }),
  ];
  return lista.filter((e) => e.quando).sort((a, b) => b.quando.localeCompare(a.quando)).slice(0, 150);
}

/** Os slugs fora do ar, que o proxy consulta para fechar site, agendamento e minisite. */
export async function desativados(db: Firestore) {
  const snap = await db.collection(RAIZ).where("publicado", "==", false).select().get();
  return snap.docs.map((d) => d.id);
}
