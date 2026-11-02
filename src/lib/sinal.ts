// Sinal do agendamento online: o cliente paga parte do valor por Pix, na chave do salão,
// para garantir o horário. Código puro: roda no servidor, no navegador e nos testes.
//
// ponytail: Pix estático, o salão confere no banco e toca "Sinal recebido". Com um PSP,
// o webhook faria o mesmo que confirmarSinal e nada mais muda.
// O schema (zod) mora em sinal-config.ts: a página pública de agendamento usa só as contas
// daqui, e o zod ficava no JS que todo cliente baixa.
import type { ConfigSinal } from "@/lib/sinal-config";

/** Quanto o cliente paga agora. Fixo nunca passa do preço; sem preço, sem sinal. */
export function valorDoSinal(cfg: Pick<ConfigSinal, "tipo" | "valor">, precoCents: number) {
  if (!Number.isFinite(precoCents) || precoCents <= 0 || !Number.isFinite(cfg.valor) || cfg.valor <= 0) return 0;
  return cfg.tipo === "percentual" ? Math.round((precoCents * cfg.valor) / 100) : Math.min(cfg.valor, precoCents);
}

/** Até quando o sinal vale: o prazo do negócio, mas nunca depois do início do horário. */
export const prazoDoSinal = (agora: Date, prazoMin: number, inicio: Date) => new Date(Math.min(agora.getTime() + prazoMin * 60_000, inicio.getTime()));

/** O que fica no agendamento (appointments/{id}.sinal); só o servidor grava. */
// ate: instante real; hora: o mesmo prazo no relógio do negócio, para a agenda mostrar
// dispensado: o salão confirmou ou remarcou sem o sinal
export type SinalDoAgendamento = { cents: number; status: "pendente" | "pago" | "vencido" | "dispensado" | "erro"; ate: Date; hora: string; txid: string; pix: { chave: string; nome: string; cidade: string } };

/** "30% do valor" / "R$ 20,00": como a página de agendamento anuncia. */
export const textoDoSinal = (cfg: Pick<ConfigSinal, "tipo" | "valor">) =>
  cfg.tipo === "percentual" ? `${cfg.valor}% do valor` : (cfg.valor / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** O que falta receber no balcão: o preço menos o sinal já pago. */
export const restanteDe = (a: { priceCents: number; sinal?: { status?: string; cents?: number } }) =>
  Math.max(0, a.priceCents - (a.sinal?.status === "pago" ? (a.sinal.cents ?? 0) : 0));

/** "24 min" / "1 h 05 min" até o prazo; null quando já passou (ou a data é inválida). */
export function tempoRestante(ate: string, agora: number) {
  const min = Math.ceil((Date.parse(ate) - agora) / 60_000);
  if (!Number.isFinite(min) || min <= 0) return null;
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}
