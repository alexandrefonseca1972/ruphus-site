// npm run test:recibo — o texto do recibo, sem banco
import assert from "node:assert/strict";
import { erroDoEmail, htmlDoRecibo, sugestaoDeEmail, itensDoRecibo, linhasDoRecibo, numeroDoRecibo, textoDoRecibo, valorPorExtenso } from "@/lib/recibo";

const casos: [number, string][] = [
  [100, "um real"],
  [1, "um centavo"],
  [0, "zero real"],
  [5000, "cinquenta reais"],
  [10000, "cem reais"],
  [10100, "cento e um reais"],
  [12345, "cento e vinte e três reais e quarenta e cinco centavos"],
  [100000, "mil reais"],
  [110000, "mil e cem reais"],
  [102000, "mil e vinte reais"],
  [123400, "mil, duzentos e trinta e quatro reais"],
  [200000, "dois mil reais"],
  [9999999, "noventa e nove mil, novecentos e noventa e nove reais e noventa e nove centavos"],
  [1500, "quinze reais"],
  [2101, "vinte e um reais e um centavo"],
  [100000000, "um milhão de reais"],
  [200000000, "dois milhões de reais"],
  [120000000, "um milhão e duzentos mil reais"],
  [125000000, "um milhão, duzentos e cinquenta mil reais"],
  [100000500, "um milhão e cinco reais"],
  [100100000, "um milhão e mil reais"],
  [123456789, "um milhão, duzentos e trinta e quatro mil, quinhentos e sessenta e sete reais e oitenta e nove centavos"],
];
for (const [c, esperado] of casos) assert.equal(valorPorExtenso(c), esperado, String(c));

assert.equal(numeroDoRecibo("ag-AbC123xyz789"), "123XYZ789".slice(-8));
assert.equal(numeroDoRecibo("mn-0123456789abcdef"), "89ABCDEF");
assert.equal(numeroDoRecibo("mn-0123456789abcdef"), numeroDoRecibo("mn-0123456789abcdef"), "estável");

const l = { id: "ag-x1", tipo: "entrada", valorCents: 6000, data: "2026-11-06", forma: "pix" as const, categoria: "Atendimento", descricao: "Corte", customerName: "Ana", customerKey: "5591999990000", staffName: "Bia" };
const r = linhasDoRecibo([l], { nome: "Salão X", cidade: "Belém", uf: "PA", telefone: "(91) 99999-0000" });
assert.equal(r.declaracao, `Recebemos de Ana a quantia de ${r.valor} (sessenta reais), referente a Corte.`);
assert.deepEqual(r.itens, [{ servico: "Corte", profissional: "Bia", valor: r.valor }]);
assert.deepEqual(r.emissor, ["Salão X", "Belém/PA", "(91) 99999-0000"]);
assert.equal(r.rodape, "Belém/PA, 06/11/2026.");
// sem cliente (entrada avulsa): não inventa pagador; estorno aparece
const avulso = linhasDoRecibo([{ ...l, customerName: null, descricao: undefined, staffName: null, categoria: "Produto", estornadoCents: 1000 }], { nome: "Salão X" });
assert.match(avulso.declaracao, /^Recebemos a quantia de .* referente a Produto\.$/);
assert.ok(avulso.detalhes.some(([k]) => k === "Estornado"));
assert.match(textoDoRecibo(r, true), /^\*Recibo nº X1\*\nSalão X\n/);

