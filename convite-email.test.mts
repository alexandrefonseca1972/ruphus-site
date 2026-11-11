import assert from "node:assert/strict";
import { emailDoConvite } from "@/lib/convite-email";
import { emailDoAceite } from "@/lib/contrato";
import { montarEmail } from "@/lib/email-layout";

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

// confirmação do aceite dos Termos: versão, negócio, horário de Brasília e o link fixo da versão
{
  const a = emailDoAceite({ slug: "bela-vista", versao: "1.0", quando: new Date("2026-11-01T15:30:00Z"), site: "https://www.ruphus.site/" });
  assert.ok(a.assunto.includes("versão 1.0"));
  assert.ok(a.texto.includes("https://www.ruphus.site/termos/1.0"), "link da versão aceita, sem barra dobrada");
  assert.ok(a.texto.includes("bela-vista.ruphus.site"));
  assert.ok(a.texto.includes("12:30"), "horário de Brasília, não UTC");
  assert.ok(a.texto.includes("7 dias"), "lembra o direito de desistência");
  assert.ok(a.html.includes("Ler os Termos aceitos") && a.html.includes("https://www.ruphus.site/termos/1.0"), "no layout da Ruphus, com o botão");
}

// layout padrão dos avisos: dado digitado vira texto (sem HTML), e o texto puro acompanha
{
  const e = montarEmail({
    assunto: "Teste",
    faixa: "Aviso do sistema",
    titulo: "Saldo <baixo>",
    blocos: [{ p: "linha 1\nlinha 2" }, { destaque: "R$ 3,45", rotulo: "Saldo" }, { dados: [["Negócio", "a&b"]] }, { passos: ["um", "dois"], titulo: "O que fazer" }, { tecnico: "erro <x>", titulo: "Erro" }],
    acao: { texto: "Abrir", url: "https://www.ruphus.site/x?a=1&b=2" },
    motivo: "Porque sim.",
    tom: "alerta",
  });
  assert.ok(e.html.includes("Saldo &lt;baixo&gt;") && !e.html.includes("<baixo>"), "título escapado");
  assert.ok(e.html.includes("linha 1<br>linha 2"));
  assert.ok(e.html.includes("a&amp;b") && e.html.includes("erro &lt;x&gt;"));
  assert.ok(e.html.includes('href="https://www.ruphus.site/x?a=1&amp;b=2"'));
  assert.ok(e.html.includes("CNPJ 59.500.429/0001-90"), "rodapé da empresa");
  assert.equal(e.texto, "Saldo <baixo>\n\nlinha 1\nlinha 2\n\nSaldo: R$ 3,45\n\nNegócio: a&b\n\nO que fazer\n1. um\n2. dois\n\nErro\nerro <x>\n\nAbrir: https://www.ruphus.site/x?a=1&b=2\n\nRuphus\n\nPorque sim.");
  console.log("layout de e-mail: ok");
}


// A confirmação do e-mail devolve ao convite, sem aceitar retorno para fora do site.
{
  const { destinoInterno, urlDeVerificacao } = await import("@/lib/retorno");
  const origem = "https://www.ruphus.site";
  assert.equal(destinoInterno("/convite?c=abc#entrar", origem), "/convite?c=abc#entrar");
  assert.equal(destinoInterno(`${origem}/convite?c=abc`, origem), "/convite?c=abc");
  assert.equal(destinoInterno("//evil.com/convite", origem), "");
  assert.equal(destinoInterno("/\\evil.com/convite", origem), "");
  assert.equal(destinoInterno("https://evil.com/convite", origem), "");
  assert.equal(destinoInterno(null, origem), "");
  assert.equal(urlDeVerificacao(origem, "/convite?c=abc"), `${origem}/convite?c=abc`);
  assert.equal(urlDeVerificacao(origem, "https://evil.com/convite"), undefined);
  console.log("retorno da verificação: ok");
}
