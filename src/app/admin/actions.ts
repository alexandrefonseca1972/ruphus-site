"use server";

import { adminDb } from "@/lib/admin";
import { adminAction } from "@/lib/admin-guard";
import { criarConvite } from "@/lib/convite";

export type Espaco = {
  slug: string;
  nome: string;
  telefone: string | null;
  categoria: string | null;
  ownerId: string;
  acessos: number; // quantas pessoas entram no painel deste espaço
};

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
      categoria: d.get("site.category") ?? null,
      ownerId: String(d.get("ownerId") ?? ""),
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
