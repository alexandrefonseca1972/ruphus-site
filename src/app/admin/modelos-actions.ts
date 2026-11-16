"use server";

import { revalidateTag } from "next/cache";
import { z } from "zod";
import { adminDb } from "@/lib/admin";
import { comBase } from "@/lib/admin-html";
import { adminAction, ErroPrevisto } from "@/lib/admin-guard";
import type { DadosSite } from "@/lib/gerador";
import { lerSite } from "@/lib/gerador.server";
import { checar as checarModelo } from "@/lib/modelos/checagem";
import { EMBUTIDOS } from "@/lib/modelos/embutidos";
import { type FiltrosLote, aplicarLote as aplicarLoteRepo, contarLote as contarLoteRepo, desfazerLote as desfazerLoteRepo } from "@/lib/modelos/lote.server";
import { recalcularCopias } from "@/lib/modelos/copias.server";
import { assinarPreviaBio } from "@/lib/modelos/previa-bio.server";
import * as repo from "@/lib/modelos/repo.server";
import { Caso, DefModelo, doNichoAtivo } from "@/lib/modelos/tipos";
import { ehClaro, renderClaro } from "@/lib/site-claro";
import { SLUG_SITE } from "@/lib/site-arquivo";
import { renderEditorial } from "@/lib/site-editorial";

// Ações do Estúdio de modelos (docs/plano-estudio-modelos.md, F5). Todas passam por adminAction
// (token de admin em config/admin) e validam a entrada com Zod antes de tocar no banco. As que
// gravam invalidam o cache do catálogo (D7) depois de dar certo. Publicar, padrão e lote refazem
// antes as cópias da bio (site.color/site.photo) de quem passou a ver outro modelo (D8).

const Id = z.string().regex(/^[a-z0-9-]{1,80}$/, "id de modelo inválido");
const Ids = z.array(Id).min(1).max(100);
const Tipo = z.enum(["site", "bio"]);
const Slug = z.string().regex(SLUG_SITE, "negócio inválido");
const EMBUTIDO = new Set(EMBUTIDOS.map((m) => m.id));
const porQuem = (u: { uid: string; email?: string }) => u.email ?? u.uid;
const invalidar = () => revalidateTag(repo.TAG_MODELOS, { expire: 0 });
/** Falha nas cópias não desfaz a gravação nem pode impedir o invalidar: fica no log. */
const copias = (alvo: Parameters<typeof recalcularCopias>[1]) =>
  recalcularCopias(adminDb, alvo).catch((e) => console.error("[modelos] não refiz as cópias da bio", alvo, e));

/** Quantos negócios apontam para o modelo. Lido sob demanda (aba Uso, diálogo Publicar), não na
 *  lista: 2 agregações count() e, no site, os docs da escolha antiga (só o campo gerado.modelo).
 *  - prospeccao: segue a publicada (versao null), muda quando publicar;
 *  - clientes: congelados (versao fixa), não mudam;
 *  - legado (só site): gerado.escolha.modelo igual ao id E sem gerado.modelo (quem tem ref segue a
 *    ref, já contada acima). O Firestore não filtra "campo ausente", por isso lê e filtra aqui.
 *    A prospecção daqui também muda ao publicar (o cliente é congelado antes, em repo.publicar). */
async function uso(tipo: "site" | "bio", id: string) {
  const campo = tipo === "site" ? "modelo" : "bio";
  const t = adminDb.collection("tenants");
  const conta = async (q: FirebaseFirestore.Query) => (await q.count().get()).data().count;
  const [total, prospeccao, escolhas] = await Promise.all([
    conta(t.where(`gerado.${campo}.id`, "==", id)),
    conta(t.where(`gerado.${campo}.id`, "==", id).where(`gerado.${campo}.versao`, "==", null)),
    tipo === "site" ? t.where("gerado.escolha.modelo", "==", id).select("gerado.modelo").get() : null,
  ]);
  const legado = escolhas?.docs.filter((d) => !d.get("gerado.modelo")).length ?? 0;
  return { prospeccao, clientes: total - prospeccao, ...(tipo === "site" ? { legado } : {}) };
}
export type Uso = Awaited<ReturnType<typeof uso>>;

/** Os modelos do tipo, só dos nichos em que a Ruphus opera (NICHOS_ATIVOS). Sem contagem de uso
 *  (usoDoModelo): contar cada um dos ~100 modelos a cada abertura custava centenas de leituras. */
