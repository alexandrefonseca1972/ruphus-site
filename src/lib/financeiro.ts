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
  // "2026-13-45" passaria no formato e criaria um mês que nenhuma tela mostra
  data: z.string().regex(DATA, "Data inválida.").refine((d) => { const t = new Date(`${d}T12:00:00Z`); return !Number.isNaN(+t) && t.toISOString().slice(0, 10) === d; }, "Data inválida."),
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
  // o sinal que a tela descontou do preço ao abrir: se mudou desde então (confirmado em outra
  // tela), o servidor recusa em vez de contar o sinal duas vezes
  sinalCents: z.number().int().min(0).max(99_999_99).optional(),
});

/** O documento como o painel lê (tenants/{t}/lancamentos). */
export const Lancamento = LancamentoInput.extend({
  // comissão toda abatida por estorno fica registrada com R$ 0
  valorCents: z.number().int().min(0),
  mes: z.string(),
  appointmentId: z.string().optional(),
  staffId: z.string().nullish(),
  staffName: z.string().nullish(),
  customerName: z.string().nullish(),
  /** o cliente da agenda (55DDNNNNNNNNN): é o WhatsApp do recibo */
  customerKey: z.string().nullish(),
  /** o mês em que a entrada conta para a comissão: o do recebimento do atendimento. O sinal só
   *  ganha ele quando o atendimento é recebido (falta ou cancelamento: o sinal fica com o salão) */
  mesComissao: z.string().optional(),
  /** estorno: o id da entrada que ele devolve */
  estornoDe: z.string().optional(),
  /** pagamento de comissão: quanto de estorno ele abateu (negativo: devolveu ao profissional) */
  descontoCents: z.number().int().optional(),
});
export type Lancamento = z.infer<typeof Lancamento> & { id: string };

export const mesDe = (data: string) => data.slice(0, 7);
/** Em que mês a entrada conta para a comissão; null: não conta (sinal de atendimento não recebido). */
export const mesDaComissao = (l: { id: string; mes: string; mesComissao?: string | null }) => l.mesComissao ?? (l.id.startsWith("sn-") ? null : l.mes);
/** Uma baixa por atendimento: o id é o do agendamento, e o segundo toque não duplica. */
export const idDaBaixa = (appointmentId: string) => `ag-${appointmentId}`;
/** Um estorno por entrada: o segundo toque não devolve duas vezes. */
export const idDoEstorno = (lancamentoId: string) => `es-${lancamentoId}`;
/** Conta fixa, comissão, estorno e vale: nascem de outro registro, tipo e data não mudam. */
export const ehVinculado = (id: string) => /^(fx|cm|es|vl)-/.test(id);
/** Vale: parte da comissão adiantada ao profissional, a qualquer dia. Sai do próximo pagamento. */
export const ehVale = (id: string) => id.startsWith("vl-");
/** Sinal do agendamento no Caixa (criado ao confirmar o sinal): entrada presa ao atendimento. */
export const ehSinal = (id: string) => id.startsWith("sn-");
/** Id de uma entrada ou saída avulsa, gerado na tela: repetir o envio não duplica o dinheiro. */
export const ID_AVULSO = /^mn-[A-Za-z0-9]{16,32}$/;

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
export const Fixa = FixaInput.extend({
  id: z.string().regex(/^[a-z0-9]{1,20}$/),
  desde: z.string().regex(MES).optional(),
  // tirada: some deste mês em diante; os meses de antes continuam com ela (paga ou a pagar)
  ate: z.string().regex(MES).optional(),
});
/** A conta vale no mês: já existia e ainda não foi tirada. */
export const fixaNoMes = (f: { desde?: string; ate?: string }, mes: string) => (!f.desde || f.desde <= mes) && (!f.ate || mes < f.ate);
export type Fixa = z.infer<typeof Fixa>;

/** tenants/{t}/caixa/config: as contas fixas e a comissão (%) de cada profissional. */
export const CaixaConfig = z.object({
  fixas: z.array(Fixa).max(30, "No máximo 30 contas fixas.").default([]),
  comissoes: z.record(z.string().max(128), z.number().min(0).max(100)).default({}),
  /** estorno ainda não abatido da comissão de cada profissional, em centavos: sai do próximo
   *  pagamento, e o que não couber nele passa para o seguinte. Negativo: a devolver a ele. */
  descontos: z.record(z.string().max(128), z.number().int()).default({}),
});
export type CaixaConfig = z.infer<typeof CaixaConfig>;

/** Pagar uma conta fixa ou a comissão do mês: o id é fixo, o segundo toque não duplica. */
export const PagamentoInput = z.object({
  tipo: z.enum(["fixa", "comissao"]),
  alvoId: docId,
  mes: z.string().regex(MES),
  // R$ 0 só na comissão toda abatida por estorno (o servidor confere)
  valorCents: z.number().int().min(0).max(99_999_99, "Valor alto demais."),
  forma: z.enum(FORMAS),
  /** comissão: o estorno que este pagamento abate */
  descontoCents: z.number().int().optional(),
});
/** Vale ao profissional: o id vem da tela (vl-…), reenviar não paga duas vezes. O e-mail
 *  recebe a confirmação, sempre. */
