// Rode: npm run test:pix  (BR Code do Pix — funções puras, sem emulador)
import assert from "node:assert/strict";
import { brCode, competenciaAtual, crc16, txidDe, vencimentoDe } from "@/lib/pix";

// Vetor conhecido do CCITT-FALSE: pega init 0x0000 ou polinômio trocado
assert.equal(crc16("123456789"), 0x29b1);
assert.equal(crc16(""), 0xffff);

const recebedor = { chave: "pix@ruphus.site", nome: "Ruphus Tecnologia", cidade: "São Paulo" };
const codigo = brCode({ ...recebedor, valorCents: 5990, txid: "ACMEM2610" });

// Golden: campo a campo, na ordem que o app do banco espera
assert.equal(
  codigo,
  "00020126370014br.gov.bcb.pix0115pix@ruphus.site52040000" +
    "5303986540559.905802BR5917RUPHUS TECNOLOGIA6009SAO PAULO" +
    "62130509ACMEM26106304" +
    codigo.slice(-4),
);

// O CRC cobre o payload com "6304": calcular sem ele é o erro que mais acontece
assert.equal(crc16(codigo.slice(0, -4)).toString(16).toUpperCase().padStart(4, "0"), codigo.slice(-4));
assert.match(codigo.slice(-4), /^[0-9A-F]{4}$/);

// Tamanho com dois dígitos e zero à esquerda
assert.ok(brCode({ ...recebedor, nome: "ABC", valorCents: 100, txid: "X" }).includes("5903ABC"));
// Valor sempre com dois decimais
assert.ok(codigo.includes("540559.90"));
assert.ok(brCode({ ...recebedor, valorCents: 25000, txid: "X" }).includes("5406250.00"));
assert.ok(brCode({ ...recebedor, valorCents: 100, txid: "X" }).includes("54041.00"));

// Acento sai, e o limite corta: 25 no nome, 15 na cidade
assert.ok(codigo.includes("6009SAO PAULO"));
const longo = brCode({ chave: "k", nome: "Associação Beneficente Muito Longa", cidade: "São José dos Campos", valorCents: 1, txid: "X" });
assert.ok(longo.includes("5925ASSOCIACAO BENEFICENTE MU"), "nome cortado em 25");
assert.ok(longo.includes("6015SAO JOSE DOS CA"), "cidade cortada em 15");

// Trocar qualquer campo muda o CRC
const base = { ...recebedor, valorCents: 5990, txid: "ACMEM2610" };
for (const mudanca of [{ valorCents: 5991 }, { txid: "ACMEM2611" }, { chave: "outra@chave" }, { nome: "Outro Nome" }, { cidade: "Manaus" }]) {
  assert.notEqual(brCode({ ...base, ...mudanca }).slice(-4), codigo.slice(-4), `CRC não mudou com ${Object.keys(mudanca)[0]}`);
}

// txid: só A-Z0-9, distingue entrada de mensalidade e um mês do outro
assert.equal(txidDe("barbaros-barbearia", "mensal", "2026-10"), "BARBAROSBARBEARIAM2610");
assert.equal(txidDe("barbaros-barbearia", "entrada", null), "BARBAROSBARBEARIAE");
assert.notEqual(txidDe("acme", "mensal", "2026-10"), txidDe("acme", "mensal", "2026-11"));
assert.match(txidDe("Açaí & Cia", "mensal", "2026-10"), /^[A-Z0-9]+$/);
assert.ok(txidDe("a".repeat(40), "mensal", "2026-10").length <= 25);
const longoTx = txidDe("a".repeat(40), "mensal", "2026-10");
assert.ok(longoTx.endsWith("M2610") && longoTx.length === 25, "slug longo não come o mês");
assert.notEqual(longoTx, txidDe("a".repeat(40), "mensal", "2026-11"), "um mês do outro, mesmo com slug longo");
assert.ok(txidDe("a".repeat(40), "mensal", "2026-10", 2).endsWith("M2610R2"), "reemissão tem txid próprio");
assert.equal(txidDe("acme", "mensal", "2026-10", 1), "ACMEM2610", "primeira emissão igual a antes");

// Competência no fuso do projeto: 23h30 de 31/10 em São Paulo ainda é outubro
assert.equal(competenciaAtual(new Date("2026-11-01T02:30:00Z")), "2026-10");
assert.equal(competenciaAtual(new Date("2026-11-01T03:30:00Z")), "2026-11");
assert.equal(vencimentoDe("2026-10"), "2026-10-10");
assert.equal(vencimentoDe("2027-01"), "2027-01-10");

console.log("pix ok");

