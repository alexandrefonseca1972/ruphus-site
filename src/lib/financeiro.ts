import { z } from "zod";

// Caixa do negócio: entradas e saídas do mês, em centavos inteiros. Sem Firebase aqui:
// o painel, o servidor e os testes usam o mesmo esquema.
//
// "data" e "mes" são texto na hora de parede do negócio ("2026-10-29", "2026-10"), não
// instantes: o dia do lançamento é o dia do caixa, sem conta de fuso no meio.

export const FORMAS = ["pix", "dinheiro", "cartao", "outro"] as const;
export const ROTULO_FORMA: Record<(typeof FORMAS)[number], string> = { pix: "Pix", dinheiro: "Dinheiro", cartao: "Cartão", outro: "Outro" };

export type Familia = "pet" | "beleza" | "saude" | "aulas" | "fitness" | "automotivo";

// As do nicho vêm primeiro: são as que o dono procura
const EXTRAS: Record<Familia, { entrada: string[]; saida: string[] }> = {
  pet: { entrada: ["Ração e acessórios"], saida: ["Estoque de ração"] },
  beleza: { entrada: [], saida: ["Produtos de beleza"] },
  saude: { entrada: [], saida: ["Material clínico"] },
  aulas: { entrada: ["Mensalidade", "Matrícula"], saida: ["Material didático"] },
  fitness: { entrada: ["Plano/mensalidade"], saida: ["Equipamentos"] },
  automotivo: { entrada: ["Peças"], saida: ["Peças e estoque", "Ferramentas"] },
};
const BASE = {
  entrada: ["Atendimento", "Produto", "Pacote/mensalidade", "Outro"],
  saida: ["Aluguel", "Produtos/insumos", "Comissão/salário", "Contas (luz, água, internet)", "Marketing", "Impostos/taxas", "Outro"],
};

export function categorias(tipo: "entrada" | "saida", familia?: string) {
  const extras = EXTRAS[familia as Familia]?.[tipo] ?? [];
  return [...new Set([...extras, ...BASE[tipo]])];
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const docId = z.string().min(1).max(128).regex(/^[^/]+$/);

/** O que o dono digita na folha de entrada/saída. */
export const LancamentoInput = z.object({
  tipo: z.enum(["entrada", "saida"]),
  valorCents: z.number().int().positive("Informe o valor.").max(99_999_99, "Valor alto demais."),
  data: z.string().regex(DATA, "Data inválida."),
  categoria: z.string().trim().min(1, "Escolha a categoria.").max(40),
  forma: z.enum(FORMAS),
  descricao: z.string().trim().max(80).optional(),
});
export type LancamentoInput = z.infer<typeof LancamentoInput>;

/** Baixa de um atendimento da agenda: o valor pode mudar (preço "a partir de"). */
export const BaixaInput = z.object({
  appointmentId: docId,
  valorCents: z.number().int().positive("Informe o valor.").max(99_999_99, "Valor alto demais."),
  forma: z.enum(FORMAS),
});

/** O documento como o painel lê (tenants/{t}/lancamentos). */
export const Lancamento = LancamentoInput.extend({
  mes: z.string(),
  appointmentId: z.string().optional(),
  staffName: z.string().nullish(),
  customerName: z.string().nullish(),
});
export type Lancamento = z.infer<typeof Lancamento> & { id: string };

export const mesDe = (data: string) => data.slice(0, 7);
/** Uma baixa por atendimento: o id é o do agendamento, e o segundo toque não duplica. */
export const idDaBaixa = (appointmentId: string) => `ag-${appointmentId}`;

/** Os três números do topo e os agrupamentos do resumo. */
export function resumoDoMes(itens: (Pick<Lancamento, "tipo" | "valorCents" | "categoria" | "forma"> & { staffName?: string | null })[]) {
  const soma = (f: (l: (typeof itens)[number]) => boolean) => itens.filter(f).reduce((t, l) => t + l.valorCents, 0);
  const agrupa = (chave: (l: (typeof itens)[number]) => string | null | undefined, tipo: "entrada" | "saida") => {
    const m = new Map<string, number>();
    for (const l of itens) {
      const k = l.tipo === tipo ? chave(l) : undefined;
      if (k) m.set(k, (m.get(k) ?? 0) + l.valorCents);
    }
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const entrou = soma((l) => l.tipo === "entrada");
  const saiu = soma((l) => l.tipo === "saida");
  return {
    entrou,
    saiu,
    sobrou: entrou - saiu,
    porForma: agrupa((l) => ROTULO_FORMA[l.forma], "entrada"),
    entradasPorCategoria: agrupa((l) => l.categoria, "entrada"),
    saidasPorCategoria: agrupa((l) => l.categoria, "saida"),
    porProfissional: agrupa((l) => l.staffName, "entrada"),
  };
}
