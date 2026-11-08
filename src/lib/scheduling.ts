import { z } from "zod";
import { phoneError, TIPOS_PRECO } from "@/lib/datetime";
import { erroNome } from "@/lib/nome";
import { DadosCliente } from "@/lib/cliente-dados";


const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido");
const id = z.string().min(1).max(128).regex(/^[^/]+$/);

export const Service = z.object({
  name: z.string().trim().min(1, "Informe o nome").max(80, "Nome muito longo"),
  durationMin: z.number().int().min(5, "A duração mínima é de 5 minutos").max(480, "A duração máxima é de 8 horas"),
  priceCents: z.number().int().min(0, "Preço inválido").max(9_999_999, "O preço máximo é R$ 99.999,99"),
  // "a partir de" o preço, ou sem preço (priceCents 0). Ausente = fixo, como os serviços de antes.
  tipoPreco: z.enum(TIPOS_PRECO).optional(),
  active: z.boolean(),
});
export type Service = z.infer<typeof Service>;


export const WindowSchema = z
  .object({ start: hhmm, end: hhmm })
  .refine((w) => w.start < w.end, "O fim do expediente precisa ser depois do início");

/** Recado que o dono deixa para quem acabou de agendar (ex.: "chegue 10 minutos antes").
 *  Vazio: a tela de confirmação mostra o texto padrão. */
export const RECADO_MAX = 300;
export const Recado = z.string().trim().max(RECADO_MAX, `Use no máximo ${RECADO_MAX} caracteres`);

export const Staff = z.object({
  name: z.string().trim().min(1, "Informe o nome").max(80, "Nome muito longo"),
  serviceIds: z.array(id).min(1, "Escolha pelo menos um serviço"),
  // Chave = dia da semana (0 = domingo). Dia ausente = não atende.
  hours: z.partialRecord(z.enum(["0", "1", "2", "3", "4", "5", "6"]), WindowSchema),
  active: z.boolean(),
});
export type Staff = z.infer<typeof Staff>;

/** Quantos serviços e quanto tempo somado o cliente marca de uma vez pelo link. O dono ajusta
 *  em "Meu negócio", dentro do teto: nem "todos os serviços", nem duração sem limite. */
export const MAX_SERVICOS_PADRAO = 5;
export const MAX_SERVICOS_TETO = 10;
export const MAX_DURACAO_PADRAO = 240;
export const MAX_DURACAO_MIN = 30;
export const MAX_DURACAO_TETO = 480;
export const LimitesAgenda = z.object({
  maxServicos: z.number().int().min(1, "Pelo menos 1 serviço").max(MAX_SERVICOS_TETO, `No máximo ${MAX_SERVICOS_TETO} serviços`),
  maxDuracaoMin: z.number().int().min(MAX_DURACAO_MIN, "Pelo menos 30 minutos").max(MAX_DURACAO_TETO, "No máximo 8 horas"),
});
export type LimitesAgenda = z.infer<typeof LimitesAgenda>;

/** Os limites gravados em tenants/{slug}.agenda; campo ausente ou fora do formato = padrão. */
export function limitesDe(agenda: unknown): LimitesAgenda {
  const a = (agenda ?? {}) as Record<string, unknown>;
  return {
    maxServicos: LimitesAgenda.shape.maxServicos.safeParse(a.maxServicos).data ?? MAX_SERVICOS_PADRAO,
    maxDuracaoMin: LimitesAgenda.shape.maxDuracaoMin.safeParse(a.maxDuracaoMin).data ?? MAX_DURACAO_PADRAO,
  };
}

/** Por que a escolha passa do limite; null = vale. Um serviço sozinho sempre vale, mesmo mais
 *  longo que o limite: a soma é que trava, senão o serviço longo sumia do link. */
