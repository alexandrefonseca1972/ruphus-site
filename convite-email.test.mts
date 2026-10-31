import assert from "node:assert/strict";
import { emailDoConvite } from "@/lib/convite-email";

const base = {
  nome: "Salão Bela Vista",
  slug: "bela-vista",
  donoNome: "Ana Paula Souza",
  url: "https://www.ruphus.site/convite?c=eyJhbGciOi.exemplo",
  email: "ana@salaobelavista.com.br",
  dias: 7,
  assinatura: "Carlos",
};

const e = emailDoConvite(base);

// assunto leva o nome do negócio, e o corpo leva o link exato do convite
assert.equal(e.assunto, "Acesso ao painel do Salão Bela Vista");
assert.ok(e.texto.includes(base.url), "o link do convite tem de estar no corpo");

// o link abre só com este e-mail: ele precisa aparecer para o dono saber qual usar
assert.ok(e.texto.includes(`com o e-mail ${base.email}`), "diz qual e-mail abre o link");

// endereço do site do negócio, como no convite do WhatsApp
assert.ok(e.texto.includes("https://bela-vista.ruphus.site"), "mostra o endereço do site");

// prazo e aviso de uso único
assert.ok(e.texto.includes("vale 7 dias"), "diz o prazo");
assert.ok(e.texto.includes("serve uma vez só, então não repasse"), "pede para não repassar");

// saudação pelo primeiro nome e assinatura do admin
assert.ok(e.texto.startsWith("Oi, Ana!"), "saúda pelo primeiro nome");
assert.ok(e.texto.endsWith("Carlos\nRuphus"), "assina com o nome definido e a marca");

// sem dono cadastrado e sem assinatura: saudação e fecho continuam limpos
const sem = emailDoConvite({ ...base, donoNome: null, assinatura: null });
assert.ok(sem.texto.startsWith("Oi!"), "sem nome do dono, saudação só com o oi");
assert.ok(sem.texto.endsWith("\n\nRuphus"), "sem assinatura, fica só a marca");
assert.ok(!sem.texto.includes("\n\n\n"), "sem linhas vazias sobrando");

// texto puro: nada de tag HTML no corpo
assert.ok(!/<[a-z][\s\S]*>/i.test(e.texto), "corpo é texto puro");

// HTML: o mesmo link, o e-mail que abre e nada digitado entra cru
assert.ok(e.html.includes(base.url), "o botão leva o link do convite");
assert.ok(e.html.includes(base.email), "o HTML diz qual e-mail abre o link");
const perigo = emailDoConvite({ ...base, nome: "<script>x</script> & Cia" });
assert.ok(!perigo.html.includes("<script>x"), "nome do negócio escapado no HTML");
assert.ok(perigo.html.includes("&lt;script&gt;x&lt;/script&gt; &amp; Cia"));
console.log("convite-email html: ok");
