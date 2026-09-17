import { z } from "zod";

// ponytail: fuso único para todos os tenants; vira campo do tenant quando houver clientes fora do horário de Brasília
export const TIMEZONE = "America/Sao_Paulo";
export const SLOT_STEP_MIN = 15;
/** Até quantos dias à frente o cliente pode agendar pela página pública */
export const MAX_DAYS_AHEAD = 90;
export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido");
const id = z.string().min(1).max(128).regex(/^[^/]+$/);

export const Service = z.object({
  name: z.string().trim().min(1, "Informe o nome").max(80),
  durationMin: z.number().int().min(5, "Duração mínima de 5 minutos").max(480, "Duração máxima de 8 horas"),
  priceCents: z.number().int().min(0, "Preço inválido"),
  active: z.boolean(),
});
export type Service = z.infer<typeof Service>;

export const Window = z
  .object({ start: hhmm, end: hhmm })
  .refine((w) => w.start < w.end, "O fim do expediente precisa ser depois do início");
export type Window = z.infer<typeof Window>;

export const Staff = z.object({
  name: z.string().trim().min(1, "Informe o nome").max(80),
  serviceIds: z.array(id).min(1, "Escolha pelo menos um serviço"),
  // Chave = dia da semana (0 = domingo). Dia ausente = não atende.
  hours: z.partialRecord(z.enum(["0", "1", "2", "3", "4", "5", "6"]), Window),
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

export const BookingInput = SlotQuery.extend({
  time: hhmm,
  customerName: z.string().trim().min(2, "Informe seu nome").max(80),
  customerPhone: z
    .string()
    .trim()
    .regex(/^[\d\s()+-]{8,20}$/, "Informe um telefone válido")
    .refine((p) => /^\d{10,13}$/.test(p.replace(/\D/g, "")), "Informe o telefone com DDD"),
});
export type BookingInput = z.infer<typeof BookingInput>;

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function offsetMinutes(at: Date, tz: string) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")!.value; // "GMT-03:00" ou "GMT"
  const m = name.match(/([+-])(\d{2}):(\d{2})/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/** "2026-09-20" + "09:00" no fuso do negócio → instante UTC */
export function zonedTime(date: string, time: string, tz = TIMEZONE) {
  const guess = new Date(`${date}T${time}:00Z`);
  // ponytail: offset medido no próprio instante; erra por 1h só na virada de horário de verão
  return new Date(guess.getTime() - offsetMinutes(guess, tz) * 60_000);
}

export const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Data "AAAA-MM-DD" de um instante, no fuso do negócio */
export const dateIn = (d: Date, tz = TIMEZONE) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
export const todayIn = (tz = TIMEZONE) => dateIn(new Date(), tz);

export const formatTime = (d: Date, tz = TIMEZONE) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(d);

/** "segunda-feira, 21 de setembro" */
export const formatLongDate = (d: Date, tz = TIMEZONE) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(d);

export const formatBRL = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export const formatDuration = (min: number) =>
  min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, "0") : ""}`;

export const RescheduleInput = z.object({
  tenantId: id,
  appointmentId: id,
  date: z.iso.date(),
  time: hhmm,
});
export type RescheduleInput = z.infer<typeof RescheduleInput>;

/** Máscara brasileira enquanto digita: (11) 91234-5678 ou (11) 3333-4444 */
export function formatPhone(value: string) {
  let d = value.replace(/\D/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2); // colado com DDI
  d = d.slice(0, 11);
  if (d.length <= 2) return d && `(${d}`;
  const [ddd, rest] = [d.slice(0, 2), d.slice(2)];
  const split = rest.length === 9 ? 5 : 4;
  return rest.length <= split ? `(${ddd}) ${rest}` : `(${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`;
}

/** Mensagem de erro do WhatsApp em tempo real ("" = válido) */
export function phoneError(value: string) {
  const d = value.replace(/\D/g, "");
  if (!d) return "Informe seu WhatsApp";
  if (d.length < 10) return "Informe o número com DDD";
  if (d[0] === "0") return "DDD inválido";
  if (d.length === 11 && d[2] !== "9") return "Celular com 11 dígitos começa com 9 depois do DDD";
  return "";
}

/** Telefone só com dígitos e DDI (55 quando vier com 10-11 dígitos). Também é o id do cliente. */
export function customerKey(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length <= 11 ? `55${digits}` : digits;
}

export function whatsappLink(phone: string, text?: string) {
  return `https://wa.me/${customerKey(phone)}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

export const PlanInput = z.object({
  tenantId: id,
  customerName: BookingInput.shape.customerName,
  customerPhone: BookingInput.shape.customerPhone,
  serviceIds: SlotQuery.shape.serviceIds,
  staffId: id,
  weekday: z.number().int().min(0).max(6),
  time: hhmm,
  startDate: z.iso.date(),
  weeks: z.number().int().min(1, "Mínimo de 1 semana").max(52, "Máximo de 52 semanas"),
});
export type PlanInput = z.infer<typeof PlanInput>;

/** Datas do plano: a partir de startDate, no dia da semana pedido, uma por semana */
export function planDates(startDate: string, day: number, weeks: number) {
  const first = addDays(startDate, (day - weekday(startDate) + 7) % 7);
  return Array.from({ length: weeks }, (_, i) => addDays(first, 7 * i));
}

/** Horários de início livres no dia, em "HH:MM" local. */
export function freeSlots(args: {
  date: string;
  window: Window | undefined;
  durationMin: number;
  busy: { start: Date; end: Date }[];
  now: Date;
}) {
  const { date, window, durationMin, busy, now } = args;
  if (!window) return [];
  const slots: string[] = [];
  for (let m = toMin(window.start); m + durationMin <= toMin(window.end); m += SLOT_STEP_MIN) {
    const start = zonedTime(date, toHHMM(m));
    const end = new Date(start.getTime() + durationMin * 60_000);
    if (start <= now) continue;
    if (busy.some((b) => b.start < end && b.end > start)) continue;
    slots.push(toHHMM(m));
  }
  return slots;
}
