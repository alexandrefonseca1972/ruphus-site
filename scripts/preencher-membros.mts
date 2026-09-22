// Preenche e-mail e nome nos acessos antigos, para o /admin mostrar quem é quem.
// Os novos já nascem com eles (criar negócio e aceitar convite); estes vieram antes.
// O Admin Auth não roda na Vercel, por isso a cópia é feita daqui, uma vez.
//
//   npm run membros            (só mostra o que faria)
//   npm run membros -- --aplicar
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const app = initializeApp({
  credential: process.env.FIREBASE_SERVICE_ACCOUNT
    ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
    : applicationDefault(),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
});
const db = getFirestore(app);
const aplicar = process.argv.includes("--aplicar");

const faltando = (await db.collectionGroup("members").get()).docs.filter(
  (d) => d.ref.parent.parent?.parent.id === "tenants" && !d.get("email"),
);
// Um usuário costuma estar em vários negócios (o admin, em todos): busca cada um uma vez
const uids = [...new Set(faltando.map((d) => d.id))];
const usuarios = new Map<string, { email?: string; nome?: string }>();
for (let i = 0; i < uids.length; i += 100) {
  const { users } = await getAuth(app).getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })));
  for (const u of users) usuarios.set(u.uid, { email: u.email, nome: u.displayName?.trim() || undefined });
}

let gravados = 0;
// BulkWriter divide sozinho em lotes: o admin está em centenas de negócios (passa das 500 escritas de um batch)
const escritor = aplicar ? db.bulkWriter() : null;
for (const d of faltando) {
  const u = usuarios.get(d.id);
  if (!u?.email) continue;
  escritor?.update(d.ref, { email: u.email, ...(u.nome && { nome: u.nome }) });
  gravados++;
}
console.log(`${faltando.length} acesso(s) sem e-mail, ${uids.length} pessoa(s); ${gravados} a preencher.`);
for (const [uid, u] of usuarios) console.log(`  ${uid} → ${u.email ?? "(sem e-mail)"}${u.nome ? ` · ${u.nome}` : ""}`);
if (escritor) {
  await escritor.close();
  console.log(`${gravados} gravado(s).`);
} else if (gravados) console.log("nada gravado: rode com --aplicar.");
