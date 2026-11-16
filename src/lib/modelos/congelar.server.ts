import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { comConvite, lerCatalogoDireto, lerConfig } from "@/lib/modelos/repo.server";
import { type Catalogo, ehClienteAtivo } from "@/lib/modelos/resolver";
import { type ConfigModelos, RefModelo } from "@/lib/modelos/tipos";

// Congelamento do cliente (docs/plano-estudio-modelos.md, D6 e F7): quem vira cliente passa a
// apontar para uma versão fixa do modelo, para publicar, trocar padrão ou aplicar em lote não o
// mudar. O mesmo cálculo serve ao CRM (virou "fechado"), ao cadastro do dono e ao script da F7.

const LOTE = 400;

type Gerado = { sub?: string; origem?: string; publicadoEm?: unknown; modelo?: unknown; bio?: unknown; escolha?: { modelo?: unknown } };
/** Só as refs que mudam; vazio = nada a gravar (já congelado, ou fica no caminho de hoje). */
export type Refs = { modelo?: RefModelo; bio?: RefModelo };

const lida = (v: unknown) => {
  const r = RefModelo.safeParse(v);
  return r.success ? r.data : null;
};

/** As refs a gravar no negócio. Regras:
 *  - ref com versao null: cliente fixa a versão publicada de agora (prospecção fica como está);
 *  - site sem ref e com gerado.escolha.modelo (escolha da gaveta antiga): vira ref; cliente na
 *    versão publicada de agora (a que o resolver mostra para a escolha), prospecção na publicada (null);
 *  - sem ref nem escolha: com `padrao` (o negócio era prospecção até agora, então via o padrão do
 *    ramo), o cliente fixa o padrão na versão de agora; sem padrão fica no caminho de hoje
 *    (escolha por kit/cor ou sorteio pelo slug, que não muda com o Estúdio);
 *  - bio: as mesmas regras, sem a escolha (a bio de hoje é a "atual" sem ref).
 *  Modelo que não está no catálogo (ou de outro tipo) não vira ref. */
export function refsCongeladas(gerado: Gerado, catalogo: Catalogo, config: ConfigModelos, o: { cliente: boolean; padrao: boolean }): Refs {
  const sub = gerado.sub ?? "";
  const doTipo = (id: string | undefined, tipo: "site" | "bio") => {
    const e = id ? catalogo.get(id) : undefined;
    return e?.publicado.tipo === tipo ? e : undefined;
  };
  const fixar = (ref: RefModelo, tipo: "site" | "bio") => {
    const e = doTipo(ref.id, tipo);
    return o.cliente && ref.versao == null && e ? { id: ref.id, versao: e.versao } : undefined;
  };
  const doPadrao = (id: string | undefined, tipo: "site" | "bio") => {
    const e = o.cliente && o.padrao ? doTipo(id, tipo) : undefined;
    return e ? { id: id!, versao: e.versao } : undefined;
  };

  const modelo = lida(gerado.modelo);
  const escolhido = typeof gerado.escolha?.modelo === "string" ? gerado.escolha.modelo : undefined;
  const site = modelo
    ? fixar(modelo, "site")
    : doTipo(escolhido, "site")
      ? { id: escolhido!, versao: o.cliente ? doTipo(escolhido, "site")!.versao : null }
      : doPadrao(config.padroes.site[sub], "site");

  const bio = lida(gerado.bio);
  const b = bio ? fixar(bio, "bio") : doPadrao(config.padroes.bio[sub] ?? config.padroes.bio.todos, "bio");
  return { ...(site && { modelo: site }), ...(b && { bio: b }) };
}

const campos = (refs: Refs) => Object.fromEntries(Object.entries(refs).map(([k, v]) => [`gerado.${k}`, v]));

/** O sinal de cliente que cada evento acende (ehClienteAtivo). */
const SINAL = { fechou: "fechado", convite: "convite", publicou: "publicado" } as const;

/** Congela o negócio que acabou de virar cliente: `fechou` = estágio "fechado" no CRM, `convite` =
 *  o dono aceitou o convite, `publicou` = entrada paga (gerado.publicadoEm). O padrão do ramo só
 *  conta se, tirando o sinal deste evento, o negócio não era cliente (cliente não via o padrão);
 *  `cadastro` = o dono acabou de criar o negócio, que nasce no padrão do ramo, se houver.
 *  Idempotente e nunca lança: erro vai para o log e o fluxo de quem chamou segue. */
