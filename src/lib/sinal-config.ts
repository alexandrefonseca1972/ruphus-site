// Configuração do sinal do negócio, validada no painel e no servidor. Fica fora de sinal.ts para
// o zod não entrar no JS da página pública de agendamento.
import { z } from "zod";

/** Configuração do negócio (tenants/{slug}.sinal). valor: % (1–100) ou centavos. */
export const ConfigSinal = z.object({
  ativo: z.boolean(),
  tipo: z.enum(["percentual", "fixo"]),
  valor: z.number({ message: "Informe o valor do sinal." }).int().positive("Informe o valor do sinal."),
  prazoMin: z.number().int().min(10, "O prazo mínimo é de 10 minutos.").max(24 * 60, "O prazo máximo é de 24 horas."),
})
  .refine((c) => c.tipo === "fixo" || c.valor <= 100, { message: "O percentual vai até 100%.", path: ["valor"] })
  // R$ 10.000: acima disso é erro de digitação, não sinal de salão
  .refine((c) => c.tipo === "percentual" || c.valor <= 1_000_000, { message: "O sinal fixo vai até R$ 10.000,00.", path: ["valor"] });
export type ConfigSinal = z.infer<typeof ConfigSinal>;

export const SINAL_PADRAO: ConfigSinal = { ativo: false, tipo: "percentual", valor: 30, prazoMin: 30 };

