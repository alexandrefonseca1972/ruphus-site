// Rode: npm run test:cobranca  (cobrança por Pix no emulador do Firestore)
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { abrirCobranca, atrasadas, baixar, cancelar, gerarCobranca, idDe, lerPix, listarCobrancas, salvarPix } from "@/lib/cobranca";

const db = getFirestore(initializeApp({ projectId: "demo-siteflow" }));

// Sem chave cadastrada a cobrança existe, mas não tem Pix para mostrar
await assert.rejects(lerPix(db), /não cadastrada/);
await assert.rejects(salvarPix(db, { chave: "", nome: "Ruphus", cidade: "São Paulo", whatsapp: "11999990000" }));
await salvarPix(db, { chave: "pix@ruphus.site", nome: "Ruphus Tecnologia", cidade: "São Paulo", whatsapp: "(11) 99999-0000" });
assert.equal((await lerPix(db)).chave, "pix@ruphus.site");

await db.collection("tenants").doc("acme").set({ name: "Acme Barbearia" });

// Id previsível, e gerar de novo não duplica nem reescreve o valor
assert.equal(idDe("acme", "mensal", "2026-10"), "acme-2026-10");
assert.equal(idDe("acme", "entrada", null), "acme-entrada");
const um = await gerarCobranca(db, { slug: "acme", tipo: "mensal", competencia: "2026-10", valorCents: 5990 });
assert.deepEqual([um.id, um.nova], ["acme-2026-10", true]);
const dois = await gerarCobranca(db, { slug: "acme", tipo: "mensal", competencia: "2026-10", valorCents: 9999 });
assert.deepEqual([dois.id, dois.nova, dois.token], [um.id, false, um.token]);
assert.equal((await listarCobrancas(db, "acme"))[0].valorCents, 5990, "valor da cobrança aberta não se reescreve");
assert.equal((await listarCobrancas(db, "acme")).length, 1);

// A página pública: o token do link é a credencial
assert.equal(await abrirCobranca(db, um.id, "token-errado"), null);
assert.equal(await abrirCobranca(db, um.id, ""), null);
assert.equal(await abrirCobranca(db, "acme-2026-09", um.token), null, "cobrança que não existe");
const publica = (await abrirCobranca(db, um.id, um.token))!;
assert.deepEqual(
  Object.keys(publica).sort(),
  ["brCode", "competencia", "nome", "status", "tipo", "txid", "valorCents", "vencimento"],
  "nada de slug, token ou baixaPor na página pública",
);
// Nenhum valor complexo: Timestamp derruba a travessia servidor→cliente
assert.ok(Object.values(publica).every((v) => v === null || ["string", "number", "boolean"].includes(typeof v)));
assert.deepEqual([publica.nome, publica.valorCents, publica.vencimento], ["Acme Barbearia", 5990, "2026-10-10"]);
assert.ok(publica.brCode?.startsWith("000201"), "cobrança aberta mostra o Pix");
assert.equal(publica.txid, "ACMEM2610");

// Baixa: grava o que entrou de fato, e não reabre
await baixar(db, um.id, { recebidoCents: 5990, pagoEm: "2026-10-12", por: "admin@ruphus.app" });
const paga = (await listarCobrancas(db, "acme"))[0];
assert.deepEqual([paga.status, paga.pagoEm, paga.recebidoCents], ["paga", "2026-10-12", 5990]);
assert.equal((await abrirCobranca(db, um.id, um.token))?.brCode, null, "paga não mostra Pix");
assert.equal((await gerarCobranca(db, { slug: "acme", tipo: "mensal", competencia: "2026-10", valorCents: 5990 })).nova, false);
await assert.rejects(baixar(db, "nao-existe", { recebidoCents: 1, pagoEm: "2026-10-12", por: "x" }));

// Cancelar libera a competência com sufixo — é como se corrige um valor errado
const nov = await gerarCobranca(db, { slug: "acme", tipo: "mensal", competencia: "2026-11", valorCents: 5990 });
await cancelar(db, nov.id, "admin@ruphus.app");
const cancelada = (await abrirCobranca(db, nov.id, nov.token))!;
assert.deepEqual([cancelada.status, cancelada.brCode], ["cancelada", null], "cancelada responde, sem Pix");
const refeita = await gerarCobranca(db, { slug: "acme", tipo: "mensal", competencia: "2026-11", valorCents: 7000 });
assert.deepEqual([refeita.id, refeita.nova], ["acme-2026-11-2", true]);
assert.notEqual(refeita.token, nov.token);

// Atrasadas: aberta com vencimento no passado, nada mais
const atraso = await atrasadas(db, "2026-11-15");
assert.deepEqual(
  atraso.map((c) => c.id),
  ["acme-2026-11-2"],
  "a paga de outubro e a cancelada de novembro ficam fora",
);
assert.equal((await atrasadas(db, "2026-11-01")).length, 0, "antes do vencimento não é atraso");

// Entrada: uma por negócio, vencimento dado na mão
const entrada = await gerarCobranca(db, { slug: "acme", tipo: "entrada", competencia: null, valorCents: 25000, vencimento: "2026-10-05" });
assert.deepEqual([entrada.id, entrada.nova], ["acme-entrada", true]);
assert.equal((await abrirCobranca(db, entrada.id, entrada.token))?.competencia, null);

console.log("cobranca ok");
process.exit(0);
