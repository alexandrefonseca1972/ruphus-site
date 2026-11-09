// Rode: npx tsx --conditions=react-server canal-oficial.test.mts  (só funções puras do canal oficial)
import assert from "node:assert/strict";
import { parametro, templateCliente, templateNovoDono, TEMPLATES } from "@/lib/canal-oficial.server";

// a Meta recusa parâmetro com quebra de linha, tab ou mais de 4 espaços seguidos; vazio também
assert.equal(parametro("Corte\n e\t\tescova     longa"), "Corte e escova longa");
assert.equal(parametro("   "), "-");
assert.equal(parametro(null), "-");
assert.equal(parametro("x".repeat(500)).length, 200);

assert.deepEqual(
  templateCliente("confirmado", { nome: "Maria", negocio: "Salão Bela", servico: "Corte", quando: "amanhã às 10:00" }),
  { nome: "agendamento_confirmado_cliente", parametros: ["Maria", "Salão Bela", "Corte", "amanhã às 10:00"] },
);
assert.equal(templateCliente("lembrete", { nome: "A", negocio: "B", servico: "C", quando: "D" }).nome, TEMPLATES.lembrete);
assert.deepEqual(
  templateNovoDono({ negocio: "Salão Bela", cliente: "Maria Souza", telefone: "11987654321", servico: "Corte", quando: "sexta", codigo: "AB12" }).parametros,
  ["AB12", "Salão Bela", "Maria Souza", "11987654321", "Corte", "sexta"],
);
console.log("canal-oficial: ok");
