// Rode: npm run test:admin  (módulos do plano: o que o /admin desliga por negócio; sem rede)
import assert from "node:assert/strict";
import { agendamentoLigado, caixaLigado, esperaLigada, telaDoPlano } from "@/lib/modulos";

// sem nada gravado (negócio de antes do campo): tudo ligado
assert.equal(agendamentoLigado(undefined), true);
assert.equal(caixaLigado({}), true);
// só false desliga
assert.equal(caixaLigado({ caixa: false }), false);
assert.equal(caixaLigado({ caixa: true, agendamento: true }), true);
// sem agendamento não há Caixa
assert.equal(caixaLigado({ agendamento: false }), false);
assert.equal(agendamentoLigado({ caixa: false }), true, "desligar o Caixa não mexe no agendamento");

// fila de espera: serviço extra, só true liga
assert.equal(esperaLigada(undefined), false);
assert.equal(esperaLigada({}), false);
assert.equal(esperaLigada({ espera: false }), false);
assert.equal(esperaLigada({ espera: true }), true);
assert.equal(esperaLigada({ espera: true, agendamento: false }), false);
assert.equal(esperaLigada({ espera: "true" }), false);

// telas: "só site" fica com Serviços e Meu negócio
for (const t of ["", "profissionais", "clientes", "caixa", "consumo"]) assert.equal(telaDoPlano({ agendamento: false }, t), false, t);
for (const t of ["servicos", "negocio"]) assert.equal(telaDoPlano({ agendamento: false }, t), true, t);
assert.equal(telaDoPlano({ caixa: false }, "caixa"), false);
assert.equal(telaDoPlano({ caixa: false }, ""), true);
assert.equal(telaDoPlano(undefined, "caixa"), true);

console.log("modulos ok");
