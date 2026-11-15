// Rode: npm run test:espera-f3  (entrada e saída da fila de espera pela rota pública, no emulador do Firestore)
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { adminDb as db } from "@/lib/admin";
import { book, deviceId } from "@/lib/booking.server";
import { addDays, customerKey, todayIn } from "@/lib/datetime";
import { EntradaEsperaInput } from "@/lib/fila-espera";
import { entrarNaFila, esperasAtivas, sairDaFila } from "@/lib/fila-espera.server";
import { TERMO_ESPERA_VERSAO } from "@/lib/consentimento-whatsapp";

const slug = "espera-site";
const t = db.doc(`tenants/${slug}`);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const date = addDays(todayIn(), 7);
const ip = "189.6.10.20";
const telA = "11 91234-5678";
const telB = "11 98765-4321";
const telC = "11 97777-0001";

// Limpa o que este teste usa e monta o negócio: uma atendente com 60 min, e uma segunda para os agendamentos de B
await db.recursiveDelete(t);
await t.set({ name: "Espera Site", ownerId: "dona" });
await t.collection("services").doc("corte").set({ name: "Corte", durationMin: 60, priceCents: 5000, active: true });
const hours = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, { start: "09:00", end: "12:00" }]));
await t.collection("staff").doc("ana").set({ name: "Ana", serviceIds: ["corte"], hours, active: true });
await t.collection("staff").doc("bia").set({ name: "Bia", serviceIds: ["corte"], hours, active: true });

const entrada = (over: Record<string, unknown> = {}) =>
  EntradaEsperaInput.parse({
    tenantId: slug,
    serviceIds: ["corte"],
    staffId: "ana",
    date,
    customerName: "Maria Silva",
    customerPhone: telA,
    preferido: "10:00",
    aceite: true,
    token: "tokenAAAAAAAAAAAAAAAA",
    ...over,
  });

// Agenda da Ana: 10:00 (outro cliente) e 11:00 (cliente A). Ocupados para a fila são o começo de
// cada atendimento (10:00 e 11:00); 09:00 segue livre.
const agendou = (r: Awaited<ReturnType<typeof book>>) => {
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.ok ? r.id : "";
};
const apt10 = agendou(await book(db, { tenantId: slug, serviceIds: ["corte"], staffId: "ana", date, time: "10:00", customerName: "Outro Cliente", customerPhone: "11 90000-1111" }));
const aptA = agendou(await book(db, { tenantId: slug, serviceIds: ["corte"], staffId: "ana", date, time: "11:00", customerName: "Maria Silva", customerPhone: telA }));
const aptB = agendou(await book(db, { tenantId: slug, serviceIds: ["corte"], staffId: "bia", date, time: "09:00", customerName: "Bruno Lima", customerPhone: telB }));
assert.ok(apt10 && aptA && aptB);

// 1. Sem a fila ligada, nada entra
assert.deepEqual(await entrarNaFila(db, entrada(), ip), { ok: false, error: "Este negócio não usa fila de espera." });
await t.update({ "modulos.espera": true });

// 2. Horário livre: não entra na fila, manda agendar
assert.deepEqual(await entrarNaFila(db, entrada({ preferido: "09:00" }), ip), {
  ok: false,
  vagou: true,
  error: "Boa notícia: esse horário vagou. Agende agora.",
});

// 3. Horário que não é começo de atendimento (10:30, no meio do das 10:00): recusa
assert.deepEqual(await entrarNaFila(db, entrada({ preferido: "10:30" }), ip), {
  ok: false,
  error: "Esse horário não está disponível para aviso. Escolha outro.",
});

// 4. Entrada válida: documento com o token só em hash e o aceite gravado
const agora1 = new Date("2030-01-01T10:00:00Z");
const r1 = await entrarNaFila(db, entrada(), ip, agora1);
assert.equal(r1.ok, true, JSON.stringify(r1));
if (!r1.ok) throw new Error("entrada válida recusada");
assert.equal(r1.tipo, "esperar");
assert.equal(r1.id.length, 40);
const doc1 = (await t.collection("espera").doc(r1.id).get()).data()!;
assert.equal(doc1.status, "aguardando");
assert.equal(doc1.tokenHash, sha("tokenAAAAAAAAAAAAAAAA"));
assert.notEqual(doc1.tokenHash, "tokenAAAAAAAAAAAAAAAA", "o token não vai para o banco");
assert.equal(doc1.customerKey, customerKey(telA));
assert.equal(doc1.telefone, customerKey(telA));
assert.equal(doc1.staffId, "ana");
assert.equal(doc1.consentimento.versao, TERMO_ESPERA_VERSAO);
assert.equal(doc1.consentimento.aceito, true);
assert.equal(doc1.criadaEm, agora1.getTime());
assert.deepEqual(doc1.avisos, []);

// 5. Mesmo pedido, do mesmo aparelho (mesmo token): mesmo documento, preferido trocado, criadaEm intacto
const agora2 = new Date("2030-01-01T11:00:00Z");
const r2 = await entrarNaFila(db, entrada({ preferido: "11:00", customerName: "Maria Souza" }), ip, agora2);
assert.deepEqual(r2, { ok: true, id: r1.id, tipo: "esperar", data: date, preferido: "11:00" });
const doc2 = (await t.collection("espera").doc(r1.id).get()).data()!;
assert.equal(doc2.preferido, "11:00");
assert.equal(doc2.tokenHash, sha("tokenAAAAAAAAAAAAAAAA"));
assert.equal(doc2.criadaEm, agora1.getTime(), "criadaEm não muda na repetição");
assert.equal(doc2.nome, "Maria Souza");

