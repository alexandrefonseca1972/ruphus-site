// Logout automático: em que fase está quem ficou parado (src/lib/limites.ts)
import assert from "node:assert/strict";
import { faseDaSessao } from "@/lib/limites";

const MIN = 60_000;
assert.equal(faseDaSessao(10 ** 9, 0), "ativa", "0 desliga");
assert.equal(faseDaSessao(4 * MIN - 1, 5), "ativa");
assert.equal(faseDaSessao(4 * MIN, 5), "aviso", "um minuto antes do fim");
assert.equal(faseDaSessao(5 * MIN - 1, 5), "aviso");
assert.equal(faseDaSessao(5 * MIN, 5), "sair");
assert.equal(faseDaSessao(30_000, 1), "ativa", "prazo de 1 min: sem aviso");
assert.equal(faseDaSessao(MIN, 1), "sair");
console.log("sessao ok");
