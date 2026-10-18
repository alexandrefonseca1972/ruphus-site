import assert from "node:assert/strict";
import { emailDaProposta } from "@/lib/proposta-email";

const base = {
  nome: "Salão Bela Vista",
  donoNome: "Ana Paula Souza",
  url: "https://www.ruphus.site/proposta/bela-vista?t=abc123",
  valeAte: "2026-10-25",
  entradaCents: 250_00,
  mensalCents: 89_90,
  assinatura: "Carlos",
};

const e = emailDaProposta(base);

// assunto leva o nome do negócio, e o texto leva o link exato da página
assert.equal(e.assunto, "Proposta da Ruphus para Salão Bela Vista");
assert.ok(e.texto.includes(base.url), "o link da proposta tem de estar no corpo");

// saudação pelo primeiro nome do dono
assert.ok(e.texto.startsWith("Oi, Ana!"), "saúda pelo primeiro nome");

// valores em reais, iguais aos da página (o Intl põe um espaço não separável após R$)
assert.match(e.texto, /R\$\s250,00/, "entrada em reais");
assert.match(e.texto, /R\$\s89,90/, "mensalidade em reais");

// prazo em dia/mês, como a página mostra
assert.ok(e.texto.includes("vale até 25/10"), "validade em DD/MM");

// assinatura do admin, depois da marca
assert.ok(e.texto.endsWith("Carlos\nRuphus"), "assina com o nome definido e a marca");

// sem dono cadastrado e sem assinatura: sem saudação quebrada nem linha vazia no fim
const sem = emailDaProposta({ ...base, donoNome: null, assinatura: null });
assert.ok(sem.texto.startsWith("Oi!"), "sem nome do dono, a saudação fica só com o oi");
assert.ok(sem.texto.endsWith("\n\nRuphus"), "sem assinatura, fica só a marca");
assert.ok(!sem.texto.includes("\n\n\n"), "sem linhas vazias sobrando");

// texto puro: nada de tag HTML no corpo
assert.ok(!/<[a-z][\s\S]*>/i.test(e.texto), "corpo é texto puro");
