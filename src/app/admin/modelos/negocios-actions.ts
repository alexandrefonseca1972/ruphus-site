"use server";

import { z } from "zod";
import { adminDb } from "@/lib/admin";
import { adminAction } from "@/lib/admin-guard";
import { DefModelo } from "@/lib/modelos/tipos";

// Negócios reais para o Estúdio (docs/plano-estudio-modelos.md, F6): os do ramo, para a prévia
// com dados de verdade, e os que já apontam para o modelo, para a aba Uso. Só lê.

const Tipo = z.enum(["site", "bio"]);
const Id = z.string().regex(/^[a-z0-9-]{1,80}$/, "id de modelo inválido");

type Doc = FirebaseFirestore.QueryDocumentSnapshot;
const linha = (d: Doc) => ({
  slug: d.id,
  nome: String(d.get("name") ?? d.id),
  cidade: [d.get("site.city"), d.get("site.uf")].filter(Boolean).join("/"),
});

/** Até 8 negócios do ramo (a bio "todos" usa salão) e até 20 que usam o modelo, com a versão
 *  gravada (null = segue a publicada; número = cliente congelado). */
export const negociosDoModelo = adminAction(async (_user, tipo: "site" | "bio", sub: string, id: string) => {
  const campo = Tipo.parse(tipo) === "site" ? "modelo" : "bio";
  const ramo = DefModelo.shape.sub.parse(sub);
  const t = adminDb.collection("tenants");
  const [doRamo, usam] = await Promise.all([
    t.where("gerado.sub", "==", ramo === "todos" ? "salao" : ramo).select("name", "site.city", "site.uf").limit(8).get(),
    t.where(`gerado.${campo}.id`, "==", Id.parse(id)).select("name", "site.city", "site.uf", `gerado.${campo}.versao`).limit(20).get(),
  ]);
  // a bio não depende da família do layout: sem negócio do ramo, a prévia usa um salão
  const semRamo = !doRamo.size && campo === "bio" && ramo !== "salao" && ramo !== "todos";
  const reserva = semRamo ? await t.where("gerado.sub", "==", "salao").select("name", "site.city", "site.uf").limit(8).get() : doRamo;
  return {
    doRamo: reserva.docs.map(linha),
    usam: usam.docs.map((d) => ({ ...linha(d), versao: (d.get(`gerado.${campo}.versao`) as number | null | undefined) ?? null })),
  };
});
