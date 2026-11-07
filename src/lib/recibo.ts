// O recibo de um recebimento do Caixa: o texto que vai impresso, no WhatsApp e no e-mail.
// Só monta texto: quem lê o lançamento e o negócio é a tela.
import { formatBRL } from "@/lib/datetime";
import { ROTULO_FORMA, type Lancamento } from "@/lib/financeiro";

const UNIDADES = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

/** 0 a 999 por extenso ("cento e vinte e um"; 100 é "cem"). */
function ate999(n: number): string {
  if (n === 100) return "cem";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS[c]);
  if (resto) partes.push(resto < 20 ? UNIDADES[resto] : [DEZENAS[Math.floor(resto / 10)], resto % 10 ? UNIDADES[resto % 10] : ""].filter(Boolean).join(" e "));
  return partes.join(" e ") || "zero";
}

/** 0 a 999.999 por extenso: "mil e duzentos", "dois mil, trezentos e dez". */
function inteiro(n: number): string {
  const mil = Math.floor(n / 1000);
  const resto = n % 1000;
  if (!mil) return ate999(resto);
  const milhar = mil === 1 ? "mil" : `${ate999(mil)} mil`;
  if (!resto) return milhar;
  // "e" quando o resto é redondo ou menor que cem (mil e cem, mil e vinte); senão, vírgula
  return `${milhar}${resto < 100 || resto % 100 === 0 ? " e " : ", "}${ate999(resto)}`;
}

/** R$ por extenso, como num recibo: 12345 → "cento e vinte e três reais e quarenta e cinco centavos". */
export function valorPorExtenso(cents: number): string {
  const reais = Math.floor(cents / 100);
  const centavos = cents % 100;
  const r = reais ? `${inteiro(reais)} ${reais === 1 ? "real" : "reais"}` : "";
  const c = centavos ? `${ate999(centavos)} ${centavos === 1 ? "centavo" : "centavos"}` : "";
  return [r, c].filter(Boolean).join(" e ") || "zero real";
}

/** Número curto e estável do recibo: sai do id do lançamento, o mesmo em toda reimpressão. */
export const numeroDoRecibo = (id: string) => id.replace(/^[a-z]{2}-/, "").replace(/[^A-Za-z0-9]/g, "").slice(-8).toUpperCase();

export type Emissor = { nome: string; telefone?: string | null; endereco?: string | null; cidade?: string | null; uf?: string | null; documento?: string | null };

type Item = Pick<Lancamento, "id" | "valorCents" | "data" | "forma" | "categoria" | "descricao" | "customerName" | "staffName"> & { estornadoCents?: number };

const dataBR = (iso: string) => iso.split("-").reverse().join("/");
const ehSinal = (i: Item) => i.id.startsWith("sn-");
// o sinal e o restante do mesmo atendimento: sn-{agendamento} e ag-{agendamento}
const atendimentoDe = (i: Item) => (/^(ag|sn)-/.test(i.id) ? i.id.slice(3) : i.id);
// "Sinal · Corte" (a descrição do lançamento do sinal) é o serviço "Corte"
const servicoDe = (i: Item) => {
  const d = i.descricao?.trim() || i.categoria;
  return d.startsWith("Sinal · ") ? d.slice(8) : d;
};

/** As partes do recibo, na ordem em que aparecem impressas e no texto. Um recibo junta os
 *  recebimentos de uma visita (o cliente no dia). Os serviços vêm com o preço inteiro; o
 *  pagamento, dividido como entrou: o sinal pago por Pix no agendamento e o resto no balcão. */
export function linhasDoRecibo(itens: Item[], emissor: Emissor) {
  const [primeiro] = itens;
  const total = itens.reduce((t, i) => t + i.valorCents, 0);
  const estornado = itens.reduce((t, i) => t + (i.estornadoCents ?? 0), 0);
  const pagador = itens.find((i) => i.customerName?.trim())?.customerName?.trim() || null;
  const local = [emissor.cidade, emissor.uf].filter(Boolean).join("/");
  const datas = [...new Set(itens.map((i) => i.data))].sort();
  // um serviço por atendimento, somando o sinal e o restante
  const porAtendimento = new Map<string, Item[]>();
  for (const i of itens) porAtendimento.set(atendimentoDe(i), [...(porAtendimento.get(atendimentoDe(i)) ?? []), i]);
  const servicos = [...porAtendimento.values()].map((g) => {
    const base = g.find((i) => !ehSinal(i)) ?? g[0];
    return { servico: servicoDe(base), profissional: g.find((i) => i.staffName?.trim())?.staffName?.trim() || "", valorCents: g.reduce((t, i) => t + i.valorCents, 0) };
  });
  // o pagamento como entrou: cada sinal com a sua parte do serviço; o resto somado por forma
  const pagamentos: { rotulo: string; detalhe: string; valor: string }[] = [];
  const porForma = new Map<string, number>();
  for (const i of itens) {
    const forma = ROTULO_FORMA[i.forma] ?? i.forma;
    if (!ehSinal(i)) {
      porForma.set(forma, (porForma.get(forma) ?? 0) + i.valorCents);
      continue;
    }
    const doServico = porAtendimento.get(atendimentoDe(i))!.reduce((t, x) => t + x.valorCents, 0);
    const pct = doServico > i.valorCents ? ` · ${Math.round((i.valorCents / doServico) * 100)}% do serviço` : "";
    pagamentos.push({ rotulo: "Sinal no agendamento", detalhe: `${forma}${pct}`, valor: formatBRL(i.valorCents) });
  }
  const comSinal = pagamentos.length > 0;
  for (const [forma, cents] of porForma) pagamentos.push({ rotulo: comSinal ? "Restante no atendimento" : forma, detalhe: comSinal ? forma : "", valor: formatBRL(cents) });
  return {
    // o número sai do recebimento do atendimento: o mesmo em toda reimpressão, mesmo se a visita ganhar outro item
    titulo: `Recibo nº ${numeroDoRecibo((itens.find((i) => i.id.startsWith("ag-")) ?? primeiro).id)}`,
    valor: formatBRL(total),
    declaracao: `Recebemos${pagador ? ` de ${pagador}` : ""} a quantia de ${formatBRL(total)} (${valorPorExtenso(total)}), referente ${servicos.length > 1 ? "aos serviços acima" : `a ${servicos[0].servico}`}.`,
    itens: servicos.map((i) => ({ servico: i.servico, profissional: i.profissional, valor: formatBRL(i.valorCents) })),
    pagamentos,
    detalhes: [
      ["Data", datas.map(dataBR).join(", ")],
      ...(estornado ? [["Estornado", `${formatBRL(estornado)} devolvidos ao cliente`]] : []),
    ] as [string, string][],
    emissor: [emissor.nome, emissor.documento, emissor.endereco, local, emissor.telefone].filter((x): x is string => !!x?.trim()),
    rodape: `${local ? `${local}, ` : ""}${dataBR(datas.at(-1)!)}.`,
  };
}

