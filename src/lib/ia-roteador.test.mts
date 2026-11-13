// Rode: tsx --conditions=react-server src/lib/ia-roteador.test.mts  (parte de npm run test:prospeccao-fb)
// Sem rede e sem emulador: config, gasto e telemetria em memória; provedor mock.
import assert from "node:assert/strict";
import { z } from "zod";
import {
  baldeAB, chamarIA, ConfigRoteamento, custoCentavos, IAIndisponivel, LimiteAtingido, paramsAnthropic, PADRAO, PROVEDORES_PADRAO, RESPOSTAS_MOCK, resultadoAnthropic, roteamentoNaTela, SaidaIAInvalida, salvarRoteamento, ProvedorProibido,
  type Ambiente, type Chamada, type Elo, type Provedor,
} from "@/lib/ia-roteador.server";
import type { ModeloId } from "@/lib/tipos-marca";

const Saida = z.object({ texto: z.string() });
const entrada = { sistema: "sistema", mensagens: [{ role: "user" as const, content: "oi" }] };
const elo = (modelo: string, extra: Partial<Elo> = {}): Elo => ({ provedor: "mock", modelo: modelo as ModeloId, maxTokens: 100, timeoutMs: 50, ...extra });

// o mock de teste decide pelo nome do modelo: falha, demora, responde fora do formato ou responde
const mockTeste: Provedor = async ({ elo: e }) => {
  if (e.modelo === "erro") throw new Error("caiu");
  if (e.modelo === "lento") await new Promise((r) => setTimeout(r, 200));
  if (e.modelo === "invalido") return { bruto: { outra: 1 }, tokensEntrada: 10, tokensSaida: 5 };
  return { bruto: { texto: `de ${e.modelo}` }, tokensEntrada: 10, tokensSaida: 5 };
};
const pago: Provedor = async () => ({ bruto: { texto: "pago" }, tokensEntrada: 1_000_000, tokensSaida: 0 });

function ambiente(config: z.input<typeof ConfigRoteamento>, gasto = 0) {
  const chamadas: Chamada[] = [];
  const amb: Ambiente = {
    config: async () => ConfigRoteamento.parse(config),
    gastoHoje: async () => gasto,
    registrar: async (c) => void chamadas.push(c),
    provedores: { mock: mockTeste, local: mockTeste, anthropic: pago },
  };
  return { amb, chamadas };
}
const chamar = (amb: Ambiente, slug?: string) => chamarIA({ tarefa: "sugerir_resposta", entrada, schema: Saida, slug }, amb);

// ── sucesso no primeiro elo ──
{
  const { amb, chamadas } = ambiente({ sugerir_resposta: { cadeia: [elo("a")] } });
  assert.deepEqual(await chamar(amb), { saida: { texto: "de a" }, modelo: "a", provedor: "mock" });
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].ok, true);
  assert.equal(chamadas[0].fallbackDe, undefined);
}

// ── fallback em erro, timeout e saída inválida ──
for (const ruim of ["erro", "lento", "invalido"]) {
  const { amb, chamadas } = ambiente({ sugerir_resposta: { cadeia: [elo(ruim), elo("b")] } });
  const r = await chamar(amb);
  assert.equal(r.modelo, "b", `fallback depois de ${ruim}`);
  assert.deepEqual(chamadas.map((c) => [c.modelo, c.ok, c.fallbackDe]), [[ruim, false, undefined], ["b", true, ruim]]);
}
{
  const { amb, chamadas } = ambiente({ sugerir_resposta: { cadeia: [elo("lento")] } });
  await assert.rejects(chamar(amb), IAIndisponivel, "timeout no único elo vira IAIndisponivel");
  assert.equal(chamadas[0].erro, "IAIndisponivel");
}
{
  const { amb, chamadas } = ambiente({ sugerir_resposta: { cadeia: [elo("invalido")] } });
  await assert.rejects(chamar(amb), SaidaIAInvalida);
  assert.deepEqual([chamadas[0].tokensEntrada, chamadas[0].erro], [10, "SaidaIAInvalida"], "tokens da tentativa inválida contam");
}
{
  const { amb } = ambiente({ sugerir_resposta: { cadeia: [elo("erro")] } });
  await assert.rejects(chamar(amb), /caiu/, "todos falharam: sobe o erro do último elo");
}

