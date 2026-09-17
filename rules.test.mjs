// Rode: npm run test:rules
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";
import { readFileSync } from "node:fs";

const env = await initializeTestEnvironment({
  projectId: "demo-siteflow",
  firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  storage: { rules: readFileSync("storage.rules", "utf8"), host: "127.0.0.1", port: 9199 },
});
const as = (uid) => env.authenticatedContext(uid, { email: `${uid}@teste.dev` }).firestore();

function create(db, slug, uid) {
  const b = writeBatch(db);
  b.set(doc(db, "tenants", slug), { name: slug, ownerId: uid });
  b.set(doc(db, `tenants/${slug}/members/${uid}`), { uid, role: "owner" });
  return b.commit();
}

const alice = as("alice"), bob = as("bob"), mallory = as("mallory");

await assertSucceeds(create(alice, "acme", "alice"));
await assertFails(create(mallory, "acme", "mallory")); // slug já existe
await assertFails(setDoc(doc(mallory, "tenants/x"), { name: "x", ownerId: "alice" })); // sem membro owner
await assertFails(setDoc(doc(mallory, "tenants/acme/members/mallory"), { uid: "mallory", role: "admin" }));

// Isolamento
await assertSucceeds(setDoc(doc(alice, "tenants/acme/sites/s1"), { title: "a" }));
await assertFails(getDoc(doc(mallory, "tenants/acme")));
await assertFails(getDoc(doc(mallory, "tenants/acme/sites/s1")));
await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "tenants/acme")));

// Papéis
await assertSucceeds(setDoc(doc(alice, "tenants/acme/members/bob"), { uid: "bob", role: "member" }));
await assertSucceeds(getDoc(doc(bob, "tenants/acme/sites/s1")));
await assertFails(setDoc(doc(bob, "tenants/acme/members/mallory"), { uid: "mallory", role: "member" }));
await assertFails(updateDoc(doc(bob, "tenants/acme/members/bob"), { role: "admin" })); // auto-promoção
await assertFails(setDoc(doc(alice, "tenants/acme/members/bob"), { uid: "bob", role: "owner" }));
await assertSucceeds(updateDoc(doc(alice, "tenants/acme/members/bob"), { role: "admin" }));
await assertFails(updateDoc(doc(bob, "tenants/acme/members/alice"), { role: "member" })); // admin não rebaixa owner
await assertFails(updateDoc(doc(bob, "tenants/acme"), { ownerId: "bob" }));

// Meus tenants
await assertSucceeds(getDocs(query(collectionGroup(bob, "members"), where("uid", "==", "bob"))));
await assertFails(getDocs(collectionGroup(mallory, "members")));

// Agendamentos + histórico (criados pelo servidor; aqui simulados sem regras)
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "tenants/acme/appointments/a1"), { status: "booked", start: new Date(), customerName: "X" });
  await setDoc(doc(db, "tenants/acme/history/old"), { appointmentId: "a1", type: "created", by: "cliente" });
});
function changeStatus(db, uid, status, { apptId = "a1", type = status, byName = `${uid}@teste.dev`, extra = {}, apptExtra = {}, reuse } = {}) {
  const h = reuse ? doc(db, "tenants/acme/history", reuse) : doc(collection(db, "tenants/acme/history"));
  const b = writeBatch(db);
  b.set(h, { appointmentId: apptId, type, at: serverTimestamp(), by: uid, byName, ...extra });
  b.update(doc(db, "tenants/acme/appointments", apptId), { status, lastHistoryId: h.id, ...apptExtra });
  return b.commit();
}
await assertFails(updateDoc(doc(bob, "tenants/acme/appointments/a1"), { status: "confirmed" })); // sem histórico
await assertFails(changeStatus(mallory, "mallory", "confirmed")); // não membro
await assertFails(changeStatus(bob, "bob", "confirmed", { type: "cancelled" })); // histórico mente o tipo
await assertFails(changeStatus(bob, "bob", "confirmed", { byName: "alice@teste.dev" })); // se passa por outro
await assertFails(changeStatus(bob, "bob", "confirmed", { reuse: "old" })); // reaproveita registro existente
await assertFails(updateDoc(doc(bob, "tenants/acme/appointments/a1"), { status: "cancelled", lastHistoryId: "old" })); // aponta para registro antigo
await assertFails(changeStatus(bob, "bob", "confirmed", { apptExtra: { start: new Date(0) } })); // muda horário pelo cliente
await assertFails(changeStatus(bob, "bob", "confirmed", { extra: { note: "x" } })); // campo extra
await assertFails(changeStatus(bob, "bob", "booked")); // status inválido
await assertSucceeds(changeStatus(bob, "bob", "confirmed"));
await assertSucceeds(changeStatus(alice, "alice", "no_show"));
await assertFails(changeStatus(alice, "alice", "confirmed")); // falta é final no painel
await assertFails(updateDoc(doc(alice, "tenants/acme/history/old"), { type: "x" }));
await assertFails(deleteDoc(doc(alice, "tenants/acme/history/old")));
await assertFails(deleteDoc(doc(alice, "tenants/acme/appointments/a1")));
await assertFails(setDoc(doc(alice, "tenants/acme/appointments/novo"), { status: "booked" })); // só o servidor cria
await assertSucceeds(getDocs(query(collection(bob, "tenants/acme/history"), where("appointmentId", "==", "a1"))));
await assertFails(getDocs(query(collection(mallory, "tenants/acme/history"), where("appointmentId", "==", "a1"))));

// Clientes e planos: membros leem, ninguém grava pelo app
await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "tenants/acme/customers/5511912345678"), { name: "X" }));
await assertSucceeds(getDoc(doc(bob, "tenants/acme/customers/5511912345678")));
await assertFails(getDoc(doc(mallory, "tenants/acme/customers/5511912345678")));
await assertFails(setDoc(doc(alice, "tenants/acme/customers/5511912345678"), { name: "Y" }));
await assertFails(setDoc(doc(alice, "tenants/acme/plans/p1"), { status: "active" }));
await assertSucceeds(getDocs(collection(bob, "tenants/acme/plans")));

// Storage (bob é admin de acme, mallory não é membro)
const file = (uid, path) => ref(env.authenticatedContext(uid).storage(), path);
const bytes = (n) => new Uint8Array(n);
await assertSucceeds(uploadBytes(file("bob", "tenants/acme/logo.png"), bytes(10)));
await assertSucceeds(getBytes(file("alice", "tenants/acme/logo.png")));
await assertFails(getBytes(file("mallory", "tenants/acme/logo.png")));
await assertFails(uploadBytes(file("mallory", "tenants/acme/x.png"), bytes(10)));
await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), "tenants/acme/logo.png")));
await assertFails(uploadBytes(file("alice", "tenants/acme/big.bin"), bytes(10 * 1024 * 1024)));
await assertFails(uploadBytes(file("alice", "outro/lugar.png"), bytes(10)));

await env.cleanup();
console.log("rules ok");
