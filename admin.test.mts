// Rode: npm run test:admin  (o select da lista não pode ficar para trás dos campos lidos)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A lista do painel pede só alguns campos do tenant (select), e depois lê esses
// campos com d.get(). Quem acrescentar um campo à tela e esquecer o select não
// recebe erro nenhum: o campo chega undefined e a coluna fica vazia para os 677
// negócios. Este teste é o que avisa.
const fonte = readFileSync(new URL("./src/app/admin/actions.ts", import.meta.url), "utf8");

const lista = fonte.match(/const CAMPOS_DA_LISTA = \[([^\]]*)\]/)?.[1];
assert.ok(lista, "CAMPOS_DA_LISTA sumiu de actions.ts");
const pedidos = new Set([...lista.matchAll(/"([^"]+)"/g)].map((m) => m[1]));

const mapeamento = fonte.match(/\.map\(\(d\): Espaco => \(\{([\s\S]*?)\}\)\)/)?.[1];
assert.ok(mapeamento, "o mapeamento de Espaco mudou de forma");
const lidos = [...mapeamento.matchAll(/d\.get\("([^"]+)"\)/g)].map((m) => m[1]);
assert.ok(lidos.length >= 7, `só ${lidos.length} campos lidos: a regex não está pegando o mapeamento`);

for (const campo of lidos) {
  assert.ok(pedidos.has(campo), `"${campo}" é lido mas não está no select: chegaria vazio na lista`);
}

// e o contrário também cansa: campo pedido e nunca usado é peso à toa na consulta
for (const campo of pedidos) {
  assert.ok(lidos.includes(campo), `"${campo}" está no select e ninguém lê: tire da consulta`);
}

console.log(`ok — ${lidos.length} campos lidos, todos no select`);
