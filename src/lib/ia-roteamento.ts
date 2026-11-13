// A config de roteamento da IA (config/ia-roteamento): os schemas Zod que o roteador usa no servidor
// e a tela de Ajustes usa para validar ao vivo. Sem "server-only".
import { z } from "zod";
import { paraModeloId, type ModeloId } from "@/lib/tipos-marca";

export const TAREFAS = ["sugerir_resposta", "classificar_resposta", "agente_lead", "gerar_variacoes", "personalizar", "visual_site"] as const;
export type Tarefa = (typeof TAREFAS)[number];
export const PROVEDORES = ["anthropic", "local", "mock"] as const;
export type NomeProvedor = (typeof PROVEDORES)[number];

const Modelo = z
  .string()
  .refine((s) => paraModeloId(s) !== null, "Modelo inválido")
  .transform((s) => s as ModeloId);

// strictObject: chave desconhecida (ex.: escalarSe, ainda fora do schema) é erro, não some em silêncio
export const Elo = z.strictObject({
  provedor: z.enum(PROVEDORES),
  modelo: Modelo,
  maxTokens: z.number().int().positive().max(64_000),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  timeoutMs: z.number().int().positive().max(600_000),
  /** A/B: o elo só vale para os leads cujo hash(slug) % 100 < percentual; sem slug, é pulado */
  percentual: z.number().min(0).max(100).optional(),
  /** só no provedor local: endpoint OpenAI-compatível (padrão: Ollama nesta máquina) */
  endpoint: z.url().optional(),
});
export type Elo = z.infer<typeof Elo>;

export const Rota = z.strictObject({
  // um elo sem percentual garante resposta a quem não cai em nenhum braço do A/B (e a quem não tem slug)
  cadeia: z
    .array(Elo)
    .min(1)
    .refine((c) => c.some((e) => e.percentual === undefined), "A cadeia precisa de ao menos um modelo sem percentual."),
  /** em centavos de dólar (o preço da Anthropic é em dólar); sem ele, não há teto */
  orcamentoDiaCentavos: z.number().min(0).optional(),
});
export type Rota = z.infer<typeof Rota>;

export const ConfigRoteamento = z.partialRecord(z.enum(TAREFAS), Rota);
export type ConfigRoteamento = z.infer<typeof ConfigRoteamento>;

/** Uma linha de iaChamadas como a tabela de custo precisa. */
export type LinhaChamada = { tarefa: string; modelo: string; provedor: string; custoCentavos: number; ok: boolean };
export type CustoTarefa = { tarefa: string; modelo: string; provedor: string; chamadas: number; erros: number; custoCentavos: number };

/** Custo e erro por tarefa e modelo (a tabela de Ajustes), do mais caro ao mais barato. */
export function custoPorTarefa(linhas: readonly LinhaChamada[]): CustoTarefa[] {
  const grupos = new Map<string, CustoTarefa>();
  for (const l of linhas) {
    const k = `${l.tarefa}\u0000${l.modelo}\u0000${l.provedor}`;
    const g = grupos.get(k) ?? { tarefa: l.tarefa, modelo: l.modelo, provedor: l.provedor, chamadas: 0, erros: 0, custoCentavos: 0 };
    g.chamadas++;
    if (!l.ok) g.erros++;
    g.custoCentavos += Number.isFinite(l.custoCentavos) ? l.custoCentavos : 0;
    grupos.set(k, g);
  }
  return [...grupos.values()].sort((a, b) => b.custoCentavos - a.custoCentavos || a.tarefa.localeCompare(b.tarefa));
}
