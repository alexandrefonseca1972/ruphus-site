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

// Criar negócio é só pelo servidor (limite por conta): nem o próprio dono cria pelo app
await assertFails(create(alice, "acme", "alice"));
await env.withSecurityRulesDisabled((ctx) => create(ctx.firestore(), "acme", "alice"));
await assertFails(create(mallory, "acme", "mallory")); // slug já existe
await assertFails(setDoc(doc(mallory, "tenants/x"), { name: "x", ownerId: "alice" })); // sem membro owner
await assertFails(setDoc(doc(mallory, "tenants/acme/members/mallory"), { uid: "mallory", role: "admin" }));

// Isolamento
await assertSucceeds(setDoc(doc(alice, "tenants/acme/sites/s1"), { title: "a" }));
await assertFails(getDoc(doc(mallory, "tenants/acme")));

// Admin da plataforma: entra em qualquer espaço para dar suporte; quem não está na lista, não
await env.withSecurityRulesDisabled((ctx) =>
  setDoc(doc(ctx.firestore(), "config/admin"), { uids: ["suporte"] }),
);
const suporte = as("suporte");
await assertSucceeds(getDoc(doc(suporte, "tenants/acme")));
await assertSucceeds(setDoc(doc(suporte, "tenants/acme/services/corte"), { name: "Corte", durationMin: 30, priceCents: 4000, active: true }));
await assertFails(getDoc(doc(mallory, "config/admin")));   // a lista não é pública
// Dinheiro mora fora do tenant de propósito: dentro dele a regra pega-tudo libera
// coleção nova para qualquer membro, e cobrança não é assunto de quem usa a agenda.
await assertFails(getDoc(doc(alice, "cobrancas/acme-2026-10")), "membro nao le cobranca");
await assertFails(setDoc(doc(alice, "cobrancas/acme-2026-10"), { valorCents: 1 }));
await assertFails(getDoc(doc(alice, "config/pix")), "a chave Pix da Ruphus nao e publica");
await assertFails(getDoc(doc(suporte, "cobrancas/acme-2026-10")), "nem o admin le pelo cliente: so o Admin SDK")
await assertFails(setDoc(doc(suporte, "config/admin"), { uids: ["mallory"] })); // nem o admin escreve nela
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

// Tenant não pode ser apagado pelo app (slug seria recriado por outro com os dados antigos)
await assertFails(deleteDoc(doc(alice, "tenants/acme")));
// Subcoleções aninhadas: nem "members" falso nem nada abaixo de um nível
await assertFails(setDoc(doc(bob, "tenants/acme/services/evil/members/carol"), { uid: "carol", role: "owner" }));
await assertFails(setDoc(doc(bob, "tenants/acme/services/s1/qualquer/x"), { a: 1 }));
await assertSucceeds(setDoc(doc(bob, "tenants/acme/services/s1"), { name: "Corte" }));
// Registro de histórico sozinho, sem a mudança no agendamento
await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "tenants/acme/appointments/solo"), { status: "booked" }));
await assertFails(setDoc(doc(bob, "tenants/acme/history/h-solo"), { appointmentId: "solo", type: "confirmed", at: serverTimestamp(), by: "bob", byName: "bob@teste.dev" }));

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
const imagem = { contentType: "image/png" };
await assertSucceeds(uploadBytes(file("bob", "tenants/acme/logo.png"), bytes(10), imagem));
// só imagem: HTML no bucket viraria página no domínio do Storage
await assertFails(uploadBytes(file("bob", "tenants/acme/pagina.html"), bytes(10), { contentType: "text/html" }));
await assertSucceeds(getBytes(file("alice", "tenants/acme/logo.png")));
await assertFails(getBytes(file("mallory", "tenants/acme/logo.png")));
await assertFails(uploadBytes(file("mallory", "tenants/acme/x.png"), bytes(10), imagem));
await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), "tenants/acme/logo.png")));
await assertFails(uploadBytes(file("alice", "tenants/acme/big.png"), bytes(10 * 1024 * 1024), imagem));
await assertFails(uploadBytes(file("alice", "outro/lugar.png"), bytes(10), imagem));

