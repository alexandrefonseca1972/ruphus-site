import { dateIn } from "@/lib/datetime";

// Consumo de mensagens (SMS e WhatsApp) que o negócio paga à Ruphus. Funções puras: o tipo de cada
// envio, o status, a máscara do destino, o preço e o que conta no agregado do mês. A gravação mora em
// consumo.server.ts. Nunca entra o telefone inteiro nem o texto da mensagem (LGPD).
//
// Regra de cobrança:
// - WhatsApp cobra o que saiu (aceito pelo atendys, enviado, entregue, lido). Falhou ou parado na cota
//   não cobra. "aceito" já conta: o message.status que vier depois (failed) devolve o valor.
// - SMS cobra no envio aceito pela Comtele (sem retorno de entrega: fica "enviado").
// - Pré-pago: o custo sai do saldo do negócio no mesmo momento (consumo.server); falhou estorna.
//   Bloqueado por falta de saldo vira envio "sem-saldo" (custo 0) e nada sai.
// - Preço de WhatsApp: resposta dentro da janela de 24 h (o cliente ou o dono acabou de escrever) é
//   "service"; o resto (template, aviso, lembrete) é "utility". Vale para o canal oficial e para o
//   número do salão: é o preço que a Ruphus cobra do negócio, não o da Meta.

export type Canal = "whatsapp" | "sms";
export type Via = "oficial" | "salao";
export const TIPOS_ENVIO = ["recebido", "pedido_dono", "confirmado", "cancelado", "reagendado", "lembrete", "pix", "recibo", "resposta", "saldo", "outro"] as const;
export type TipoEnvio = (typeof TIPOS_ENVIO)[number];
export const STATUS_ENVIO = ["aceito", "enviado", "entregue", "lido", "falhou", "parado", "sem-saldo"] as const;
export type StatusEnvio = (typeof STATUS_ENVIO)[number];
export type Destinatario = "cliente" | "dono";

/** Preço por mensagem em centavos, definido no /admin (config/mensagens). */
export type Precos = { whatsappUtilityCents: number; whatsappServiceCents: number; smsCents: number };
/** Sem config/mensagens: WhatsApp utilidade R$ 0,05, resposta (service) grátis, SMS R$ 0,12. */
export const PRECOS_PADRAO: Precos = { whatsappUtilityCents: 5, whatsappServiceCents: 0, smsCents: 12 };

export const MODOS_SEM_SALDO = ["pausar-clientes", "pausar-tudo", "negativo"] as const;
export type SemSaldo = (typeof MODOS_SEM_SALDO)[number];
export type Pacote = { id: string; valorCents: number; bonusCents: number; ativo: boolean };
/** config/mensagens: cobrança das mensagens, igual para todos os negócios (o /admin edita). */
export type ConfigMensagens = Precos & {
  cobrar: boolean;
  modelo: "prepago" | "pospago";
  /** saldo abaixo disto: um aviso ao dono por recarga */
  avisoSaldoCents: number;
  /** crédito de boas-vindas do negócio novo (pré-pago) */
  boasVindasCents: number;
  semSaldo: SemSaldo;
  /** no modo "negativo": até quanto o saldo pode ficar abaixo de zero */
  limiteNegativoCents: number;
  pacotes: Pacote[];
};
export const CONFIG_PADRAO: ConfigMensagens = {
  ...PRECOS_PADRAO,
  cobrar: true,
  modelo: "prepago",
  avisoSaldoCents: 500,
  boasVindasCents: 1000,
  semSaldo: "pausar-clientes",
  limiteNegativoCents: 0,
  pacotes: [
    { id: "p20", valorCents: 2000, bonusCents: 0, ativo: true },
    { id: "p50", valorCents: 5000, bonusCents: 500, ativo: true },
    { id: "p100", valorCents: 10000, bonusCents: 2000, ativo: true },
  ],
};
/** Recarga avulsa (sem pacote): no mínimo R$ 10,00. */
export const RECARGA_MINIMA_CENTS = 1000;

/** O que vale para o negócio: a config geral com o que o /admin mudou só para ele
 *  (tenants/{slug}/privado/mensagens: cobrar e preços). */
