import { z } from "zod";


const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido");
const id = z.string().min(1).max(128).regex(/^[^/]+$/);

export const Service = z.object({
  name: z.string().trim().min(1, "Informe o nome").max(80, "Nome muito longo"),
  durationMin: z.number().int().min(5, "A duração mínima é de 5 minutos").max(480, "A duração máxima é de 8 horas"),
  priceCents: z.number().int().min(0, "Preço inválido"),
  active: z.boolean(),
});
export type Service = z.infer<typeof Service>;

export const WindowSchema = z
  .object({ start: hhmm, end: hhmm })
  .refine((w) => w.start < w.end, "O fim do expediente precisa ser depois do início");

export const Staff = z.object({
  name: z.string().trim().min(1, "Informe o nome").max(80, "Nome muito longo"),
  serviceIds: z.array(id).min(1, "Escolha pelo menos um serviço"),
  // Chave = dia da semana (0 = domingo). Dia ausente = não atende.
  hours: z.partialRecord(z.enum(["0", "1", "2", "3", "4", "5", "6"]), WindowSchema),
  active: z.boolean(),
});
export type Staff = z.infer<typeof Staff>;

export const SlotQuery = z.object({
  tenantId: id,
  serviceIds: z
    .array(id)
    .min(1, "Escolha pelo menos um serviço")
    .max(5, "Escolha até 5 serviços")
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
  customerName: z.string().trim().min(2, "Informe seu nome").max(80, "Nome muito longo"),
  customerPhone: z
    .string()
    .trim()
    .regex(/^[\d\s()+-]{8,20}$/, "Informe um telefone válido")
    .refine((p) => /^\d{10,13}$/.test(p.replace(/\D/g, "")), "Informe o telefone com DDD"),
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
});
export type PlanInput = z.infer<typeof PlanInput>;

