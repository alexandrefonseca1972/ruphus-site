import assert from "node:assert/strict";
import { cacheDe, faixa, objetoDoSite, tipoDe } from "@/lib/site-arquivo";

// caminho de site vira chave do bucket
assert.equal(objetoDoSite("engenheiradasunhas", ["index.html"]), "sites/engenheiradasunhas/index.html");
assert.equal(objetoDoSite("engenheiradasunhas", ["video", "marsala.mp4"]), "sites/engenheiradasunhas/video/marsala.mp4");
assert.equal(objetoDoSite("_p", ["engenheiradasunhas.webp"]), "sites/_p/engenheiradasunhas.webp");
// nada de subir de pasta, esconder arquivo ou slug inventado
assert.equal(objetoDoSite("engenheiradasunhas", ["..", "outro", "index.html"]), null);
assert.equal(objetoDoSite("engenheiradasunhas", ["img", "..x.jpg"]), null);
assert.equal(objetoDoSite("engenheiradasunhas", [".env"]), null);
assert.equal(objetoDoSite("engenheiradasunhas", ["img/../x.jpg"]), null);
assert.equal(objetoDoSite("engenheiradasunhas", ["foto nova.jpg"]), null);
assert.equal(objetoDoSite("Maiuscula", ["index.html"]), null);
assert.equal(objetoDoSite("_x", ["a.webp"]), null);
assert.equal(objetoDoSite("engenheiradasunhas", []), null);
assert.equal(objetoDoSite("a-b", ["1", "2", "3", "4", "5.jpg"]), null, "fundo demais");
console.log("caminhos ok");

// Range do vídeo (o Safari só toca <video> se o servidor responder faixas)
assert.equal(faixa(null, 1000), null);
assert.deepEqual(faixa("bytes=0-1", 1000), { inicio: 0, fim: 1 });
assert.deepEqual(faixa("bytes=500-", 1000), { inicio: 500, fim: 999 });
assert.deepEqual(faixa("bytes=900-5000", 1000), { inicio: 900, fim: 999 }, "fim além do arquivo é cortado");
assert.deepEqual(faixa("bytes=-100", 1000), { inicio: 900, fim: 999 });
assert.equal(faixa("bytes=1000-", 1000), "fora");
assert.equal(faixa("bytes=10-5", 1000), "fora");
assert.equal(faixa("bytes=0-1,5-9", 1000), null, "várias faixas: vai o arquivo inteiro");
assert.equal(faixa("itens=0-1", 1000), null);
console.log("faixas ok");

assert.equal(tipoDe("index.html"), "text/html; charset=utf-8");
assert.equal(tipoDe("img/FOTO.JPG"), "image/jpeg");
assert.equal(tipoDe("video/marsala.mp4"), "video/mp4");
assert.equal(tipoDe("sem-extensao"), "application/octet-stream");
assert.match(cacheDe("index.html"), /max-age=0,/);
assert.match(cacheDe("img/a.jpg"), /max-age=300,/);
console.log("tipos ok");
