// Rode: npm run test:ia  (o assistente da seção "Visual": pedido montado e resposta lida, sem rede)
import assert from "node:assert/strict";
import { lerResposta, MODELO, montarPedido, RespostaIA } from "@/lib/ia.server";

const pedido = montarPedido({
  negocio: { nome: "Navalha", ramo: "Barbearia", cidade: "Manaus", uf: "AM", bairro: "Centro", servicos: ["Corte", "Barba"], horario: "Seg a sáb 9h–19h" },
  atual: { cores: { ink: "#111111", acc: "#c9962f" }, fonte: "Fraunces", textos: { frase: "Corte na régua." }, fotosProprias: ["hero"] },
  fotos: ["aGVsbG8="],
  historico: [{ papel: "user", texto: "oi" }, { papel: "assistant", texto: "olá" }],
  pedido: "deixa mais escuro",
});
assert.equal(pedido.model, MODELO);
assert.ok(!("thinking" in pedido) && !("tool_choice" in pedido) && !("tools" in pedido), "sem thinking explícito, sem ferramentas");
assert.equal(pedido.output_config?.effort, "medium");
assert.ok(pedido.output_config?.format, "resposta estruturada");
assert.deepEqual([pedido.betas, pedido.fallbacks], [["server-side-fallback-2026-07-01"], "default"]);
assert.ok(Array.isArray(pedido.system) && pedido.system[0].cache_control?.type === "ephemeral", "sistema estável em cache");
assert.equal(pedido.messages.length, 4, "contexto, histórico (2) e pedido");
assert.equal(pedido.messages.at(-1)?.content, "deixa mais escuro");
const primeiro = pedido.messages[0].content as { type: string }[];
assert.ok(Array.isArray(primeiro) && primeiro.some((b) => b.type === "image") && JSON.stringify(primeiro).includes("Navalha"), "negócio e miniaturas no primeiro turno");
assert.ok(!JSON.stringify(pedido.system).includes("fotos:"), "o sistema não oferece mudar fotos");

const ok = (parsed_output: unknown) => lerResposta({ stop_reason: "end_turn", parsed_output });
const lida = ok({ resposta: "Escureci a tinta.", mudancas: { cores: { ink: "#0A0A0A", acc: null }, fonte: null, textos: { frase: null, sobre: "Desde 2010.", galeria: null } } });
assert.deepEqual(lida, { resposta: "Escureci a tinta.", mudancas: { cores: { ink: "#0a0a0a" }, textos: { sobre: "Desde 2010." } } }, "nulos somem, hex vira minúscula");
assert.deepEqual(ok({ resposta: "Nada a mudar.", mudancas: { cores: { ink: null, acc: null }, fonte: null, textos: { frase: null, sobre: null, galeria: null } } }).mudancas, {}, "tudo null = sem mudança");
assert.throws(() => lerResposta({ stop_reason: "refusal", parsed_output: null }), /não aceitou/);
assert.throws(() => lerResposta({ stop_reason: "max_tokens", parsed_output: null }), /longa/);
assert.throws(() => ok(null), /fora do formato/);
assert.throws(() => ok({ resposta: "x", mudancas: { cores: { ink: "red", acc: null }, fonte: null, textos: { frase: null, sobre: null, galeria: null } } }), /fora do formato/);
assert.throws(() => ok({ resposta: "x", mudancas: { cores: { ink: null, acc: null }, fonte: "Comic Sans", textos: { frase: null, sobre: null, galeria: null } } }), /fora do formato/);
assert.ok(!RespostaIA.safeParse({ resposta: "x", mudancas: { fotos: { hero: "fotos/hero.jpg" } } }).success, "a IA não devolve fotos");
console.log("ia: ok");
