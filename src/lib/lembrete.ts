// Depois de agendar: o horário na agenda do celular e o caminho até a casa.
// Só montagem de texto e links, sem API nem chave: quem abre é o app do cliente.

export type Compromisso = {
  /** identifica o evento: a mesma reserva salva duas vezes não duplica na agenda */
  id: string;
  titulo: string;
  inicio: Date;
  fim: Date;
  local: string;
  detalhes: string;
};

// 2026-09-28T14:30:00.000Z → 20260928T143000Z, o formato de data do iCalendar e do Google
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
// vírgula, ponto e vírgula e barra são separadores no iCalendar; quebra de linha vira \n
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\r?\n/g, "\\n");

/** O arquivo .ics: no celular abre direto na agenda, no computador baixa. Lembra 2 horas antes. */
export function ics(c: Compromisso, agora = new Date()) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ruphus//Agenda//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${c.id}@ruphus.site`,
    `DTSTAMP:${utc(agora)}`,
    `DTSTART:${utc(c.inicio)}`,
    `DTEND:${utc(c.fim)}`,
    `SUMMARY:${esc(c.titulo)}`,
    ...(c.local ? [`LOCATION:${esc(c.local)}`] : []),
    `DESCRIPTION:${esc(c.detalhes)}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(c.titulo)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

/** O mesmo evento no Google Agenda, para quem não quer baixar arquivo. */
export const linkGoogleAgenda = (c: Compromisso) =>
  `https://calendar.google.com/calendar/render?${new URLSearchParams({
    action: "TEMPLATE",
    text: c.titulo,
    dates: `${utc(c.inicio)}/${utc(c.fim)}`,
    details: c.detalhes,
    ...(c.local && { location: c.local }),
  })}`;

/** Como chegar: o endereço (ou, sem ele, bairro e cidade) nos apps de mapa. */
export const mapas = (onde: string) => ({
  google: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(onde)}`,
  waze: `https://waze.com/ul?q=${encodeURIComponent(onde)}&navigate=yes`,
  // o mapa que aparece na página: a incorporação pública do Google, sem chave
  embed: `https://maps.google.com/maps?q=${encodeURIComponent(onde)}&z=16&output=embed`,
});