export async function congelarNegocio(db: Firestore, slug: string, quando: "fechou" | "cadastro" | "convite" | "publicou"): Promise<Refs | null> {
  try {
    // leitura direta: roda dentro e fora de requisição, e a versão "de agora" tem de ser a do banco
    const [{ catalogo }, config, crm, membros] = await Promise.all([
      lerCatalogoDireto(), lerConfig(), db.doc(`crm/${slug}`).get(),
      db.collection(`tenants/${slug}/members`).where("viaConvite", "==", true).limit(1).get(),
    ]);
    return await db.runTransaction(async (tx) => {
      const t = await tx.get(db.doc(`tenants/${slug}`));
      const gerado = t.get("gerado") as Gerado | undefined;
      if (!t.exists || !gerado?.sub) return {};
      // ponytail: o "antes" sai dos sinais de agora sem o do evento; um 2º convite ou 2ª entrada do
      // mesmo negócio conta como o 1º (só pesa se nunca houve congelamento e o padrão mudou no meio)
      const sinais = { fechado: crm.get("estagio") === "fechado", cadastro: gerado.origem === "cadastro", publicado: !!gerado.publicadoEm, convite: !membros.empty };
      const antes = quando === "cadastro" ? {} : { ...sinais, [SINAL[quando]]: false };
      const eraCliente = Object.values(antes).some(Boolean);
      const refs = refsCongeladas(gerado, catalogo, config, { cliente: true, padrao: quando === "cadastro" || !eraCliente });
      if (Object.keys(refs).length) tx.update(t.ref, campos(refs));
      return refs;
    });
  } catch (e) {
    console.error(`[modelos] não congelei o modelo de ${slug}; segue sem congelar`, e);
    return null;
  }
}

export type ItemMigracao = { slug: string; cliente: boolean; antes: { modelo: unknown; bio: unknown; escolha: unknown }; depois: Refs };

/** O que o script da F7 faria (scripts/migrar-modelos.mts): clientes (ehClienteAtivo: CRM "fechado",
 *  cadastro, convite aceito ou site publicado)
 *  congelados pelas regras de refsCongeladas SEM o padrão (cliente nunca viu o padrão: o resolver
 *  só o aplica à prospecção), e gerado.escolha.modelo convertido em ref para todos. Só lê. */
export async function planoMigracao(db: Firestore, catalogo: Catalogo, config: ConfigModelos) {
  const [tenants, fechados, convites] = await Promise.all([
    db.collection("tenants").select("gerado.sub", "gerado.origem", "gerado.publicadoEm", "gerado.modelo", "gerado.bio", "gerado.escolha").get(),
    db.collection("crm").where("estagio", "==", "fechado").select().get(),
    comConvite(db),
  ]);
  const fechado = new Set(fechados.docs.map((d) => d.id));
  const itens: ItemMigracao[] = [];
  let comGerado = 0, clientes = 0;
  for (const d of tenants.docs) {
    const gerado = d.get("gerado") as Gerado | undefined;
    if (!gerado?.sub) continue;
    comGerado++;
    const cliente = ehClienteAtivo(gerado, fechado.has(d.id) ? "fechado" : null, convites.has(d.id));
    if (cliente) clientes++;
    const depois = refsCongeladas(gerado, catalogo, config, { cliente, padrao: false });
    if (Object.keys(depois).length)
      itens.push({ slug: d.id, cliente, antes: { modelo: gerado.modelo ?? null, bio: gerado.bio ?? null, escolha: gerado.escolha ?? null }, depois });
  }
  return { itens, comGerado, clientes };
}

/** Grava o plano em lotes de 400. Rodar de novo não muda nada: o plano novo sai vazio. */
export async function aplicarMigracao(db: Firestore, itens: ItemMigracao[]) {
  for (let i = 0; i < itens.length; i += LOTE) {
    const lote = db.batch();
    for (const it of itens.slice(i, i + LOTE)) lote.update(db.doc(`tenants/${it.slug}`), campos(it.depois));
    await lote.commit();
  }
  return itens.length;
}
