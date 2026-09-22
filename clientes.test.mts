// Rode: npm run test:clientes  (regra de quem conta como cliente ativo)
import assert from "node:assert/strict";
import { ativosDesde, DIA_EM_MS, JANELAS, MAIOR_JANELA, resumoPorCliente } from "@/lib/clientes";

const chaves = (s: Set<string>) => [...s].sort();
const agora = Date.UTC(2026, 8, 20);
const diasAtras = (n: number) => agora - n * DIA_EM_MS;
const desde = (n: number) => agora - n * DIA_EM_MS;

// Marcado ou confirmado dentro da janela: ativo
assert.deepEqual(
  chaves(ativosDesde(
    [
      { customerKey: "ana", status: "confirmed", startMs: diasAtras(10) },
      { customerKey: "bia", status: "booked", startMs: diasAtras(50) },
    ],
    desde(60),
  )),
  ["ana", "bia"],
);

// A mesma base recortada mais curto deixa a bia de fora
assert.deepEqual(
  chaves(ativosDesde(
    [
      { customerKey: "ana", status: "confirmed", startMs: diasAtras(10) },
      { customerKey: "bia", status: "booked", startMs: diasAtras(50) },
    ],
    desde(30),
  )),
  ["ana"],
  "trocar de faixa recorta o que já está na memória",
);

// Cancelado e falta não são visita
assert.deepEqual(
  chaves(ativosDesde(
    [
      { customerKey: "carla", status: "cancelled", startMs: diasAtras(5) },
      { customerKey: "dani", status: "no_show", startMs: diasAtras(5) },
    ],
    desde(60),
  )),
  [],
  "cancelar não é vir",
);

// Um cancelado não apaga uma visita de verdade da mesma pessoa
assert.deepEqual(
  chaves(ativosDesde(
    [
      { customerKey: "ana", status: "cancelled", startMs: diasAtras(3) },
      { customerKey: "ana", status: "confirmed", startMs: diasAtras(4) },
    ],
    desde(60),
  )),
  ["ana"],
);

// Horário futuro conta: essa pessoa está voltando
assert.deepEqual(
  chaves(ativosDesde([{ customerKey: "eva", status: "booked", startMs: agora + 7 * DIA_EM_MS }], desde(60))),
  ["eva"],
);

// Visita mais velha que a janela não salva ninguém
assert.deepEqual(
  chaves(ativosDesde([{ customerKey: "fabi", status: "confirmed", startMs: diasAtras(400) }], desde(365))),
  [],
);

assert.deepEqual(chaves(ativosDesde([], desde(60))), []);

// A consulta precisa cobrir a maior faixa oferecida, senão a última mente
assert.equal(MAIOR_JANELA, Math.max(...JANELAS.map((j) => j.dias)));

console.log("clientes: ok");

// Resumo da lista: só visitas que aconteceram contam
{
  const r = resumoPorCliente(
    [
      { customerKey: "ana", status: "confirmed", startMs: diasAtras(10), priceCents: 9000 },
      { customerKey: "ana", status: "booked", startMs: diasAtras(40), priceCents: 6000 },
      { customerKey: "ana", status: "cancelled", startMs: diasAtras(5), priceCents: 9000 },
      { customerKey: "ana", status: "confirmed", startMs: agora + DIA_EM_MS, priceCents: 9000 },
      { customerKey: "bia", status: "no_show", startMs: diasAtras(3), priceCents: 5000 },
    ],
    agora,
  );
  assert.deepEqual(r.get("ana"), { ultimaMs: diasAtras(10), visitas: 2, gastoCents: 15000 });
  assert.equal(r.has("bia"), false, "falta não é visita");
}
