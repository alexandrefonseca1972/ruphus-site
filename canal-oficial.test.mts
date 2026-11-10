// Rode: npx tsx --conditions=react-server canal-oficial.test.mts  (só funções puras do canal oficial)
import assert from "node:assert/strict";
import { idBotao, lerBotao, parametro, templateCliente, templateConfirmarDono, templateNovoDono, TEMPLATES } from "@/lib/canal-oficial.server";

// a Meta recusa parâmetro com quebra de linha, tab ou mais de 4 espaços seguidos; vazio também
assert.equal(parametro("Corte\n e\t\tescova     longa"), "Corte e escova longa");
assert.equal(parametro("   "), "-");
assert.equal(parametro(null), "-");
assert.equal(parametro("x".repeat(500)).length, 200);

assert.deepEqual(
  templateCliente("confirmado", { nome: "Maria", negocio: "Salão Bela", servico: "Corte", quando: "amanhã às 10:00" }),
  { nome: "agendamento_confirmado_cliente", parametros: ["Maria", "*Salão Bela*", "Corte", "📅 *amanhã às 10:00*"] },
);
assert.equal(templateCliente("lembrete", { nome: "A", negocio: "B", servico: "C", quando: "D" }).nome, TEMPLATES.lembrete);
assert.deepEqual(
  templateNovoDono({ negocio: "Salão Bela", cliente: "Maria Souza", telefone: "11987654321", servico: "Corte", quando: "sexta", codigo: "AB12" }).parametros,
  ["*AB12*", "*Salão Bela*", "Maria Souza", "11987654321", "Corte", "📅 *sexta*"],
);
// asterisco dentro do valor sairia do negrito: cai fora
assert.equal(templateCliente("confirmado", { nome: "A", negocio: "Bela*Vista", servico: "C", quando: "D" }).parametros[1], "*BelaVista*");
// confirmação do WhatsApp do dono: {{1}} negócio e o botão "Sou eu" com rph:ok:{slug}:dono
assert.deepEqual(templateConfirmarDono("Salão Bela", "bela"), { nome: "ruphus_confirmar_whatsapp_dono", parametros: ["*Salão Bela*"], botoes: ["rph:ok:bela:dono"] });
assert.deepEqual(lerBotao(idBotao("ok", "bela", "dono")), { acao: "ok", slug: "bela", agendamento: "dono" });
assert.equal(lerBotao("rph:ok:../x:dono"), null, "slug fora do formato");
assert.equal(lerBotao("rph:okk:bela:dono"), null, "ação desconhecida");
console.log("canal-oficial: ok");