export function configDoNegocio(geral: ConfigMensagens, proprio?: { cobrar?: unknown; precos?: Partial<Record<keyof Precos, unknown>> } | null): ConfigMensagens {
  const preco = (k: keyof Precos) => {
    const v = proprio?.precos?.[k];
    return Number.isInteger(v) && (v as number) >= 0 ? (v as number) : geral[k];
  };
  return {
    ...geral,
    cobrar: typeof proprio?.cobrar === "boolean" ? proprio.cobrar : geral.cobrar,
    whatsappUtilityCents: preco("whatsappUtilityCents"),
    whatsappServiceCents: preco("whatsappServiceCents"),
    smsCents: preco("smsCents"),
  };
}

/** Sai sem saldo? Pedido ao dono sempre sai. "pausar-clientes" segura só a mensagem ao cliente que não
 *  é lembrete (do dia) nem resposta na janela de 24 h; "pausar-tudo" segura todo o resto; "negativo"
 *  deixa o saldo descer até o limite. Fora do pré-pago (não cobra, pós-pago, grátis) sempre sai. */
export function podeEnviar(p: {
  cobrar: boolean;
  modelo: ConfigMensagens["modelo"];
  saldoCents: number;
  custoCents: number;
  semSaldo: SemSaldo;
  limiteNegativoCents: number;
  destinatario: Destinatario;
  tipo: TipoEnvio;
}): { envia: boolean; motivo?: string } {
  if (!p.cobrar || p.modelo !== "prepago" || p.custoCents <= 0) return { envia: true };
  if (p.saldoCents - p.custoCents >= 0) return { envia: true };
  // o pedido ao dono e o aviso de saldo baixo sempre saem
  if (p.tipo === "pedido_dono" || p.tipo === "saldo") return { envia: true };
  if (p.semSaldo === "negativo") {
    return p.saldoCents - p.custoCents >= -p.limiteNegativoCents ? { envia: true } : { envia: false, motivo: "limite de saldo negativo atingido" };
  }
  if (p.semSaldo === "pausar-clientes" && (p.destinatario === "dono" || p.tipo === "lembrete" || p.tipo === "resposta")) return { envia: true };
  return { envia: false, motivo: "sem saldo de mensagens" };
}

export type NivelSaldo = "ok" | "atencao" | "critico";
export type Previsao = {
  mediaDiariaCents: number | null;
  diasRestantesEstimados: number | null;
  acabaEm: string | null;
  faltaParaFecharMesCents: number;
  pacoteIndicado: Pacote | null;
  nivel: NivelSaldo;
};
export const somaDias = (dia: string, n: number) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Dias do mês de "YYYY-MM-DD". */
export const diasNoMes = (dia: string) => new Date(Date.UTC(Number(dia.slice(0, 4)), Number(dia.slice(5, 7)), 0)).getUTCDate();

/** Quanto o saldo dura no ritmo de consumo. Média: os últimos 14 dias (até hoje) quando há pelo menos
 *  7 dias com consumo neles; senão, o mês corrente até hoje. Média zero: sem previsão de fim.
 *  pacoteIndicado: o menor pacote ativo (valor + bônus) que cobre o que falta para fechar o mês; nenhum
 *  cobre, o maior. nivel: crítico com saldo ≤ 0 ou menos de 2 dias; atenção abaixo do aviso ou de 7 dias. */
