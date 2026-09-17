// Rode: npm run test:rules
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collectionGroup, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { readFileSync } from "node:fs";

const env = await initializeTestEnvironment({
  projectId: "demo-siteflow",
  firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
});
const as = (uid) => env.authenticatedContext(uid).firestore();

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

await env.cleanup();
console.log("rules ok");