// 5b. Outra pessoa com o mesmo telefone (token diferente) não muda nem toma a espera
const sequestro = await entrarNaFila(db, entrada({ preferido: "10:00", token: "tokenBBBBBBBBBBBBBBBB" }), "203.0.113.9");
assert.equal(sequestro.ok, false, "sem o token não muda");
assert.equal(!sequestro.ok && sequestro.error, "Não foi possível alterar este aviso por aqui. Se você já pediu em outro aparelho, use aquele ou responda SAIR no WhatsApp.", "neutra: não confirma que o telefone tem espera");
const doc2b = (await t.collection("espera").doc(r1.id).get()).data()!;
assert.equal(doc2b.preferido, "11:00");
assert.equal(doc2b.tokenHash, sha("tokenAAAAAAAAAAAAAAAA"), "o token de quem pediu continua");

// 6. Troca: agendamento de outro telefone não vale
assert.deepEqual(
  await entrarNaFila(db, entrada({ customerPhone: telC, agendamentoId: aptA, preferido: "10:00", token: "tokenCCCCCCCCCCCCCCCC" }), ip),
  { ok: false, error: "Não encontramos o seu agendamento deste dia." },
);

// 7. Troca: a espera simples do dia não conta (a troca a substitui); três em outros dias completam o limite
for (const n of [1, 2, 3]) {
  await t.collection("espera").doc(`semente-${n}`).set({
    tipo: "esperar", customerKey: customerKey(telA), nome: "Maria Silva", telefone: customerKey(telA), serviceIds: ["corte"], staffId: "ana",
    data: addDays(date, n), preferido: "10:00", status: "aguardando", criadaEm: 1, avisos: [], tokenHash: "x",
  });
}
assert.deepEqual(
  await entrarNaFila(db, entrada({ agendamentoId: aptA, preferido: "10:00", token: "tokenCCCCCCCCCCCCCCCC" }), ip),
  { ok: false, error: "Limite de avisos deste número neste negócio. Saia de uma espera para pedir outra." },
);

// 8. Troca válida: B tem horário marcado às 09:00 e quer trocar para 10:00 (ocupado para a Ana)
const rt = await entrarNaFila(db, entrada({ customerPhone: telB, customerName: "Bruno Lima", agendamentoId: aptB, preferido: "10:00", token: "tokenDDDDDDDDDDDDDDDD" }), ip);
assert.equal(rt.ok, true, JSON.stringify(rt));
if (!rt.ok) throw new Error("troca válida recusada");
assert.equal(rt.tipo, "troca");
assert.equal(rt.id === r1.id, false, "troca é outro documento");
assert.equal((await t.collection("espera").doc(rt.id).get()).get("agendamentoId"), aptB);

// 8b. Ativas: só as do token certo e ainda aguardando/avisadas (a página tira as outras)
assert.deepEqual(await esperasAtivas(db, slug, [{ id: r1.id, token: "tokenAAAAAAAAAAAAAAAA" }, { id: rt.id, token: "tokenZZZZZZZZZZZZZZZZ" }, { id: "nao-existe", token: "tokenAAAAAAAAAAAAAAAA" }]), [r1.id]);

// 9. Sair: token errado não sai; o certo sai, e de novo também
assert.deepEqual(await sairDaFila(db, slug, r1.id, "tokenZZZZZZZZZZZZZZZZ"), { ok: false, error: "Não encontramos esta espera." });
assert.deepEqual(await sairDaFila(db, slug, r1.id, "tokenAAAAAAAAAAAAAAAA"), { ok: true });
assert.equal((await t.collection("espera").doc(r1.id).get()).get("status"), "saiu");
assert.deepEqual(await sairDaFila(db, slug, r1.id, "tokenAAAAAAAAAAAAAAAA"), { ok: true }, "repetir é idempotente");
assert.deepEqual(await esperasAtivas(db, slug, [{ id: r1.id, token: "tokenAAAAAAAAAAAAAAAA" }]), [], "a que saiu não é mais ativa");

// 10. Troca fecha a espera simples do mesmo dia (não avisa o mesmo cliente duas vezes)
const simples = await entrarNaFila(db, entrada({ customerPhone: telC, customerName: "Carla Dias", preferido: "10:00", token: "tokenEEEEEEEEEEEEEEEE" }), ip);
assert.equal(simples.ok, true, JSON.stringify(simples));
const aptC = agendou(await book(db, { tenantId: slug, serviceIds: ["corte"], staffId: "bia", date, time: "11:00", customerName: "Carla Dias", customerPhone: telC }));
const trocaC = await entrarNaFila(db, entrada({ customerPhone: telC, customerName: "Carla Dias", agendamentoId: aptC, preferido: "10:00", token: "tokenEEEEEEEEEEEEEEEE" }), ip);
assert.equal(trocaC.ok, true, JSON.stringify(trocaC));
if (simples.ok) assert.equal((await t.collection("espera").doc(simples.id).get()).get("status"), "saiu", "a espera simples virou troca");

// 11. Limite por aparelho: o 11º pedido do dia do mesmo IP é recusado antes de ler a agenda
const ipCheio = "198.51.100.77";
await t.collection("limits").doc(`espera-device-${deviceId(ipCheio)}-${todayIn()}`).set({ count: 10 });
assert.deepEqual(await entrarNaFila(db, entrada({ customerPhone: telC, token: "tokenFFFFFFFFFFFFFFFF" }), ipCheio), { ok: false, error: "Muitos pedidos deste aparelho hoje. Tente amanhã." });

console.log("espera-entrada: ok");
