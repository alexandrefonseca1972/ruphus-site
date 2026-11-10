import { dateIn } from "@/lib/datetime";

// Consumo de mensagens (SMS e WhatsApp) que o negócio paga à Ruphus. Funções puras: o tipo de cada
// envio, o status, a máscara do destino, o preço e o que conta no agregado do mês. A gravação mora em
// consumo.server.ts. Nunca entra o telefone inteiro nem o texto da mensagem (LGPD).
//
// Regra de cobrança:
// - WhatsApp cobra o que saiu (aceito pelo atendys, enviado, entregue, lido). Falhou ou parado na cota
//   não cobra. "aceito" já conta: o message.status que vier depois (failed) devolve o valor.
// - SMS cobra no envio aceito pela Comtele (sem retorno de entrega: fica "enviado").
// - Preço de WhatsApp: resposta dentro da janela de 24 h (o cliente ou o dono acabou de escrever) é
//   "service"; o resto (template, aviso, lembrete) é "utility". Vale para o canal oficial e para o
//   número do salão: é o preço que a Ruphus cobra do negócio, não o da Meta.

export type Canal = "whatsapp" | "sms";
export type Via = "oficial" | "salao";
export const TIPOS_ENVIO = ["recebido", "pedido_dono", "confirmado", "cancelado", "reagendado", "lembrete", "pix", "recibo", "resposta", "outro"] as const;
export type TipoEnvio = (typeof TIPOS_ENVIO)[number];
export const STATUS_ENVIO = ["aceito", "enviado", "entregue", "lido", "falhou", "parado"] as const;
export type StatusEnvio = (typeof STATUS_ENVIO)[number];
export type Destinatario = "cliente" | "dono";

/** Preço por mensagem em centavos, definido no /admin (config/precos). */
export type Precos = { whatsappUtilityCents: number; whatsappServiceCents: number; smsCents: number };
/** Sem config/precos: WhatsApp utilidade R$ 0,05, resposta (service) grátis, SMS R$ 0,12. */
export const PRECOS_PADRAO: Precos = { whatsappUtilityCents: 5, whatsappServiceCents: 0, smsCents: 12 };

/** O preço que vale para este envio (o snapshot gravado nele). */
export const precoDe = (p: Precos, canal: Canal, servico: boolean) =>
  canal === "sms" ? p.smsCents : servico ? p.whatsappServiceCents : p.whatsappUtilityCents;

/** Cobra neste status? */
export const cobra = (canal: Canal, status: StatusEnvio) =>
  canal === "sms" ? status !== "falhou" : status === "aceito" || status === "enviado" || status === "entregue" || status === "lido";

/** Status do atendys no nosso vocabulário. null = não muda nada (manual_started etc. viram parado). */
export function statusDoAtendys(s: string): StatusEnvio | null {
  if (s === "queued") return "aceito";
  if (s === "sent") return "enviado";
  if (s === "delivered") return "entregue";
  if (s === "read") return "lido";
  if (s === "failed" || s === "cancelled") return "falhou";
  if (s === "awaiting_manual" || s === "manual_started") return "parado";
  return null;
}

// ordem do que já saiu: um webhook atrasado (delivered depois do read) não volta o status
const ORDEM: Record<StatusEnvio, number> = { parado: 0, aceito: 1, falhou: 2, enviado: 3, entregue: 4, lido: 5 };
/** O status novo vale? Parado e aceito mudam para qualquer um; falhou volta a enviado (reconciliação
 *  do atendys); depois de entregue, falha não desfaz; nada anda para trás entre enviado/entregue/lido. */
export function avanca(atual: StatusEnvio, novo: StatusEnvio): boolean {
  if (atual === novo) return false;
  if (atual === "parado" || atual === "aceito") return true;
  if (novo === "falhou") return atual === "enviado";
  if (novo === "parado" || novo === "aceito") return false;
  return ORDEM[novo] > ORDEM[atual];
}

/** Template aprovado na Meta → tipo do aviso (com ou sem _v2/_botoes). */
export function tipoDoTemplate(nome: string): TipoEnvio {
  const base = nome.replace(/_v2$/, "").replace(/_botoes$/, "");
  if (base === "agendamento_recebido") return "recebido";
  if (base === "agendamento_confirmado_cliente") return "confirmado";
  if (base === "agendamento_cancelado") return "cancelado";
  if (base === "agendamento_lembrete") return "lembrete";
  if (base === "agendamento_pedido_dono") return "pedido_dono";
  return "outro";
}

/** O agendamento do envio, quando dá para saber sem perguntar a quem chama: o eventId do aceite
 *  (ruphus-agendamento:<negócio>:<agendamento>) ou o id dos botões (rph:<ação>:<negócio>:<agendamento>). */
export function agendamentoDoEnvio(slug: string, eventId?: string, botoes?: string[]): string | undefined {
  const doAceite = eventId?.startsWith(`ruphus-agendamento:${slug}:`) ? eventId.split(":")[2] : undefined;
  if (doAceite && /^[A-Za-z0-9]{1,40}$/.test(doAceite)) return doAceite;
  for (const b of botoes ?? []) {
    const p = b.split(":");
    if (p[0] === "rph" && p[2] === slug && /^[A-Za-z0-9]{1,40}$/.test(p[3] ?? "")) return p[3];
  }
  return undefined;
}

/** "5591988776389" → "(91) •••••-6389": o DDD e os 4 últimos, nunca o número inteiro. */
export function mascararDestino(fone: string): string {
  let d = String(fone ?? "").replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  const fim = d.slice(-4).padStart(4, "•");
  return d.length >= 10 ? `(${d.slice(0, 2)}) •••••-${fim}` : `•••••-${fim}`;
}

/** Mês e dia do envio no horário de Brasília (o mesmo do resto do painel).
 *  ponytail: fuso fixo; negócio em Manaus vê o envio das 23h30 no dia seguinte. Fuso do negócio se pedir. */
export function quandoFoi(em: Date) {
  const d = dateIn(em);
  return { mes: d.slice(0, 7), dia: d.slice(8, 10) };
}

type Envio = { canal: Canal; via: Via; tipo: TipoEnvio; precoCents: number; dia: string };
type Arvore = { [k: string]: number | Arvore };

/** O que muda no agregado do mês (tenants/{slug}/consumo/{YYYY-MM}): o envio novo (de = null) ou a
 *  troca de status. Números a somar, na forma do documento; quem grava troca cada um por increment. */
export function deltaDoConsumo(e: Envio, de: StatusEnvio | null, para: StatusEnvio): Arvore {
  const custo = (s: StatusEnvio | null) => (s && cobra(e.canal, s) ? e.precoCents : 0);
  const dCusto = custo(para) - custo(de);
  const status: Arvore = { [para]: 1, ...(de && { [de]: -1 }) };
  const bloco = (novo: boolean): Arvore => ({ ...(novo && { total: 1 }), ...(dCusto && { custoCents: dCusto }), status });
  const novo = de === null;
  return {
    ...bloco(novo),
    canais: { [e.canal]: bloco(novo) },
    tipos: { [e.tipo]: bloco(novo) },
    ...(novo && { vias: { [e.via]: 1 }, dias: { [e.dia]: { [e.canal]: 1 } } }),
  };
}
