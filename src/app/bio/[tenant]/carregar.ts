import { type Dominio, urlDoSite } from "@/lib/dominio";
import { cache } from "react";
import type { Firestore } from "firebase-admin/firestore";
import { adminDb } from "@/lib/admin";
import { agendaDesligada, agendaDias, foraDoAr } from "@/lib/booking.server";
import { addDays, fusoDe, todayIn, weekday, WEEKDAYS, type TipoPreco } from "@/lib/datetime";
import { Service, Staff } from "@/lib/scheduling";
import { type Escolha, type Sub, SUBS } from "@/lib/gerador";
import { defDoSite, personalDe } from "@/lib/gerador.server";
import { ehClaro, galeriaClaro, visualClaro } from "@/lib/site-claro";
import { visualEditorial } from "@/lib/site-editorial";
import { resolverModelo } from "@/lib/modelos/resolver";
import { type LayoutBio, RefModelo } from "@/lib/modelos/tipos";

const SLUG = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;

export type Servico = { id: string; nome: string; duracao: number; preco: number; tipoPreco?: TipoPreco };
type Expediente = { dia: number; inicio: string; fim: string };

export type Bio = {
  site: string;
  nome: string;
  cidade: string | null;
  uf: string | null;
  fuso: string;
  telefone: string | null;
  instagram: string | null;
  endereco: string | null;
  nota: number | null;
  avaliacoes: number | null;
  cor: string;
  foto: string | null;
  servicos: Servico[];
  expediente: Expediente[];
  agendaOnline: boolean;
  /** o ramo como o Google mostra ("Design de sobrancelha"), para a linha abaixo do nome */
  categoria: string | null;
  /** até três fotos da galeria, prontas para o src (as do site: próprias ou do kit) */
  fotos: string[];
  /** o layout da bio que o negócio usa (D5); "atual" é a bio de sempre */
  layout: LayoutBio;
  /** ramo de saúde (odonto, fisio…): Cartaz e Noturno ficam sóbrios */
  saude: boolean;
};

export type Livres = { servico: Servico; dias: { date: string; rotulo: string; horarios: string[] }[] };

type Gerado = { sub?: Sub; origem?: string; publicadoEm?: unknown; escolha?: Escolha & { modelo?: string }; personal?: unknown; modelo?: unknown; bio?: unknown };

// unstable_cache só roda dentro de requisição: fora dela (script), leitura direta
const emCache = <T,>(cache: () => Promise<T>, direto: () => Promise<T>) => cache().catch(() => direto());

/** O layout da bio (D5), com a mesma regra de leitura do site (defDoSite): catálogo só quando
 *  o negócio aponta para um modelo ou o ramo tem padrão; CRM só para saber se é cliente. A escolha
 *  manual da gaveta antiga (gerado.escolha.modelo, de site) tira o negócio do padrão: fica a bio de
 *  sempre, como no resolver. Erro ou modelo que não é de bio = a bio de sempre. */
async function layoutDaBio(db: Firestore, slug: string, gerado: Gerado & { sub: Sub }): Promise<LayoutBio> {
  try {
    const ref = RefModelo.safeParse(gerado.bio);
    const modelo = ref.success ? ref.data : null;
    const { lerCatalogo, lerCatalogoDireto, lerConfig, lerConfigCache } = await import("@/lib/modelos/repo.server");
    const config = await emCache(lerConfigCache, lerConfig);
    const padroes = config.padroes.bio;
    if (!modelo && (typeof gerado.escolha?.modelo === "string" || !(padroes[gerado.sub] ?? padroes.todos))) return "atual";
    const origem = gerado.origem === "cadastro" ? "cadastro" : "prospeccao";
    const lerCrm = !modelo && origem !== "cadastro" && !gerado.publicadoEm;
    const [{ catalogo }, crm, convite] = await Promise.all([
      emCache(lerCatalogo, lerCatalogoDireto),
      lerCrm ? db.collection("crm").doc(slug).get() : null,
      lerCrm ? db.collection(`tenants/${slug}/members`).where("viaConvite", "==", true).limit(1).get() : null,
    ]);
    const r = resolverModelo({ gerado: { sub: gerado.sub, origem, publicadoEm: gerado.publicadoEm, bio: modelo }, crmEstagio: crm?.get("estagio"), conviteAceito: !!convite && !convite.empty }, catalogo, config, "bio");
    return r.def?.tipo === "bio" ? (r.def.layout as LayoutBio) : "atual";
  } catch (e) {
    console.error(`[bio] não resolvi o layout de ${slug}; sigo com a atual`, e);
    return "atual";
  }
}

/** As três fotos da galeria do site (as próprias de gerado.personal ou as do kit do modelo do
 *  site), no endereço que a bio usa. Site da fábrica (sem gerado) não tem galeria. */
