import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { type Escolha, type Sub, SUBS } from "@/lib/gerador";
import { defDoSite, personalDe, visualDoSite } from "@/lib/gerador.server";
import { negociosDoLote } from "@/lib/modelos/lote.server";
import { comConvite, lerCatalogoDireto, lerConfig } from "@/lib/modelos/repo.server";
import { type Catalogo, ehClienteAtivo } from "@/lib/modelos/resolver";
import { type ConfigModelos, RefModelo } from "@/lib/modelos/tipos";

// Cópias da bio (docs/plano-estudio-modelos.md, D8 e F8.1). A /bio lê a cor e a foto gravadas no
// tenant (site.color, site.photo), não o modelo. Quando o modelo que um negócio vê muda sem passar
// pela gaveta (publicar, padrão do ramo, lote e desfazer), as cópias são refeitas pela mesma conta
// do definirModelo: visualDoSite sobre a def que o site resolve (defDoSite).
// Catálogo e config lidos direto do banco: dentro da Server Action o cache ainda tem o de antes.
// A página da bio sai do cache pela tag do catálogo (revalidateTag(TAG_MODELOS, { expire: 0 }),
// que a ação chama DEPOIS daqui): toda bio de site gerado lê config/modelos pelo cache com essa tag,
// então não há renovarSite por negócio (seriam milhares de visitas de aquecimento de uma vez).

const LOTE = 400;
type Lido = { catalogo: Catalogo; config: ConfigModelos };

const temRef = (v: unknown) => RefModelo.safeParse(v).success;
const temEscolha = (v: unknown) => typeof v === "string";

/** Prospecção que vê o modelo de site `modelo` (ref na publicada, escolha da gaveta antiga, ou o
 *  padrão do ramo que ele é) ou o padrão do ramo `sub`. Cliente fica de fora: não muda sozinho.
 *  ponytail: o ramo inteiro é lido (só os campos do modelo) e o CRM em lotes de 400; com dezenas de
 *  milhares por ramo, gravar no tenant se ele segue o padrão. */
async function seguidores(db: Firestore, { config, catalogo }: Lido, alvo: { modelo?: string; sub?: string }) {
  const t = db.collection("tenants");
  const campos = ["gerado.sub", "gerado.origem", "gerado.publicadoEm", "gerado.modelo", "gerado.escolha.modelo"] as const;
  const ehSite = alvo.modelo ? catalogo.get(alvo.modelo)?.publicado.tipo === "site" : false;
  const subs = [
    ...(alvo.sub ? [alvo.sub] : []),
    ...(ehSite ? Object.entries(config.padroes.site).filter(([, id]) => id === alvo.modelo).map(([s]) => s) : []),
  ];
  const consultas = await Promise.all([
    ehSite ? t.where("gerado.modelo.id", "==", alvo.modelo).where("gerado.modelo.versao", "==", null).select(...campos).get() : null,
    ehSite ? t.where("gerado.escolha.modelo", "==", alvo.modelo).select(...campos).get() : null,
    ...subs.map((s) => t.where("gerado.sub", "==", s).select(...campos).get()),
  ]);
  const [refs, escolhas, ...ramos] = consultas;
  const docs = new Map([
    ...(refs?.docs ?? []),
    // quem tem gerado.modelo segue a ref, não a escolha
    ...(escolhas?.docs.filter((d) => !temRef(d.get("gerado.modelo"))) ?? []),
    // o padrão só vale para quem não escolheu nada
    ...ramos.flatMap((q) => q!.docs.filter((d) => !temRef(d.get("gerado.modelo")) && !temEscolha(d.get("gerado.escolha.modelo")))),
  ].map((d) => [d.id, d]));
  const lista = [...docs.values()];
  const convites = lista.length ? await comConvite(db) : new Set<string>();
  const slugs: string[] = [];
  for (let i = 0; i < lista.length; i += LOTE) {
    const parte = lista.slice(i, i + LOTE);
    const crm = await db.getAll(...parte.map((d) => db.doc(`crm/${d.id}`)));
    parte.forEach((d, j) => {
      if (!ehClienteAtivo(d.get("gerado") ?? {}, crm[j].get("estagio"), convites.has(d.id))) slugs.push(d.id);
    });
  }
  return slugs;
}

/** Refaz site.color/site.photo de cada negócio pelo modelo que o site resolve agora. Grava só o
 *  que mudou, em lotes de 400; devolve quantos mudaram. */
export async function atualizarCopias(db: Firestore, slugs: string[], lido?: Lido) {
  const l = lido ?? await Promise.all([lerCatalogoDireto(), lerConfig()]).then(([c, config]) => ({ catalogo: c.catalogo, config }));
  let mudaram = 0;
  for (let i = 0; i < slugs.length; i += LOTE) {
    const docs = await db.getAll(...slugs.slice(i, i + LOTE).map((s) => db.doc(`tenants/${s}`)));
    const novos = await Promise.all(docs.map(async (d) => {
      const gerado = d.get("gerado") as { sub?: string; origem?: string; modelo?: unknown; escolha?: Escolha; personal?: unknown } | undefined;
      if (!d.exists || !gerado?.sub || !(gerado.sub in SUBS)) return null;
      const sub = gerado.sub as Sub;
      const def = await defDoSite(db, d.id, { ...gerado, sub }, l);
      const v = visualDoSite(d.id, sub, gerado.escolha, personalDe(gerado.personal), def);
      return v.cor === d.get("site.color") && v.foto === d.get("site.photo") ? null : { d, v };
    }));
    const lote = db.batch();
    for (const n of novos) if (n) lote.update(n.d.ref, { "site.color": n.v.cor, "site.photo": n.v.foto });
    await lote.commit();
    mudaram += novos.filter(Boolean).length;
  }
  return mudaram;
}

/** Depois de publicar (`modelos`), trocar o padrão de site do ramo (`sub`) ou aplicar/desfazer um
 *  lote (`lote`): as cópias da bio de quem passou a ver outro modelo. Modelo e lote de bio não mexem
 *  nas cópias (a bio não pinta pela paleta do modelo de bio). Do lote vale todo negócio que ele pegou,
 *  inclusive o cliente que o admin confirmou. */
export async function recalcularCopias(db: Firestore, alvo: { modelos?: string[]; sub?: string; lote?: string }) {
  const [{ catalogo }, config] = await Promise.all([lerCatalogoDireto(), lerConfig()]);
  const lido = { catalogo, config };
  const slugs = new Set<string>();
  for (const modelo of alvo.modelos ?? []) for (const s of await seguidores(db, lido, { modelo })) slugs.add(s);
  if (alvo.sub) for (const s of await seguidores(db, lido, { sub: alvo.sub })) slugs.add(s);
  if (alvo.lote) {
    const l = await negociosDoLote(alvo.lote);
    if (l?.tipo === "site") for (const s of l.slugs) slugs.add(s);
  }
  return atualizarCopias(db, [...slugs], lido);
}