/** O recibo em texto corrido: WhatsApp (com *negrito*) e e-mail. */
export function textoDoRecibo(linhas: ReturnType<typeof linhasDoRecibo>, negrito = false) {
  const b = (s: string) => (negrito ? `*${s}*` : s);
  return [
    b(linhas.titulo),
    linhas.emissor[0],
    "",
    b("Serviços"),
    ...linhas.itens.map((i) => `• ${i.servico}${i.profissional ? ` (${i.profissional})` : ""}: ${i.valor}`),
    "",
    b("Pagamento"),
    ...linhas.pagamentos.map((p) => `• ${p.rotulo}${p.detalhe ? ` (${p.detalhe})` : ""}: ${p.valor}`),
    `Total: ${b(linhas.valor)}`,
    "",
    linhas.declaracao,
    ...linhas.detalhes.map(([k, v]) => `${k}: ${v}`),
    "",
    linhas.emissor.join(" · "),
    "Não é documento fiscal.",
  ].join("\n");
}

/** Os recebimentos que entram no mesmo recibo: as entradas do mesmo cliente no mesmo dia
 *  (os serviços da visita) e o sinal de cada atendimento, que pode ter sido pago noutro dia.
 *  Entrada sem cliente é recibo sozinha. */
export function itensDoRecibo<T extends Item & { tipo: string; customerKey?: string | null; estornoDe?: string }>(escolhido: T, doMes: T[]): T[] {
  const entradas = doMes.filter((l) => l.tipo === "entrada" && !l.estornoDe);
  const doDia = escolhido.customerKey ? entradas.filter((l) => l.customerKey === escolhido.customerKey && l.data === escolhido.data) : [escolhido];
  const base = doDia.some((l) => l.id === escolhido.id) ? doDia : [escolhido];
  const atendimentos = new Set(base.filter((l) => /^(ag|sn)-/.test(l.id)).map(atendimentoDe));
  const juntos = new Map([...base, ...entradas.filter((l) => /^(ag|sn)-/.test(l.id) && atendimentos.has(atendimentoDe(l)))].map((l) => [l.id, l]));
  return [...juntos.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// o mesmo critério do cadastro do cliente: algo@dominio.tld, sem espaço, até 254 caracteres
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
/** A mensagem do campo de e-mail do recibo, ou "" quando dá para enviar. */
export function erroDoEmail(valor: string, quem = "do cliente") {
  const v = valor.trim();
  if (!v) return `Digite o e-mail ${quem}.`;
  if (v.length > 254 || !EMAIL.test(v)) return "E-mail incompleto. Confira, ex.: nome@gmail.com";
  return "";
}

// os erros de digitação que mais aparecem nos e-mails de cliente de salão
const DOMINIOS: Record<string, string> = {
  "gmial.com": "gmail.com", "gmal.com": "gmail.com", "gmai.com": "gmail.com", "gmail.co": "gmail.com", "gmail.con": "gmail.com", "gamil.com": "gmail.com", "gmail.com.br": "gmail.com",
  "hotmal.com": "hotmail.com", "hotmial.com": "hotmail.com", "hotmail.con": "hotmail.com", "hotmai.com": "hotmail.com",
  "outlok.com": "outlook.com", "outlook.con": "outlook.com", "yahoo.con": "yahoo.com", "icloud.con": "icloud.com",
};
/** "ana@gmial.com" → "ana@gmail.com"; nada a sugerir, "". */
export function sugestaoDeEmail(valor: string) {
  const [nome, dominio] = valor.trim().toLowerCase().split("@");
  const certo = dominio && DOMINIOS[dominio];
  return nome && certo ? `${nome}@${certo}` : "";
}
