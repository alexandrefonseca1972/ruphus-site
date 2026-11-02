// Rode: npm run test:sinal-puro  (regras do sinal, sem emulador)
import assert from "node:assert/strict";
import { prazoDoSinal, restanteDe, tempoRestante, textoDoSinal, valorDoSinal } from "@/lib/sinal";
import { ConfigSinal } from "@/lib/sinal-config";

const valida = (c: unknown) => ConfigSinal.safeParse(c);
assert.ok(valida({ ativo: true, tipo: "percentual", valor: 30, prazoMin: 30 }).success);
assert.ok(valida({ ativo: true, tipo: "fixo", valor: 1_000_000, prazoMin: 10 }).success, "R$ 10.000 no limite");
for (const [c, msg] of [
  [{ ativo: true, tipo: "percentual", valor: 101, prazoMin: 30 }, /até 100%/],
  [{ ativo: true, tipo: "fixo", valor: 1_000_001, prazoMin: 30 }, /R\$ 10\.000/],
  [{ ativo: true, tipo: "percentual", valor: 0, prazoMin: 30 }, /valor do sinal/],
  [{ ativo: true, tipo: "percentual", valor: 2.5, prazoMin: 30 }, /./],
  [{ ativo: true, tipo: "percentual", valor: 30, prazoMin: 5 }, /10 minutos/],
  [{ ativo: true, tipo: "percentual", valor: 30, prazoMin: 24 * 60 + 1 }, /24 horas/],
  [{ ativo: true, tipo: "outro", valor: 30, prazoMin: 30 }, /./],
  [{ ativo: "sim", tipo: "percentual", valor: 30, prazoMin: 30 }, /./],
  [null, /./],
] as const) {
  const r = valida(c);
  assert.ok(!r.success, JSON.stringify(c));
  assert.match(r.error!.issues[0].message, msg);
}

assert.equal(valorDoSinal({ tipo: "percentual", valor: 100 }, 5000), 5000);
assert.equal(valorDoSinal({ tipo: "percentual", valor: 1 }, 1), 0, "1% de 1 centavo arredonda para 0: sem sinal");
assert.equal(valorDoSinal({ tipo: "percentual", valor: 30 }, Number.NaN), 0);
assert.equal(valorDoSinal({ tipo: "fixo", valor: Number.NaN }, 5000), 0);
assert.equal(valorDoSinal({ tipo: "fixo", valor: -100 }, 5000), 0);

const agora = Date.parse("2030-01-07T12:00:00Z");
assert.equal(tempoRestante("2030-01-07T12:24:00Z", agora), "24 min");
assert.equal(tempoRestante("2030-01-07T12:00:30Z", agora), "1 min", "arredonda para cima");
assert.equal(tempoRestante("2030-01-07T13:05:00Z", agora), "1 h 05 min");
assert.equal(tempoRestante("2030-01-07T12:00:00Z", agora), null, "vencido");
assert.equal(tempoRestante("não é data", agora), null);

assert.equal(prazoDoSinal(new Date(agora), 30, new Date(agora - 60_000)).getTime(), agora - 60_000, "horário já começou: prazo é o início");
assert.equal(textoDoSinal({ tipo: "percentual", valor: 30 }), "30% do valor");
assert.equal(textoDoSinal({ tipo: "fixo", valor: 2000 }), "R$ 20,00");
assert.equal(restanteDe({ priceCents: 5000, sinal: { status: "pago", cents: 9000 } }), 0, "nunca negativo");
assert.equal(restanteDe({ priceCents: 5000, sinal: { status: "pago" } }), 5000, "sinal sem valor não abate");
assert.equal(restanteDe({ priceCents: 5000, sinal: { status: "dispensado", cents: 1500 } }), 5000);
console.log("sinal (puro) ok");
