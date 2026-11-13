import "server-only";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AggregateField, FieldValue, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { adminDb } from "@/lib/admin";
import { todayIn } from "@/lib/datetime";
import { ErroPrevisto, LimiteAtingido } from "@/lib/erro-previsto";
import { integracao } from "@/lib/integracoes.server";
import { mascararDigitos } from "@/lib/sanitizar";
import { ConfigRoteamento, custoPorTarefa, Elo, PROVEDORES, Rota, TAREFAS, type NomeProvedor, type Tarefa } from "@/lib/ia-roteamento";
import type { ModeloId } from "@/lib/tipos-marca";

// Roteador de IA: toda chamada passa por chamarIA({ tarefa, entrada, schema }). A rota de cada
// tarefa (cadeia de modelos, orçamento do dia) mora em config/ia-roteamento, validada por Zod e
// trocada sem deploy; sem ela, vale PADRAO. Erro, demora ou saída fora do schema passam para o
// próximo elo da cadeia. Cada tentativa vira um doc em iaChamadas (telemetria, TTL de 90 dias).
// ponytail: roteamento por regra fixa. A escala por confiança (escalarSe) ficou fora da F2: nenhuma tarefa a
// usa, e `Elo`/`Rota` em strictObject recusam a chave; entra no schema quando uma tarefa precisar dela.

// os schemas da config moram em módulo sem "server-only": a tela de Ajustes valida ao vivo com os mesmos
export { ConfigRoteamento, Elo, PROVEDORES, Rota, TAREFAS, type NomeProvedor, type Tarefa };

/** A IA não respondeu (chave, rede, sobrecarga, demora). A mensagem chega à tela como está. */
// `codigo` explícito vai para a telemetria: constructor.name muda com a minificação.
export class IAIndisponivel extends ErroPrevisto {
  readonly codigo = "IAIndisponivel";
}
/** A IA respondeu, mas fora do formato pedido (ou recusou, ou não terminou). */
export class SaidaIAInvalida extends ErroPrevisto {
  readonly codigo = "SaidaIAInvalida";
}
/** Orçamento do dia esgotado e nenhum elo gratuito na cadeia (a classe mora em erro-previsto: o CRM usa a mesma). */
export { LimiteAtingido };
const codigoErro = (e: unknown) =>
  e instanceof IAIndisponivel || e instanceof SaidaIAInvalida || e instanceof LimiteAtingido ? e.codigo : e instanceof Error ? e.name : "desconhecido";


const anthropic = (modelo: string, maxTokens: number, timeoutMs: number, effort?: Elo["effort"]): Elo => ({
  provedor: "anthropic",
  modelo: modelo as ModeloId,
  maxTokens,
  timeoutMs,
  ...(effort && { effort }),
});

/** Rotas sem config/ia-roteamento. Haiku para o volume; Opus onde a qualidade manda.
 *  Texto curto com 2000 de teto: o pensamento também conta no max_tokens, e 600 cortava a resposta
 *  (max_tokens = falha paga). O teto não encarece: paga-se só o que sai.
 *  Tarefas pagas têm orçamento do dia (centavos de dólar). Com a config ilegível ou inválida, o
 *  orçamento conta como esgotado (só elos gratuitos), nunca como ilimitado.
 *  ponytail: valores sem dado de uso (Haiku 100, Opus e agente 500); ajustar em Ajustes com o custo real. */
export const PADRAO: Record<Tarefa, Rota> = {
  classificar_resposta: { cadeia: [anthropic("claude-haiku-5-5", 2000, 60_000, "low")] },
  sugerir_resposta: { cadeia: [anthropic("claude-haiku-5-5", 2000, 60_000)], orcamentoDiaCentavos: 100 },
  agente_lead: { cadeia: [anthropic("claude-haiku-5-5", 2000, 60_000)], orcamentoDiaCentavos: 500 },
  personalizar: { cadeia: [anthropic("claude-haiku-5-5", 2000, 60_000)], orcamentoDiaCentavos: 100 },
  gerar_variacoes: { cadeia: [anthropic("claude-opus-5-5", 8000, 600_000, "medium")], orcamentoDiaCentavos: 500 },
  // o pensamento adaptativo conta no teto: folga para não cortar a resposta; 10 min = o padrão do SDK
  visual_site: { cadeia: [anthropic("claude-opus-5-5", 8000, 600_000, "medium")], orcamentoDiaCentavos: 500 },
};

