"use client";

import { formatLongDate, formatTime } from "@/lib/datetime";

/** Quando a mensagem sai, no fuso do negócio: "sábado, 8 de novembro às 00:00". */
export const quandoSai = (iso: string, fuso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "mais tarde" : `${formatLongDate(d, fuso)} às ${formatTime(d, fuso)}`;
};
