import assert from "node:assert/strict";
import { textoAvisoCliente, textoConvite } from "@/lib/mensagens";

const a = { customerName: " Ana Maria ", serviceName: "Corte", staffName: "Bia", start: new Date("2026-11-10T13:00:00Z") };
const conf = textoAvisoCliente("confirmado", a, "Salão X", "https://x/agendar/s");
assert.match(conf, /^Olá, Ana! Seu horário na Salão X está confirmado: Corte com Bia, .* às 10:00\. Até lá!$/);
assert.match(textoAvisoCliente("cancelado", a, "Salão X", "https://x/agendar/s"), /foi cancelado\. Para marcar outro horário: https:\/\/x\/agendar\/s$/);
assert.match(textoAvisoCliente("remarcado", a, "Salão X", ""), /foi remarcado para .* às 10:00 \(Corte com Bia\)/);
assert.match(textoConvite({ nome: "", negocio: "N", url: "u", email: "e@x", dias: 7 }), /^Oi! [^]*\(e@x\)\. O link vale 7 dias/);
assert.match(textoConvite({ nome: "Bia Souza", negocio: "N", url: "u", email: "e@x", dias: 7 }), /^Oi, Bia!/);
console.log("mensagens ok");

// limites da agenda pelo link
import { foraDoLimite, limitesDe } from "@/lib/scheduling";
assert.deepEqual(limitesDe(undefined), { maxServicos: 5, maxDuracaoMin: 240 });
assert.deepEqual(limitesDe({ maxServicos: 99, maxDuracaoMin: 5 }), { maxServicos: 5, maxDuracaoMin: 240 }); // fora do teto = padrão
assert.deepEqual(limitesDe({ maxServicos: 3, maxDuracaoMin: 120 }), { maxServicos: 3, maxDuracaoMin: 120 });
const lim = { maxServicos: 2, maxDuracaoMin: 120 };
const s = (m: number) => ({ durationMin: m });
assert.equal(foraDoLimite([s(300)], lim), null); // um serviço longo sozinho vale
assert.equal(foraDoLimite([s(60), s(60)], lim), null);
assert.match(foraDoLimite([s(60), s(90)], lim)!, /passam de 2 h/);
assert.match(foraDoLimite([s(10), s(10), s(10)], lim)!, /até 2 serviços/);
console.log("limites ok");

// fuso do negócio: o escolhido à mão vence; sem ele, o da UF; inválido cai na UF
import { FUSOS, fusoDaUF, fusoDe } from "@/lib/datetime";
import { UFS } from "@/lib/gerador";
for (const id of Object.keys(FUSOS)) new Intl.DateTimeFormat("pt-BR", { timeZone: id }); // IANA válido
for (const uf of UFS) assert.ok(fusoDaUF(uf) in FUSOS, uf); // toda UF cai num fuso da lista
assert.equal(fusoDe({ uf: "AM" }), "America/Manaus");
assert.equal(fusoDe({ uf: "PA" }), "America/Belem");
assert.equal(fusoDe({ uf: "AM", fuso: "America/Sao_Paulo" }), "America/Sao_Paulo");
assert.equal(fusoDe({ uf: "AC", fuso: "Europe/Lisbon" }), "America/Rio_Branco");
assert.equal(fusoDe(undefined), "America/Sao_Paulo");
console.log("fusos ok");