export const ValeInput = z.object({
  id: z.string().regex(/^vl-[A-Za-z0-9]{16,32}$/),
  staffId: docId,
  valorCents: valor,
  forma: z.enum(FORMAS),
  email: z.string().trim().toLowerCase().email("Informe o e-mail do profissional.").max(254),
});
/** Devolver ao cliente, no todo ou em parte, o que entrou. */
export const EstornoInput = z.object({
  lancamentoId: docId,
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

/** % digitado, com a vírgula do teclado brasileiro (e o "%" que o dono digita junto).
 *  Vazio ou texto vira null: não grava nada. */
export function pctDoTexto(s: string) {
  const t = s.replace("%", "").trim();
  const n = Number(t.replace(",", "."));
  return !t || Number.isNaN(n) ? null : Math.min(100, Math.max(0, Math.round(n * 100) / 100));
}

/** Comissão de cada profissional: o que ele faturou pela agenda vezes o percentual (bruto),
 *  menos o estorno guardado para abater (descontos), até zerar; o resto fica para o próximo. */
// ponytail: quem tem desconto guardado mas não atendeu no mês não aparece; ele espera o próximo
// mês com atendimento. Listar essas linhas se um profissional sair da equipe devendo estorno.
export function comissoesDoMes(itens: (Pick<Lancamento, "tipo" | "valorCents" | "staffId" | "staffName"> & { data?: string })[], pct: Record<string, number>, descontos: Record<string, number> = {}, nomes: Record<string, string> = {}) {
  const m = new Map<string, { staffId: string; nome: string; faturado: number; dataNome: string }>();
  // crédito a devolver (estorno desfeito, recebimento depois do pagamento) sem atendimento no mês:
  // a linha aparece mesmo assim, senão não haveria como pagar quem saiu da equipe
  for (const [staffId, d] of Object.entries(descontos)) if (d < 0) m.set(staffId, { staffId, nome: nomes[staffId] ?? "Profissional", faturado: 0, dataNome: "" });
  for (const l of itens) {
    if (l.tipo !== "entrada" || !l.staffId) continue;
    const p = m.get(l.staffId) ?? { staffId: l.staffId, nome: l.staffName ?? "Profissional", faturado: 0, dataNome: "" };
    // renomeado no mês: vale o nome do lançamento mais recente
    if (l.staffName && (l.data ?? "") >= p.dataNome) Object.assign(p, { nome: l.staffName, dataNome: l.data ?? "" });
    p.faturado += l.valorCents;
    m.set(l.staffId, p);
  }
  return [...m.values()]
    .map(({ dataNome: _, ...p }) => {
      const bruto = Math.round((p.faturado * (pct[p.staffId] ?? 0)) / 100);
      const desconto = descontos[p.staffId] ?? 0;
      const abatido = desconto > 0 ? Math.min(desconto, bruto) : desconto;
      return { ...p, pct: pct[p.staffId] ?? 0, bruto, desconto, abatido, valor: bruto - abatido };
    })
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
export function resumoDoMes(itens: (Pick<Lancamento, "tipo" | "valorCents" | "categoria" | "forma"> & { staffId?: string | null; staffName?: string | null; estornoDe?: string; data?: string })[]) {
  const soma = (f: (l: (typeof itens)[number]) => boolean) => itens.filter(f).reduce((t, l) => t + l.valorCents, 0);
  const agrupa = (chave: (l: (typeof itens)[number]) => string | null | undefined, tipo: "entrada" | "saida") => {
    const m = new Map<string, number>();
    for (const l of itens) {
      const k = l.tipo === tipo ? chave(l) : undefined;
      if (k) m.set(k, (m.get(k) ?? 0) + l.valorCents);
    }
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  // faturamento por profissional já sem o que foi estornado. Pelo id: duas "Ana" não viram uma,
  // e quem foi renomeado no mês não vira duas linhas (fica o nome mais recente)
  const porProfissional = new Map<string, { nome: string; data: string; total: number }>();
  for (const l of itens) {
    const k = l.staffId || l.staffName;
    if (!k || !(l.tipo === "entrada" || l.estornoDe)) continue;
    const p = porProfissional.get(k) ?? { nome: l.staffName || "Profissional", data: "", total: 0 };
    if (l.staffName && (l.data ?? "") >= p.data) Object.assign(p, { nome: l.staffName, data: l.data ?? "" });
    p.total += l.tipo === "entrada" ? l.valorCents : -l.valorCents;
    porProfissional.set(k, p);
  }
  // recebido por forma também sem os estornos: é o que bate com o extrato do banco e a gaveta
  const porForma = new Map<string, number>();
  for (const l of itens) {
    if (l.tipo !== "entrada" && !l.estornoDe) continue;
    const f = ROTULO_FORMA[l.forma];
    porForma.set(f, (porForma.get(f) ?? 0) + (l.tipo === "entrada" ? l.valorCents : -l.valorCents));
  }
  const entrou = soma((l) => l.tipo === "entrada");
  const saiu = soma((l) => l.tipo === "saida");
  return {
    entrou,
    saiu,
    sobrou: entrou - saiu,
    porForma: [...porForma].filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]),
    entradasPorCategoria: agrupa((l) => l.categoria, "entrada"),
    saidasPorCategoria: agrupa((l) => l.categoria, "saida"),
    porProfissional: [...porProfissional.values()].filter((p) => p.total !== 0).map((p): [string, number] => [p.nome, p.total]).sort((a, b) => b[1] - a[1]),
  };
}
