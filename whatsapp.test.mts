import assert from "node:assert/strict";
import { linkWhatsApp } from "@/lib/datetime";

const numero = (link: string | null) => link?.match(/wa\.me\/(\d+)/)?.[1] ?? null;

// número de casa ganha o código do país
assert.equal(numero(linkWhatsApp("(92) 98473-9695", "oi")), "5592984739695");
assert.equal(numero(linkWhatsApp("9232334455", "oi")), "559232334455");
// já veio com o 55, fica como está
assert.equal(numero(linkWhatsApp("+55 92 98473-9695", "oi")), "5592984739695");
assert.equal(numero(linkWhatsApp("559232334455", "oi")), "559232334455");

// A armadilha: 55 também é o DDD de Santa Maria. Um fixo de lá tem 10 dígitos
// e começa com 55 — se fosse lido como internacional, abriria conversa com
// um número que não existe.
assert.equal(numero(linkWhatsApp("5532200000", "oi")), "555532200000");

// o que não serve não vira botão
assert.equal(linkWhatsApp("", "oi"), null);
assert.equal(linkWhatsApp(null, "oi"), null);
assert.equal(linkWhatsApp("1234", "oi"), null);
assert.equal(linkWhatsApp("123456789012345", "oi"), null);
// doze dígitos que não começam com 55 não são internacionais conhecidos
assert.equal(linkWhatsApp("019232334455", "oi"), null);

// a mensagem viaja escapada, com quebras de linha e acento
const l = linkWhatsApp("92984739695", "Olá!\nAgendei às 10:30 & confirmo");
assert.ok(l!.includes("?text="));
assert.equal(decodeURIComponent(l!.split("?text=")[1]), "Olá!\nAgendei às 10:30 & confirmo");

console.log("whatsapp: ok");

// nome de quem agenda ou se cadastra: a mesma regra na tela e no servidor
import { erroNome, mascaraNome } from "@/lib/nome";
assert.equal(mascaraNome("3232323232232"), "", "número não entra no nome");
assert.equal(mascaraNome("  Ana   Maria 2 "), "Ana Maria ");
assert.equal(mascaraNome("D'Ávila-Souza Jr."), "D'Ávila-Souza Jr.");
assert.equal(erroNome("3232323232232"), "Use só letras no nome");
assert.equal(erroNome("A"), "Informe seu nome, com pelo menos 2 letras");
assert.equal(erroNome(""), "Informe seu nome");
assert.equal(erroNome("Zé"), "");
console.log("nome: ok");

// dados do cliente na ficha: nascimento e e-mail
import { erroEmail, erroNascimento, idade, isoDeBR, mascaraData, mascaraEmail } from "@/lib/cliente-dados";
assert.equal(mascaraData("31121990"), "31/12/1990");
assert.equal(mascaraData("3a1/1"), "31/1", "letra e barra digitada não entram");
assert.equal(mascaraData("311219901234"), "31/12/1990", "no máximo 8 dígitos");
assert.equal(isoDeBR("31/12/1990"), "1990-12-31");
const hoje = new Date("2026-09-26T12:00:00Z");
assert.equal(erroNascimento("", hoje), "", "vazio é permitido");
assert.equal(erroNascimento("31/12/19", hoje), "Complete a data: DD/MM/AAAA");
assert.equal(erroNascimento("31/02/1990", hoje), "Essa data não existe");
assert.equal(erroNascimento("01/13/1990", hoje), "Essa data não existe");
assert.equal(erroNascimento("01/01/1850", hoje), "Confira o ano");
assert.equal(erroNascimento("01/01/2027", hoje), "A data não pode ser no futuro");
assert.equal(erroNascimento("29/02/2000", hoje), "", "bissexto vale");
assert.equal(idade("1990-09-27", hoje), 35, "ainda não fez aniversário este ano");
assert.equal(idade("1990-09-26", hoje), 36);
assert.equal(mascaraEmail(" Ana @Gmail.COM "), "ana@gmail.com");
assert.equal(erroEmail("ana@gmail"), "E-mail incompleto: confira o @ e o domínio");
assert.equal(erroEmail(""), "");
assert.equal(erroEmail("ana@gmail.com"), "");
console.log("dados do cliente: ok");
