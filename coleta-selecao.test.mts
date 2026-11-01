// Rode: npm run test:coleta-selecao  (marcar todas, desmarcar e sortear cidades — funções puras)
import assert from "node:assert/strict";
import { desmarcar, marcarTodas, sortear } from "@/lib/coleta-selecao";

const todas = ["Macapá", "Amapá", "Calçoene", "Cutias", "Ferreira Gomes"];
assert.deepEqual(marcarTodas([], todas, 50), { lista: todas, cortadas: 0 });
assert.deepEqual(marcarTodas(["Cutias"], todas, 50).lista, ["Cutias", "Macapá", "Amapá", "Calçoene", "Ferreira Gomes"], "não repete a já marcada");
assert.deepEqual(marcarTodas(["Cutias"], todas, 3), { lista: ["Cutias", "Macapá", "Amapá"], cortadas: 2 }, "para no limite e diz quantas ficaram de fora");
assert.deepEqual(marcarTodas(["a", "b", "c"], todas, 3), { lista: ["a", "b", "c"], cortadas: 5 }, "limite já cheio");

assert.deepEqual(desmarcar(todas, todas), []);
assert.deepEqual(desmarcar(["Macapá", "Belém"], ["Macapá", "Amapá"]), ["Belém"], "com busca, só as visíveis saem");

// sorteio determinístico para o teste: sempre o primeiro do que sobra
const primeiro = () => 0;
assert.deepEqual(sortear([], todas, 2, 50, primeiro), ["Macapá", "Amapá"]);
assert.deepEqual(sortear(["Macapá"], todas, 2, 50, primeiro), ["Macapá", "Amapá", "Calçoene"], "não sorteia a já marcada");
assert.deepEqual(sortear([], todas, 99, 50, primeiro).length, 5, "pede mais do que há: todas");
assert.deepEqual(sortear(["x", "y"], todas, 5, 3, primeiro).length, 3, "respeita o limite");
assert.deepEqual(sortear([], todas, 0, 50), []);
assert.deepEqual(sortear([], todas, -3, 50), []);
assert.deepEqual(sortear([], [], 5, 50), []);
// aleatório de verdade: sem repetição e só das visíveis
for (let k = 0; k < 200; k++) {
  const s = sortear([], todas, 3, 50);
  assert.equal(new Set(s).size, 3);
  assert.ok(s.every((c) => todas.includes(c)));
}
// sorteio cobre todas as cidades com o tempo (não fica preso no começo da lista)
const vistas = new Set<string>();
for (let k = 0; k < 500; k++) sortear([], todas, 1, 50).forEach((c) => vistas.add(c));
assert.equal(vistas.size, todas.length);
console.log("seleção de cidades ok");
