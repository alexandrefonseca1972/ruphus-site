#!/usr/bin/env -S npx tsx
/** Clientes gravados com celular sem o 9º dígito (55+DDD+8 dígitos) passam para a chave
 *  canônica, com o 9 (a mesma de customerKey desde a correção M1).
 *
 *   npx tsx --env-file=.env.local scripts/migrar-chave-cliente.mts            # só relatório
 *   npx tsx --env-file=.env.local scripts/migrar-chave-cliente.mts --aplicar  # migra
 *
 * Migra só quem não tem par: se a chave com o 9 já existe (a pessoa marcou dos dois jeitos),
 * o script NÃO junta — lista como DUPLICADO para o dono decidir na mão.
 * Idempotente: a cópia leva "migradoDe"; rodar de novo depois de uma queda termina o que
 * faltou, e um cliente já migrado não aparece mais (a chave antiga deixa de existir). */
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { canonicalBrMobile } from "@/lib/telefone";

async function main() {
  const app =
    getApps()[0] ??
    initializeApp({
      credential: process.env.FIREBASE_SERVICE_ACCOUNT ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) : applicationDefault(),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
  const db = getFirestore(app);
  const aplicar = process.argv.includes("--aplicar");
  let migrar = 0;
  let duplicados = 0;
  for (const c of (await db.collectionGroup("customers").get()).docs) {
    const tenant = c.ref.parent.parent;
    if (!tenant || tenant.parent.id !== "tenants") continue;
    const nova = canonicalBrMobile(c.id);
    if (nova === c.id) continue;
    const destino = tenant.collection("customers").doc(nova);
    const ja = await destino.get();
    if (ja.exists && ja.get("migradoDe") !== c.id) {
      duplicados++;
      console.log(`DUPLICADO ${tenant.id}: ${c.id} e ${nova} — não mexi; juntar à mão`);
      continue;
    }
    migrar++;
    console.log(`${aplicar ? "migrando" : "migraria"} ${tenant.id}: ${c.id} -> ${nova}`);
    if (!aplicar) continue;
    const bw = db.bulkWriter();
    for (const col of ["appointments", "plans", "lancamentos"]) {
      for (const d of (await tenant.collection(col).where("customerKey", "==", c.id).get()).docs) bw.update(d.ref, { customerKey: nova });
    }
    for (const n of (await c.ref.collection("notas").get()).docs) bw.set(destino.collection("notas").doc(n.id), n.data());
    bw.set(destino, { ...c.data(), migradoDe: c.id });
    await bw.close();
    await db.recursiveDelete(c.ref); // só depois de tudo copiado
  }
  console.log(`${aplicar ? "migrados" : "a migrar"}: ${migrar}; duplicados (não mexidos): ${duplicados}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