export const listarModelos = adminAction(async (_user, tipo: "site" | "bio") => {
  const t = Tipo.parse(tipo);
  const [{ catalogo, rascunhos }, config] = await Promise.all([repo.lerCatalogoDireto(), repo.lerConfig()]);
  const modelos = [...catalogo].filter(([, e]) => e.publicado.tipo === t && doNichoAtivo(e.publicado.sub)).map(([id, e]) => ({
    def: e.publicado, versao: e.versao, ativo: e.publicado.ativo, rascunho: rascunhos[id] ?? null, embutido: EMBUTIDO.has(id),
  }));
  return { modelos, padroes: config.padroes[t] };
});

export const usoDoModelo = adminAction(async (_user, id: string) => {
  const e = (await repo.lerCatalogoDireto()).catalogo.get(Id.parse(id));
  if (!e) throw new ErroPrevisto(`Modelo ${id} não existe.`);
  return uso(e.publicado.tipo, id);
});

/** O nome longo de teste: quebra em duas ou três linhas no topo de qualquer layout. */
const NOME_LONGO = " · Estúdio de Beleza, Estética Avançada e Bem-Estar";

/** O caso de teste aplicado aos dados reais do negócio. No site, "poucas" e "semprec" não mudam
 *  nada: o kit sempre dá 4 fotos (a foto própria cai no kit posição a posição) e o site não mostra preço. */
function comCaso(d: DadosSite, caso: Caso): DadosSite {
  if (caso === "longo") return { ...d, nome: d.nome + NOME_LONGO };
  if (caso === "semnota") return { ...d, nota: null, avaliacoes: null };
  if (caso === "umserv") return { ...d, servicos: d.servicos.slice(0, 1) };
  return d;
}

const PedidoPrevia = z.object({ def: DefModelo, slug: Slug, caso: Caso.default("normal"), tipo: Tipo })
  .refine((p) => p.def.tipo === p.tipo, { message: "tipo não combina com o modelo", path: ["tipo"] });

/** Prévia de uma def (rascunho ou não) com os dados reais de um negócio; não grava nada.
 *  Site: o HTML pronto para o iframe. Bio: o endereço da prévia assinada (10 min). */
export const previaModelo = adminAction(async (_user, pedido: { def: DefModelo; slug: string; caso?: Caso; tipo: "site" | "bio" }): Promise<{ html: string } | { url: string }> => {
  const { def, slug, caso, tipo } = PedidoPrevia.parse(pedido);
  if (tipo === "bio") return { url: `/bio/${slug}/previa?t=${encodeURIComponent(assinarPreviaBio({ slug, def, caso }))}` };
  const d = await lerSite(adminDb, slug);
  if (!d) throw new ErroPrevisto("Site não encontrado.");
  if (def.layout !== (ehClaro(d.sub) ? "claro" : "editorial")) throw new ErroPrevisto(`Este negócio usa o layout ${ehClaro(d.sub) ? "claro" : "editorial"}; escolha outro negócio.`);
  const dados = comCaso({ ...d, def }, caso);
  return { html: comBase(ehClaro(d.sub) ? renderClaro(dados) : renderEditorial(dados), slug) };
});

// rascunho, descartar e restaurar não mudam o que o site e a bio mostram: sem invalidar o cache
export const salvarRascunho = adminAction(async (_user, id: string, def: DefModelo) => {
  await repo.salvarRascunho(Id.parse(id), def);
});

/** Por id: a versão nova, quantos de prospecção mudam e quantos clientes ficaram congelados.
 *  Cópias e cache rodam mesmo se um id falhar no meio: os que já foram ao ar não ficam com a bio
 *  e o cache velhos (refazer a cópia de quem não mudou não muda nada). */
export const publicar = adminAction(async (user, ids: string[]) => {
  const lista = Ids.parse(ids);
  try {
    return await repo.publicar(lista, porQuem(user));
  } finally {
    await copias({ modelos: lista });
    invalidar();
  }
});

export const descartar = adminAction(async (_user, ids: string[]) => {
  await repo.descartar(Ids.parse(ids));
});

export const criar = adminAction(async (user, def: DefModelo) => {
  const id = await repo.criar(def, porQuem(user));
  invalidar();
  return id;
});

export const duplicar = adminAction(async (user, id: string, nome: string) => {
  const novo = await repo.duplicar(Id.parse(id), DefModelo.shape.nome.parse(nome), porQuem(user));
  invalidar();
  return novo;
});

