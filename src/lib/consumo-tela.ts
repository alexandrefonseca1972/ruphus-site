import type { Canal, StatusEnvio, TipoEnvio } from "@/lib/consumo";

// Contas da tela de consumo (/[slug]/consumo), a partir dos envios do mês. Funções puras: a tela só
// desenha. O envio aqui é o que o servidor manda (consumo-painel.server), sem telefone inteiro.

export type EnvioDaTela = {
  id: string;
  em: number;
  canal: Canal;
  tipo: TipoEnvio;
  destinatario: "cliente" | "dono";
  status: StatusEnvio;
  custoCents: number;
  statusEm: number | null;
};

export const ROTULO_TIPO: Record<TipoEnvio, string> = {
  recebido: "Pedido recebido (cliente)",
  pedido_dono: "Pedido para você confirmar",
  confirmado: "Agendamento confirmado",
  cancelado: "Cancelamento",
  reagendado: "Remarcação",
  lembrete: "Lembrete",
  pix: "Pix do sinal",
  recibo: "Recibo",
  resposta: "Resposta a quem escreveu",
  saldo: "Aviso de saldo",
  outro: "Outra mensagem",
};

/** Lida > entregue > enviada (saiu, sem retorno) > parada > falhou: a "situação" de cada mensagem. */
export type Situacao = "lida" | "entregue" | "enviada" | "parada" | "falhou";
export function situacao(s: StatusEnvio): Situacao {
  if (s === "lido") return "lida";
  if (s === "entregue") return "entregue";
  if (s === "falhou" || s === "sem-saldo") return "falhou";
  if (s === "parado") return "parada";
  return "enviada";
}
export const SITUACOES: Situacao[] = ["lida", "entregue", "enviada", "parada", "falhou"];

type Contagem = Record<Situacao, number>;
const zerada = (): Contagem => ({ lida: 0, entregue: 0, enviada: 0, parada: 0, falhou: 0 });

export function resumo(envios: EnvioDaTela[]) {
  const sit = zerada();
  let custo = 0;
  let semSaldo = 0;
  const canais = { whatsapp: { total: 0, custoCents: 0 }, sms: { total: 0, custoCents: 0 } };
  for (const e of envios) {
    sit[situacao(e.status)]++;
    if (e.status === "sem-saldo") semSaldo++;
    custo += e.custoCents;
    canais[e.canal].total++;
    canais[e.canal].custoCents += e.custoCents;
  }
  // entrega só no WhatsApp: o SMS não devolve confirmação de entrega
  const zap = envios.filter((e) => e.canal === "whatsapp" && e.status !== "sem-saldo" && e.status !== "parado");
  const chegaram = zap.filter((e) => e.status === "entregue" || e.status === "lido").length;
  return {
    total: envios.length,
    custoCents: custo,
    situacoes: sit,
    semSaldo,
    canais,
    atencao: sit.falhou + sit.parada,
    entrega: { base: zap.length, chegaram, lidas: sit.lida, pct: zap.length ? Math.round((chegaram / zap.length) * 100) : null },
  };
}

/** O caminho das mensagens: enviadas → aceitas (não falharam nem pararam) → entregues → lidas. */
export function funil(envios: EnvioDaTela[]) {
  const zap = envios.filter((e) => e.canal === "whatsapp" && e.status !== "sem-saldo");
  const aceitas = zap.filter((e) => e.status !== "falhou" && e.status !== "parado");
  const entregues = aceitas.filter((e) => e.status === "entregue" || e.status === "lido");
  const lidas = entregues.filter((e) => e.status === "lido");
  return [
    { rotulo: "enviadas", n: zap.length },
    { rotulo: "aceitas", n: aceitas.length },
    { rotulo: "entregues", n: entregues.length },
    { rotulo: "lidas", n: lidas.length },
  ];
}

export type LinhaTipo = { tipo: TipoEnvio; canal: Canal; total: number; situacoes: Contagem; custoCents: number };
/** Uma linha por tipo e canal, as mais numerosas primeiro. */
export function porTipo(envios: EnvioDaTela[]): LinhaTipo[] {
  const m = new Map<string, LinhaTipo>();
  for (const e of envios) {
    const k = `${e.tipo}/${e.canal}`;
    const l = m.get(k) ?? { tipo: e.tipo, canal: e.canal, total: 0, situacoes: zerada(), custoCents: 0 };
    l.total++;
    l.situacoes[situacao(e.status)]++;
    l.custoCents += e.custoCents;
    m.set(k, l);
  }
  return [...m.values()].sort((a, b) => b.total - a.total || b.custoCents - a.custoCents);
}

const TZ = "America/Sao_Paulo";
const diaDe = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(ms));

