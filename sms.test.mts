// Rode: npm run test:sms  (SMS da Comtele: número, texto e envio, sem rede)
import assert from "node:assert/strict";
import { numeroSms, textoSms } from "@/lib/comtele";
import { enviarSms, ErroSms } from "@/lib/comtele.server";
import { textoConfirmacao, textoLembrete } from "@/lib/sms-agendamento.server";

// número: celular com ou sem 55 e máscara; fixo e lixo ficam de fora (fixo não recebe SMS)
assert.equal(numeroSms("5511912345678"), "11912345678");
assert.equal(numeroSms("(91) 98888-7777"), "91988887777");
assert.equal(numeroSms("+55 92 99123-4567"), "92991234567");
assert.equal(numeroSms("559232364727"), null, "fixo");
assert.equal(numeroSms("1133334444"), null, "fixo sem 55");
assert.equal(numeroSms("01912345678"), null, "DDD 0");
assert.equal(numeroSms(""), null);

// texto: sem acento nem símbolo fora do alfabeto do SMS (senão a operadora cobra a cada 70)
assert.equal(textoSms("Salão “Bella” — confirmação às 15:15…"), 'Salao "Bella" - confirmacao as 15:15...');
assert.equal(textoSms("a 💈 b\n\nc"), "a b c");
assert.ok(textoSms("x".repeat(500)).length <= 160);
assert.ok(textoSms("x".repeat(500)).endsWith("..."));

// as mensagens cabem num SMS só, mesmo com nome e serviço longos
const longo = { negocio: "Studio de Beleza e Estética Avançada Maria Aparecida dos Santos", quando: "sexta, 09/10 às 14:00", servico: "Corte + escova + hidratação profunda + manicure", telefone: "(91) 98888-7777" };
for (const t of [textoConfirmacao(longo), textoLembrete({ ...longo, nome: "Marina" })]) {
  const s = textoSms(t);
  assert.ok(s.length <= 160, `${s.length} caracteres`);
  assert.ok(/^[\x20-\x7E]*$/.test(s), "só caracteres simples");
}
assert.equal(textoSms(textoConfirmacao({ negocio: "Bella", quando: "amanhã às 15:15", servico: "Corte", telefone: "" })), "Bella: seu horario amanha as 15:15 (Corte) esta confirmado.");

// envio: cabeçalho auth-key, corpo da API v2, id de volta; erro da Comtele vira ErroSms; sem chave, nada sai
const chave = process.env.COMTELE_API_KEY;
delete process.env.COMTELE_API_KEY;
assert.equal(await enviarSms("11912345678", "oi", { fetch: () => { throw new Error("não devia chamar"); } }), null);
process.env.COMTELE_API_KEY = "chave-teste";
let pedido: { url: string; init: RequestInit } | null = null;
const ok = (async (url: string, init: RequestInit) => ((pedido = { url, init }), Response.json({ Success: true, Object: { requestUniqueId: "abc" }, Message: "ok" }))) as unknown as typeof fetch;
assert.equal(await enviarSms("11912345678", "Olá", { fetch: ok }), "abc");
assert.equal(pedido!.url, "https://sms.comtele.com.br/api/v2/send");
assert.equal((pedido!.init.headers as Record<string, string>)["auth-key"], "chave-teste");
assert.deepEqual(JSON.parse(String(pedido!.init.body)), { Sender: "ruphus", Receivers: "11912345678", Content: "Ola" });
const semCredito = (async () => Response.json({ Success: false, Message: "Créditos insuficientes" }, { status: 400 })) as unknown as typeof fetch;
await assert.rejects(enviarSms("11912345678", "oi", { fetch: semCredito }), (e: unknown) => e instanceof ErroSms && /insuficientes/.test(e.message));
if (chave === undefined) delete process.env.COMTELE_API_KEY;
else process.env.COMTELE_API_KEY = chave;

console.log("sms ok");