// Chave do salão: cada tipo vira o formato que o banco aceita
import { normalizarChave, recebedorDe, tipoDaChave, txidLivre } from "@/lib/pix";
assert.equal(normalizarChave("529.982.247-25"), "52998224725", "CPF válido");
assert.equal(normalizarChave("(11) 99888-7777"), "+5511998887777", "11 dígitos sem CPF válido é celular");
assert.equal(normalizarChave("+55 96 99123-4567"), "+5596991234567");
assert.equal(normalizarChave("12.345.678/0001-95"), "12345678000195", "CNPJ");
assert.equal(normalizarChave(" Salao@Exemplo.com "), "salao@exemplo.com");
assert.equal(normalizarChave("123E4567-E89B-12D3-A456-426614174000"), "123e4567-e89b-12d3-a456-426614174000");
assert.equal(normalizarChave("abc"), null);
assert.equal(normalizarChave("12345"), null);
assert.equal(normalizarChave("+1 202 555 0100"), null, "só Brasil");
assert.equal(normalizarChave("52998224725"), "52998224725", "dígitos soltos com CPF válido: CPF");
assert.equal(normalizarChave("(52) 99822-4725"), "+5552998224725", "com parênteses é celular, mesmo formando CPF válido");
assert.equal(typeof recebedorDe({ chave: "52998224725", nome: "李明", cidade: "Belém" }), "string", "nome que o banco não lê");
assert.deepEqual([tipoDaChave("52998224725"), tipoDaChave("+5511998887777"), tipoDaChave("a@b.co"), tipoDaChave("12345678000195")], ["CPF", "celular", "e-mail", "CNPJ"]);
assert.equal(typeof recebedorDe({ chave: "x", nome: "Ana", cidade: "Belém" }), "string");
assert.deepEqual(recebedorDe({ chave: "52998224725", nome: " Ana ", cidade: "Belém" }), { chave: "52998224725", nome: "Ana", cidade: "Belém" });
const tx = txidLivre("salao-da-ana");
assert.match(tx, /^[A-Z0-9]{1,25}$/);
assert.notEqual(txidLivre("salao-da-ana"), txidLivre("salao-da-ana"), "mesmo milissegundo, txid diferente");
assert.match(txidLivre("s".repeat(40)), /^[A-Z0-9]{25}$/, "slug longo: corta no começo, cabe em 25");
console.log("chave do salão ok");

// Validação do BR Code: entrada fora do formato não vira QR que o banco recusa
import { brCode as montar, legivel, PixInvalido } from "@/lib/pix";
const ok = { chave: "52998224725", nome: "Ana", cidade: "Belem", valorCents: 1000, txid: "ABC123" };
assert.doesNotThrow(() => montar(ok));
for (const [campo, valor] of [
  ["valorCents", 0], ["valorCents", -1], ["valorCents", 10.5], ["valorCents", Number.NaN], ["valorCents", 1e13],
  ["txid", ""], ["txid", "COM ESPAÇO"], ["txid", "A".repeat(26)], ["txid", "acentuação"],
  ["chave", ""], ["chave", "   "], ["chave", "x".repeat(78)],
  ["nome", "李明"], ["cidade", "!!!"],
] as const) {
  assert.throws(() => montar({ ...ok, [campo]: valor }), PixInvalido, `${campo}=${String(valor)}`);
}
assert.ok(montar({ ...ok, valorCents: 999_999_999_999 }).includes("5413" + "9999999999.99"), "valor máximo cabe no campo 54");

// CNPJ com dígito verificador, zero do DDD, chave aleatória
assert.equal(normalizarChave("11.222.333/0001-81"), "11222333000181");
assert.equal(normalizarChave("11.222.333/0001-82"), null, "CNPJ com dígito errado");
assert.equal(normalizarChave("00000000000000"), null);
assert.equal(normalizarChave("111.111.111-11"), null, "CPF repetido não é CPF, e 11 1111-1111 não é celular");
assert.equal(normalizarChave("(11) 3333-4444"), null, "fixo não é chave Pix");
assert.equal(normalizarChave("(11) 2888-7777 0"), null);
assert.ok(legivel("Ana", 25) && !legivel("李明", 25) && !legivel("--", 25) && !legivel("A", 25));
assert.equal(normalizarChave("0 (11) 98888-7777"), "+5511988887777", "zero na frente do DDD");
assert.equal(normalizarChave("+55 (11) 98888-7777"), "+5511988887777");
assert.equal(normalizarChave("1234"), null);
assert.equal(normalizarChave("a@b"), null, "e-mail sem domínio");
assert.equal(normalizarChave(`${"a".repeat(70)}@exemplo.com`), null, "e-mail acima de 77");
assert.equal(normalizarChave("<script>@x.com"), "<script>@x.com".toLowerCase(), "e-mail é texto: o QR leva como está, a tela escapa");
assert.equal(tipoDaChave("123e4567-e89b-12d3-a456-426614174000"), "chave aleatória");

// Sanitização: controle e espaços somem antes de virar QR
const limpo = recebedorDe({ chave: "52998224725", nome: "  Ana\u0000\n  Souza ", cidade: "Belém\t" });
assert.deepEqual(limpo, { chave: "52998224725", nome: "Ana Souza", cidade: "Belém" });
assert.equal(typeof recebedorDe({ chave: "52998224725", nome: "A", cidade: "Belém" }), "string", "nome curto");
assert.equal(typeof recebedorDe({ chave: "52998224725", nome: "Ana", cidade: " " }), "string", "cidade vazia");
// o nome guardado pode ser longo; o QR corta em 25
assert.ok(montar({ ...ok, nome: "N".repeat(60) }).includes("5925" + "N".repeat(25)));
console.log("validação do pix ok");