export const ligar = adminAction(async (user, id: string, ativo: boolean) => {
  const v = await repo.ligar(Id.parse(id), z.boolean().parse(ativo), porQuem(user));
  invalidar();
  return v;
});

export const definirPadrao = adminAction(async (_user, tipo: "site" | "bio", sub: string, id: string | null) => {
  const t = Tipo.parse(tipo), s = DefModelo.shape.sub.parse(sub);
  await repo.definirPadrao(t, s, Id.nullable().parse(id));
  if (t === "site") await copias({ sub: s });
  invalidar();
});

export const historico = adminAction(async (_user, id: string) => repo.historico(Id.parse(id)));

/** Copia a versão n para o rascunho; publicar continua sendo outro passo. */
export const restaurar = adminAction(async (_user, id: string, n: number) => {
  await repo.restaurar(Id.parse(id), z.number().int().min(1).parse(n));
});

const FOTOS_VALIDADE = 5 * 60_000;
// ponytail: cache em memória do processo (produção é um processo Next, F0.3); vários processos = um por processo
const fotosCache = new Map<string, { n: number; ate: number }>();

/** Negócios do ramo com foto própria na galeria, mas menos de 3 (ga1..ga3). Quem não tem foto
 *  própria usa o kit, que tem 4. ponytail: aproximação (a bio pode completar posição a posição com
 *  o kit) e lê os tenants do ramo, uma leitura cada; por isso só roda com a aba Checar aberta, para
 *  layout que precisa de 3 fotos, e guarda o número por ramo por 5 minutos. */
async function comPoucasFotos(sub: string) {
  const guardado = fotosCache.get(sub);
  if (guardado && guardado.ate > Date.now()) return guardado.n;
  const n = await contarPoucasFotos(sub);
  fotosCache.set(sub, { n, ate: Date.now() + FOTOS_VALIDADE });
  return n;
}

async function contarPoucasFotos(sub: string) {
  const t = adminDb.collection("tenants");
  const snap = await (sub === "todos" ? t : t.where("gerado.sub", "==", sub)).select("gerado.sub", "gerado.personal.fotos").get();
  return snap.docs.filter((d) => {
    const fotos = d.get("gerado.personal.fotos") as Record<string, unknown> | undefined;
    return d.get("gerado.sub") && fotos && ["ga1", "ga2", "ga3"].filter((k) => fotos[k]).length < 3;
  }).length;
}

/** A checagem automática; com `fotos` (aba Checar aberta), mais quantos negócios do ramo cairiam na
 *  Clara por falta de fotos. */
export const checar = adminAction(async (_user, def: DefModelo, negocio: { fotos?: number; nome?: string; avaliacoes?: number } = {}, fotos = false) => {
  const m = DefModelo.parse(def);
  const n = z.object({ fotos: z.number().int().min(0).max(20), nome: z.string().max(200), avaliacoes: z.number().int().min(0) }).partial().parse(negocio);
  const avisos = checarModelo(m, n);
  const poucasFotos = z.boolean().parse(fotos) && (m.layout === "galeria" || m.layout === "stories") ? await comPoucasFotos(m.sub) : null;
  if (poucasFotos) avisos.push({ nivel: "aviso", titulo: "Negócios com poucas fotos", texto: `${poucasFotos} negócio(s) do ramo têm menos de 3 fotos próprias na galeria; neles a bio volta para a Clara.` });
  return { avisos, poucasFotos };
});

export const contarLote = adminAction(async (_user, filtros: FiltrosLote) => contarLoteRepo(filtros));

const OpcoesLote = z.object({ incluirClientes: z.boolean().default(false), confirmouClientes: z.boolean().optional() }).strict();

/** Aplica em lote. Cliente só entra com incluirClientes e confirmouClientes === true (segunda confirmação). */
export const aplicarLote = adminAction(async (user, filtros: FiltrosLote, opcoes: { incluirClientes?: boolean; confirmouClientes?: boolean }) => {
  const r = await aplicarLoteRepo(filtros, OpcoesLote.parse(opcoes ?? {}), porQuem(user));
  // lote vazio não grava nada: nem cópias nem cache
  if (r.id) {
    await copias({ lote: r.id });
    invalidar();
  }
  return r;
});

export const desfazerLote = adminAction(async (_user, id: string) => {
  const lote = z.string().regex(/^[A-Za-z0-9]{1,40}$/, "lote inválido").parse(id);
  const r = await desfazerLoteRepo(lote);
  if (!r.jaDesfeito) await copias({ lote });
  invalidar();
  return r;
});
