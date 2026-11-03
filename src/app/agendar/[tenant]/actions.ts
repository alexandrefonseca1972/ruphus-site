"use server";

import { adminDb } from "@/lib/admin";
import { agendaDias, availableSlots } from "@/lib/booking.server";
import { addDays, dentroDaJanela as withinRange, todayIn } from "@/lib/datetime";
import { AgendaQuery, SlotQuery } from "@/lib/scheduling";

// Chamáveis por qualquer pessoa via POST: toda entrada é validada aqui

export async function getSlots(input: unknown) {
  const q = SlotQuery.safeParse(input);
  return q.success && withinRange(q.data.date) ? availableSlots(adminDb, q.data) : [];
}

const DIAS_NA_FAIXA = 7; // o que cabe na faixa de dias da página, e o teto do custo desta chamada

/** A semana que a página desenha: dias com contagem e horários, em uma chamada. */
export async function getAgenda(input: unknown) {
  const q = AgendaQuery.safeParse(input);
  if (!q.success) return [];
  // passado distante (aba esquecida, data digitada): começa hoje. "Ontem" de Brasília passa, porque
  // no AC e no AM ainda pode ser hoje; o agendaDias acerta pelo fuso do negócio
  const from = q.data.from < addDays(todayIn(), -1) ? todayIn() : q.data.from;
  if (!withinRange(from)) return [];
  const dias = Array.from({ length: DIAS_NA_FAIXA }, (_, i) => addDays(from, i)).filter(withinRange);
  return agendaDias(adminDb, { ...q.data, from }, dias);
}
