// Rode: npm run test:conversas  (regras da tela de Conversas, sem navegador nem emulador)
import assert from "node:assert/strict";
import { avisoDoEnvio, indiceDeClientes, janelaRestante, juntarConversas, nomeDaConversa, novaChave, ordenarConversas, telefoneLegivel } from "@/lib/conversas";
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
assert.equal(telefoneLegivel(null), "Contato sem número");
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

console.log("conversas (tela) ok");
