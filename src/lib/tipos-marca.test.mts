// Rode: tsx src/lib/tipos-marca.test.mts  (parte de npm run test:prospeccao-fb)
import assert from "node:assert/strict";
import { paraModeloId, paraSlug, paraTelefoneNorm, paraVarianteId } from "@/lib/tipos-marca";

assert.equal(paraTelefoneNorm("(91) 99236-1726"), "5591992361726", "local vira DDI+DDD+número");
assert.equal(paraTelefoneNorm("559192361726"), "5591992361726", "celular antigo sem o 9 é canonizado");
assert.equal(paraTelefoneNorm("(91) 3223-4567"), "559132234567", "fixo passa como está");
assert.equal(paraTelefoneNorm("123"), null, "curto");
assert.equal(paraTelefoneNorm("(11) 99999-9999"), null, "inventado (um dígito só)");
assert.equal(paraTelefoneNorm("(83) 98811-2233"), null, "inventado (pares)");
assert.equal(paraTelefoneNorm(""), null);

assert.equal(paraSlug("salao-da-ana"), "salao-da-ana");
for (const ruim of ["Salão", "salao-", "-salao", "a", "", "salao da ana", "salao--ana", "x".repeat(64)]) assert.equal(paraSlug(ruim), null, `slug ${ruim}`);

assert.equal(paraVarianteId("salao-primeiro-elogio"), "salao-primeiro-elogio");
assert.equal(paraVarianteId("Salao Primeiro"), null);

assert.equal(paraModeloId("claude-haiku-5-5"), "claude-haiku-5-5");
assert.equal(paraModeloId("llama3.1:8b"), "llama3.1:8b");
for (const ruim of ["", " claude", "claude haiku", "-x", "x".repeat(101)]) assert.equal(paraModeloId(ruim), null, `modelo ${ruim}`);

// marca: um string comum não entra onde se espera Slug
// @ts-expect-error string não é Slug
const _s: import("@/lib/tipos-marca").Slug = "salao";
void _s;
console.log("tipos-marca: ok");
