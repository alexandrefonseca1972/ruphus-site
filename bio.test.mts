import assert from "node:assert/strict";
import { situacaoExpediente } from "@/lib/bio";
import { telefoneDoNegocio, telefoneFixo, whatsappDoNegocio } from "@/lib/contato";

const expediente = [
  { dia: 4, inicio: "09:00", fim: "18:00" },
  { dia: 5, inicio: "09:00", fim: "12:00" },
];

// Às 12:30Z de 13/11, São Paulo está sexta às 9:30 e Manaus, quinta às 8:30.
const virada = new Date("2026-11-13T12:30:00Z");
assert.equal(situacaoExpediente(expediente, "America/Manaus", virada).aberto, false);
assert.deepEqual(situacaoExpediente(expediente, "America/Sao_Paulo", virada), { aberto: true, ate: "12:00" });

// A abertura e o fechamento seguem o relógio do negócio, não o do servidor.
assert.deepEqual(situacaoExpediente(expediente, "America/Manaus", new Date("2026-11-12T13:00:00Z")), { aberto: true, ate: "18:00" });
assert.equal(situacaoExpediente(expediente, "America/Manaus", new Date("2026-11-12T12:59:00Z")).aberto, false);
assert.deepEqual(situacaoExpediente(expediente, "America/Manaus", new Date("2026-11-12T21:59:00Z")), { aberto: true, ate: "18:00" });
assert.equal(situacaoExpediente(expediente, "America/Manaus", new Date("2026-11-12T22:00:00Z")).aberto, false);
assert.equal(situacaoExpediente(expediente, "America/Rio_Branco", new Date("2026-11-12T14:00:00Z")).aberto, true);

assert.equal(telefoneFixo("559132364727"), true);
assert.equal(telefoneFixo("5591993721156"), false);
assert.equal(whatsappDoNegocio("559132364727", "Olá"), null);
assert.equal(whatsappDoNegocio("5591993721156", "Olá"), "https://wa.me/5591993721156?text=Ol%C3%A1");
assert.equal(telefoneDoNegocio("(91) 3236-4727"), "tel:+559132364727");
assert.equal(telefoneDoNegocio("(92) 99372-1156"), "tel:+5592993721156");
assert.equal(telefoneDoNegocio(""), null);

console.log("bio e contato: ok");
