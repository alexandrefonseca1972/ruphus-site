import "server-only";
import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { unstable_cache } from "next/cache";
import { z } from "zod";
import { adminDb } from "@/lib/admin";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { EMBUTIDOS } from "@/lib/modelos/embutidos";
import { loteDevolveria } from "@/lib/modelos/lote.server";
import { type Catalogo, type EntradaCatalogo, ehClienteAtivo } from "@/lib/modelos/resolver";
import { CONFIG_VAZIA, ConfigModelos, DefModelo, DefModeloLida, RefModelo } from "@/lib/modelos/tipos";

// Persistência do Estúdio (docs/plano-estudio-modelos.md, D3):
// - modelos/{id} = { publicado, versao, rascunho?, embutido, atualizadoEm };
// - modelos/{id}/versoes/{n} = { n, def, publicadoEm, por?, nota? }: foto imutável de cada versão;
// - config/modelos = ConfigModelos.
// Os embutidos não vão para o banco de saída: valem como versão 1 até o admin mexer neles. O doc
// nasce na primeira mudança, já com versoes/1 = embutido, para o histórico e o restaurar.
// Invalidar o cache (revalidateTag(TAG_MODELOS, { expire: 0 })) é da Server Action (F5): estas
// funções rodam também em script e teste, fora de requisição.

export const TAG_MODELOS = "modelos";
const LOTE = 400;
const DOC_CONFIG = "config/modelos";

const EMBUTIDO = new Map(EMBUTIDOS.map((m) => [m.id, m]));
const refModelo = (id: string) => adminDb.collection("modelos").doc(id);
const refVersao = (id: string, n: number) => refModelo(id).collection("versoes").doc(String(n));

export type Leitura = { catalogo: Catalogo; rascunhos: Record<string, DefModelo> };
type LeituraCrua = { entradas: [string, EntradaCatalogo][]; rascunhos: Record<string, DefModelo> };

/** Doc do banco lido sem confiar. Se o código mudou (fonte ou ramo que saiu da lista), a leitura
 *  tolerante mantém o modelo no catálogo, com log, para quem o usa não cair no sorteio; só o que
 *  nem assim passa (dado quebrado) sai do catálogo, também com log, em vez de derrubar o site. */
function valido(id: string, bruto: unknown): DefModelo | null {
  const r = DefModelo.safeParse(bruto);
  if (r.success) return r.data;
  const t = DefModeloLida.safeParse(bruto);
  console.error(`[modelos] ${id} fora do esquema atual; ${t.success ? "lido no modo tolerante" : "fica de fora"}`, z.prettifyError(r.error));
  return t.success ? (t.data as DefModelo) : null;
}

/** Negócios com convite aceito (membro com viaConvite, sinal de cliente em ehClienteAtivo): uma
 *  consulta para o lote inteiro, em vez de uma por negócio. */
export async function comConvite(db: Firestore = adminDb) {
  const q = await db.collectionGroup("members").where("viaConvite", "==", true).select().get();
  return new Set(q.docs.filter((d) => d.ref.parent.parent?.parent.id === "tenants").map((d) => d.ref.parent.parent!.id));
}

async function lerCru(): Promise<LeituraCrua> {
  const docs = (await adminDb.collection("modelos").get()).docs;
  const porId = new Map<string, EntradaCatalogo>(EMBUTIDOS.map((m) => [m.id, { publicado: m, versao: 1, versoes: { 1: m } }]));
  const rascunhos: Record<string, DefModelo> = {};
  // ponytail: uma leitura de versoes por modelo mexido; com centenas de modelos, guardar só as congeladas
  await Promise.all(docs.map(async (d) => {
    const publicado = valido(d.id, d.get("publicado"));
    if (!publicado) return;
    const versoes: Record<number, DefModelo> = {};
    for (const v of (await d.ref.collection("versoes").get()).docs) {
      const def = valido(`${d.id}@${v.id}`, v.get("def"));
      if (def) versoes[v.get("n")] = def;
    }
    porId.set(d.id, { publicado, versao: d.get("versao"), versoes });
    const rascunho = d.get("rascunho") ? valido(`${d.id} (rascunho)`, d.get("rascunho")) : null;
    if (rascunho) rascunhos[d.id] = rascunho;
  }));
  return { entradas: [...porId], rascunhos };
}