export function previsaoDeSaldo(p: {
  saldoCents: number;
  consumoPorDia: { dia: string; cents: number }[];
  hoje: string;
  diasNoMes: number;
  pacotes: Pacote[];
  avisoSaldoCents: number;
}): Previsao {
  const janela = p.consumoPorDia.filter((c) => c.dia >= somaDias(p.hoje, -13) && c.dia <= p.hoje && c.cents > 0);
  const diaDoMes = Number(p.hoje.slice(8, 10));
  const media = janela.length >= 7
    ? janela.reduce((t, c) => t + c.cents, 0) / 14
    : p.consumoPorDia.filter((c) => c.dia.slice(0, 7) === p.hoje.slice(0, 7) && c.dia <= p.hoje).reduce((t, c) => t + c.cents, 0) / diaDoMes;
  const mediaDiariaCents = media > 0 ? Math.round(media) : null;
  const dias = mediaDiariaCents ? Math.max(0, Math.floor(p.saldoCents / media)) : null;
  const falta = mediaDiariaCents ? Math.max(0, Math.ceil(media * (p.diasNoMes - diaDoMes) - p.saldoCents)) : 0;
  const ativos = p.pacotes.filter((x) => x.ativo).sort((a, b) => a.valorCents + a.bonusCents - (b.valorCents + b.bonusCents));
  const nivel: NivelSaldo = p.saldoCents <= 0 || (dias !== null && dias < 2) ? "critico" : p.saldoCents < p.avisoSaldoCents || (dias !== null && dias < 7) ? "atencao" : "ok";
  return {
    mediaDiariaCents,
    diasRestantesEstimados: dias,
    acabaEm: dias === null ? null : somaDias(p.hoje, dias),
    faltaParaFecharMesCents: falta,
    pacoteIndicado: ativos.find((x) => x.valorCents + x.bonusCents >= falta) ?? ativos.at(-1) ?? null,
    nivel,
  };
}

const ORDEM_NIVEL: Record<NivelSaldo, number> = { ok: 0, atencao: 1, critico: 2 };
/** Avisa o dono? O nível piorou para atenção ou crítico e ainda não houve aviso desde a última recarga
 *  (avisadoEm e ultimaRecargaEm em ms; null = nunca). */
export const deveAvisar = (antes: NivelSaldo, depois: NivelSaldo, avisadoEm: number | null, ultimaRecargaEm: number | null) =>
  depois !== "ok" && ORDEM_NIVEL[depois] > ORDEM_NIVEL[antes] && (avisadoEm === null || (ultimaRecargaEm !== null && avisadoEm < ultimaRecargaEm));

const reais = (c: number) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;
/** O aviso de saldo ao dono (WhatsApp, e-mail, push e extrato). */
export function textoDoAvisoDeSaldo(saldoCents: number, prev: Previsao) {
  const n = prev.diasRestantesEstimados;
  const quando = n === null ? "" : n === 0 ? " e deve acabar hoje" : ` e deve acabar em ~${n} ${n === 1 ? "dia" : "dias"}`;
  const p = prev.pacoteIndicado;
  const pacote = p
    ? ` Para garantir o mês, recarregue ${reais(p.valorCents)} (pacote ${reais(p.valorCents)}${p.bonusCents ? ` + ${reais(p.bonusCents)} de bônus` : ""}).`
    : " Recarregue para os avisos aos clientes continuarem saindo.";
  return `Seu saldo de mensagens está em ${reais(saldoCents)}${quando}.${pacote}`;
}

/** O preço que vale para este envio (o snapshot gravado nele). */
export const precoDe = (p: Precos, canal: Canal, servico: boolean) =>
  canal === "sms" ? p.smsCents : servico ? p.whatsappServiceCents : p.whatsappUtilityCents;

/** Cobra neste status? */
export const cobra = (canal: Canal, status: StatusEnvio) =>
  canal === "sms" ? status !== "falhou" && status !== "sem-saldo" : status === "aceito" || status === "enviado" || status === "entregue" || status === "lido";

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
const ORDEM: Record<StatusEnvio, number> = { "sem-saldo": -1, parado: 0, aceito: 1, falhou: 2, enviado: 3, entregue: 4, lido: 5 };
/** O status novo vale? Parado e aceito mudam para qualquer um; falhou volta a enviado (reconciliação
 *  do atendys); depois de entregue, falha não desfaz; nada anda para trás entre enviado/entregue/lido. */
export function avanca(atual: StatusEnvio, novo: StatusEnvio): boolean {
  // sem saldo não saiu: nenhum webhook muda isso
  if (atual === novo || atual === "sem-saldo" || novo === "sem-saldo") return false;
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
  if (base === "ruphus_saldo_baixo") return "saldo";
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