export function foraDoLimite(servicos: { durationMin: number }[], lim: LimitesAgenda): string | null {
  if (servicos.length > lim.maxServicos) return `Escolha até ${lim.maxServicos} ${lim.maxServicos > 1 ? "serviços" : "serviço"} por horário.`;
  const total = servicos.reduce((soma, s) => soma + s.durationMin, 0);
  if (servicos.length > 1 && total > lim.maxDuracaoMin) return `Juntos, os serviços passam de ${lim.maxDuracaoMin % 60 ? `${lim.maxDuracaoMin} min` : `${lim.maxDuracaoMin / 60} h`}. Marque o resto em outro horário.`;
  return null;
}

export const SlotQuery = z.object({
  tenantId: id,
  serviceIds: z
    .array(id)
    .min(1, "Escolha pelo menos um serviço")
    .max(MAX_SERVICOS_TETO, `Escolha até ${MAX_SERVICOS_TETO} serviços`)
    .refine((ids) => new Set(ids).size === ids.length),
  staffId: id,
  date: z.iso.date(),
});
export type SlotQuery = z.infer<typeof SlotQuery>;

/** A semana que a página pública desenha de uma vez. staffId vazio = qualquer profissional. */
export const AgendaQuery = z.object({
  tenantId: id,
  serviceIds: SlotQuery.shape.serviceIds,
  staffId: z.union([id, z.literal("")]),
  from: z.iso.date(),
});
export type AgendaQuery = z.infer<typeof AgendaQuery>;

export const BookingInput = SlotQuery.extend({
  time: hhmm,
  // a mesma regra da tela: sem ela, "3232323232" passava como nome
  customerName: z.string().trim().max(80, "Nome muito longo").superRefine((v, ctx) => {
    const erro = erroNome(v);
    if (erro) ctx.addIssue({ code: "custom", message: erro });
  }),
  customerPhone: z
    .string()
    .trim()
    .regex(/^[\d\s()+-]{8,20}$/, "Informe um telefone válido")
    .refine((p) => /^\d{10,13}$/.test(p.replace(/\D/g, "")), "Informe o telefone com DDD")
    // a mesma regra da tela: "0000000000" passava e furava o limite por telefone
    .refine((p) => !phoneError(p), "Confira o número de WhatsApp"),
  // escolheu "qualquer profissional": se o oferecido ocupou, vale outro livre na mesma hora
  qualquer: z.boolean().optional(),
  // gerado pela tela e mantido até ela receber a resposta: confirmar de novo acha a mesma
  // reserva (tenants/{t}/pedidos/{pedido}). Sem ele, não há repetição reconhecida
  pedido: id.optional(),
  // aceite explícito, desmarcado por padrão, de receber a confirmação e os avisos pelo WhatsApp;
  // a versão identifica o texto que o cliente viu. Sem aceite, o agendamento vale e nada é enviado
  aceiteWhatsapp: z.boolean().optional(),
  termoWhatsapp: z.string().trim().max(40).optional(),
});
export type BookingInput = z.infer<typeof BookingInput>;

export const RescheduleInput = z.object({
  tenantId: id,
  appointmentId: id,
  date: z.iso.date(),
  time: hhmm,
});
export type RescheduleInput = z.infer<typeof RescheduleInput>;

export const PlanInput = z.object({
  tenantId: id,
  customerName: BookingInput.shape.customerName,
  customerPhone: BookingInput.shape.customerPhone,
  serviceIds: SlotQuery.shape.serviceIds,
  staffId: id,
  weekday: z.number().int().min(0).max(6),
  time: hhmm,
  startDate: z.iso.date(),
  weeks: z.number().int().min(1, "O plano precisa de pelo menos 1 semana").max(52, "O plano vai até 52 semanas"),
  // "Qualquer um": staffId é quem atende de preferência (o do primeiro dia); a semana em que ele
  // está ocupado vai para outro profissional livre no mesmo horário, em vez de ser pulada
  qualquer: z.boolean().optional(),
  // opcional: limpo (sem espaço, minúsculo) e validado como na ficha do cliente; vazio não grava
  email: DadosCliente.shape.email.optional(),
});
export type PlanInput = z.infer<typeof PlanInput>;

