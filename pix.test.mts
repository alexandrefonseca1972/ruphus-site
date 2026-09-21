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

// Competência no fuso do projeto: 23h30 de 31/10 em São Paulo ainda é outubro
assert.equal(competenciaAtual(new Date("2026-11-01T02:30:00Z")), "2026-10");
assert.equal(competenciaAtual(new Date("2026-11-01T03:30:00Z")), "2026-11");
assert.equal(vencimentoDe("2026-10"), "2026-10-10");
assert.equal(vencimentoDe("2027-01"), "2027-01-10");

console.log("pix ok");
