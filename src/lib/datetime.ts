// Datas, horários e formatação — sem zod, para não entrar no pacote do celular
export const TIMEZONE = "America/Sao_Paulo";
export const SLOT_STEP_MIN = 15;
/** Até quantos dias à frente o cliente pode agendar pela página pública */
export const MAX_DAYS_AHEAD = 90;
export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
export type Window = { start: string; end: string };

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

/** Máscara de preço enquanto digita: os dígitos entram pela direita, como em caixa
 * eletrônico ("4" → R$ 0,04, "4500" → R$ 45,00). Até R$ 99.999,99. */
export function maskBRL(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 7);
  // "R$ 0,00" apagando um dígito vira "00": aí quem apaga quer esvaziar, não zerar de novo
  if (!d || (Number(d) === 0 && d.length === 2)) return "";
  return formatBRL(Number(d));
}

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

/** Conversa no WhatsApp com a mensagem já escrita, ou null se o número não servir.
 *
 * O código do país entra pelo tamanho, não por "começa com 55": o DDD 55 é de
 * Santa Maria, e um fixo de lá (55 3220-0000) seria lido como número já
 * internacional e abriria conversa com ninguém. Dez ou onze dígitos são
 * daqui e recebem o 55; doze ou treze já vieram com ele.
 */
export function linkWhatsApp(telefone: string | null | undefined, texto: string) {
  const d = (telefone ?? "").replace(/\D/g, "");
  const numero =
    d.length === 10 || d.length === 11 ? `55${d}` : (d.length === 12 || d.length === 13) && d.startsWith("55") ? d : "";
  return numero ? `https://wa.me/${numero}?text=${encodeURIComponent(texto)}` : null;
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
