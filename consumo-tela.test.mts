// Rode: npm run test:consumo  (contas da tela de consumo: resumo, funil, por tipo, por dia e leitura; sem rede)
import assert from "node:assert/strict";
import { centavos, csvDasMensagens, dataHora, duracaoDoSaldo, erroLegivel, plural, tetoDoEixo, funil, mapaDeLeitura, mensagensNoSaldo, porDia, porTipo, resumo, saldoPorDia, situacao, type EnvioDaTela } from "@/lib/consumo-tela";

// 10/11/2026 12:00 em Brasília = 15:00Z (terça-feira)
const t = (iso: string) => Date.parse(iso);
let n = 0;
const e = (p: Partial<EnvioDaTela>): EnvioDaTela => ({ id: `e${n++}`, em: t("2026-11-10T15:00:00Z"), canal: "whatsapp", tipo: "recebido", destinatario: "cliente", status: "entregue", custoCents: 5, statusEm: null, ...p });

const envios = [
  e({ status: "lido", statusEm: t("2026-11-10T13:30:00Z") }), // lida às 10h30 de terça
  e({ status: "lido", statusEm: t("2026-11-10T13:40:00Z"), tipo: "pedido_dono", destinatario: "dono" }),
  e({ status: "entregue" }),
  e({ status: "falhou", custoCents: 0 }),
  e({ status: "parado", custoCents: 0 }),
  e({ status: "sem-saldo", custoCents: 0 }),
  e({ canal: "sms", status: "enviado", custoCents: 12, tipo: "lembrete", em: t("2026-11-02T12:00:00Z") }),
];

assert.equal(situacao("aceito"), "enviada");
assert.equal(situacao("sem-saldo"), "falhou");

const r = resumo(envios);
assert.equal(r.total, 7);
assert.equal(r.custoCents, 5 * 3 + 12);
assert.equal(r.atencao, 3); // falhou + sem saldo + parada
assert.equal(r.semSaldo, 1);
assert.deepEqual(r.canais.sms, { total: 1, custoCents: 12 });
// entrega: WhatsApp sem os parados e sem os sem-saldo (4), 3 chegaram
assert.deepEqual(r.entrega, { base: 4, chegaram: 3, lidas: 2, pct: 75 });

assert.deepEqual(funil(envios).map((f) => f.n), [5, 3, 3, 2]);

const tipos = porTipo(envios);
assert.equal(tipos[0].tipo, "recebido");
assert.equal(tipos[0].total, 5);
assert.equal(tipos.find((l) => l.canal === "sms")?.custoCents, 12);

// por dia: até hoje no mês corrente, com acumulado
const dias = porDia(envios, "2026-11", "2026-11-10");
assert.equal(dias.length, 10);
assert.equal(dias[1].sms, 1);
assert.equal(dias[9].whatsapp, 6);
assert.equal(dias[9].acumuladoCents, 27);
// mês passado: o mês inteiro
assert.equal(porDia([], "2026-02", "2026-11-10").length, 28);
// envio de 23h30 de Brasília do dia 30/11 (02:30Z de 01/12) fica no dia 30
assert.equal(porDia([e({ em: t("2026-12-01T02:30:00Z") })], "2026-11", "2026-12-05")[29].whatsapp, 1);

// leitura: terça (2) entre 9h e 12h
const m = mapaDeLeitura(envios);
assert.equal(m.total, 2);
assert.equal(m.celulas[1][2], 2);
assert.deepEqual(m.pico, { faixa: "9–12h", dia: 2 });

assert.equal(mensagensNoSaldo(2340, 5), 468);
assert.equal(mensagensNoSaldo(100, 0), null);

// saldo por dia: do extrato, com o saldo atual no último ponto
const s = saldoPorDia([{ em: t("2026-11-08T15:00:00Z"), saldoAposCents: 1000 }, { em: t("2026-11-09T15:00:00Z"), saldoAposCents: 900 }], "2026-11-10", 850, 5);
assert.deepEqual(s.map((d) => d.saldoCents), [1000, 900, 850]);

assert.equal(csvDasMensagens([{ quando: "10/11 12:00", tipo: "Lembrete", para: 'Ana "A"', canal: "SMS", situacao: "Enviado", agendamento: "Corte; barba", custo: "0,12" }]), 'Quando;Tipo;Para;Canal;Situação;Agendamento;Custo\n10/11 12:00;Lembrete;"Ana ""A""";SMS;Enviado;"Corte; barba";0,12');

// nome com fórmula não vira fórmula no Excel
assert.equal(csvDasMensagens([{ quando: "x", tipo: "x", para: "=HYPERLINK(\"a\")", canal: "x", situacao: "-1", agendamento: "a\rb", custo: "0" }]).split("\n")[1], `x;x;"'=HYPERLINK(""a"")";x;'-1;"a\rb";0`);

// valor digitado no admin: ponto sozinho com até 2 casas é decimal, nunca milhar ("10.50" ≠ R$ 1.050)
assert.equal(centavos("10.50"), 1050);
assert.equal(centavos("10.5"), 1050);
assert.equal(centavos("10,50"), 1050);
assert.equal(centavos("1.234,56"), 123456);
assert.equal(centavos("-5"), -500);
assert.equal(centavos("R$ 20"), 2000);
assert.equal(centavos("abc"), null);
assert.equal(centavos("1.2.3"), null);

assert.equal(plural(1, "lida", "lidas"), "1 lida");
assert.equal(plural(2, "lida", "lidas"), "2 lidas");
assert.equal(duracaoDoSaldo(1), "1 dia");
assert.equal(duracaoDoSaldo(45), "1 mês e meio");
assert.equal(duracaoDoSaldo(70), "2 meses");
assert.equal(duracaoDoSaldo(6090), "mais de 3 meses");
assert.equal(erroLegivel("CLOUD_API_REJECTED"), "recusada pelo WhatsApp");
assert.equal(erroLegivel("XYZ_123"), null);
assert.equal(dataHora(t("2026-11-10T20:38:00Z")), "10/11/2026 17:38");
assert.equal(tetoDoEixo(2), 3);
assert.equal(tetoDoEixo(4), 6);
assert.equal(tetoDoEixo(14), 15);

console.log("consumo-tela ok");
