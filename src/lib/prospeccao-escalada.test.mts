// Rode: npm run test:prospeccao-escalada  (M-4: lista de escaladas e "tratada" no admin; parte pura e
// emulador demo-siteflow com Firestore e Auth; nada sai para a rede)
import assert from "node:assert/strict";
import { getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/admin";
import { limparEscaladaAction, listarEscaladosAction } from "@/app/admin/prospeccao-actions";
import { listarEscalados, paraEscalado } from "@/lib/prospeccao-escalada.server";

// ————— puro: máscara, slug confirmado, motivo, 3 últimas falas —————
const falas = [1, 2, 3, 4, 5].map((i) => ({ de: i % 2 ? ("lead" as const) : ("ruphus" as const), texto: `fala ${i}` }));
const e = paraEscalado("5585991470031", { escaladoEm: 1000, motivoEscalada: "pediu preço", slug: "salao-x", slugAlegado: "outro", historico: falas })!;
assert.deepEqual(e, { telefone: "5585991470031", telefoneMascarado: "…0031", slug: "salao-x", motivo: "pediu preço", em: 1000, falas: falas.slice(-3) });
assert.ok(!JSON.stringify({ ...e, telefone: "" }).includes("99147"), "fora da chave, o telefone só sai mascarado");
const sem = paraEscalado("5585991470031", { escaladoEm: Timestamp.fromMillis(2000), slugAlegado: "outro", historico: "torto" })!;
assert.deepEqual([sem.slug, sem.motivo, sem.em, sem.falas], [null, "sem motivo registrado", 2000, []], "slug alegado não entra; histórico torto vira vazio");
assert.equal(paraEscalado("5585991470031", { motivoEscalada: "x" }), null, "sem escaladoEm não é escalada");
assert.equal(paraEscalado("123", { escaladoEm: 1 }), null, "id que não é telefone fica de fora");

// ————— emulador —————
assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, "rode pelo emulador (npm run test:prospeccao-escalada)");
assert.equal(process.env.RUPHUS_E2E, "1", "o token do emulador só vale com RUPHUS_E2E=1");
const db = adminDb;
const C = "prospeccaoConversas";
const [A, B, CALMA] = ["5585991470031", "5585991470032", "5585991470033"];
for (const t of [A, B, CALMA]) await db.recursiveDelete(db.doc(`${C}/${t}`));
await db.doc(`${C}/${A}`).set({ escaladoEm: 1000, motivoEscalada: "pediu preço", slug: "salao-x", historico: falas });
await db.doc(`${C}/${B}`).set({ escaladoEm: 5000, motivoEscalada: "áudio", historico: [] });
await db.doc(`${C}/${CALMA}`).set({ historico: falas, turnos: { dia: "2026-11-12", n: 1 } });

// listar só escaladas, a mais recente primeiro
assert.deepEqual((await listarEscalados(db)).map((x) => x.telefone), [B, A]);

// actions: só admin
async function tokenDe(uid: string) {
  const custom = await getAuth().createCustomToken(uid);
  const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  return ((await r.json()) as { idToken: string }).idToken;
}
await db.doc("config/admin").set({ uids: ["admin-escalada"], revogados: {} }, { merge: true });
const admin = await tokenDe("admin-escalada");
const intruso = await tokenDe("intruso-escalada");

assert.deepEqual(await listarEscaladosAction(intruso), { ok: false, error: "Área restrita." }, "não-admin não lista");
assert.deepEqual(await limparEscaladaAction(intruso, A), { ok: false, error: "Área restrita." }, "não-admin não limpa");
assert.equal((await listarEscaladosAction("token-falso")).ok, false);
assert.ok((await db.doc(`${C}/${A}`).get()).get("escaladoEm"), "a recusa não mexeu na conversa");

const lista = await listarEscaladosAction(admin);
assert.ok(lista.ok);
assert.deepEqual(lista.dados.map((x) => [x.telefoneMascarado, x.slug, x.motivo]), [["…0032", null, "áudio"], ["…0031", "salao-x", "pediu preço"]]);

// limpar: tira escaladoEm, registra o evento, e a conversa sai da lista
assert.deepEqual(await limparEscaladaAction(admin, "123"), { ok: false, error: "Telefone inválido." });
assert.deepEqual(await limparEscaladaAction(admin, CALMA), { ok: false, error: "Essa conversa não está escalada." });
assert.deepEqual(await limparEscaladaAction(admin, A), { ok: true, dados: undefined });
const depois = (await db.doc(`${C}/${A}`).get()).data()!;
assert.equal(depois.escaladoEm, undefined);
assert.equal(depois.motivoEscalada, undefined);
assert.deepEqual(depois.historico, falas, "o histórico fica");
const eventos = (await db.collection(`${C}/${A}/eventos`).get()).docs.map((d) => d.data());
assert.equal(eventos.length, 1);
assert.deepEqual([eventos[0].tipo, eventos[0].motivo, eventos[0].escaladoEm, eventos[0].por], ["escalada_tratada", "pediu preço", 1000, "admin-escalada"]);
assert.ok(eventos[0].expiraEm instanceof Timestamp, "evento com TTL");
assert.deepEqual((await listarEscalados(db)).map((x) => x.telefone), [B]);
assert.deepEqual(await limparEscaladaAction(admin, A), { ok: false, error: "Essa conversa não está escalada." }, "tratar de novo é recusado");

for (const t of [A, B, CALMA]) await db.recursiveDelete(db.doc(`${C}/${t}`));
console.log("prospeccao-escalada: ok");
