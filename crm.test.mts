import assert from "node:assert/strict";
import { negocio } from "@/lib/crm";

// Um Timestamp do Firestore é uma classe. Se ele escapar para a tela, o React
// derruba o painel inteiro com "Only plain objects... can be passed to Client
// Components" — e só quando existe negócio salvo, então passa despercebido.
class Timestamp {
  constructor(private readonly ms: number) {}
  toDate() {
    return new Date(this.ms);
  }
}

const doc = (campos: Record<string, unknown>) => ({ get: (c: string) => campos[c] });

const cheio = negocio(
  doc({
    estagio: "negociando",
    valorCents: 39000,
    proximaAcao: "Cobrar retorno da proposta",
    proximaData: "2026-09-25",
    notas: 1,
    publicado: true,
    fechadoEm: new Timestamp(Date.UTC(2026, 8, 25)),
    atualizadoEm: new Timestamp(Date.now()), // o campo que não pode vazar
  }),
);

// nenhum valor de classe atravessa
for (const [campo, valor] of Object.entries(cheio)) {
  const tipo = typeof valor;
  assert.ok(
    valor === null || tipo === "string" || tipo === "number" || tipo === "boolean",
    `${campo} precisa ser simples, veio ${tipo}`,
  );
}
assert.equal(Object.hasOwn(cheio, "atualizadoEm"), false, "atualizadoEm não pode chegar na tela");
assert.equal(cheio.estagio, "negociando");
assert.equal(cheio.valorCents, 39000);
assert.equal(cheio.fechadoEm, "2026-09-25T00:00:00.000Z");

// documento recém-criado por uma anotação: só tem contador, e ainda assim abre
const magro = negocio(doc({ notas: 1, atualizadoEm: new Timestamp(Date.now()) }));
assert.deepEqual(magro, {
  estagio: "novo",
  valorCents: null,
  fechadoEm: null,
  proximaAcao: null,
  proximaData: null,
  publicado: true,
  notas: 1,
});

// estágio desconhecido não quebra a tela nem pinta chip inexistente
assert.equal(negocio(doc({ estagio: "atrasado" })).estagio, "novo");
// publicado só é falso quando dito explicitamente
assert.equal(negocio(doc({ publicado: false })).publicado, false);
assert.equal(negocio(doc({})).publicado, true);

console.log("crm: ok");