/** US$ por milhão de tokens (entrada, saída). Modelo fora da tabela conta como o mais caro.
 *  Cache: leitura a 0,1x e criação a 1,25x do preço de entrada. */
const PRECO: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};
export function custoCentavos(elo: Pick<Elo, "provedor" | "modelo">, tokensEntrada: number, tokensSaida: number, cacheLeitura = 0, cacheCriacao = 0) {
  if (elo.provedor !== "anthropic") return 0;
  const [e, s] = PRECO[elo.modelo] ?? PRECO["claude-opus-5-5"];
  return ((tokensEntrada + cacheLeitura * 0.1 + cacheCriacao * 1.25) * e + tokensSaida * s) / 10_000; // US$/MTok × tokens / 1e6 × 100 centavos
}

/** Balde estável de 0 a 99 por slug: o mesmo lead cai sempre no mesmo braço do A/B. */
export const baldeAB = (slug: string) => createHash("sha256").update(slug).digest().readUInt32BE(0) % 100;

/** A conversa no formato da Anthropic; o provedor local aproveita só o texto. */
export type Entrada = { sistema: string; mensagens: Anthropic.Beta.BetaMessageParam[] };
/** `tokensEntrada` sem o cache, que vem à parte. `parada` (stop_reason) o roteador confere depois
 *  de contar os tokens: recusa e corte também custam. */
export type Resultado = { bruto: unknown; tokensEntrada: number; tokensSaida: number; cacheLeitura?: number; cacheCriacao?: number; parada?: string | null };
export type Provedor = (p: { elo: Elo; entrada: Entrada; schema: z.ZodType; signal: AbortSignal; tarefa: Tarefa }) => Promise<Resultado>;