export type Dia = { dia: string; whatsapp: number; sms: number; custoCents: number; acumuladoCents: number };
/** Um ponto por dia do mês até hoje (ou até o fim, num mês passado), com o custo acumulado. */
export function porDia(envios: EnvioDaTela[], mes: string, hoje: string): Dia[] {
  const ultimo = mes === hoje.slice(0, 7) ? Number(hoje.slice(8, 10)) : new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate();
  const dias: Dia[] = Array.from({ length: ultimo }, (_, i) => ({ dia: `${mes}-${String(i + 1).padStart(2, "0")}`, whatsapp: 0, sms: 0, custoCents: 0, acumuladoCents: 0 }));
  for (const e of envios) {
    const d = dias[Number(diaDe(e.em).slice(8, 10)) - 1];
    if (!d || !diaDe(e.em).startsWith(mes)) continue;
    d[e.canal]++;
    d.custoCents += e.custoCents;
  }
  let soma = 0;
  for (const d of dias) d.acumuladoCents = soma += d.custoCents;
  return dias;
}

/** Faixas de hora do mapa de leitura (início inclusivo, fim exclusivo). */
export const FAIXAS = [
  { rotulo: "6–9h", de: 6, ate: 9 },
  { rotulo: "9–12h", de: 9, ate: 12 },
  { rotulo: "12–15h", de: 12, ate: 15 },
  { rotulo: "15–18h", de: 15, ate: 18 },
  { rotulo: "18–22h", de: 18, ate: 22 },
] as const;
/** Leituras por faixa de hora (linhas) e dia da semana (colunas, domingo = 0), pelo horário da leitura. */
export function mapaDeLeitura(envios: EnvioDaTela[]) {
  const m = FAIXAS.map(() => [0, 0, 0, 0, 0, 0, 0]);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", hourCycle: "h23" });
  const SEMANA = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let total = 0;
  for (const e of envios) {
    if (e.status !== "lido" || !e.statusEm) continue;
    const p = Object.fromEntries(fmt.formatToParts(new Date(e.statusEm)).map((x) => [x.type, x.value]));
    const h = Number(p.hour);
    const f = FAIXAS.findIndex((x) => h >= x.de && h < x.ate);
    if (f < 0) continue;
    m[f][SEMANA.indexOf(p.weekday)]++;
    total++;
  }
  const max = Math.max(0, ...m.flat());
  // o pico: a célula com mais leituras
  let pico: { faixa: string; dia: number } | null = null;
  if (max > 0) {
    const f = m.findIndex((l) => l.includes(max));
    pico = { faixa: FAIXAS[f].rotulo, dia: m[f].indexOf(max) };
  }
  return { celulas: m, max, total, pico };
}

/** Quantas mensagens de WhatsApp o saldo paga, no preço de aviso. */
export const mensagensNoSaldo = (saldoCents: number, precoCents: number) => (precoCents > 0 ? Math.max(0, Math.floor(saldoCents / precoCents)) : null);

/** O saldo ao fim de cada dia dos últimos N dias, pelo extrato (saldoAposCents do último lançamento do dia). */
export function saldoPorDia(creditos: { em: number; saldoAposCents: number }[], hoje: string, saldoAtual: number, n = 30) {
  const ordenado = [...creditos].sort((a, b) => a.em - b.em);
  const dias: { dia: string; saldoCents: number }[] = [];
  const base = new Date(`${hoje}T12:00:00Z`);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    dias.push({ dia: d.toISOString().slice(0, 10), saldoCents: NaN });
  }
  let atual: number | null = null;
  let j = 0;
  for (const d of dias) {
    while (j < ordenado.length && diaDe(ordenado[j].em) <= d.dia) atual = ordenado[j++].saldoAposCents;
    d.saldoCents = atual ?? NaN;
  }
  if (dias.length) dias[dias.length - 1].saldoCents = saldoAtual;
  return dias.filter((d) => !Number.isNaN(d.saldoCents));
}

/** CSV das mensagens do mês (separador ;, como o Excel brasileiro abre). */
export function csvDasMensagens(linhas: { quando: string; tipo: string; para: string; canal: string; situacao: string; agendamento: string; custo: string }[]) {
  // o nome do cliente vem do agendamento público: "=HYPERLINK(…)" viraria fórmula no Excel
  const esc = (t: string) => {
    const v = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
    return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const cab = ["Quando", "Tipo", "Para", "Canal", "Situação", "Agendamento", "Custo"];
  return [cab, ...linhas.map((l) => [l.quando, l.tipo, l.para, l.canal, l.situacao, l.agendamento, l.custo])].map((l) => l.map(esc).join(";")).join("\n");
}

/** "12,50", "1.234,50", "10.50" ou "-3" → centavos (com sinal); inválido → null. Ponto só vale como
 *  milhar no formato 1.234(,56); sozinho com até 2 casas é decimal ("10.50" = R$ 10,50, nunca 1.050). */
export const centavos = (t: string) => {
  const b = t.trim().replace(/\s/g, "").replace(/^R\$/i, "");
  let v: string;
  if (/^-?\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(b)) v = b.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d+([.,]\d{1,2})?$/.test(b)) v = b.replace(",", ".");
  else return null;
  return Math.round(Number(v) * 100);
};