const comoLeitura = (c: LeituraCrua): Leitura => ({ catalogo: new Map(c.entradas), rascunhos: c.rascunhos });

/** Sem cache: scripts e testes (unstable_cache exige requisição). */
export const lerCatalogoDireto = async () => comoLeitura(await lerCru());

// o cache guarda JSON: Map não sobrevive, por isso a forma crua
const lerCruCache = unstable_cache(lerCru, ["catalogo-modelos"], { tags: [TAG_MODELOS], revalidate: 3600 });
/** Com cache (D7): render do site e da bio. */
export const lerCatalogo = async () => comoLeitura(await lerCruCache());

/** config/modelos validada; ausente, ilegível ou inválida vira CONFIG_VAZIA (todo ramo no caminho de hoje). */
export async function lerConfig(): Promise<ConfigModelos> {
  try {
    const r = ConfigModelos.safeParse((await adminDb.doc(DOC_CONFIG).get()).data() ?? {});
    if (r.success) return r.data;
    console.error("[modelos] config/modelos inválida; sigo sem padrões", z.prettifyError(r.error));
  } catch (e) {
    console.error("[modelos] não li config/modelos; sigo sem padrões", e);
  }
  return CONFIG_VAZIA;
}
export const lerConfigCache = unstable_cache(lerConfig, ["config-modelos"], { tags: [TAG_MODELOS], revalidate: 3600 });

type Atual = { publicado: DefModelo; versao: number; rascunho: DefModelo | null; novo: boolean };

/** Lê o modelo na transação; embutido sem doc vem como versão 1, ainda por gravar (`novo`). */
async function atualNaTx(tx: Transaction, id: string): Promise<Atual> {
  const d = await tx.get(refModelo(id));
  if (d.exists) return { publicado: d.get("publicado"), versao: d.get("versao"), rascunho: d.get("rascunho") ?? null, novo: false };
  const embutido = EMBUTIDO.get(id);
  if (!embutido) throw new ErroPrevisto(`Modelo ${id} não existe.`);
  return { publicado: embutido, versao: 1, rascunho: null, novo: true };
}

/** Primeira gravação de um embutido: o doc e a foto da versão 1. */
function nascerEmbutido(tx: Transaction, id: string, a: Atual) {
  tx.set(refModelo(id), { publicado: a.publicado, versao: 1, embutido: true, atualizadoEm: FieldValue.serverTimestamp() });
  tx.create(refVersao(id, 1), { n: 1, def: a.publicado, publicadoEm: FieldValue.serverTimestamp(), nota: "embutido" });
}

/** Nova versão na mesma transação que leu a atual: duas gravações juntas viram n+1 e n+2. */
function gravarVersao(tx: Transaction, id: string, a: Atual, def: DefModelo, extra: { por?: string; nota?: string; rascunho: DefModelo | null }) {
  if (a.novo) nascerEmbutido(tx, id, a);
  const n = a.versao + 1;
  tx.set(refModelo(id), {
    publicado: def, versao: n, embutido: EMBUTIDO.has(id), atualizadoEm: FieldValue.serverTimestamp(),
    ...(extra.rascunho ? { rascunho: extra.rascunho } : {}),
  });
  tx.create(refVersao(id, n), { n, def, publicadoEm: FieldValue.serverTimestamp(), ...(extra.por ? { por: extra.por } : {}), ...(extra.nota ? { nota: extra.nota } : {}) });
  return n;
}

/** Quantos negócios apontam para o modelo (ref ou, no site, a escolha da gaveta antiga). */
async function usos(id: string, tipo: DefModelo["tipo"]) {
  const t = adminDb.collection("tenants");
  const conta = async (q: FirebaseFirestore.Query) => (await q.count().get()).data().count;
  const [refs, escolhas] = await Promise.all([
    conta(t.where(`gerado.${tipo === "site" ? "modelo" : "bio"}.id`, "==", id)),
    tipo === "site" ? conta(t.where("gerado.escolha.modelo", "==", id)) : 0,
  ]);
  return refs + escolhas;
}

