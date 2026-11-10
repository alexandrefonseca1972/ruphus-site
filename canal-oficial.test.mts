// Rode: npx tsx --conditions=react-server canal-oficial.test.mts  (só funções puras do canal oficial)
import assert from "node:assert/strict";
import { contatoDoNegocio, idBotao, lerBotao, parametro, respostaForaDoFluxo, templateCliente, templateConfirmarDono, templateNovoDono, templateSaldoBaixo, TEMPLATES } from "@/lib/canal-oficial.server";

// a Meta recusa parâmetro com quebra de linha, tab ou mais de 4 espaços seguidos; vazio também
assert.equal(parametro("Corte\n e\t\tescova     longa"), "Corte e escova longa");
assert.equal(parametro("   "), "-");
assert.equal(parametro(null), "-");
assert.equal(parametro("x".repeat(500)).length, 200);

assert.deepEqual(
  templateCliente("confirmado", { nome: "Maria", negocio: "Salão Bela", servico: "Corte", quando: "amanhã às 10:00", contato: "(91) 99999-0000" }),
  { nome: "agendamento_confirmado_cliente", parametros: ["Maria", "*Salão Bela*", "Corte", "📅 *amanhã às 10:00*"] },
);
assert.equal(templateCliente("lembrete", { nome: "A", negocio: "B", servico: "C", quando: "D", contato: "E" }).nome, TEMPLATES.lembrete);
assert.deepEqual(
  templateNovoDono({ negocio: "Salão Bela", cliente: "Maria Souza", telefone: "11987654321", servico: "Corte", quando: "sexta", codigo: "AB12" }).parametros,
  ["*AB12*", "*Salão Bela*", "Maria Souza", "11987654321", "Corte", "📅 *sexta*"],
);
// asterisco dentro do valor sairia do negrito: cai fora
assert.equal(templateCliente("confirmado", { nome: "A", negocio: "Bela*Vista", servico: "C", quando: "D", contato: "E" }).parametros[1], "*BelaVista*");

// contato do estabelecimento ({{5}} dos _v2): telefone do site formatado; sem ele, o site público
const tenant = (id: string, campos: Record<string, unknown>) => ({ id, get: (c: string) => campos[c] });
assert.equal(contatoDoNegocio(tenant("bela", { "site.phone": "5591999990000" })), "(91) 99999-0000");
assert.equal(contatoDoNegocio(tenant("bela", { "site.phone": "91 3222-4444" })), "(91) 3222-4444");
assert.equal(contatoDoNegocio(tenant("bela", {})), "https://bela.ruphus.site");
assert.equal(contatoDoNegocio(tenant("bela", { "site.phone": "123", dominio: { host: "www.bela.com.br", status: "ativo" } })), "https://www.bela.com.br");

// templates v2 (ATENDYS_TEMPLATES_V2=1): nomes _v2, {{5}} contato nos de cliente, 📅 já no texto
process.env.ATENDYS_TEMPLATES_V2 = "1";
const cliente = { nome: "Maria", negocio: "Salão Bela", servico: "Corte", quando: "amanhã às 10:00", contato: "(91) 99999-0000" };
assert.deepEqual(templateCliente("confirmado", cliente), {
  nome: "agendamento_confirmado_cliente_v2",
  parametros: ["Maria", "*Salão Bela*", "Corte", "*amanhã às 10:00*", "(91) 99999-0000"],
});
for (const tipo of ["recebido", "cancelado", "lembrete"] as const) {
  const t = templateCliente(tipo, cliente);
  assert.equal(t.nome, `${TEMPLATES[tipo]}_v2`);
  assert.equal(t.parametros.length, 5);
}
process.env.ATENDYS_TEMPLATES_BOTOES = "1";
assert.equal(templateCliente("lembrete", cliente, { slug: "bela", agendamento: "A1" }).nome, "agendamento_lembrete_botoes_v2");
const dono = { negocio: "Salão Bela", cliente: "Maria", telefone: "11987654321", servico: "Corte", quando: "sexta", codigo: "AB12" };
assert.equal(templateNovoDono(dono, { slug: "bela", agendamento: "A1" }).nome, "agendamento_pedido_dono_botoes_v2");
delete process.env.ATENDYS_TEMPLATES_BOTOES;
const pedido = templateNovoDono(dono);
assert.deepEqual([pedido.nome, pedido.parametros], ["agendamento_pedido_dono_v2", ["*AB12*", "*Salão Bela*", "Maria", "11987654321", "Corte", "*sexta*"]]);
delete process.env.ATENDYS_TEMPLATES_V2;
assert.equal(templateCliente("confirmado", cliente).parametros.length, 4, "sem a chave, os templates antigos (4 parâmetros)");

