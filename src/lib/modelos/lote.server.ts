import "server-only";
import { type DocumentSnapshot, FieldValue, type Query, type Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { adminDb } from "@/lib/admin";
import { ESTAGIOS } from "@/lib/crm-tipos";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { type Sub, SUBS } from "@/lib/gerador";
import { comConvite, lerCatalogoDireto } from "@/lib/modelos/repo.server";
import { ehClienteAtivo } from "@/lib/modelos/resolver";
import type { RefModelo } from "@/lib/modelos/tipos";
import { ehClaro } from "@/lib/site-claro";

// Aplicar um modelo em lote (docs/plano-estudio-modelos.md, F5.2) e desfazer por 7 dias.
// lotes/{id} = { modelo, tipo, filtros, antes?: [{slug, anterior, cliente}], partes?, prospeccao, clientes,
// feitoEm, por, desfeitoEm? }. Com mais de PARTE negócios, `antes` vai em lotes/{id}/partes/{n}
// (o doc do Firestore tem teto de 1 MB). O registro é gravado ANTES dos negócios: se o lote cair no
// meio, desfazer devolve o que mudou (quem não chegou a mudar não aponta para o modelo e fica quieto).

const LOTE = 400;
const PARTE = 2000;
const DIAS_DESFAZER = 7;

const SUB_IDS = Object.keys(SUBS) as [Sub, ...Sub[]];
export const FiltrosLote = z.object({
  tipo: z.enum(["site", "bio"]),
  modeloId: z.string().regex(/^[a-z0-9-]{1,80}$/),
  sub: z.enum(SUB_IDS).optional(),
  uf: z.string().regex(/^[A-Z]{2}$/).optional(),
  cidade: z.string().trim().min(1).max(80).optional(),
  estagio: z.enum(ESTAGIOS).optional(),
  soSemEscolhaManual: z.boolean().optional(),
}).strict();
export type FiltrosLote = z.infer<typeof FiltrosLote>;

type Alvo = { slug: string; cliente: boolean; anterior: RefModelo | null };
export type Contagem = { prospeccao: number; clientes: number; comEscolhaManual: number; total: number };

const campoDe = (tipo: FiltrosLote["tipo"]) => (tipo === "site" ? "modelo" : "bio");

/** O modelo do lote no catálogo: tem de existir, ser do tipo e estar ligado. */
async function modeloDoLote(f: FiltrosLote) {
  const e = (await lerCatalogoDireto()).catalogo.get(f.modeloId);
  if (!e || e.publicado.tipo !== f.tipo) throw new ErroPrevisto(`Modelo ${f.modeloId} não é de ${f.tipo}.`);
  if (!e.publicado.ativo) throw new ErroPrevisto("Ligue o modelo antes de aplicar em lote.");
  return e;
}

/** Negócios que os filtros pegam. ponytail: sem ramo nem cidade lê todos os tenants (uma leitura
 *  cada, só os campos do modelo); se a base passar de dezenas de milhares, contar por agregação. */
async function alvos(f: FiltrosLote, layout: string) {
  let q: Query = adminDb.collection("tenants");
  if (f.sub) q = q.where("gerado.sub", "==", f.sub);
  if (f.cidade) q = q.where("site.city", "==", f.cidade);
  if (f.uf) q = q.where("site.uf", "==", f.uf);
  const campo = campoDe(f.tipo);
  const [snap, convites] = await Promise.all([
    q.select("gerado.sub", "gerado.origem", "gerado.publicadoEm", `gerado.${campo}`, "gerado.escolha.modelo").get(),
    comConvite(),
  ]);
  // site: só o ramo da mesma família de layout (o lerSite ignora editorial num ramo claro e vice-versa)
  const docs = snap.docs.filter((d) => {
    const sub = d.get("gerado.sub") as Sub | undefined;
    return sub && sub in SUBS && (f.tipo === "bio" || (ehClaro(sub) ? "claro" : "editorial") === layout);
  });
  const todos: (Alvo & { manual: boolean })[] = [];
  for (let i = 0; i < docs.length; i += LOTE) {
    const parte = docs.slice(i, i + LOTE);
    const crm = await adminDb.getAll(...parte.map((d) => adminDb.doc(`crm/${d.id}`)));
    parte.forEach((d, j) => {
      const estagio = (crm[j].get("estagio") as string | undefined) ?? "novo";
      if (f.estagio && estagio !== f.estagio) return;
      const anterior = (d.get(`gerado.${campo}`) as RefModelo | undefined) ?? null;
      todos.push({
        slug: d.id,
        cliente: ehClienteAtivo({ origem: d.get("gerado.origem"), publicadoEm: d.get("gerado.publicadoEm") }, estagio, convites.has(d.id)),
        anterior,
        manual: !!anterior || !!d.get("gerado.escolha.modelo"),
      });
    });
  }
  const comEscolhaManual = todos.filter((a) => a.manual).length;
  const lista: Alvo[] = (f.soSemEscolhaManual ? todos.filter((a) => !a.manual) : todos).map(({ manual: _m, ...a }) => a);
  return { lista, comEscolhaManual };
}

/** Quantos o lote pegaria. `comEscolhaManual` conta antes do filtro "só sem escolha manual";
 *  prospeccao + clientes = total, já com esse filtro. */
export async function contarLote(filtros: unknown): Promise<Contagem> {
  const f = FiltrosLote.parse(filtros);
  const m = await modeloDoLote(f);
  const { lista, comEscolhaManual } = await alvos(f, m.publicado.layout);
  const clientes = lista.filter((a) => a.cliente).length;
  return { prospeccao: lista.length - clientes, clientes, comEscolhaManual, total: lista.length };
}

/** Aponta os negócios para o modelo: prospecção segue a publicada (versao null); cliente, só com
 *  incluirClientes E confirmouClientes === true, fica congelado na versão de agora. */
export async function aplicarLote(filtros: unknown, opcoes: { incluirClientes?: boolean; confirmouClientes?: boolean }, por?: string) {
  const f = FiltrosLote.parse(filtros);
  if (opcoes.incluirClientes && opcoes.confirmouClientes !== true)
    throw new ErroPrevisto("Para incluir clientes, confirme de novo: eles deixam o modelo que têm hoje.");
  const m = await modeloDoLote(f);
  const { lista } = await alvos(f, m.publicado.layout);
  const alvo = opcoes.incluirClientes ? lista : lista.filter((a) => !a.cliente);
  const campo = campoDe(f.tipo);
  // nada a trocar: sem registro (um lote vazio só poluiria o desfazer)
  if (!alvo.length) return { id: null, prospeccao: 0, clientes: 0, total: 0 };

  // `cliente` de cada um, para o desfazer não mexer em quem virou cliente depois do lote
  const antes = alvo.map((a) => ({ slug: a.slug, anterior: a.anterior, cliente: a.cliente }));
  const partes = Array.from({ length: Math.ceil(antes.length / PARTE) }, (_, i) => antes.slice(i * PARTE, (i + 1) * PARTE));
  const clientes = alvo.filter((a) => a.cliente).length;
  const ref = adminDb.collection("lotes").doc();
  await ref.set({
    modelo: f.modeloId, tipo: f.tipo, filtros: f, prospeccao: alvo.length - clientes, clientes,
    ...(partes.length > 1 ? { partes: partes.length } : { antes }),
    feitoEm: FieldValue.serverTimestamp(), ...(por ? { por } : {}),
  });
  if (partes.length > 1) await Promise.all(partes.map((p, n) => ref.collection("partes").doc(String(n)).set({ antes: p })));

  for (let i = 0; i < alvo.length; i += LOTE) {
    const lote = adminDb.batch();
    for (const a of alvo.slice(i, i + LOTE))
      lote.update(adminDb.doc(`tenants/${a.slug}`), { [`gerado.${campo}`]: { id: f.modeloId, versao: a.cliente ? m.versao : null } });
    await lote.commit();
  }
  return { id: ref.id, prospeccao: alvo.length - clientes, clientes, total: alvo.length };
}

type Antes = { slug: string; anterior: RefModelo | null; cliente?: boolean }[];
const antesDoLote = async (d: DocumentSnapshot): Promise<Antes> => d.get("partes")
  ? (await d.ref.collection("partes").get()).docs.sort((a, b) => Number(a.id) - Number(b.id)).flatMap((p) => p.get("antes"))
  : d.get("antes") ?? [];

/** O tipo do lote e os negócios que ele pegou (os mesmos ao aplicar e ao desfazer). */
export async function negociosDoLote(id: string) {
  const d = await adminDb.collection("lotes").doc(id).get();
  return d.exists ? { tipo: d.get("tipo") as FiltrosLote["tipo"], slugs: (await antesDoLote(d)).map((a) => a.slug) } : null;
}

/** Devolve a cada negócio o modelo que tinha (apaga o campo se não tinha nenhum). Até 7 dias; a
 *  segunda chamada não faz nada. Quem trocou de modelo depois do lote fica como está, e quem virou
 *  cliente depois dele também (`viraramClientes`): cliente nunca muda sozinho. */
export async function desfazerLote(id: string) {
  const ref = adminDb.collection("lotes").doc(id);
  const d = await ref.get();
  if (!d.exists) throw new ErroPrevisto("Lote não encontrado.");
  if (d.get("desfeitoEm")) return { restaurados: 0, mudaram: 0, viraramClientes: 0, jaDesfeito: true };
  const feitoEm = d.get("feitoEm") as Timestamp | undefined;
  if (!feitoEm || Date.now() - feitoEm.toMillis() > DIAS_DESFAZER * 86_400_000)
    throw new ErroPrevisto(`Só dá para desfazer um lote em até ${DIAS_DESFAZER} dias.`);
  const antes = await antesDoLote(d);
  const campo = campoDe(d.get("tipo"));
  const modelo = d.get("modelo") as string;

  const convites = antes.length ? await comConvite() : new Set<string>();
  let restaurados = 0, mudaram = 0, viraramClientes = 0;
  for (let i = 0; i < antes.length; i += LOTE) {
    const parte = antes.slice(i, i + LOTE);
    const [atuais, crm] = await Promise.all([
      adminDb.getAll(...parte.map((a) => adminDb.doc(`tenants/${a.slug}`))),
      adminDb.getAll(...parte.map((a) => adminDb.doc(`crm/${a.slug}`))),
    ]);
    const lote = adminDb.batch();
    parte.forEach((a, j) => {
      // tenant apagado não volta; quem saiu do modelo do lote depois dele foi trocado de propósito
      if (!atuais[j].exists) return;
      if (atuais[j].get(`gerado.${campo}.id`) !== modelo) return void mudaram++;
      // lote antigo (sem `cliente`) vale como prospecção na época
      const cliente = ehClienteAtivo(atuais[j].get("gerado") ?? {}, crm[j].get("estagio"), convites.has(a.slug));
      if (cliente && !a.cliente) return void viraramClientes++;
      lote.update(atuais[j].ref, { [`gerado.${campo}`]: a.anterior ?? FieldValue.delete() });
      restaurados++;
    });
    await lote.commit();
  }
  await ref.update({ desfeitoEm: FieldValue.serverTimestamp() });
  return { restaurados, mudaram, viraramClientes, jaDesfeito: false };
}
