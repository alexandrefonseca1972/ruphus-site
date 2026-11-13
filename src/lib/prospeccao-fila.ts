import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { addDays, dateIn, weekday, zonedTime } from "@/lib/datetime";
import { ETAPAS_VARIANTE } from "@/lib/prospeccao-variantes";

// Fila de envios da prospecção (F5): prospeccaoFila/{slug}__{etapa}, criada com create() (nunca set()),
// um item por lead e etapa. Aqui ficam o schema, a janela de envio e o cancelamento (usado também pelo
// agente, sem import circular); o produtor e o consumidor estão em prospeccao-fila.server.ts.

export const FILA = "prospeccaoFila";

export const STATUS_FILA = ["pendente", "reservado", "enviado", "falhou", "cancelado", "reagendado"] as const;
export type StatusFila = (typeof STATUS_FILA)[number];
/** Ainda não saiu nem foi reservado: o que o cancelamento e o reagendamento tocam. */
export const ABERTOS = ["pendente", "reagendado"] as const satisfies readonly StatusFila[];

const Base = z.object({
  slug: z.string().min(1).max(63),
  etapa: z.enum(ETAPAS_VARIANTE),
  telefoneNorm: z.string().regex(/^55\d{10,11}$/),
  varianteId: z.string().min(1),
  texto: z.string().min(1).max(1000),
  /** ms; o consumidor pega o vencido mais antigo */
  agendadoPara: z.number(),
  tentativas: z.number().int().min(0),
  criadoEm: z.number(),
  /** id do envio confirmado no CRM (registrarMensagem): o mesmo item grava o evento uma vez só */
  crmEnvioId: z.uuid(),
  /** crm.toques lido quando o item nasceu: mudou (toque dado por fora), o item não sai */
  toques: z.number().int().min(0).optional(),
  /** variáveis do template da etapa ({{1}} nome do negócio; no lembrete e na última, {{2}} o link do
   *  site), gravadas pelo produtor: fora da janela de 24 h da Meta só sai template */
  templateParametros: z.array(z.string().min(1).max(200)).max(5).optional(),
  /** o template escolhido no envio (fora da janela de 24 h); gravado antes do POST, a retomada repete o
   *  mesmo conteúdo com a mesma chave */
  templateNome: z.string().optional(),
  templateIdioma: z.string().optional(),
});

/** Um item da fila, por status (união discriminada; switch exaustivo em quem consome). */
export const ItemFila = z.discriminatedUnion("status", [
  Base.extend({ status: z.literal("pendente") }),
  // motivo sem_template: fora da janela de 24 h e sem template da etapa em config/prospeccao.templates
  Base.extend({ status: z.literal("reagendado"), reagendadoEm: z.number(), motivo: z.literal("sem_template").optional() }),
  Base.extend({
    status: z.literal("reservado"),
    leaseToken: z.string().min(1),
    leaseAte: z.number(),
    reservadoEm: z.number(),
    /** o POST não respondeu (prazo, rede): pode ter saído; a próxima reserva reconcilia com a mesma chave */
    incertoEm: z.number().optional(),
  }),
  Base.extend({
    status: z.literal("enviado"),
    enviadoEm: z.number(),
    envioId: z.string().min(1),
    /** o toque ainda não entrou no CRM: o consumidor tenta de novo (reconciliarCrm) */
    crmPendente: z.boolean().optional(),
    /** o atendys aceitou sem sair agora (retryAt, awaiting_manual...): o CRM espera o status da mensagem */
    aguardaStatus: z.boolean().optional(),
    /** o CRM recusou o toque de vez (PARE, limite de toques): não tenta mais */
    crmErro: z.string().optional(),
    /** ms; a reconciliação do CRM pega o mais antigo vencido (um preso não ocupa a vaga dos outros) */
    reconciliarApos: z.number().optional(),
    /** passagens da reconciliação do CRM; no limite, crmErro e sai da reconciliação */
    tentativasCrm: z.number().int().min(0).optional(),
  }),
  // talvezEnviado: o item tinha um POST sem resposta (incertoEm) e não houve como confirmar no atendys
  Base.extend({ status: z.literal("falhou"), falhouEm: z.number(), erro: z.string(), talvezEnviado: z.boolean().optional() }),
  Base.extend({ status: z.literal("cancelado"), canceladoEm: z.number(), motivo: z.string(), talvezEnviado: z.boolean().optional() }),
]);
export type ItemFila = z.infer<typeof ItemFila>;

/** Reconciliação do CRM (M-2, terceira rodada): um item preso (awaiting_manual sem fim, status 404)
 *  sai dela com crmErro depois de tentativasMax passagens ou prazoMs desde o envio. */
export const RECONCILIAR = { tentativasMax: 20, prazoMs: 7 * 86_400_000, esperaMaxMs: 6 * 3_600_000 } as const;
export const desistirDaReconciliacao = (item: { tentativasCrm?: number; enviadoEm: number }, agora: number) =>
  (item.tentativasCrm ?? 0) >= RECONCILIAR.tentativasMax || agora - item.enviadoEm >= RECONCILIAR.prazoMs;
/** Quando a n-ésima passagem volta a tentar: 1, 2, 4… minutos, até 6 h (20 passagens dão uns 3 dias). */
export const proximaReconciliacao = (n: number, agora: number) => agora + Math.min(60_000 * 2 ** (n - 1), RECONCILIAR.esperaMaxMs);

