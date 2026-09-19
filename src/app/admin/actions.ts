"use server";

import { adminDb } from "@/lib/admin";
import { adminAction } from "@/lib/admin-guard";
import { criarConvite } from "@/lib/convite";
import { anotar, CrmInput, lerCrm, listarNotas, salvarCrm } from "@/lib/crm";

export type Espaco = {
  slug: string;
  nome: string;
  telefone: string | null;
  nicho: string;          // rótulo em português, já agrupado
  cidade: string | null;
  uf: string | null;
  nota: number | null;    // estrelas no Google
  avaliacoes: number | null;
  acessos: number;        // quantas pessoas entram no painel deste espaço
};

// os tipos do schema.org viram nichos que a gente reconhece (e junta variações)
const NICHOS: Record<string, string> = {
  petstore: "Pet shop",
  veterinarycare: "Veterinária",
  beautysalon: "Estética e beleza",
  healthandbeautybusiness: "Estética e beleza",
  hairsalon: "Cabeleireiro",
  barbershop: "Barbearia",
  nailsalon: "Unhas",
  dayspa: "Spa e massagem",
  tattooparlor: "Tatuagem",
  medicalclinic: "Saúde",
  dentist: "Odontologia",
  physician: "Saúde",
  healthclub: "Saúde",
  podiatric: "Podologia",
};
const nicho = (tipo: unknown) => NICHOS[String(tipo ?? "").toLowerCase()] ?? "Outros";

/** Se quem entrou administra a plataforma.
 *
 * config/admin não é legível pelo cliente — nenhuma regra abre essa coleção —,
 * então quem responde é o servidor. O login usa isto para mandar o admin ao
 * painel da plataforma em vez da casa de um negócio.
 */
export const ehAdminDaPlataforma = adminAction(async () => true);

/** Lista os espaços com quantas pessoas têm acesso a cada um. */
export const listarEspacos = adminAction(async () => {
  const [tenants, membros] = await Promise.all([
    adminDb.collection("tenants").get(),
    adminDb.collectionGroup("members").get(),
  ]);
  const porEspaco = new Map<string, number>();
  for (const m of membros.docs) {
    const espaco = m.ref.parent.parent;
    if (espaco?.parent.id === "tenants") porEspaco.set(espaco.id, (porEspaco.get(espaco.id) ?? 0) + 1);
  }
  return tenants.docs
    .map((d): Espaco => ({
      slug: d.id,
      nome: String(d.get("name") ?? d.id),
      telefone: d.get("site.phone") ?? null,
      nicho: nicho(d.get("site.category")),
      cidade: d.get("site.city") ?? null,
      uf: d.get("site.uf") ?? null,
      nota: d.get("site.rating") ?? null,
      avaliacoes: d.get("site.reviews") ?? null,
      acessos: porEspaco.get(d.id) ?? 0,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
});

/** Link de convite: quem abrir e entrar vira admin do espaço. */
export const gerarConvite = adminAction(async (_user, slug: string) => {
  const tenant = await adminDb.collection("tenants").doc(slug).get();
  if (!tenant.exists) throw new Error(`espaço ${slug} não existe`);
  return `${process.env.SITE_URL ?? "https://www.ruphus.site"}/convite?c=${await criarConvite(adminDb, slug)}`;
});

export type Acesso = { uid: string; papel: string; desde: string | null };

export const listarAcessos = adminAction(async (_user, slug: string) => {
  const snap = await adminDb.collection(`tenants/${slug}/members`).get();
  return snap.docs.map((d): Acesso => ({
    uid: d.id,
    papel: String(d.get("role") ?? "member"),
    desde: d.get("createdAt")?.toDate?.().toISOString() ?? null,
  }));
});

/** Tira o acesso de alguém. O dono do espaço não pode ser removido. */
export const revogarAcesso = adminAction(async (_user, slug: string, uid: string) => {
  const ref = adminDb.doc(`tenants/${slug}/members/${uid}`);
  const membro = await ref.get();
  if (!membro.exists) return "já não tinha acesso";
  if (membro.get("role") === "owner") throw new Error("dono não pode ser removido");
  await ref.delete();
  return "acesso removido";
});

export type Resumo = { agendamentosHoje: number; espacosComAgenda: number };

/** Agendamentos de hoje em toda a plataforma, para o topo do painel. */
export const resumoDoDia = adminAction(async (): Promise<Resumo> => {
  const inicio = new Date();
  inicio.setHours(0, 0, 0, 0);
  const fim = new Date(inicio);
  fim.setDate(fim.getDate() + 1);
  const snap = await adminDb
    .collectionGroup("appointments")
    .where("start", ">=", inicio)
    .where("start", "<", fim)
    .get();
  const espacos = new Set(snap.docs.map((d) => d.ref.parent.parent?.id).filter(Boolean));
  return { agendamentosHoje: snap.size, espacosComAgenda: espacos.size };
});

export type Detalhe = {
  servicos: number;
  profissionais: number;
  agendamentos30d: number;
  telefone: string | null;
};

/** O que o painel lateral de um espaço mostra além dos acessos. */
export const detalhesEspaco = adminAction(async (_user, slug: string): Promise<Detalhe> => {
  const t = adminDb.collection("tenants").doc(slug);
  const desde = new Date();
  desde.setDate(desde.getDate() - 30);
  const [tenant, servicos, staff, agendamentos] = await Promise.all([
    t.get(),
    t.collection("services").where("active", "==", true).count().get(),
    t.collection("staff").where("active", "==", true).count().get(),
    t.collection("appointments").where("start", ">=", desde).count().get(),
  ]);
  return {
    servicos: servicos.data().count,
    profissionais: staff.data().count,
    agendamentos30d: agendamentos.data().count,
    telefone: tenant.get("site.phone") ?? null,
  };
});

// ————— CRM: oferta, venda e publicação —————

/** Estágio, valor e próxima ação de cada espaço, em um mapa por slug. */
export const listarCrm = adminAction(async () => lerCrm(adminDb));

export const salvarNegocio = adminAction(async (_user, slug: string, dados: unknown) => {
  await salvarCrm(adminDb, slug, CrmInput.parse(dados));
  return "salvo";
});

export const listarNotasDo = adminAction(async (_user, slug: string) => listarNotas(adminDb, slug));

export const anotarNegocio = adminAction(async (user, slug: string, texto: string) => {
  await anotar(adminDb, slug, texto, user.email ?? user.uid);
  return listarNotas(adminDb, slug);
});
