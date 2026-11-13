// Rode: tsx src/lib/sanitizar.test.mts  (parte de npm run test:prospeccao-fb)
import assert from "node:assert/strict";
import { textoSeguro } from "@/lib/sanitizar";

assert.equal(textoSeguro("Oi\u0000 tudo\u0007bem\u001b", 50), "Oi tudo bem", "controle vira espaço e some na ponta");
assert.equal(textoSeguro("linha 1\n\n\tlinha 2\r\n", 50), "linha 1 linha 2", "quebra e tab colapsam");
assert.equal(textoSeguro("Sa\u200Blão\u00AD da\uFEFF Ana\u2060", 50), "Salão da Ana", "largura zero e hífen invisível somem sem deixar espaço");
assert.equal(textoSeguro("Técnica 👩\u200D🔧", 50), "Técnica 👩‍🔧", "ZWJ do emoji composto fica");
assert.equal(textoSeguro("a\u200Cb", 50), "a\u200Cb", "ZWNJ fica");
assert.equal(textoSeguro("abc‮def", 50), "abc def", "bidi (Cf) não passa");
const nfd = "Sálao"; // "Sálao" decomposto
assert.equal(textoSeguro(nfd, 50), "Sálao", "NFC");
assert.equal(textoSeguro(nfd, 50).length, 5);
assert.equal(textoSeguro("   muito    espaço   ", 50), "muito espaço");
assert.equal(textoSeguro("abcdef", 3), "abc", "corte");
assert.equal(textoSeguro("ab cdef", 3), "ab", "corte não deixa espaço no fim");
assert.equal(textoSeguro("😀😀😀", 2), "😀😀", "corte por ponto de código, sem partir emoji");
assert.equal(textoSeguro("", 10), "");
// linhas: a mensagem confirmada do "Enviou?" guarda as quebras (o resto do controle segue virando espaço)
assert.equal(textoSeguro("Oi!\r\n\nSegue o link:\t x\u0000y\u200B", 100, true), "Oi!\n\nSegue o link: x y", "quebras ficam; tab, \\0 e largura zero não");
assert.equal(textoSeguro("  a  \n  b  ", 100, true), "a\nb", "espaços colapsam e somem em volta da quebra");
console.log("sanitizar: ok");
