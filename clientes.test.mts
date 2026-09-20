// Rode: npm run test:clientes  (regra de quem conta como cliente ativo)
import assert from "node:assert/strict";
import { ativosNaJanela } from "@/lib/clientes";

const chaves = (s: Set<string>) => [...s].sort();

// Quem tem horário marcado ou confirmado dentro da janela está ativo
assert.deepEqual(
  chaves(ativosNaJanela([
    { customerKey: "ana", status: "confirmed" },
    { customerKey: "bia", status: "booked" },
  ])),
  ["ana", "bia"],
);

// Cancelado e falta não são visita: quem só tem isso continua sumido
assert.deepEqual(
  chaves(ativosNaJanela([
    { customerKey: "carla", status: "cancelled" },
    { customerKey: "dani", status: "no_show" },
  ])),
  [],
  "cancelar não é vir",
);

// Um cancelado não apaga uma visita de verdade da mesma pessoa
assert.deepEqual(
  chaves(ativosNaJanela([
    { customerKey: "ana", status: "cancelled" },
    { customerKey: "ana", status: "confirmed" },
  ])),
  ["ana"],
);

// A consulta entrega futuros junto; eles contam, porque a pessoa está voltando
assert.deepEqual(chaves(ativosNaJanela([{ customerKey: "eva", status: "booked" }])), ["eva"]);

assert.deepEqual(chaves(ativosNaJanela([])), []);

console.log("clientes: ok");