// a visita inteira num recibo: dois serviços e o sinal de um deles (pago por Pix noutro dia)
const doMes = [
  { ...l, valorCents: 7000, forma: "dinheiro" as const },
  { ...l, id: "sn-x1", valorCents: 3000, descricao: "Sinal · Corte", data: "2026-11-02" },
  { ...l, id: "ag-x2", valorCents: 4000, descricao: "Escova", forma: "dinheiro" as const },
  { ...l, id: "ag-x3", valorCents: 9000, data: "2026-11-07" }, // outro dia
  { ...l, id: "ag-x4", valorCents: 1000, customerKey: "5591888880000" }, // outro cliente
  { ...l, id: "es-ag-x1", tipo: "saida", valorCents: 500, estornoDe: "ag-x1" },
];
const juntos = itensDoRecibo(doMes[2], doMes);
assert.deepEqual(juntos.map((i) => i.id), ["ag-x1", "ag-x2", "sn-x1"], "o sinal de outro dia vem junto do atendimento");
const visita = linhasDoRecibo(juntos, { nome: "Salão X" });
assert.equal(visita.valor.replace(/\s/g, " "), "R$ 140,00");
assert.deepEqual(visita.itens.map((i) => [i.servico, i.valor.replace(/\s/g, " ")]), [["Corte", "R$ 100,00"], ["Escova", "R$ 40,00"]], "o serviço com o preço inteiro");
assert.deepEqual(visita.pagamentos.map((p) => [p.rotulo, p.detalhe, p.valor.replace(/\s/g, " ")]), [["Sinal no agendamento", "Pix · 30% do serviço", "R$ 30,00"], ["Restante no atendimento", "Dinheiro", "R$ 110,00"]]);
assert.match(visita.declaracao, /cento e quarenta reais\), referente aos serviços acima\.$/);
assert.match(textoDoRecibo(visita), /Pagamento\n• Sinal no agendamento \(Pix · 30% do serviço\): R\$/);
assert.deepEqual(itensDoRecibo({ ...l, customerKey: null as string | null }, doMes as (typeof l & { customerKey: string | null })[]).map((i) => i.id), ["ag-x1", "sn-x1"], "avulso fica sozinho, mas o sinal do atendimento vem");
// o sinal pago hoje para um horário futuro (ainda não recebido) não entra no recibo de hoje
const comFuturo = [...doMes, { ...l, id: "sn-futuro", valorCents: 450, descricao: "Sinal · Corte" }];
assert.deepEqual(itensDoRecibo(comFuturo[2], comFuturo).map((i) => i.id), ["ag-x1", "ag-x2", "sn-x1"]);
assert.deepEqual(itensDoRecibo(comFuturo[6], comFuturo).map((i) => i.id), ["ag-x1", "ag-x2", "sn-futuro", "sn-x1"], "o recibo do próprio sinal mostra ele");
// só um forma, sem sinal: "Pix", sem "no atendimento"
assert.deepEqual(r.pagamentos.map((p) => p.rotulo), ["Pix"]);

// e-mail do recibo: vazio, incompleto e o texto da imagem do dono não passam
assert.ok(erroDoEmail(""));
assert.ok(erroDoEmail("fdfvdfvfvdfvdfvdfvdfvdfvdvdfv"));
assert.ok(erroDoEmail("ana@gmail"));
assert.ok(erroDoEmail("ana@.com"));
assert.equal(erroDoEmail(" ana.souza@gmail.com "), "");
assert.equal(erroDoEmail("ana@empresa.com.br"), "");
assert.equal(sugestaoDeEmail("Ana@Gmial.com"), "ana@gmail.com");
assert.equal(sugestaoDeEmail("ana@gmail.com"), "");

// o e-mail: o cupom em HTML, com o que veio do banco escapado
{
  const h = htmlDoRecibo(linhasDoRecibo(juntos, { nome: "Salão <X> & Cia" }));
  assert.match(h, /Salão &lt;X&gt; &amp; Cia/);
  assert.ok(!h.includes("<X>"), "nome do negócio não vira HTML");
  assert.match(h, /TOTAL[\s\S]*R\$\s140,00/);
  assert.match(h, /Sinal no agendamento[\s\S]*Restante no atendimento/);
  if (process.env.PREVIA) (await import("node:fs")).writeFileSync(process.env.PREVIA, h);
}

console.log("recibo ok");