/** Os parâmetros da chamada à Anthropic, à parte para o teste conferir sem rede. */
export function paramsAnthropic(elo: Elo, entrada: Entrada, schema: z.ZodType) {
  // o Haiku não tem fallback do lado do servidor; os outros caem noutro modelo quando o classificador recusa
  const semFallback = elo.modelo.startsWith("claude-haiku");
  return {
    model: elo.modelo,
    max_tokens: elo.maxTokens,
    // o bloco estável vai primeiro e em cache: o que muda são as mensagens
    system: [{ type: "text", text: entrada.sistema, cache_control: { type: "ephemeral" } }],
    messages: entrada.mensagens,
    // só o JSON Schema: sem o `parse` do helper, o SDK não valida nada e devolve o usage mesmo com saída
    // ruim; quem valida é validarSaida, depois de contar os tokens
    output_config: { ...(elo.effort && { effort: elo.effort }), format: { type: "json_schema" as const, schema: zodOutputFormat(schema).schema } },
    ...(!semFallback && { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
  } satisfies Anthropic.Beta.MessageCreateParamsNonStreaming;
}

/** Recusa e corte viram SaidaIAInvalida com a mensagem que a tela mostra. */
export function conferirParada(stop: string | null) {
  if (stop === "refusal") throw new SaidaIAInvalida("A IA não aceitou esse pedido. Reformule.");
  if (stop === "max_tokens") throw new SaidaIAInvalida("A IA não terminou a resposta. Tente de novo, com um pedido mais curto.");
}

export function validarSaida<S extends z.ZodType>(schema: S, bruto: unknown): z.output<S> {
  const lida = schema.safeParse(bruto);
  if (!lida.success) throw new SaidaIAInvalida("A IA respondeu fora do formato. Tente de novo.");
  return lida.data;
}

/** A mensagem da Anthropic (formato do SDK) vira Resultado. JSON quebrado (ex.: corte em max_tokens)
 *  vira `bruto` undefined: o roteador confere a parada e o schema depois de contar os tokens. */
export function resultadoAnthropic(msg: {
  content: readonly { type: string; text?: unknown }[];
  usage: Pick<Anthropic.Beta.BetaUsage, "input_tokens" | "output_tokens" | "cache_read_input_tokens" | "cache_creation_input_tokens">;
  stop_reason: string | null;
}): Resultado {
  const texto = msg.content.find((b) => b.type === "text")?.text;
  let bruto: unknown;
  try {
    bruto = typeof texto === "string" ? JSON.parse(texto) : undefined;
  } catch (e) {
    // L-1: a mensagem do JSON.parse cita um trecho da saída, que pode ter o telefone do lead
    console.error("[ia] a Anthropic devolveu JSON inválido", mascararDigitos(e instanceof Error ? e.message : String(e)));
  }
  const u = msg.usage;
  return {
    bruto,
    tokensEntrada: u.input_tokens,
    tokensSaida: u.output_tokens,
    cacheLeitura: u.cache_read_input_tokens ?? 0,
    cacheCriacao: u.cache_creation_input_tokens ?? 0,
    parada: msg.stop_reason,
  };
}

const provedorAnthropic: Provedor = async ({ elo, entrada, schema, signal }) => {
  const chave = await integracao("ANTHROPIC_API_KEY");
  if (!chave) throw new IAIndisponivel("Cadastre a chave da Anthropic em Ajustes.");
  const cliente = new Anthropic({ apiKey: chave });
  try {
    return resultadoAnthropic(await cliente.beta.messages.create(paramsAnthropic(elo, entrada, schema), { signal }));
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new IAIndisponivel("A chave da Anthropic não vale. Confira em Ajustes.");
    if (err instanceof Anthropic.RateLimitError) throw new IAIndisponivel("Muitos pedidos à IA agora. Espere um minuto.");
    if (err instanceof Anthropic.APIConnectionError) throw new IAIndisponivel("Sem resposta da Anthropic. Tente de novo.");
    if (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500) throw new IAIndisponivel("A IA está sobrecarregada. Tente de novo em um minuto.");
    throw err;
  }
};

const textoDe = (c: Anthropic.Beta.BetaMessageParam["content"]) =>
  typeof c === "string" ? c : (c ?? []).flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");

/** Servidor local OpenAI-compatível (Ollama, llama.cpp). Imagens ficam de fora. */
const provedorLocal: Provedor = async ({ elo, entrada, schema, signal }) => {
  const r = await fetch(elo.endpoint ?? "http://127.0.0.1:11434/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify({
      model: elo.modelo,
      max_tokens: elo.maxTokens,
      messages: [{ role: "system", content: entrada.sistema }, ...entrada.mensagens.map((m) => ({ role: m.role, content: textoDe(m.content) }))],
      response_format: { type: "json_schema", json_schema: { name: "saida", schema: z.toJSONSchema(schema) } },
    }),
  });
  if (!r.ok) throw new IAIndisponivel(`O modelo local respondeu ${r.status}.`);
  const corpo = (await r.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  let bruto: unknown;
  try {
    bruto = JSON.parse(corpo.choices?.[0]?.message?.content ?? "");
  } catch {
    throw new SaidaIAInvalida("O modelo local respondeu fora do formato.");
  }
  return { bruto, tokensEntrada: corpo.usage?.prompt_tokens ?? 0, tokensSaida: corpo.usage?.completion_tokens ?? 0 };
};

/** Respostas fixas por tarefa, no formato que cada tarefa pede (dev sem chave e testes). */
export const RESPOSTAS_MOCK: Record<Tarefa, unknown> = {
  sugerir_resposta: { resposta: "Resposta de teste.", etapaSugerida: "oferta", motivo: "mock" },
  classificar_resposta: { tipo: "humana", confianca: 1 },
  agente_lead: { resposta: "Resposta de teste.", acao: "escalar" },
  gerar_variacoes: { variacoes: ["Variação de teste. Se não quiser receber mais, responda PARE."] },
  personalizar: { texto: "Texto de teste." },
  visual_site: { resposta: "Resposta de teste: nada mudou.", mudancas: { cores: { ink: null, acc: null }, fonte: null, textos: { frase: null, sobre: null, galeria: null } } },
};
const provedorMock: Provedor = async ({ tarefa }) => ({ bruto: RESPOSTAS_MOCK[tarefa], tokensEntrada: 0, tokensSaida: 0 });

