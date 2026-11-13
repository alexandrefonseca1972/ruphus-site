import { dateIn, formatTime, weekday } from "@/lib/datetime";

export type ExpedienteBio = { dia: number; inicio: string; fim: string };

export function situacaoExpediente(expediente: ExpedienteBio[], fuso: string, agora = new Date()) {
  const jornada = expediente.find((e) => e.dia === weekday(dateIn(agora, fuso)));
  const hora = formatTime(agora, fuso);
  return jornada && hora >= jornada.inicio && hora < jornada.fim
    ? { aberto: true, ate: jornada.fim }
    : { aberto: false, ate: null };
}
