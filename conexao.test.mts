// Rode: npm run test:conexao  (monitor de conexão e versão do painel — funções puras)
import assert from "node:assert/strict";
import { ehVersaoAntiga, esperaDe, recarregarUmaVez, versaoMudou } from "@/lib/conexao";

// espera crescente, com teto
assert.deepEqual([1, 2, 3, 4, 5, 6, 20].map(esperaDe), [5_000, 10_000, 20_000, 40_000, 60_000, 60_000, 60_000]);
assert.equal(esperaDe(0), 5_000, "sem falha ainda: a primeira espera");

// a mensagem do Next para ação de outro deploy (servidor e cliente)
assert.ok(ehVersaoAntiga(new Error('Failed to find Server Action "7f95". This request might be from an older or newer deployment.')));
assert.ok(ehVersaoAntiga(new Error('Server Action "7f95" was not found on the server.')));
assert.ok(!ehVersaoAntiga(new Error("fetch failed")), "queda de rede não é versão antiga");
assert.ok(!ehVersaoAntiga(new TypeError("Failed to fetch")));
assert.ok(!ehVersaoAntiga(null) && !ehVersaoAntiga(undefined) && !ehVersaoAntiga("qualquer"));

// versão nova: só com commits de verdade e diferentes
assert.equal(versaoMudou("a1b2c3d", "e4f5a6b"), true);
assert.equal(versaoMudou("a1b2c3d", "a1b2c3d"), false);
assert.equal(versaoMudou("local", "e4f5a6b"), false, "em dev a página é local");
assert.equal(versaoMudou("a1b2c3d", "local"), false);
assert.equal(versaoMudou("a1b2c3d", null), false, "sem resposta não é versão nova");

// recarregar no máximo uma vez por minuto (sem laço se o servidor oscilar)
const memoria = new Map<string, string>();
const armazem = { getItem: (k: string) => memoria.get(k) ?? null, setItem: (k: string, v: string) => void memoria.set(k, v) };
assert.equal(recarregarUmaVez(1_000_000, armazem), true);
assert.equal(recarregarUmaVez(1_030_000, armazem), false, "30 s depois: não recarrega de novo");
assert.equal(recarregarUmaVez(1_061_000, armazem), true, "passado um minuto, pode");
const quebrado = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => undefined };
assert.equal(recarregarUmaVez(1, quebrado), true, "storage bloqueado: recarrega assim mesmo");

console.log("conexão ok");