export const PROVEDORES_PADRAO: Record<NomeProvedor, Provedor> = { anthropic: provedorAnthropic, local: provedorLocal, mock: provedorMock };

/** Uma tentativa num elo (um doc em iaChamadas). `erro` é o `codigo` do erro (ou o `name`, se não tiver). */
export type Chamada = {
  tarefa: Tarefa;
  modelo: ModeloId;
  provedor: NomeProvedor;
  tokensEntrada: number;
  tokensSaida: number;
  cacheLeitura?: number;
  cacheCriacao?: number;
  custoCentavos: number;
  latenciaMs: number;
  ok: boolean;
  fallbackDe?: ModeloId;
  erro?: string;
};

/** De onde o roteador lê a config e o gasto, e para onde manda a telemetria. O teste troca tudo.
 *  `config` null: não deu para ler ou a salva é inválida (o roteador trata o orçamento como esgotado). */
export type Ambiente = {
  config: () => Promise<ConfigRoteamento | null>;
  gastoHoje: (tarefa: Tarefa) => Promise<number>;
  registrar: (c: Chamada) => Promise<void>;
  provedores: Record<NomeProvedor, Provedor>;
};

const DOC_CONFIG = "config/ia-roteamento";
const TTL_MS = 90 * 86_400_000;

/** A config salva e, se ela não vale, o porquê (`invalida`, que a tela de Ajustes mostra). Inválida ou
 *  ilegível, a config volta vazia e `ok` false: o roteador segue com o PADRAO, mas sem orçamento (só
 *  elos gratuitos). `bruto`: o doc como está gravado (a tela mostra o inválido para corrigir, não {}).
 *  `lida` false: a leitura falhou (não se sabe o que está gravado; a tela não deixa salvar por cima). */
export async function lerRoteamentoComAviso(db: Firestore): Promise<{ config: ConfigRoteamento; invalida: string | null; ok: boolean; lida: boolean; bruto: unknown }> {
  let dados: unknown;
  try {
    dados = (await db.doc(DOC_CONFIG).get()).data() ?? {};
  } catch (e) {
    console.error("[ia] não li config/ia-roteamento; sigo com o padrão, sem orçamento pago", e);
    return { config: {}, invalida: null, ok: false, lida: false, bruto: null };
  }
  const lida = ConfigRoteamento.safeParse(dados);
  if (!lida.success) {
    const invalida = z.prettifyError(lida.error);
    console.error("[ia] config/ia-roteamento inválida; sigo com o padrão, sem orçamento pago", invalida);
    return { config: {}, invalida, ok: false, lida: true, bruto: dados };
  }
  return { config: lida.data, invalida: null, ok: true, lida: true, bruto: dados };
}

export const lerRoteamento = async (db: Firestore) => (await lerRoteamentoComAviso(db)).config;

/** Soma do custo da tarefa no dia (fuso da plataforma). Só igualdades: não pede índice composto. */
export async function gastoHoje(db: Firestore, tarefa: Tarefa): Promise<number> {
  const s = await db.collection("iaChamadas").where("tarefa", "==", tarefa).where("dia", "==", todayIn()).aggregate({ total: AggregateField.sum("custoCentavos") }).get();
  return s.data().total ?? 0;
}

/** Grava a tentativa em iaChamadas. `expiraEm` é o campo da política de TTL do Firestore
 *  (ligada uma vez: gcloud firestore fields ttls update expiraEm --collection-group=iaChamadas). */
export async function registrarChamada(db: Firestore, c: Chamada, agora = Date.now()) {
  await db.collection("iaChamadas").add({ ...c, dia: todayIn(), criadaEm: FieldValue.serverTimestamp(), expiraEm: new Date(agora + TTL_MS) });
}

/** Rota com provedor que não serve em produção: `mock` (respostas fixas) só no emulador; `local` só no
 *  emulador ou com um servidor local declarado (IA_LOCAL=1 no ambiente). */
export class ProvedorProibido extends ErroPrevisto {
  readonly codigo = "ProvedorProibido";
}

