// Rode: npm run test:espera-f1  (fila de espera: pedido do dono e ligar/desligar pelo admin, no emulador do Firestore)
import assert from "node:assert/strict";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb as db } from "@/lib/admin";
import { cancelarSolicitacaoEspera, definirEspera, estadoEspera, solicitarEspera } from "@/lib/espera-solicitacao.server";

const slug = "espera-salao";
const t = db.doc(`tenants/${slug}`);

// Limpa o que este teste usa (o negócio e tudo que ficou embaixo dele)
await db.recursiveDelete(t);
await t.set({ name: "Salão Espera", ownerId: "dona" });

// 0. Cancelar sem pedido não faz nada
assert.deepEqual(await cancelarSolicitacaoEspera(db, slug, 500), { ligado: false, pedido: null });

// 1. Sem campos: nada ligado, nenhum pedido
assert.deepEqual(await estadoEspera(db, slug), { ligado: false, pedido: null });

// O alerta é falso: grava o que foi chamado, sem e-mail de verdade
const chamadas: string[] = [];
const alertar = async (_db: unknown, chave: string) => {
  chamadas.push(chave);
};

// 2. Pedido pendente com a hora dele, e um alerta para a Ruphus
const e1 = await solicitarEspera(db, slug, "dona", { alertar, agora: 1000 });
assert.deepEqual(e1.pedido, { status: "pendente", em: 1000 });
assert.deepEqual(chamadas, [`espera:${slug}:1000`], "chave por pedido: o alertarAdmin segura 6 h por chave");

// 3. Pedir de novo enquanto está pendente: mesmo pedido, sem novo alerta
const e2 = await solicitarEspera(db, slug, "dona", { alertar, agora: 2000 });
assert.deepEqual(e2.pedido, { status: "pendente", em: 1000 });
assert.equal(chamadas.length, 1, "não alerta de novo");

// 4. Cancelar muda o status; cancelar de novo não faz nada
const c1 = await cancelarSolicitacaoEspera(db, slug, 3000);
assert.equal(c1.pedido?.status, "cancelada");
await cancelarSolicitacaoEspera(db, slug, 4000);
assert.equal((await t.get()).get("solicitacoes.espera.canceladaEm"), 3000, "segunda vez não mexe");

// 5. Depois de cancelada, pedir de novo volta a pendente e alerta outra vez
const e3 = await solicitarEspera(db, slug, "dona", { alertar, agora: 5000 });
assert.deepEqual(e3.pedido, { status: "pendente", em: 5000 });
assert.equal(chamadas.length, 2, "alerta do segundo pedido");
assert.notEqual(chamadas[1], chamadas[0], "chave nova, senão o e-mail ficaria preso na janela de 6 h");

// 6. Ligar pelo admin atende o pedido pendente
const e4 = await definirEspera(db, slug, true, 6000);
assert.equal(e4.ligado, true);
assert.equal(e4.pedido?.status, "atendida");

// 7. Com a fila ligada, pedir é recusado
await assert.rejects(solicitarEspera(db, slug, "dona", { alertar, agora: 7000 }), { message: "A fila de espera já está ativa." });
assert.equal(chamadas.length, 2, "recusado não alerta");

// 8. Desligar tira a flag (o campo some de vez)
const e5 = await definirEspera(db, slug, false, 8000);
assert.equal(e5.ligado, false);
assert.equal((await t.get()).get("modulos.espera"), undefined);

// 9. Sem agendamento não há fila, mesmo com espera true
await t.update({ modulos: { agendamento: false, espera: true } });
assert.equal((await estadoEspera(db, slug)).ligado, false, "espera sem agendamento não liga");

// 9b. Negócio só site: não pede nem liga
await assert.rejects(definirEspera(db, slug, true, 9000), { message: "Sem agendamento online não há fila de espera." });
await t.update({ "modulos.espera": FieldValue.delete(), "solicitacoes.espera": FieldValue.delete() });
await assert.rejects(solicitarEspera(db, slug, "dona", { alertar, agora: 9100 }), { message: "Sem agendamento online não há fila de espera." });
await t.update({ "modulos.agendamento": FieldValue.delete() });

// 9c. Ligar sem pedido não inventa pedido
const e6 = await definirEspera(db, slug, true, 9200);
assert.equal(e6.ligado, true);
assert.equal(e6.pedido, null);
await definirEspera(db, slug, false, 9300);

// 9d. Dois pedidos ao mesmo tempo: um só alerta
const antes = chamadas.length;
await Promise.all([solicitarEspera(db, slug, "dona", { alertar, agora: 9400 }), solicitarEspera(db, slug, "dona", { alertar, agora: 9401 })]);
assert.equal(chamadas.length - antes, 1, "transação: só um pedido novo");

// 10. Negócio que não existe
await assert.rejects(solicitarEspera(db, "espera-inexistente", "x", { alertar }), { message: "Negócio não encontrado." });

await db.recursiveDelete(t);
console.log("espera-solicitacao ok");
