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
  staffId: z.string().nullish(),
  staffName: z.string().nullish(),
  customerName: z.string().nullish(),
});
export type Lancamento = z.infer<typeof Lancamento> & { id: string };

export const mesDe = (data: string) => data.slice(0, 7);
/** Uma baixa por atendimento: o id é o do agendamento, e o segundo toque não duplica. */
export const idDaBaixa = (appointmentId: string) => `ag-${appointmentId}`;

const valor = z.number().int().positive("Informe o valor.").max(99_999_99, "Valor alto demais.");

/** Conta que se repete todo mês (aluguel, internet). Vira saída só quando o dono paga. */
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/** O que o dono digita para uma conta nova. */
export const FixaInput = z.object({
  nome: z.string().trim().min(1, "Dê um nome à conta.").max(40),
  valorCents: valor,
  dia: z.number().int().min(1, "O dia vai de 1 a 31.").max(31, "O dia vai de 1 a 31."),
  categoria: z.string().trim().min(1).max(40),
});
/** Guardada com id e o mês em que foi criada: antes dele, a conta não aparece para pagar. */
export const Fixa = FixaInput.extend({ id: z.string().regex(/^[a-z0-9]{1,20}$/), desde: z.string().regex(MES).optional() });
export type Fixa = z.infer<typeof Fixa>;

/** tenants/{t}/caixa/config: as contas fixas e a comissão (%) de cada profissional. */
export const CaixaConfig = z.object({
  fixas: z.array(Fixa).max(30, "No máximo 30 contas fixas.").default([]),
  comissoes: z.record(z.string().max(128), z.number().min(0).max(100)).default({}),
});
export type CaixaConfig = z.infer<typeof CaixaConfig>;

/** Pagar uma conta fixa ou a comissão do mês: o id é fixo, o segundo toque não duplica. */
export const PagamentoInput = z.object({
  tipo: z.enum(["fixa", "comissao"]),
  alvoId: docId,
  mes: z.string().regex(MES),
  valorCents: valor,
  forma: z.enum(FORMAS),
});
export const idDoPagamento = (tipo: "fixa" | "comissao", alvoId: string, mes: string) => `${tipo === "fixa" ? "fx" : "cm"}-${alvoId}-${mes}`;

/** O dia da conta dentro do mês: dia 31 em fevereiro cai no último dia. */
export function diaNoMes(mes: string, dia: number) {
  const [a, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${mes}-${String(Math.min(dia, ultimo)).padStart(2, "0")}`;
}

/** % digitado, com a vírgula do teclado brasileiro. Vazio ou texto vira null: não grava nada. */
export function pctDoTexto(s: string) {
  const t = s.trim();
  const n = Number(t.replace(",", "."));
  return !t || Number.isNaN(n) ? null : Math.min(100, Math.max(0, Math.round(n * 100) / 100));
}

/** Comissão de cada profissional: o que ele faturou pela agenda vezes o percentual. */
export function comissoesDoMes(itens: Pick<Lancamento, "tipo" | "valorCents" | "staffId" | "staffName">[], pct: Record<string, number>) {
  const m = new Map<string, { staffId: string; nome: string; faturado: number }>();
  for (const l of itens) {
    if (l.tipo !== "entrada" || !l.staffId) continue;
    const p = m.get(l.staffId) ?? { staffId: l.staffId, nome: l.staffName ?? "Profissional", faturado: 0 };
    p.faturado += l.valorCents;
    m.set(l.staffId, p);
  }
  return [...m.values()]
    .map((p) => ({ ...p, pct: pct[p.staffId] ?? 0, valor: Math.round((p.faturado * (pct[p.staffId] ?? 0)) / 100) }))
    .sort((a, b) => b.faturado - a.faturado);
}

/** Planilha do mês para o contador: ; e vírgula decimal, como o Excel em português abre. */
export function csvDoMes(itens: Pick<Lancamento, "data" | "tipo" | "categoria" | "descricao" | "customerName" | "staffName" | "forma" | "valorCents">[]) {
  const cel = (v: string) => {
    const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[;"\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const linhas = [...itens]
    .sort((a, b) => a.data.localeCompare(b.data))
    .map((l) =>
      [
        l.data.split("-").reverse().join("/"),
        l.tipo === "entrada" ? "Entrada" : "Saída",
        l.categoria,
        l.descricao ?? "",
        l.customerName ?? "",
        l.staffName ?? "",
        ROTULO_FORMA[l.forma],
      ]
        .map(cel)
        // o valor é número nosso, sem a proteção de fórmula: "-1200,00" tem que somar no Excel
        .concat(((l.tipo === "saida" ? -l.valorCents : l.valorCents) / 100).toFixed(2).replace(".", ","))
        .join(";"),
    );
  return ["Data;Tipo;Categoria;Descrição;Cliente;Profissional;Forma;Valor", ...linhas].join("\r\n");
}

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
