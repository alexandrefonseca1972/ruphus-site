// Rode: npm run test:conversas  (regras da tela de Conversas, sem navegador nem emulador)
import assert from "node:assert/strict";
import { avisoDoEnvio, conversaMinima, emOrdem, indiceDeClientes, mesclarMensagens, telefoneBr, janelaRestante, juntarConversas, nomeDaConversa, novaChave, ordenarConversas, telefoneLegivel } from "@/lib/conversas";
import { CHAVE_IDEMPOTENCIA } from "@/lib/atendys";

const c = (id: string, unreadCount: number, lastActivityAt: string, manuallyUnread = false) => ({ id, unreadCount, manuallyUnread, lastActivityAt });
assert.deepEqual(
  ordenarConversas([c("velha-lida", 0, "2026-11-08T10:00:00Z"), c("nova-lida", 0, "2026-11-09T10:00:00Z"), c("velha-nao-lida", 2, "2026-11-07T10:00:00Z"), c("marcada", 0, "2026-11-06T10:00:00Z", true)]).map((x) => x.id),
  ["velha-nao-lida", "marcada", "nova-lida", "velha-lida"],
  "não lidas (e marcadas como não lidas) primeiro, depois a mais recente",
);
assert.deepEqual(juntarConversas([{ id: "a", v: 1 }, { id: "b", v: 1 }], [{ id: "b", v: 2 }, { id: "c", v: 2 }]), [{ id: "b", v: 2 }, { id: "c", v: 2 }, { id: "a", v: 1 }], "sem repetir; a versão nova vence");

// cadastro: o mesmo celular com ou sem o 9º dígito, digitado de qualquer jeito
const doCadastro = indiceDeClientes([
  { key: "5591991121306", name: "Ana", phone: "(91) 99112-1306" },
  { key: "559188887777", name: "Bia (conta antiga)", phone: "(91) 8888-7777" },
]);
assert.equal(doCadastro("5591991121306")?.name, "Ana");
assert.equal(doCadastro("5591988887777")?.name, "Bia (conta antiga)", "WhatsApp manda com o 9; cadastro sem");
assert.equal(doCadastro("5511900000000"), undefined);
assert.equal(doCadastro(null), undefined);

assert.equal(telefoneLegivel("5591988887777"), "(91) 98888-7777");
assert.equal(telefoneLegivel("559188887777"), "(91) 8888-7777");
assert.equal(telefoneLegivel("14155550100"), "+14155550100");
assert.equal(telefoneLegivel(null), "Contato");
assert.equal(nomeDaConversa({ contactName: "Zé", contactPhone: "5591988887777" }, { name: "José Silva" }), "José Silva", "o cadastro vence");
assert.equal(nomeDaConversa({ contactName: null, contactPhone: "5591988887777" }), "(91) 98888-7777");

const agora = Date.parse("2026-11-09T12:00:00Z");
assert.equal(janelaRestante("2026-11-09T12:45:00Z", agora), "45 min");
assert.equal(janelaRestante("2026-11-09T13:30:00Z", agora), "1 h 30 min");
assert.equal(janelaRestante("2026-11-10T08:00:00Z", agora), "20 h");
assert.equal(janelaRestante("2026-11-09T11:59:00Z", agora), null, "fechada");
assert.equal(janelaRestante(null, agora), null);

const hora = () => "14:30";
assert.match(avisoDoEnvio({ status: "awaiting_manual", manualHandoffRequired: true }, hora) ?? "", /cota/);
assert.match(avisoDoEnvio({ status: "queued", retryAt: "2026-11-09T17:30:00Z" }, hora) ?? "", /sai às 14:30/);
assert.equal(avisoDoEnvio({ status: "queued" }, hora), null, "fila comum não alarma");
assert.equal(avisoDoEnvio({ status: "sent" }, hora), null);

const k1 = novaChave();
assert.match(k1, CHAVE_IDEMPOTENCIA, "a chave da tela passa na validação do servidor");
assert.notEqual(k1, novaChave());

// histórico: recarregar a página mais nova não some com as anteriores já abertas
const msg = (id: string, at: string, extra = {}) => ({ id, direction: "in" as const, type: "text" as const, text: id, at, ...extra });
const abertas = emOrdem([msg("m1", "2026-11-09T10:00:00Z"), msg("m2", "2026-11-09T10:01:00Z"), msg("m3", "2026-11-09T10:02:00Z")]);
const recarga = [msg("m4", "2026-11-09T10:03:00Z"), msg("m3", "2026-11-09T10:02:00Z", { edited: true })];
const juntas = mesclarMensagens(abertas, recarga);
assert.deepEqual(juntas.map((m) => m.id), ["m1", "m2", "m3", "m4"], "as antigas ficam e a nova entra no fim");
assert.equal(juntas.find((m) => m.id === "m3")?.edited, true, "a versão nova da mesma mensagem vence");
assert.deepEqual(mesclarMensagens(null, recarga).map((m) => m.id), ["m3", "m4"]);
assert.deepEqual(emOrdem([msg("b", "2026-11-09T10:00:00Z"), msg("a", "2026-11-09T10:00:00Z")]).map((m) => m.id), ["b", "a"], "mesmo instante: a ordem recebida");

// lista: a recarga da primeira página mantém as conversas de "Mais conversas"
assert.deepEqual(juntarConversas([{ id: "p1" }, { id: "p2-antiga" }], [{ id: "p1" }, { id: "nova" }]).map((c) => c.id).sort(), ["nova", "p1", "p2-antiga"]);

// conversa aberta por id (busca, link): responde pelo servidor, sem fingir telefone
const minima = conversaMinima("cv_1");
assert.deepEqual([minima.id, minima.contactPhone, minima.canReply], ["cv_1", null, true]);

// "Novo agendamento" só com celular do Brasil
assert.equal(telefoneBr("5591988887777"), "91988887777");
assert.equal(telefoneBr("559188887777"), "9188887777");
assert.equal(telefoneBr("14155550100"), null, "número de fora não vira brasileiro");
assert.equal(telefoneBr(null), null);

console.log("conversas (tela) ok");
