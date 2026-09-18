// Gera o link de convite de um espaço: quem abrir e entrar vira admin dele.
//
//   npm run convite -- barbeariasoul [outro-slug ...]
//   npx tsx scripts/convite.mts --self-check
import assert from "node:assert/strict";
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { criarConvite, lerConvite } from "@/lib/convite";

const BASE = process.env.SITE_URL ?? "https://www.ruphus.site";

function db() {
  const app = initializeApp({
    credential: process.env.FIREBASE_SERVICE_ACCOUNT
      ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
      : applicationDefault(),
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
  return getFirestore(app);
}

async function selfCheck() {
  const d = db();
  const token = await criarConvite(d, "espaco-de-teste");
  assert.equal(await lerConvite(d, token), "espaco-de-teste");
  assert.equal(await lerConvite(d, token + "x"), null); // assinatura adulterada não passa
  assert.equal(await lerConvite(d, "nada"), null);
  console.log("self-check ok");
}

const args = process.argv.slice(2);
if (args.includes("--self-check")) {
  await selfCheck();
} else if (!args.length) {
  console.error("informe o slug do espaço: npm run convite -- barbeariasoul");
  process.exit(1);
} else {
  const d = db();
  for (const slug of args) {
    const tenant = await d.collection("tenants").doc(slug).get();
    if (!tenant.exists) {
      console.error(`${slug}: espaço não encontrado`);
      continue;
    }
    console.log(`${tenant.get("name")}\n  ${BASE}/convite?c=${await criarConvite(d, slug)}\n`);
  }
}
