// Cobrança de R$ 0,01 num tenant descartável, para o teste no app do banco.
//   npx tsx --conditions=react-server --env-file=.env.local teste-cobranca.mts criar|apagar
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { gerarCobranca, lerPix } from "@/lib/cobranca";
import { brCode } from "@/lib/pix";

const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID }));
const SLUG = "zz-teste-cobranca";

if (process.argv[2] === "criar") {
  await db.collection("tenants").doc(SLUG).set({ name: "Teste Ruphus", site: { phone: null, city: "São Paulo" }, teste: true });
  await db.collection("crm").doc(SLUG).set({ estagio: "fechado", mensalCents: 1, publicado: false });
  const c = await gerarCobranca(db, { slug: SLUG, tipo: "mensal", competencia: "2026-09", valorCents: 1 });
  const pix = await lerPix(db);
  console.log("LINK https://www.ruphus.site/pagar/" + c.id + "?t=" + c.token);
  console.log("COPIACOLA " + brCode({ ...pix, valorCents: 1, txid: "ZZTESTECOBRANCAM2609" }));
} else {
  for (const col of ["cobrancas"]) {
    const snap = await db.collection(col).where("slug", "==", SLUG).get();
    for (const d of snap.docs) await d.ref.delete();
  }
  await db.collection("crm").doc(SLUG).delete();
  await db.collection("tenants").doc(SLUG).delete();
  console.log("apagado");
}
process.exit(0);
