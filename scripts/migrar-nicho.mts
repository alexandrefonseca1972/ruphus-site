#!/usr/bin/env -S npx tsx
/** Completa gerado.nicho nos sites que têm gerado.sub mas não têm o nicho.
 *
 * O converter-fabrica gravava só o sub, e o painel lê tenant.gerado.nicho.
 * O nicho sai de SUBS[sub].nicho. Só preenche o que está vazio; não toca no resto.
 *
 *   npx tsx --env-file=.env.local scripts/migrar-nicho.mts            # simula
 *   npx tsx --env-file=.env.local scripts/migrar-nicho.mts --aplicar
 */
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { SUBS, type Sub } from "@/lib/gerador";

const aplicar = process.argv.includes("--aplicar");
initializeApp({
  credential: process.env.FIREBASE_SERVICE_ACCOUNT ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) : applicationDefault(),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
});
const db = getFirestore();

const alvo = (await db.collection("tenants").get()).docs.filter((d) => {
  const g = d.get("gerado");
  return g && !g.nicho && g.sub in SUBS;
});
const porNicho: Record<string, number> = {};
for (const d of alvo) porNicho[SUBS[d.get("gerado.sub") as Sub].nicho] = (porNicho[SUBS[d.get("gerado.sub") as Sub].nicho] ?? 0) + 1;
console.log(`${alvo.length} sites sem gerado.nicho:`, JSON.stringify(porNicho));

if (aplicar) {
  for (let i = 0; i < alvo.length; i += 400) {
    const lote = db.batch();
    for (const d of alvo.slice(i, i + 400)) lote.update(d.ref, { "gerado.nicho": SUBS[d.get("gerado.sub") as Sub].nicho });
    await lote.commit();
  }
  console.log("gravado.");
} else console.log("simulação: nada gravado (use --aplicar).");
