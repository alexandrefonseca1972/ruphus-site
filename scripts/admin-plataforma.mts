// Quem pode abrir /admin. Sem ninguém na lista, a área fica fechada para todos.
//
//   npm run admin -- add <uid|email>
//   npm run admin -- list
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const app = initializeApp({
  credential: process.env.FIREBASE_SERVICE_ACCOUNT
    ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
    : applicationDefault(),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
});
const db = getFirestore(app);
const ref = db.doc("config/admin");
const [acao, quem] = process.argv.slice(2);

if (acao === "add" && quem) {
  const uid = quem.includes("@") ? (await getAuth(app).getUserByEmail(quem)).uid : quem;
  await ref.set({ uids: FieldValue.arrayUnion(uid) }, { merge: true });
  console.log(`${uid} agora administra a plataforma`);
} else if (acao === "remove" && quem) {
  await ref.set({ uids: FieldValue.arrayRemove(quem) }, { merge: true });
  console.log(`${quem} não administra mais`);
} else {
  console.log("admins:", (await ref.get()).get("uids") ?? []);
  if (acao !== "list") console.log("uso: npm run admin -- add|remove <uid|email> | list");
}