// ————— janela de 24 h da Meta (Cloud API) —————

/** Fora da janela de 24 h desde a última mensagem recebida do lead, a Meta só aceita template aprovado.
 *  23 h: uma hora de folga (o atendys pode segurar a mensagem na fila antes de sair). */
export const JANELA_META_MS = 23 * 3_600_000;

/** Um template por etapa em config/prospeccao.templates. Nome e idioma com as regras do send-template
 *  do atendys (SendTemplateDto). Torto vira ausente: nada sai fora da janela naquela etapa. */
export const TemplateEtapa = z.object({ nome: z.string().regex(/^[a-z0-9_]{1,512}$/), idioma: z.string().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/) });
export const TemplatesFila = z.object({
  primeiro: TemplateEtapa.optional().catch(undefined),
  lembrete: TemplateEtapa.optional().catch(undefined),
  ultima: TemplateEtapa.optional().catch(undefined),
});
export type TemplatesFila = z.infer<typeof TemplatesFila>;

export type FormaDoEnvio = { tipo: "texto" } | { tipo: "template"; nome: string; idioma: string; parametros: string[] } | { tipo: "sem_template" };

/** Texto livre ou template. O template já gravado no item vale sempre (retomada: o mesmo conteúdo com a
 *  mesma chave); a retomada sem template repete o texto (a chave devolve a mensagem já aceita). Dentro
 *  da janela, texto livre; fora, só o template da etapa, e sem ele o item não sai. */
export function formaDoEnvio(item: ItemFila, templates: TemplatesFila | undefined, naJanelaMeta: boolean, retomada = false): FormaDoEnvio {
  const parametros = item.templateParametros ?? [];
  if (item.templateNome && item.templateIdioma) return { tipo: "template", nome: item.templateNome, idioma: item.templateIdioma, parametros };
  if (retomada || naJanelaMeta) return { tipo: "texto" };
  const t = templates?.[item.etapa];
  return t && parametros.length ? { tipo: "template", nome: t.nome, idioma: t.idioma, parametros } : { tipo: "sem_template" };
}

/** Por que um item aberto foi cancelado. */
export type MotivoCancelamento = "optout" | "resposta" | "naoContatar" | "fora_do_funil" | "escalado" | "variante_pausada" | "cadencia";

// ————— janela de envio (America/Sao_Paulo): seg a sex, 9h-11h30 e 14h-17h30 —————

export const JANELAS = [
  ["09:00", "11:30"],
  ["14:00", "17:30"],
] as const;

/** Os trechos da janela no dia (ms), cortados a partir de `desde`. Sábado e domingo: nenhum. */
function trechosDoDia(dia: string, desde: number): [number, number][] {
  const d = weekday(dia);
  if (d === 0 || d === 6) return [];
  return JANELAS.map(([a, b]) => [Math.max(zonedTime(dia, a).getTime(), desde), zonedTime(dia, b).getTime()] as [number, number]).filter(([a, b]) => b > a);
}

/** O instante está dentro da janela de envio? */
export const naJanela = (agora: number) => trechosDoDia(dateIn(new Date(agora)), agora).some(([a]) => a === agora);

/** n horários espalhados por igual no próximo dia útil com janela restante a partir de `desde`
 *  (o meio de cada fatia: nunca dois no mesmo instante). */
export function espalhar(n: number, desde: number): number[] {
  if (n <= 0) return [];
  let dia = dateIn(new Date(desde));
  let trechos = trechosDoDia(dia, desde);
  for (let i = 0; i < 7 && !trechos.length; i++) {
    dia = addDays(dia, 1);
    trechos = trechosDoDia(dia, desde);
  }
  const total = trechos.reduce((t, [a, b]) => t + (b - a), 0);
  return Array.from({ length: n }, (_, i) => {
    let resto = Math.floor(((i + 0.5) * total) / n);
    for (const [a, b] of trechos) {
      if (resto < b - a) return a + resto;
      resto -= b - a;
    }
    return trechos[trechos.length - 1][1] - 1;
  });
}

// ————— cancelamento —————

/** Marca como cancelado o que ainda não saiu para o telefone (opt-out, resposta) ou com a variante
 *  (pausada no editor, F4; o reservado já está saindo e não é tocado). O disjuntor não
 *  cancela: desligado, o consumidor não envia, e ao religar o reagendamento cuida do atrasado.
 *  Uma transação por item: a reserva concorrente vence ou perde inteira (o que já foi reservado é
 *  conferido de novo no envio). Devolve quantos cancelou. */
export async function cancelarPendentes(db: Firestore, filtro: { telefone: string } | { varianteId: string }, motivo: MotivoCancelamento, agora = Date.now(), limite = 200) {
  const [campo, valor] = "telefone" in filtro ? ["telefoneNorm", filtro.telefone] : ["varianteId", filtro.varianteId];
  const docs = (await db.collection(FILA).where("status", "in", [...ABERTOS]).where(campo, "==", valor).limit(limite).get()).docs;
  let n = 0;
  for (const d of docs) {
    const ok = await db.runTransaction(async (tx) => {
      const atual = await tx.get(d.ref);
      if (!(ABERTOS as readonly string[]).includes(String(atual.get("status")))) return false;
      tx.update(d.ref, { status: "cancelado", canceladoEm: agora, motivo });
      return true;
    });
    if (ok) n++;
  }
  return n;
}
