#!/usr/bin/env -S npx tsx
/** Põe os sites de podologia no nicho novo: fotos de pés no lugar das de estética.
 *
 * Até aqui "podologia" caía em estética (ou unhas, ou salão) e o site mostrava
 * limpeza de pele e sobrancelha. O sub virou um nicho próprio (SUBS em
 * gerador.ts), com kits em /assets/beleza/podologia-1..4; falta levar os sites
 * que já estão no ar para ele.
 *
 * A escolha antiga de kit/cor é apagada: as paletas do nicho novo são outras e
 * em menor número. Sem escolha, o site sorteia pelo slug, como os sites antigos.
 * Sites de dono cadastrado ficam de fora — quem mexe neles é o dono.
 *
 *   npx tsx --env-file=.env.local scripts/migrar-podologia.mts            # simula
 *   npx tsx --env-file=.env.local scripts/migrar-podologia.mts --aplicar
 */
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { nichoDe, SUBS } from "@/lib/gerador";
import { visualEditorial } from "@/lib/site-editorial";

const aplicar = process.argv.includes("--aplicar");
const app = initializeApp({
  credential: process.env.FIREBASE_SERVICE_ACCOUNT ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) : applicationDefault(),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
});
const db = getFirestore(app);

const snap = await db.collection("tenants").get();
const alvos = snap.docs.filter((d) => {
  const gerado = d.get("gerado");
  if (!gerado || gerado.origem === "cadastro") return false;
  // o nome do negócio é o que o gerador leria da planilha
  return nichoDe({ categoria: "", nome: String(d.get("name") ?? "") })?.sub === "podologia" && gerado.sub !== "podologia";
});

console.log(`${alvos.length} de ${snap.size} sites vão para o nicho podologia${aplicar ? "" : " (simulação)"}`);
let lote = db.batch();
let n = 0;
for (const d of alvos) {
  const visual = visualEditorial(d.id, "podologia");
  console.log(`  ${d.id}: ${d.get("gerado").sub} -> podologia, ${visual.kit}`);
  if (!aplicar) continue;
  lote.update(d.ref, {
    "gerado.nicho": "beleza",
    "gerado.sub": "podologia",
    "gerado.escolha": FieldValue.delete(),
    "gerado.atualizadoEm": FieldValue.serverTimestamp(),
    "site.category": SUBS.podologia.tipo,
    "site.color": visual.cor,
    "site.photo": visual.foto,
  });
  if (++n % 400 === 0) { await lote.commit(); lote = db.batch(); }
}
if (aplicar && n % 400) await lote.commit();
console.log(aplicar ? `${n} sites atualizados` : "nada gravado (sem --aplicar)");
