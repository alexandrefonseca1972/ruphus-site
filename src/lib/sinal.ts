// Sinal do agendamento online: o cliente paga parte do valor por Pix, na chave do salão,
// para garantir o horário. Código puro: roda no servidor, no navegador e nos testes.
//
// ponytail: Pix estático, o salão confere no banco e toca "Sinal recebido". Com um PSP,
// o webhook faria o mesmo que confirmarSinal e nada mais muda.
import { z } from "zod";

/** Configuração do negócio (tenants/{slug}.sinal). valor: % (1–100) ou centavos. */
export const ConfigSinal = z.object({
  ativo: z.boolean(),
  tipo: z.enum(["percentual", "fixo"]),
  valor: z.number().int().positive(),
  prazoMin: z.number().int().min(10).max(24 * 60),
}).refine((c) => c.tipo === "fixo" || c.valor <= 100, { message: "O percentual vai até 100%.", path: ["valor"] });
export type ConfigSinal = z.infer<typeof ConfigSinal>;

export const SINAL_PADRAO: ConfigSinal = { ativo: false, tipo: "percentual", valor: 30, prazoMin: 30 };

/** Quanto o cliente paga agora. Fixo nunca passa do preço; sem preço, sem sinal. */
export function valorDoSinal(cfg: Pick<ConfigSinal, "tipo" | "valor">, precoCents: number) {
  if (precoCents <= 0) return 0;
  return cfg.tipo === "percentual" ? Math.round((precoCents * cfg.valor) / 100) : Math.min(cfg.valor, precoCents);
}

/** Até quando o sinal vale: o prazo do negócio, mas nunca depois do início do horário. */
export const prazoDoSinal = (agora: Date, prazoMin: number, inicio: Date) => new Date(Math.min(agora.getTime() + prazoMin * 60_000, inicio.getTime()));

/** O que fica no agendamento (appointments/{id}.sinal); só o servidor grava. */
export type SinalDoAgendamento = { cents: number; status: "pendente" | "pago" | "vencido"; ate: Date; txid: string; pix: { chave: string; nome: string; cidade: string } };

/** "30% do valor" / "R$ 20,00": como a página de agendamento anuncia. */
export const textoDoSinal = (cfg: Pick<ConfigSinal, "tipo" | "valor">) =>
  cfg.tipo === "percentual" ? `${cfg.valor}% do valor` : (cfg.valor / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** O que falta receber no balcão: o preço menos o sinal já pago. */
export const restanteDe = (a: { priceCents: number; sinal?: { status?: string; cents?: number } }) =>
  Math.max(0, a.priceCents - (a.sinal?.status === "pago" ? (a.sinal.cents ?? 0) : 0));