// confirmação do WhatsApp do dono: {{1}} negócio e o botão "Sou eu" com rph:ok:{slug}:dono
assert.deepEqual(templateConfirmarDono("Salão Bela", "bela"), { nome: "ruphus_confirmar_whatsapp_dono", parametros: ["*Salão Bela*"], botoes: ["rph:ok:bela:dono"] });
assert.deepEqual(lerBotao(idBotao("ok", "bela", "dono")), { acao: "ok", slug: "bela", agendamento: "dono" });
assert.equal(lerBotao("rph:ok:../x:dono"), null, "slug fora do formato");
assert.equal(lerBotao("rph:okk:bela:dono"), null, "ação desconhecida");

// resposta automática a quem escreve ao número da plataforma fora do fluxo
assert.equal(
  respostaForaDoFluxo("Oi, posso remarcar?", { negocio: "Salão *Bela*", contato: "(91) 99999-0000" }),
  "Este número da Ruphus só envia avisos de agendamento. Para falar com *Salão Bela*, chame (91) 99999-0000.",
);
assert.equal(respostaForaDoFluxo("oi", null), "Este número da Ruphus só envia avisos de agendamento. Fale com o estabelecimento onde você agendou.");
for (const sair of ["SAIR", " sair! ", "Parar", "STOP", "cancelar"]) assert.equal(respostaForaDoFluxo(sair, null), null, sair);
assert.equal(respostaForaDoFluxo("quero sair da lista amanhã", null)?.startsWith("Este número"), true, "frase com sair ainda responde");
// cliente não é dono: "Confirmado" dele também recebe a orientação
assert.equal(respostaForaDoFluxo("Confirmado", null)?.startsWith("Este número"), true);
assert.equal(respostaForaDoFluxo("   ", null), null);
// saldo de mensagens baixo (ruphus_saldo_baixo): 5 variáveis, cada uma passada por parametro()
{
  const { CONFIG_PADRAO, previsaoDeSaldo } = await import("@/lib/consumo");
  const cheio = Array.from({ length: 10 }, (_, i) => ({ dia: `2026-11-${String(11 + i).padStart(2, "0")}`, cents: 700 }));
  const previsao = previsaoDeSaldo({ saldoCents: 420, consumoPorDia: cheio, hoje: "2026-11-20", diasNoMes: 30, pacotes: CONFIG_PADRAO.pacotes, avisoSaldoCents: 500 });
  const t = templateSaldoBaixo({ negocio: "Salão\n  Bela", slug: "salao-bela", saldoCents: 420, previsao });
  assert.equal(t.nome, "ruphus_saldo_baixo");
  assert.equal(t.nome, TEMPLATES.saldoBaixo);
  assert.equal(t.parametros.length, 5);
  for (const v of t.parametros) assert.equal(v, parametro(v), "cada valor já passou por parametro()");
  assert.equal(t.parametros[0], "Salão Bela", "quebra de linha sai");
  assert.equal(t.parametros[1], "R$ 4,20", "{{2}} em reais, com espaço comum (sem o NBSP do Intl)");
  assert.match(t.parametros[1], /^R\$ \d{1,3}(\.\d{3})*,\d{2}$/);
  assert.equal(t.parametros[2], "menos de 1 dia", "saldo de menos de um dia");
  assert.equal(t.parametros[3], "R$ 50,00 (+ R$ 5,00 de bônus)", "o pacote indicado");
  assert.equal(t.parametros[4], "www.ruphus.site/salao-bela/consumo");
  const semMedia = previsaoDeSaldo({ saldoCents: 123456, consumoPorDia: [], hoje: "2026-11-20", diasNoMes: 30, pacotes: [], avisoSaldoCents: 500 });
  assert.deepEqual(templateSaldoBaixo({ negocio: "", slug: "x", saldoCents: 123456, previsao: semMedia }).parametros, ["-", "R$ 1.234,56", "poucos dias", "o valor que preferir", "www.ruphus.site/x/consumo"]);
  const tres = { ...previsao, diasRestantesEstimados: 3, pacoteIndicado: CONFIG_PADRAO.pacotes[0] };
  assert.deepEqual(templateSaldoBaixo({ negocio: "B", slug: "b", saldoCents: 420, previsao: tres }).parametros.slice(2, 4), ["3 dias", "R$ 20,00"]);
}
console.log("canal-oficial: ok");