async function fotosDoSite(db: Firestore, slug: string, gerado: Gerado & { sub: Sub }): Promise<string[]> {
  const def = await defDoSite(db, slug, gerado);
  const personal = personalDe(gerado.personal);
  let refs: string[];
  if (ehClaro(gerado.sub)) {
    const { fotos } = visualClaro(slug, gerado.sub, gerado.escolha, personal, def);
    // a pasta do banco do ramo, pelo topo sem foto própria: "/assets/{pasta}/{topo}"
    const hero = visualClaro(slug, gerado.sub, gerado.escolha, null, def).fotos.hero;
    const pasta = hero.slice(0, hero.lastIndexOf("/"));
    const doSlug = galeriaClaro(slug, gerado.sub);
    refs = [fotos.ga1, fotos.ga2, fotos.ga3].map((f, i) => f ?? `${pasta}/${doSlug[i]}-800.jpg`);
  } else {
    const { fotos } = visualEditorial(slug, gerado.sub, gerado.escolha, personal, def);
    refs = [fotos.ga1, fotos.ga2, fotos.ga3];
  }
  // a do banco mora em /s/assets; a própria ("fotos/ga1.jpg?v=…") na pasta do negócio
  return refs.map((r) => (r.startsWith("/assets/") ? `/s${r}` : `/s/${slug}/${r}`));
}

/** O que o minisite mostra: tudo já vem do tenant, nada de novo para cadastrar. */
export const carregar = cache(async (slug: string): Promise<Bio | null> => {
  if (!SLUG.test(slug)) return null;
  const t = adminDb.collection("tenants").doc(slug);
  // tirado do ar (cobrança): a bio sai junto com o site
  if (await foraDoAr(adminDb, slug)) return null;
  const [tenant, servicos, equipe] = await Promise.all([
    t.get(),
    t.collection("services").where("active", "==", true).get(),
    t.collection("staff").where("active", "==", true).get(),
  ]);
  if (!tenant.exists) return null;

  // o horário do negócio é a união da equipe: abre com o primeiro e fecha com o último
  const horas = new Map<number, { inicio: string; fim: string }>();
  for (const d of equipe.docs) {
    const p = Staff.safeParse(d.data());
    if (!p.success) continue;
    for (const [dia, j] of Object.entries(p.data.hours)) {
      if (!j) continue;
      const atual = horas.get(Number(dia));
      horas.set(Number(dia), atual ? { inicio: j.start < atual.inicio ? j.start : atual.inicio, fim: j.end > atual.fim ? j.end : atual.fim } : { inicio: j.start, fim: j.end });
    }
  }
  const gerado = tenant.get("gerado") as Gerado | undefined;
  const doGerado = gerado?.sub ? { ...gerado, sub: gerado.sub } : null;
  const [fotos, layout] = doGerado
    ? await Promise.all([
        fotosDoSite(adminDb, slug, doGerado).catch((e) => {
          console.error(`[bio] não montei a galeria de ${slug}`, e);
          return [];
        }),
        layoutDaBio(adminDb, slug, doGerado),
      ])
    : [[], "atual" as const];
  return {
    // o endereço do site: o domínio próprio do cliente, quando ativo, senão o subdomínio
    site: urlDoSite(slug, tenant.get("dominio") as Dominio | undefined),
    nome: String(tenant.get("name")),
    cidade: tenant.get("site.city") ?? null,
    uf: tenant.get("site.uf") ?? null,
    fuso: fusoDe(tenant.get("site")),
    telefone: tenant.get("site.phone") ?? null,
    instagram: tenant.get("site.instagram") ?? null,
    endereco: tenant.get("site.address") ?? null,
    nota: tenant.get("site.rating") ?? null,
    avaliacoes: tenant.get("site.reviews") ?? null,
    cor: tenant.get("site.color") ?? "#17150F",
    foto: tenant.get("site.photo") ?? null,
    servicos: servicos.docs.flatMap((d) => {
      const s = Service.safeParse(d.data());
      return s.success ? [{ id: d.id, nome: s.data.name, duracao: s.data.durationMin, preco: s.data.priceCents, tipoPreco: s.data.tipoPreco }] : [];
    }),
    expediente: [...horas].map(([dia, j]) => ({ dia, ...j })),
    agendaOnline: !agendaDesligada(tenant),
    categoria: tenant.get("site.category") || null,
    fotos,
    layout,
    saude: !!doGerado && SUBS[doGerado.sub]?.nicho === "saude",
  };
});

/** Horários livres do serviço mais curto nos próximos três dias de trabalho (até 8 por dia).
 * Os dias candidatos são consultados juntos (antes era um por vez, até 8 idas ao banco em fila). */
export async function proximosHorarios(slug: string, bio: Bio): Promise<Livres | null> {
  const curto = [...bio.servicos].sort((a, b) => a.duracao - b.duracao)[0];
  if (!curto || !bio.expediente.length || !bio.agendaOnline) return null;
  const candidatos = Array.from({ length: 8 }, (_, i) => ({ i, date: addDays(todayIn(bio.fuso), i) }))
    .filter(({ date }) => bio.expediente.some((e) => e.dia === weekday(date)))
    .slice(0, 3); // três dias de trabalho: são as abas da bio
  // staffId vazio: qualquer profissional, como na página de agendamento
  const dias = await agendaDias(adminDb, { tenantId: slug, serviceIds: [curto.id], staffId: "", from: candidatos[0]?.date ?? todayIn() }, candidatos.map((c) => c.date)).catch(() => []);
  const abas = candidatos
    .map(({ i, date }) => ({
      date,
      rotulo: i === 0 ? "Hoje" : i === 1 ? "Amanhã" : WEEKDAYS[weekday(date)],
      horarios: (dias.find((d) => d.date === date)?.horarios.map((h) => h.hora) ?? []).slice(0, 8),
    }))
    .filter((d) => d.horarios.length);
  return abas.length ? { servico: curto, dias: abas } : null;
}