/** Grava a config nova (validada; a anterior é trocada inteira). Vale na próxima chamada, sem deploy.
 *  Fora do emulador, recusa `mock` e (sem IA_LOCAL=1) `local`: produção respondendo "Resposta de teste."
 *  ao lead, ou chamando um Ollama que não existe, seria pior que o PADRAO. */
export async function salvarRoteamento(db: Firestore, bruto: unknown, env: Partial<Record<string, string>> = process.env): Promise<ConfigRoteamento> {
  const config = ConfigRoteamento.parse(bruto);
  const emulador = !!env.FIRESTORE_EMULATOR_HOST;
  for (const [tarefa, rota] of Object.entries(config)) {
    for (const elo of rota?.cadeia ?? []) {
      if (elo.provedor === "mock" && !emulador) throw new ProvedorProibido(`${tarefa}: o provedor mock só vale no emulador.`);
      if (elo.provedor === "local" && !emulador && env.IA_LOCAL !== "1") throw new ProvedorProibido(`${tarefa}: o provedor local precisa de um servidor local (IA_LOCAL=1 no ambiente).`);
    }
  }
  await db.doc(DOC_CONFIG).set(config);
  return config;
}

/** A tabela de custo e erro por tarefa e modelo dos últimos `dias` (iaChamadas). `dia` é texto
 *  AAAA-MM-DD: o filtro de intervalo num campo só não pede índice. */
export async function custosDaIA(db: Firestore, dias = 30, hoje = todayIn()) {
  const desde = new Date(Date.parse(`${hoje}T12:00:00Z`) - (dias - 1) * 86_400_000).toISOString().slice(0, 10);
  // ponytail: lê as linhas e soma aqui; vira agregação por tarefa quando passar de alguns milhares por mês
  const s = await db.collection("iaChamadas").where("dia", ">=", desde).select("tarefa", "modelo", "provedor", "custoCentavos", "ok").limit(20_000).get();
  const linhas = s.docs.map((d) => ({
    tarefa: String(d.get("tarefa") ?? ""),
    modelo: String(d.get("modelo") ?? ""),
    provedor: String(d.get("provedor") ?? ""),
    custoCentavos: Number(d.get("custoCentavos") ?? 0),
    ok: d.get("ok") === true,
  }));
  return { desde, linhas: custoPorTarefa(linhas) };
}

/** O editor de Ajustes: a config salva (vazia = o padrão do código), o aviso se a salva não vale, o
 *  padrão para referência e o custo por tarefa. Custo que falha vira null: o editor abre assim mesmo. */
export async function roteamentoNaTela(db: Firestore) {
  const [{ config, invalida, lida, bruto }, custos] = await Promise.all([
    lerRoteamentoComAviso(db),
    custosDaIA(db).catch((e) => {
      console.error("[ia] não li o custo por tarefa", e);
      return null;
    }),
  ]);
  // o que está gravado, em texto (Timestamp e afins não atravessam a action): inválido, a tela abre com
  // isto para corrigir; não lido, com nada (e Salvar desligado)
  const gravado = lida ? JSON.stringify(invalida ? bruto : config, null, 2) : null;
  return { config, invalida, lida, gravado, padrao: PADRAO, custos };
}

export const ambienteFirestore = (db: Firestore): Ambiente => ({
  config: async () => {
    const r = await lerRoteamentoComAviso(db);
    return r.ok ? r.config : null;
  },
  gastoHoje: (tarefa) => gastoHoje(db, tarefa),
  // telemetria nunca derruba a chamada
  registrar: (c) => registrarChamada(db, c).catch((e) => console.error("[ia] não gravei a telemetria", e)),
  provedores: PROVEDORES_PADRAO,
});

/** Gasto do dia; se o Firestore falhar, assume o orçamento ESGOTADO (só elos gratuitos): melhor
 *  perder a IA paga por uma chamada do que gastar sem teto, e a chamada não cai por isso. */
async function gastoOuTeto(amb: Ambiente, tarefa: Tarefa, teto: number) {
  try {
    return await amb.gastoHoje(tarefa);
  } catch (e) {
    console.error("[ia] não li o gasto do dia; trato o orçamento como esgotado", e);
    return teto;
  }
}