// ── orçamento ──
{
  const config = { sugerir_resposta: { cadeia: [elo("claude-haiku-5-5", { provedor: "anthropic" }), elo("local-1", { provedor: "local" })], orcamentoDiaCentavos: 50 } };
  const dentro = ambiente(config, 49);
  assert.equal((await chamar(dentro.amb)).provedor, "anthropic", "dentro do orçamento usa o pago");
  assert.equal(dentro.chamadas[0].custoCentavos, 10, "1 MTok de entrada no Haiku = US$ 0,10 = 10 centavos");
  const esgotado = ambiente(config, 50);
  const r = await chamar(esgotado.amb);
  assert.deepEqual([r.provedor, esgotado.chamadas.length], ["local", 1], "orçamento esgotado: pula o pago, usa o gratuito");
  const soPago = ambiente({ sugerir_resposta: { cadeia: [elo("claude-haiku-5-5", { provedor: "anthropic" })], orcamentoDiaCentavos: 50 } }, 50);
  await assert.rejects(chamar(soPago.amb), LimiteAtingido);
  assert.equal(soPago.chamadas.length, 0, "sem tentativa paga");
}
assert.equal(custoCentavos({ provedor: "anthropic", modelo: "claude-opus-5-5" as ModeloId }, 1_000_000, 1_000_000), 2400);
assert.equal(custoCentavos({ provedor: "mock", modelo: "claude-opus-5-5" as ModeloId }, 1_000_000, 1_000_000), 0);
{
  // cache: leitura a 0,1x e criação a 1,25x da entrada (Opus: US$ 4/MTok)
  const opus = { provedor: "anthropic" as const, modelo: "claude-opus-5-5" as ModeloId };
  assert.equal(custoCentavos(opus, 0, 0, 1_000_000, 0), 40, "1 MTok lido do cache = US$ 0,40");
  assert.equal(custoCentavos(opus, 0, 0, 0, 1_000_000), 500, "1 MTok gravado no cache = US$ 5,00");
  assert.equal(custoCentavos(opus, 1_000_000, 0, 1_000_000, 1_000_000), 940);
}
{
  // falha no gasto do dia (Firestore): não derruba; trata como esgotado e usa só o gratuito
  const config = { sugerir_resposta: { cadeia: [elo("claude-haiku-5-5", { provedor: "anthropic" }), elo("local-1", { provedor: "local" })], orcamentoDiaCentavos: 50 } };
  const quebrado = ambiente(config);
  quebrado.amb.gastoHoje = async () => {
    throw new Error("firestore fora");
  };
  assert.equal((await chamar(quebrado.amb)).provedor, "local", "gasto ilegível: só o gratuito");
  const soPago = ambiente({ sugerir_resposta: { cadeia: [elo("claude-haiku-5-5", { provedor: "anthropic" })], orcamentoDiaCentavos: 50 } });
  soPago.amb.gastoHoje = quebrado.amb.gastoHoje;
  await assert.rejects(chamar(soPago.amb), LimiteAtingido, "gasto ilegível e só pago: LimiteAtingido, sem chamada paga");
  assert.equal(soPago.chamadas.length, 0);
}
{
  // MEDIUM-1 (revisão do núcleo): as tarefas pagas têm orçamento no PADRAO; config ilegível ou inválida
  // (Ambiente.config null) é orçamento esgotado: o Opus do PADRAO não sai, nem o gasto é consultado
  for (const t of ["sugerir_resposta", "gerar_variacoes", "visual_site", "personalizar", "agente_lead"] as const) assert.ok((PADRAO[t].orcamentoDiaCentavos ?? 0) > 0, `${t}: orçamento no PADRAO`);
  const { amb, chamadas } = ambiente({});
  amb.config = async () => null;
  amb.gastoHoje = async () => assert.fail("config inválida não consulta o gasto: já é esgotado");
  await assert.rejects(chamarIA({ tarefa: "visual_site", entrada, schema: Saida }, amb), LimiteAtingido, "config inválida não libera o Opus");
  await assert.rejects(chamarIA({ tarefa: "gerar_variacoes", entrada, schema: Saida }, amb), LimiteAtingido);
  assert.equal(chamadas.length, 0, "nenhuma tentativa paga");
  // config válida e vazia: o PADRAO com o orçamento dele (gasto abaixo passa, no teto para)
  const ok = ambiente({}, 499);
  assert.equal((await chamarIA({ tarefa: "visual_site", entrada, schema: Saida }, ok.amb)).provedor, "anthropic");
  const teto = ambiente({}, 500);
  await assert.rejects(chamarIA({ tarefa: "visual_site", entrada, schema: Saida }, teto.amb), LimiteAtingido);
}

