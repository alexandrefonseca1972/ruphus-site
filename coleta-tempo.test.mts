// Rode: npm run test:coleta-tempo  (cronômetro, ritmo e estimativa da coleta — funções puras)
import assert from "node:assert/strict";
import { type Amostra, anotar, duracao, faltam, porcentagem, ritmo } from "@/lib/coleta-tempo";

assert.equal(duracao(0), "0 s");
assert.equal(duracao(59_999), "59 s");
assert.equal(duracao(754_000), "12 min 34 s");
assert.equal(duracao(3_905_000), "1 h 05 min");
assert.equal(duracao(-5_000), "0 s", "relógio adiantado não dá negativo");

// ritmo: 30 fichas em 3 min = 10/min
const t0 = 1_000_000;
let a: Amostra[] = [];
a = anotar(a, { etapa: "fichas", feitas: 10 }, t0);
assert.equal(ritmo(a, t0), null, "uma amostra só: sem ritmo");
a = anotar(a, { etapa: "fichas", feitas: 12 }, t0 + 10_000);
assert.equal(ritmo(a, t0 + 10_000), null, "menos de 20 s medidos: sem ritmo");
a = anotar(a, { etapa: "fichas", feitas: 40 }, t0 + 180_000);
assert.equal(ritmo(a, t0 + 180_000), 30 / 180);
assert.equal(anotar(a, { etapa: "fichas", feitas: 40 }, t0 + 190_000), a, "mesma leitura não vira amostra nova");

// troca de etapa: o ritmo recomeça
a = anotar(a, { etapa: "busca", feitas: 0 }, t0 + 200_000);
assert.equal(ritmo(a, t0 + 200_000), null);
// janela de 5 min: o começo lento sai da conta
let b: Amostra[] = [];
b = anotar(b, { etapa: "busca", feitas: 0 }, 0);
b = anotar(b, { etapa: "busca", feitas: 1 }, 60_000);
b = anotar(b, { etapa: "busca", feitas: 50 }, 400_000);
assert.equal(b.length, 2, "amostra de mais de 5 min atrás esquecida");
assert.equal(ritmo(b, 400_000), 49 / 340);
assert.equal(ritmo([{ t: 0, etapa: "busca", feitas: 5 }, { t: 60_000, etapa: "busca", feitas: 5 }], 60_000), null, "parado: sem ritmo");

// quanto falta
assert.equal(faltam({ feitas: 40, total: 100 }, 0.5), 120);
assert.equal(faltam({ feitas: 40, total: 100 }, null, 6), 360, "sem ritmo: palpite por item");
assert.equal(faltam({ feitas: 40, total: 100 }, null), null, "sem ritmo nem palpite");
assert.equal(faltam({ feitas: 100, total: 100 }, null), 0);
assert.equal(faltam({ feitas: 120, total: 100 }, 1), 0, "passou do total");

assert.equal(porcentagem({ feitas: 37, total: 55 }), 67);
assert.equal(porcentagem({ feitas: 0, total: 0 }), 0, "sem total: 0, sem dividir por zero");
assert.equal(porcentagem({ feitas: 60, total: 55 }), 100);
console.log("tempo da coleta ok");