export async function salvarRascunho(id: string, def: unknown) {
  const r = DefModelo.parse(def);
  if (r.id !== id) throw new ErroPrevisto("O id do modelo não bate.");
  await adminDb.runTransaction(async (tx) => {
    const a = await atualNaTx(tx, id);
    // trocar o tipo quebraria quem aponta para o modelo em gerado.modelo / gerado.bio
    if (r.tipo !== a.publicado.tipo) throw new ErroPrevisto("Não dá para trocar o tipo do modelo.");
    // editorial ↔ claro: o site ignora def de outra família, então quem usa cairia no sorteio
    if (r.tipo === "site" && r.layout !== a.publicado.layout) throw new ErroPrevisto("Não dá para trocar o layout de um modelo de site (editorial ↔ claro).");
    // o ramo decide em que lista o modelo aparece e que família de layout ele serve: com alguém
    // usando, mudar o ramo deixaria esses negócios num modelo de outro ramo
    if (r.sub !== a.publicado.sub && (await usos(id, r.tipo)) > 0) throw new ErroPrevisto("Não dá para trocar o ramo: há negócios usando este modelo. Duplique e troque na cópia.");
    if (a.novo) nascerEmbutido(tx, id, a);
    tx.set(refModelo(id), { rascunho: r, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
  });
}

export async function descartar(ids: string[]) {
  const docs = ids.length ? await adminDb.getAll(...ids.map(refModelo)) : [];
  const lote = adminDb.batch();
  for (const d of docs) if (d.exists) lote.update(d.ref, { rascunho: FieldValue.delete(), atualizadoEm: FieldValue.serverTimestamp() });
  await lote.commit();
}

/** Clientes que seguem a publicada (versao null, ou no site só a escolha da gaveta antiga,
 *  gerado.escolha.modelo sem gerado.modelo) passam a fixar a versão `v`; conta os dois grupos. */
async function congelarClientes(id: string, tipo: DefModelo["tipo"], v: number) {
  const campo = tipo === "site" ? "modelo" : "bio";
  const t = adminDb.collection("tenants");
  const [refs, escolhas] = await Promise.all([
    t.where(`gerado.${campo}.id`, "==", id).where(`gerado.${campo}.versao`, "==", null).get(),
    tipo === "site" ? t.where("gerado.escolha.modelo", "==", id).get() : null,
  ]);
  // quem tem gerado.modelo segue a ref, não a escolha
  const docs = [...refs.docs, ...(escolhas?.docs.filter((d) => !RefModelo.safeParse(d.get("gerado.modelo")).success) ?? [])];
  const convites = docs.length ? await comConvite() : new Set<string>();
  let clientes = 0;
  for (let i = 0; i < docs.length; i += LOTE) {
    const parte = docs.slice(i, i + LOTE);
    const crm = await adminDb.getAll(...parte.map((d) => adminDb.doc(`crm/${d.id}`)));
    const daParte = parte.filter((d, j) => ehClienteAtivo(d.get("gerado") ?? {}, crm[j].get("estagio"), convites.has(d.id)));
    const lote = adminDb.batch();
    for (const d of daParte) lote.update(d.ref, { [`gerado.${campo}`]: { id, versao: v } });
    await lote.commit();
    clientes += daParte.length;
  }
  return { clientes, prospeccao: docs.length - clientes };
}

/** Publica o rascunho de cada id. Antes, congela os clientes na versão de agora (regra fixa:
 *  cliente nunca muda sozinho). ponytail: o congelamento fica fora da transação (pode passar de
 *  500 gravações); um negócio que vire cliente no meio da publicação escapa, e a F7 o pega. */
export async function publicar(ids: string[], por?: string) {
  const feito: Record<string, { versao: number; prospeccao: number; clientes: number }> = {};
  // todos com rascunho antes de publicar qualquer um: senão metade ia ao ar e o resto não
  const docs = ids.length ? await adminDb.getAll(...ids.map(refModelo)) : [];
  const sem = ids.filter((_, i) => !docs[i].get("rascunho"));
  if (sem.length) throw new ErroPrevisto(`Sem rascunho para publicar: ${sem.join(", ")}. Nada foi publicado.`);
  for (const id of ids) {
    const d = await refModelo(id).get();
    if (!d.get("rascunho")) throw new ErroPrevisto(`Modelo ${id} não tem rascunho para publicar.`);
    const contagem = await congelarClientes(id, d.get("publicado.tipo"), d.get("versao"));
    const versao = await adminDb.runTransaction(async (tx) => {
      const a = await atualNaTx(tx, id);
      if (!a.rascunho) throw new ErroPrevisto(`Modelo ${id} não tem rascunho para publicar.`);
      return gravarVersao(tx, id, a, a.rascunho, { por, rascunho: null });
    });
    feito[id] = { versao, ...contagem };
  }
  return feito;
}

/** Liga ou desliga na hora (sem rascunho): só tira o modelo das listas, quem já usa não muda. Vira
 *  versão nova com nota, e o rascunho aberto acompanha, para publicar depois não desfazer. */
export async function ligar(id: string, ativo: boolean, por?: string) {
  return adminDb.runTransaction(async (tx) => {
    const a = await atualNaTx(tx, id);
    const rascunho = a.rascunho ? { ...a.rascunho, ativo } : null;
    return gravarVersao(tx, id, a, { ...a.publicado, ativo }, { por, nota: ativo ? "ligado" : "desligado", rascunho });
  });
}

/** Combinação nova: nasce publicada e desligada (versão 1), fora das listas até o admin ligar.
 *  Assim não precisa de um estado "só rascunho" que o catálogo e o resolver não conhecem. */
export async function criar(def: unknown, por?: string) {
  const m = { ...DefModelo.parse(def), ativo: false };
  if (EMBUTIDO.has(m.id)) throw new ErroPrevisto(`O id ${m.id} já é de um modelo embutido.`);
  const lote = adminDb.batch();
  lote.create(refModelo(m.id), { publicado: m, versao: 1, embutido: false, atualizadoEm: FieldValue.serverTimestamp() });
  lote.create(refVersao(m.id, 1), { n: 1, def: m, publicadoEm: FieldValue.serverTimestamp(), nota: "criado", ...(por ? { por } : {}) });
  await lote.commit().catch((e) => {
    throw e?.code === 6 ? new ErroPrevisto(`O id ${m.id} já existe.`) : e; // 6 = ALREADY_EXISTS
  });
  return m.id;
}

/** Cópia do rascunho (ou da publicada) com outro nome, como combinação nova desligada. */
export async function duplicar(id: string, nome: string, por?: string) {
  const { catalogo, rascunhos } = await lerCatalogoDireto();
  const base = rascunhos[id] ?? catalogo.get(id)?.publicado;
  if (!base) throw new ErroPrevisto(`Modelo ${id} não existe.`);
  const sufixo = Date.now().toString(36);
  // a base é cortada para o id caber em 60 (o Estúdio aceita até 80; cópia de cópia crescia sem fim)
  return criar({ ...base, id: `${id.slice(0, 59 - sufixo.length).replace(/-+$/, "")}-${sufixo}`, nome }, por);
}

export async function definirPadrao(tipo: DefModelo["tipo"], sub: string, id: string | null) {
  DefModelo.shape.sub.parse(sub);
  if (id) {
    const m = (await lerCatalogoDireto()).catalogo.get(id)?.publicado;
    if (!m || m.tipo !== tipo) throw new ErroPrevisto(`Modelo ${id} não é de ${tipo}.`);
  }
  await adminDb.doc(DOC_CONFIG).set(
    { padroes: { [tipo]: { [sub]: id ?? FieldValue.delete() } }, atualizadoEm: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

/** Apaga um modelo criado no Estúdio que ninguém usa: some o doc e o histórico (versoes).
 *  Embutido, modelo ligado, com negócio apontando (ref, bio ou escolha da gaveta), padrão de algum
 *  ramo ou que um lote ainda desfazível devolveria a alguém não se apaga. ponytail: conferir e
 *  apagar fora de transação; um negócio que aponte para ele no meio cai no legado (sorteio), como
 *  um id que saiu do catálogo. */
export async function apagar(id: string) {
  if (EMBUTIDO.has(id)) throw new ErroPrevisto("Modelo embutido não se apaga; desligue-o.");
  const d = await refModelo(id).get();
  if (!d.exists) throw new ErroPrevisto(`Modelo ${id} não existe.`);
  if (d.get("embutido")) throw new ErroPrevisto("Modelo embutido não se apaga; desligue-o.");
  if (d.get("publicado.ativo") !== false) throw new ErroPrevisto("Desligue o modelo antes de apagar.");
  const t = adminDb.collection("tenants");
  const conta = async (q: FirebaseFirestore.Query) => (await q.count().get()).data().count;
  // os três campos, sem olhar o tipo: id de outro tipo também é uma referência
  const emUso = await Promise.all([t.where("gerado.modelo.id", "==", id), t.where("gerado.bio.id", "==", id), t.where("gerado.escolha.modelo", "==", id)].map(conta));
  if (emUso.some((x) => x > 0)) throw new ErroPrevisto("Não dá para apagar: há negócios usando este modelo. Desligue-o.");
  // config crua, sem o lerConfig (que vira vazia ao falhar): erro de leitura recusa, e vale qualquer chave
  const padroes = ((await adminDb.doc(DOC_CONFIG).get()).get("padroes") ?? {}) as Record<string, Record<string, unknown> | undefined>;
  if ([...Object.values(padroes.site ?? {}), ...Object.values(padroes.bio ?? {})].includes(id))
    throw new ErroPrevisto("Não dá para apagar o padrão de um ramo. Troque o padrão antes.");
  if (await loteDevolveria(id)) throw new ErroPrevisto("Não dá para apagar: um lote dos últimos 7 dias devolveria negócios a este modelo ao ser desfeito.");
  // o histórico antes e o doc por último: se cair no meio, o doc segue lá e apagar de novo termina
  await adminDb.recursiveDelete(refModelo(id).collection("versoes"));
  await refModelo(id).delete();
}

export type ItemHistorico = { n: number; def: DefModelo; publicadoEm: Date | null; por?: string; nota?: string };

/** Versões da mais nova para a mais velha, a atual e o rascunho aberto. */
export async function historico(id: string): Promise<{ versao: number; rascunho: DefModelo | null; versoes: ItemHistorico[] }> {
  const d = await refModelo(id).get();
  if (!d.exists) {
    const embutido = EMBUTIDO.get(id);
    if (!embutido) throw new ErroPrevisto(`Modelo ${id} não existe.`);
    return { versao: 1, rascunho: null, versoes: [{ n: 1, def: embutido, publicadoEm: null, nota: "embutido" }] };
  }
  const snap = await d.ref.collection("versoes").orderBy("n", "desc").get();
  const versoes = snap.docs.map((v) => ({
    n: v.get("n"), def: v.get("def"), publicadoEm: v.get("publicadoEm")?.toDate() ?? null,
    ...(v.get("por") ? { por: v.get("por") } : {}), ...(v.get("nota") ? { nota: v.get("nota") } : {}),
  }));
  return { versao: d.get("versao"), rascunho: d.get("rascunho") ?? null, versoes };
}

/** Copia a versão n para o rascunho; publicar continua sendo um passo à parte. */
export async function restaurar(id: string, n: number) {
  const v = await refVersao(id, n).get();
  const def = v.exists ? v.get("def") : n === 1 ? EMBUTIDO.get(id) : undefined;
  if (!def) throw new ErroPrevisto(`Modelo ${id} não tem a versão ${n}.`);
  // ligado/desligado é da publicada (ligar vale na hora): restaurar não religa nem desliga
  const atual = await refModelo(id).get();
  const ativo = atual.exists ? atual.get("publicado.ativo") : EMBUTIDO.get(id)?.ativo;
  await salvarRascunho(id, { ...def, ativo: ativo ?? def.ativo });
}