// ── corte e recusa custam ──
for (const parada of ["max_tokens", "refusal"]) {
  const { amb, chamadas } = ambiente({ sugerir_resposta: { cadeia: [elo("claude-haiku-5-5", { provedor: "anthropic" })] } });
  amb.provedores.anthropic = async () => ({ bruto: null, tokensEntrada: 1_000_000, tokensSaida: 1_000_000, parada });
  await assert.rejects(chamar(amb), SaidaIAInvalida);
  assert.deepEqual([chamadas[0].ok, chamadas[0].erro, chamadas[0].tokensSaida], [false, "SaidaIAInvalida", 1_000_000]);
  assert.equal(chamadas[0].custoCentavos, 60, `${parada}: US$ 0,10 + 0,50 entram no gasto`);
}

// ── formato real do SDK: JSON cortado em max_tokens ainda conta o custo ──
{
  const { amb, chamadas } = ambiente({ sugerir_resposta: { cadeia: [elo("claude-haiku-5-5", { provedor: "anthropic" })] } });
  const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  amb.provedores.anthropic = async () => resultadoAnthropic({ content: [{ type: "text", text: '{"texto": "cort' }], usage, stop_reason: "max_tokens" });
  await assert.rejects(chamar(amb), /não terminou/, "max_tokens com JSON quebrado: a mensagem de corte, não erro do JSON.parse");
  assert.deepEqual([chamadas[0].erro, chamadas[0].custoCentavos], ["SaidaIAInvalida", 60], "o corte entra no gasto");
}
{
  // JSON quebrado sem corte: SaidaIAInvalida com os tokens contados
  const { amb, chamadas } = ambiente({ sugerir_resposta: { cadeia: [elo("claude-haiku-5-5", { provedor: "anthropic" })] } });
  const usage = { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: null, cache_creation_input_tokens: null };
  amb.provedores.anthropic = async () => resultadoAnthropic({ content: [{ type: "text", text: "não é json" }], usage, stop_reason: "end_turn" });
  await assert.rejects(chamar(amb), SaidaIAInvalida);
  assert.deepEqual([chamadas[0].erro, chamadas[0].custoCentavos], ["SaidaIAInvalida", 10]);
}

// ── telemetria que falha no sucesso não troca de elo ──
{
  const { amb } = ambiente({ sugerir_resposta: { cadeia: [elo("a"), elo("b")] } });
  amb.registrar = async () => {
    throw new Error("telemetria fora");
  };
  assert.equal((await chamar(amb)).modelo, "a");
}

// ── cadeia esgotada: o primeiro ErroPrevisto ganha do último erro ──
{
  const { amb } = ambiente({ sugerir_resposta: { cadeia: [elo("claude-haiku-5-5", { provedor: "anthropic" }), elo("erro")] } });
  amb.provedores.anthropic = async () => {
    throw new IAIndisponivel("Cadastre a chave da Anthropic em Ajustes.");
  };
  await assert.rejects(chamar(amb), /Cadastre a chave/);
}

// ── código explícito dos erros (sobrevive à minificação) ──
assert.deepEqual([new IAIndisponivel("x").codigo, new SaidaIAInvalida("x").codigo, new LimiteAtingido("x").codigo], ["IAIndisponivel", "SaidaIAInvalida", "LimiteAtingido"]);