function comPrazo<T>(fazer: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<never>((_, rejeitar) => {
    timer = setTimeout(() => {
      ctl.abort();
      rejeitar(new IAIndisponivel("A IA demorou demais para responder. Tente de novo."));
    }, ms);
  });
  return Promise.race([fazer(ctl.signal), prazo]).finally(() => clearTimeout(timer));
}

/** Chama a IA da tarefa pela cadeia configurada. Devolve a saída já validada por `schema`.
 *  Se todos os elos falharem, lança o primeiro ErroPrevisto (mensagem acionável, ex.: chave ausente)
 *  ou, sem nenhum, o erro do último elo. */
export async function chamarIA<S extends z.ZodType>(
  p: { tarefa: Tarefa; entrada: Entrada; schema: S; slug?: string },
  amb: Ambiente = ambienteFirestore(adminDb),
): Promise<{ saida: z.output<S>; modelo: ModeloId; provedor: NomeProvedor }> {
  const config = await amb.config();
  const rota = config?.[p.tarefa] ?? PADRAO[p.tarefa];
  const balde = p.slug ? baldeAB(p.slug) : null;
  let cadeia = rota.cadeia.filter((e) => e.percentual === undefined || (balde !== null && balde < e.percentual));
  // config ilegível ou inválida: orçamento esgotado (fail-closed), como na falha do gastoHoje
  const esgotado =
    config === null
      ? rota.orcamentoDiaCentavos !== undefined
      : rota.orcamentoDiaCentavos !== undefined && (await gastoOuTeto(amb, p.tarefa, rota.orcamentoDiaCentavos)) >= rota.orcamentoDiaCentavos;
  if (esgotado) {
    cadeia = cadeia.filter((e) => e.provedor !== "anthropic"); // orçamento acabou: só o que não custa
    if (!cadeia.length) throw new LimiteAtingido("O orçamento de IA do dia acabou para essa tarefa. Siga sem a IA ou aumente o limite em Ajustes.");
  }
  let ultimoErro: unknown = new IAIndisponivel("Nenhum modelo de IA disponível para essa tarefa.");
  let primeiroPrevisto: ErroPrevisto | undefined;
  let fallbackDe: ModeloId | undefined;
  for (const elo of cadeia) {
    const inicio = Date.now();
    let r: Resultado | undefined;
    // telemetria nunca derruba a chamada nem empurra para o próximo elo
    const registrar = (ok: boolean, erro?: unknown) =>
      amb
        .registrar({
          tarefa: p.tarefa,
          modelo: elo.modelo,
          provedor: elo.provedor,
          tokensEntrada: r?.tokensEntrada ?? 0,
          tokensSaida: r?.tokensSaida ?? 0,
          ...(r?.cacheLeitura && { cacheLeitura: r.cacheLeitura }),
          ...(r?.cacheCriacao && { cacheCriacao: r.cacheCriacao }),
          custoCentavos: custoCentavos(elo, r?.tokensEntrada ?? 0, r?.tokensSaida ?? 0, r?.cacheLeitura, r?.cacheCriacao),
          latenciaMs: Date.now() - inicio,
          ok,
          ...(fallbackDe && { fallbackDe }),
          ...(erro !== undefined && { erro: codigoErro(erro) }),
        })
        .catch((err) => console.error("[ia] não gravei a telemetria", err));
    let saida: z.output<S>;
    try {
      r = await comPrazo((signal) => amb.provedores[elo.provedor]({ elo, entrada: p.entrada, schema: p.schema, signal, tarefa: p.tarefa }), elo.timeoutMs);
      conferirParada(r.parada ?? null);
      saida = validarSaida(p.schema, r.bruto);
    } catch (e) {
      // falha conta (e custa, se houve tokens) e passa para o próximo elo
      await registrar(false, e);
      ultimoErro = e;
      if (!primeiroPrevisto && e instanceof ErroPrevisto) primeiroPrevisto = e;
      fallbackDe = elo.modelo;
      continue;
    }
    await registrar(true);
    return { saida, modelo: elo.modelo, provedor: elo.provedor };
  }
  throw primeiroPrevisto ?? ultimoErro;
}