// Clientes: o que o dono escreve sobre o cliente e dele; nome e telefone nao
await env.withSecurityRulesDisabled((ctx) =>
  setDoc(doc(ctx.firestore(), "tenants/acme/customers/5511999990000"), { name: "Ana", phone: "(11) 99999-0000" }),
);
const cliente = (db) => doc(db, "tenants/acme/customers/5511999990000");

await assertSucceeds(updateDoc(cliente(alice), { semCampanha: true, etiquetas: ["vip", "manha"] }));
await assertFails(updateDoc(cliente(alice), { name: "Outro Nome" }));
await assertFails(updateDoc(cliente(alice), { phone: "(11) 90000-0000" }));
await assertFails(updateDoc(cliente(alice), { semCampanha: "sim" }));
await assertFails(updateDoc(cliente(alice), { etiquetas: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] }));
await assertFails(updateDoc(cliente(mallory), { etiquetas: ["invadido"] }));
await assertFails(getDoc(cliente(mallory)));

const notas = (db) => collection(db, "tenants/acme/customers/5511999990000/notas");
const nota = (extra = {}) => ({
  texto: "Alergica a acetona. Prefere manha.",
  quando: serverTimestamp(),
  por: "alice",
  porNome: "alice@teste.dev",
  ...extra,
});
await assertSucceeds(setDoc(doc(notas(alice), "n1"), nota()));
await assertFails(setDoc(doc(notas(alice), "n2"), nota({ por: "bob" })), "nao da para assinar no lugar de outro");
await assertFails(setDoc(doc(notas(alice), "n3"), nota({ porNome: "outro@teste.dev" })));
await assertFails(setDoc(doc(notas(alice), "n4"), nota({ quando: new Date(0) })), "a data e a do servidor");
await assertFails(setDoc(doc(notas(alice), "n5"), nota({ texto: "" })));
await assertFails(setDoc(doc(notas(alice), "n6"), nota({ texto: "x".repeat(601) })));
await assertFails(setDoc(doc(notas(alice), "n7"), nota({ extra: "campo a mais" })));
await assertFails(updateDoc(doc(notas(alice), "n1"), { texto: "reescrito" }), "anotacao nao se reescreve");
await assertSucceeds(deleteDoc(doc(notas(alice), "n1")));
await assertFails(getDocs(notas(mallory)));

// Limite de profissionais: o dono muda o nome do negócio, mas não o próprio limite
await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "tenants/acme"), { name: "acme", ownerId: "alice", limiteStaff: 5 }));
await assertSucceeds(setDoc(doc(alice, "tenants/acme"), { name: "Acme Salão", ownerId: "alice", limiteStaff: 5 }));
await assertFails(setDoc(doc(alice, "tenants/acme"), { name: "Acme Salão", ownerId: "alice", limiteStaff: 50 }));
await assertFails(setDoc(doc(alice, "tenants/acme"), { name: "Acme Salão", ownerId: "alice" })); // apagar também é mudar

// Profissional novo só pelo servidor (é lá que o limite do plano é contado)
await assertFails(setDoc(doc(alice, "tenants/acme/staff/novo"), { name: "Bia", active: true }));
await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "tenants/acme/staff/bia"), { name: "Bia", active: true }));
await assertSucceeds(setDoc(doc(alice, "tenants/acme/staff/bia"), { name: "Bia Souza", active: true }));
await assertSucceeds(deleteDoc(doc(alice, "tenants/acme/staff/bia")));

// Coleção que ninguém liberou nasce negada (antes o coringa abria tudo)
await assertFails(setDoc(doc(alice, "tenants/acme/inventada/x"), { a: 1 }));
await assertFails(getDoc(doc(alice, "tenants/acme/inventada/x")));

// "viaConvite" é do servidor: sem isto dá para queimar a cota de outra conta
await assertFails(setDoc(doc(alice, "tenants/acme/members/vitima"), { uid: "vitima", role: "admin", viaConvite: true }));
await assertSucceeds(setDoc(doc(alice, "tenants/acme/members/vitima"), { uid: "vitima", role: "admin" }));
await assertFails(setDoc(doc(alice, "tenants/acme/members/vitima"), { uid: "vitima", role: "admin", viaConvite: true }));

await env.cleanup();
console.log("rules ok");