// ── A/B estável por hash(slug) ──
{
  assert.equal(baldeAB("salao-da-ana"), baldeAB("salao-da-ana"), "mesmo slug, mesmo balde");
  const { amb } = ambiente({ sugerir_resposta: { cadeia: [elo("b", { percentual: 50 }), elo("a")] } });
  const slugs = Array.from({ length: 200 }, (_, i) => `salao-${i}`);
  const braços = await Promise.all(slugs.map(async (s) => (await chamar(amb, s)).modelo));
  slugs.forEach((s, i) => assert.equal(braços[i], baldeAB(s) < 50 ? "b" : "a", `braço de ${s}`));
  const nB = braços.filter((m) => m === "b").length;
  assert.ok(nB > 60 && nB < 140, `divisão perto de 50% (${nB}/200)`);
  for (const s of slugs.slice(0, 20)) assert.equal((await chamar(amb, s)).modelo, braços[slugs.indexOf(s)], "estável entre chamadas");
  assert.equal((await chamar(amb)).modelo, "a", "sem slug, o elo do experimento fica de fora");
  const tudo = ambiente({ sugerir_resposta: { cadeia: [elo("b", { percentual: 100 }), elo("a")] } });
  assert.equal((await chamar(tudo.amb, "x")).modelo, "b", "100% = todos");
}

// ── config ──
assert.ok(!ConfigRoteamento.safeParse({ sugerir_resposta: { cadeia: [] } }).success, "cadeia vazia");
assert.ok(!ConfigRoteamento.safeParse({ sugerir_resposta: { cadeia: [elo("claude haiku")] } }).success, "modelo inválido");
assert.ok(!ConfigRoteamento.safeParse({ sugerir_resposta: { cadeia: [elo("a", { percentual: 101 })] } }).success, "percentual > 100");
assert.ok(!ConfigRoteamento.safeParse({ sugerir_resposta: { cadeia: [elo("a", { percentual: 50 }), elo("b", { percentual: 100 })] } }).success, "só elos com percentual");
assert.ok(!ConfigRoteamento.safeParse({ sugerir_resposta: { cadeia: [elo("a", { timeoutMs: 600_001 })] } }).success, "timeout acima de 10 min");
assert.ok(!ConfigRoteamento.safeParse({ sugerir_resposta: { cadeia: [elo("a", { maxTokens: 64_001 })] } }).success, "maxTokens acima de 64 mil");
assert.ok(ConfigRoteamento.safeParse({ sugerir_resposta: { cadeia: [elo("a", { timeoutMs: 600_000, maxTokens: 64_000 })] } }).success, "nos tetos passa");
assert.ok(!ConfigRoteamento.safeParse({ sugerir_resposta: { cadeia: [{ ...elo("a"), escalarSe: { confianca: 0.6 } }] } }).success, "chave desconhecida no elo");
assert.ok(!ConfigRoteamento.safeParse({ sugerir_resposta: { cadeia: [elo("a")], escalarSe: {} } }).success, "chave desconhecida na rota");
assert.ok(!ConfigRoteamento.safeParse({ outra_tarefa: { cadeia: [elo("a")] } }).success, "tarefa desconhecida");
assert.equal(PADRAO.visual_site.cadeia[0].modelo, "claude-opus-5-5", "visual do site no Opus");
assert.equal(PADRAO.classificar_resposta.cadeia[0].modelo, "claude-haiku-5-5");

