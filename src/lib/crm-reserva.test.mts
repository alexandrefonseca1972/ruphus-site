// Rode: npm run test:reserva  ("Enviou?" → "Não" com motivo: reserva e devolução, no Firestore do emulador)
import assert from "node:assert/strict";
import { adminDb } from "@/lib/admin";
import { devolverDaReserva, lerCrm, linhaDoTempo, registrarMensagem, reservarLead } from "@/lib/crm";
import { Reserva } from "@/lib/crm-tipos";

assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "rode pelo emulador (npm run test:reserva)");
const db = adminDb;
const SLUG = "salao-reserva-teste";
const CLIENTE = "salao-reserva-cliente";
const limpar = async () => {
  for (const s of [SLUG, CLIENTE]) {
    await db.recursiveDelete(db.doc(`crm/${s}`));
    await db.doc(`tenants/${s}`).delete();
  }
};
await limpar();
await db.doc(`tenants/${SLUG}`).set({ name: "Salão Reserva", gerado: { sub: "salao" } });
const ler = async () => (await lerCrm(db, [SLUG]))[SLUG];

// o motivo vem da tela: "Outro" sem texto não passa; motivo desconhecido também não
assert.equal(Reserva.safeParse({ motivo: "outro", detalhe: "  " }).success, false);
assert.equal(Reserva.safeParse({ motivo: "sumiu" }).success, false);
assert.deepEqual(Reserva.parse({ motivo: "sem_whatsapp" }), { motivo: "sem_whatsapp", detalhe: "" });

// um toque confirmado agenda o Lembrete; a reserva tira o retorno da cadência (sem contato não há retorno)
await registrarMensagem(db, SLUG, "Primeiro contato", "a recepção", "admin", { envioId: "2b6f3a52-7c1e-4d2a-9f3b-5e8d1c2a4b6f", textoEnviado: "Oi!", editado: false });
assert.equal((await ler()).proximaAcao, "Lembrete");
await reservarLead(db, SLUG, "outro", "  número\u0007 de outro   salão  ", "vendedor@x");
let c = await ler();
assert.ok(c.reservaEm, "na reserva");
assert.deepEqual([c.reservaMotivo, c.reservaDetalhe, c.proximaAcao, c.proximaData], ["outro", "número de outro salão", null, null], "detalhe limpo, cadência sem retorno");
assert.equal(c.toques, 1, "o envio confirmado continua contado");
const desde = c.reservaEm;

// de novo com outro motivo: troca o motivo, mantém a data de entrada e apaga o detalhe vazio
await reservarLead(db, SLUG, "sem_whatsapp", "", "vendedor@x");
c = await ler();
assert.deepEqual([c.reservaEm, c.reservaMotivo, c.reservaDetalhe], [desde, "sem_whatsapp", null]);

// devolver: sai da reserva e fica registrado na linha do tempo
await devolverDaReserva(db, SLUG, "vendedor@x");
c = await ler();
assert.deepEqual([c.reservaEm, c.reservaMotivo, c.reservaDetalhe], [null, null, null]);
const titulos = (await linhaDoTempo(db, SLUG)).map((e) => e.titulo);
assert.ok(titulos.includes("Foi para a reserva") && titulos.includes("Voltou da reserva"), titulos.join(", "));
await assert.rejects(devolverDaReserva(db, SLUG, "vendedor@x"), /não está na reserva/, "devolver duas vezes avisa");

// cliente (fechado) não vai para a reserva
await db.doc(`crm/${CLIENTE}`).set({ estagio: "fechado" });
await assert.rejects(reservarLead(db, CLIENTE, "contato_invalido", "", "vendedor@x"), /já é cliente/);

await limpar();
console.log("reserva no emulador: ok");
