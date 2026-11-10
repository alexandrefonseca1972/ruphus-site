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
// 22h em Brasília já é dia 27 em UTC: amanhã continua sendo futuro, e ninguém faz aniversário antes
const noite = new Date("2026-09-27T01:00:00Z");
assert.equal(erroNascimento("27/09/2026", noite), "A data não pode ser no futuro");
assert.equal(idade("1990-09-27", noite), 35);
assert.equal(mascaraEmail(" Ana @Gmail.COM "), "ana@gmail.com");
assert.equal(erroEmail("ana@gmail"), "E-mail incompleto: confira o @ e o domínio");
assert.equal(erroEmail(""), "");
assert.equal(erroEmail("ana@gmail.com"), "");
console.log("dados do cliente: ok");

// Preço fixo, "a partir de" ou sem preço — um serviço ou a soma de vários
import { precoDe } from "@/lib/datetime";
assert.equal(precoDe({ priceCents: 3000 }), "R$ 30,00", "sem tipo = fixo (serviços antigos)");
assert.equal(precoDe({ priceCents: 3000, tipoPreco: "aPartir" }), "a partir de R$ 30,00");
assert.equal(precoDe({ priceCents: 0, tipoPreco: "naoInformado" }), "");
assert.equal(precoDe({ priceCents: 3000, tipoPreco: "fixo" }, { priceCents: 0, tipoPreco: "naoInformado" }), "a partir de R$ 30,00", "um sem preço deixa a soma em aberto");
assert.equal(precoDe({ priceCents: 3000 }, { priceCents: 2000 }), "R$ 50,00");
console.log("preço: ok");

// celular BR canônico (com o 9º dígito), igual ao atendys: conta antiga chega sem o 9
{
  const { canonicalBrMobile, soDigitosComDDI } = await import("@/lib/telefone");
  assert.equal(canonicalBrMobile("559192361726"), "5591992361726", "conta antiga ganha o 9");
  assert.equal(canonicalBrMobile("5591992361726"), "5591992361726", "idempotente");
  assert.equal(canonicalBrMobile("559132334455"), "559132334455", "fixo não tem par");
  assert.equal(canonicalBrMobile("14155550132"), "14155550132", "estrangeiro intacto");
  assert.equal(soDigitosComDDI("(91) 9236-1726"), "5591992361726");
  assert.equal(soDigitosComDDI("+55 91 99236-1726"), "5591992361726");
  assert.equal(soDigitosComDDI("559192361726"), soDigitosComDDI("5591992361726"), "as duas formas viram uma");
  assert.equal(soDigitosComDDI("(91) 3233-4455"), "559132334455");
  assert.equal(soDigitosComDDI("123"), null);
  console.log("telefone canônico ok");
}

// WhatsApp do dono no painel: só celular brasileiro, canônico de 13 dígitos
{
  const { celularDoDono } = await import("@/lib/telefone");
  const exemplo = "Informe um celular com DDD, ex.: (91) 99999-0000";
  assert.deepEqual(celularDoDono("(91) 99236-1726"), { numero: "5591992361726" }, "11 dígitos com o 9");
  assert.deepEqual(celularDoDono("+55 91 99236-1726"), { numero: "5591992361726" }, "13 com o 55");
  assert.deepEqual(celularDoDono("559192361726"), { numero: "5591992361726" }, "12 dígitos antigo (sem o 9) vira canônico");
  assert.deepEqual(celularDoDono(""), { erro: exemplo });
  assert.deepEqual(celularDoDono("9199236"), { erro: exemplo }, "incompleto");
  assert.deepEqual(celularDoDono("123456789012345"), { erro: exemplo }, "longo demais");
  assert.deepEqual(celularDoDono("(20) 99236-1726"), { erro: `DDD inválido. ${exemplo}` }, "DDD 20 não existe");
  assert.deepEqual(celularDoDono("(01) 99236-1726"), { erro: `DDD inválido. ${exemplo}` });
  assert.match((celularDoDono("(91) 3233-4455") as { erro: string }).erro, /^Esse é um telefone fixo/, "fixo");
  assert.match((celularDoDono("559132334455") as { erro: string }).erro, /^Esse é um telefone fixo/, "fixo com 55");
  for (const falso of ["(91) 99999-9999", "(83) 98811-2233", "(11) 91234-5678"]) {
    assert.match((celularDoDono(falso) as { erro: string }).erro, /parece inventado/, falso);
  }
  // o fixo do negócio com um 9 na frente: não é o celular de ninguém
  assert.match((celularDoDono("(91) 93233-4455", "(91) 3233-4455") as { erro: string }).erro, /telefone fixo do negócio/);
  assert.deepEqual(celularDoDono("(91) 99236-1726", "(91) 3233-4455"), { numero: "5591992361726" }, "outro número com negócio fixo");
  assert.deepEqual(celularDoDono("(91) 99236-1726", "(91) 99236-1726"), { numero: "5591992361726" }, "negócio com celular: o mesmo número vale");
  console.log("celular do dono ok");
}
