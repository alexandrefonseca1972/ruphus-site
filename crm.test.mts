import assert from "node:assert/strict";
import { negocio } from "@/lib/crm";
import { diaCurto, hojeISO, prazoDe } from "@/lib/crm-tipos";

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

// ————— compromissos: a próxima ação combinada —————

const hoje = hojeISO();
assert.match(hoje, /^\d{4}-\d{2}-\d{2}$/);
// a data é a de quem olha, não a de Londres: em Manaus (UTC-4) o UTC já virou
// o dia seguinte depois das 20h, e tudo de hoje apareceria como atrasado
assert.equal(hoje, new Date().toLocaleDateString("en-CA"));

const em = (d: string) => ({ proximaData: d });
assert.equal(prazoDe(em("2026-09-17"), "2026-09-18"), "atrasada");
assert.equal(prazoDe(em("2026-09-18"), "2026-09-18"), "hoje");
assert.equal(prazoDe(em("2026-09-19"), "2026-09-18"), "futura");
// a comparação é textual: precisa atravessar virada de mês e de ano
assert.equal(prazoDe(em("2026-08-31"), "2026-09-01"), "atrasada");
assert.equal(prazoDe(em("2027-01-01"), "2026-12-31"), "futura");
// sem data combinada não existe compromisso — não conta como atrasado
assert.equal(prazoDe({ proximaData: null }, hoje), null);
assert.equal(prazoDe(undefined, hoje), null);

assert.equal(diaCurto("2026-09-25"), "25/09");

console.log("crm: ok");