// ── editor de Ajustes: config salva inválida vira aviso; custo que falha vira null ──
{
  type Db = Parameters<typeof roteamentoNaTela>[0];
  const dublê = (salva: unknown) =>
    ({
      doc: () => ({ get: async () => ({ data: () => salva }) }),
      collection: () => {
        throw new Error("iaChamadas fora");
      },
    }) as unknown as Db;
  const ruim = await roteamentoNaTela(dublê({ sugerir_resposta: { cadeia: [] } }));
  assert.deepEqual(ruim.config, {}, "inválida: o roteador segue no padrão");
  assert.match(String(ruim.invalida), /cadeia/, "o aviso diz o campo");
  assert.equal(ruim.custos, null, "custo ilegível não derruba o editor");
  assert.equal(ruim.padrao, PADRAO);
  const boa = await roteamentoNaTela(dublê({ sugerir_resposta: { cadeia: [elo("a")] } }));
  assert.deepEqual([boa.invalida, boa.config.sugerir_resposta?.cadeia[0].modelo], [null, "a"]);
  // inválida: a tela abre com o JSON gravado (para corrigir), não com {}
  assert.deepEqual(JSON.parse(String(ruim.gravado)), { sugerir_resposta: { cadeia: [] } }, "o editor mostra o que está gravado");
  assert.equal(ruim.lida, true);
  assert.equal(JSON.parse(String(boa.gravado)).sugerir_resposta.cadeia[0].modelo, "a");
  // leitura que falha: lida false e nada para editar (a tela desliga Salvar)
  const caiu = { doc: () => ({ get: async () => { throw new Error("rede"); } }), collection: () => { throw new Error("iaChamadas fora"); } } as unknown as Db;
  const semLer = await roteamentoNaTela(caiu);
  assert.deepEqual([semLer.lida, semLer.gravado, semLer.invalida], [false, null, null], "ilegível: não finge que está vazio");
}

// ── salvar: mock e local não vão para produção ──
{
  type Db = Parameters<typeof salvarRoteamento>[0];
  const gravados: unknown[] = [];
  const db = { doc: () => ({ set: async (c: unknown) => void gravados.push(c) }) } as unknown as Db;
  const com = (provedor: string) => ({ personalizar: { cadeia: [{ ...elo("m"), provedor }] } });
  await assert.rejects(salvarRoteamento(db, com("mock"), {}), (e: unknown) => e instanceof ProvedorProibido && /mock/.test(e.message), "mock fora do emulador");
  await assert.rejects(salvarRoteamento(db, com("local"), {}), (e: unknown) => e instanceof ProvedorProibido && /IA_LOCAL/.test(e.message), "local sem servidor declarado");
  assert.equal(gravados.length, 0, "recusado não grava");
  await salvarRoteamento(db, com("local"), { IA_LOCAL: "1" });
  await salvarRoteamento(db, com("mock"), { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8085" });
  await salvarRoteamento(db, com("local"), { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8085" });
  await salvarRoteamento(db, com("anthropic"), {});
  assert.equal(gravados.length, 4, "local com servidor, mock e local no emulador, anthropic sempre");
}

// ── provedor mock de verdade (respostas fixas por tarefa) ──
{
  const amb: Ambiente = { config: async () => ({}), gastoHoje: async () => 0, registrar: async () => {}, provedores: PROVEDORES_PADRAO };
  const r = await chamarIA({ tarefa: "personalizar", entrada, schema: Saida }, { ...amb, config: async () => ({ personalizar: { cadeia: [elo("mock")] } }) });
  assert.deepEqual(r.saida, RESPOSTAS_MOCK.personalizar);
}

// ── parâmetros da Anthropic ──
const opus = paramsAnthropic(PADRAO.visual_site.cadeia[0], entrada, Saida);
assert.deepEqual([opus.model, opus.max_tokens, opus.output_config.effort, opus.betas, opus.fallbacks], ["claude-opus-5-5", 8000, "medium", ["server-side-fallback-2026-07-01"], "default"]);
const haiku = paramsAnthropic(PADRAO.sugerir_resposta.cadeia[0], entrada, Saida);
assert.ok(!("betas" in haiku) && !("fallbacks" in haiku) && !("effort" in haiku.output_config), "Haiku sem fallback do servidor; sem effort quando o elo não define");
assert.equal("parse" in haiku.output_config.format, false, "sem o parse do helper: o SDK não valida antes de devolver o usage");
for (const t of ["sugerir_resposta", "agente_lead", "personalizar", "classificar_resposta"] as const) assert.equal(PADRAO[t].cadeia[0].maxTokens, 2000, `${t}: folga para o pensamento`);

console.log("ia-roteador: ok");
