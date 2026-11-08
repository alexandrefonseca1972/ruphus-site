#!/usr/bin/env -S npx tsx
/** Distribui os 3 modelos de cada ramo de fitness e automotivo entre os sites de prospecção.
 *
 * Grava o mesmo que "Aplicar modelo" da gaveta (definirModelo em admin/actions.ts):
 * gerado.escolha com o id do modelo, e site.color/site.photo, que a /bio lê.
 * Dentro de cada ramo, ordena por UF, cidade e slug e reparte em rodízio: vizinhos da
 * mesma cidade saem com modelos diferentes. Fica de fora quem é cliente (fechado ou com
 * dono de fora da plataforma) e o site do cadastro, que é do dono.
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/aplicar-modelos.mts            # simula
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/aplicar-modelos.mts --aplicar
 */
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { SUBS, type Sub } from "@/lib/gerador";
import { personalDe } from "@/lib/gerador.server";
import { MODELOS, visualEditorial } from "@/lib/site-editorial";

const aplicar = process.argv.includes("--aplicar");
initializeApp({
  credential: process.env.FIREBASE_SERVICE_ACCOUNT ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) : applicationDefault(),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
});
const db = getFirestore();

const NICHOS = new Set(["fitness", "automotivo"]);
const plataforma = new Set(((await db.doc("config/admin").get()).get("uids") as string[] | undefined) ?? []);
const [tenants, crm] = await Promise.all([db.collection("tenants").get(), db.collection("crm").get()]);
const funil = new Map(crm.docs.map((d) => [d.id, d.data()]));

const porSub = new Map<Sub, typeof tenants.docs>();
const fora: Record<string, number> = {};
for (const t of tenants.docs) {
  const sub = t.get("gerado.sub") as Sub | undefined;
  if (!sub || !SUBS[sub] || !NICHOS.has(SUBS[sub].nicho)) continue;
  const motivo =
    t.get("gerado.origem") === "cadastro" ? "cadastro (do dono)"
    : funil.get(t.id)?.estagio === "fechado" ? "cliente (fechado)"
    : t.get("ownerId") && !plataforma.has(t.get("ownerId")) ? "cliente (dono)"
    : "";
  if (motivo) { fora[motivo] = (fora[motivo] ?? 0) + 1; continue; }
  porSub.set(sub, [...(porSub.get(sub) ?? []), t]);
}

const contagem: Record<string, number> = {};
let lote = db.batch();
let n = 0;
for (const [sub, docs] of porSub) {
  const modelos = MODELOS.filter((m) => m.sub === sub);
  const chave = (t: (typeof docs)[number]) => [t.get("site.uf"), t.get("site.city"), t.id].map((v) => String(v ?? "")).join("|");
  docs.sort((a, b) => chave(a).localeCompare(chave(b), "pt-BR"));
  docs.forEach((t, i) => {
    const m = modelos[i % modelos.length];
    contagem[m.id] = (contagem[m.id] ?? 0) + 1;
    if (!aplicar) return;
    const visual = visualEditorial(t.id, sub, m.escolha, personalDe(t.get("gerado.personal")));
    lote.update(t.ref, { "gerado.escolha": m.escolha, "site.color": visual.cor, "site.photo": visual.foto });
    if (++n % 400 === 0) { void lote.commit(); lote = db.batch(); }
  });
}
if (aplicar && n % 400) await lote.commit();

console.log("fora:", JSON.stringify(fora));
console.log("por modelo:", JSON.stringify(contagem));
console.log(aplicar ? `${n} sites atualizados (o site no ar troca em até 1 minuto)` : "simulação: nada gravado (use --aplicar)");
