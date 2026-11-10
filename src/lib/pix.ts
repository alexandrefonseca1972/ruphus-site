// O "copia e cola" do Pix: o BR Code (EMV MPM) que o app do banco lê.
//
// Montado aqui, sem intermediário e sem taxa por transação. O preço disso é que
// ninguém avisa quando o dinheiro cai: o Pix estático não tem confirmação, e a
// baixa é alguém olhando o comprovante.
//
// ponytail: Pix estático, conciliação no olho. Com um PSP, o webhook chama
// baixar() em cobranca.ts e nenhuma tela muda.
import { dateIn, TIMEZONE } from "@/lib/datetime";

export const DIA_VENCIMENTO = 10;

/** CRC16/CCITT-FALSE: é o que o campo 63 do BR Code exige. */
export function crc16(texto: string) {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(texto)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

// id + tamanho em dois dígitos + valor. O tamanho com zero à esquerda é o erro
// clássico: nome de três letras é "5903ABC", nunca "593ABC".
const tlv = (id: string, valor: string) => `${id}${String(valor.length).padStart(2, "0")}${valor}`;

/** Sem acento, maiúsculo e cortado no limite: o decodificador do banco é rígido. */
const texto = (v: string, max: number) =>
  v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 .-]/g, "")
    .trim()
    .slice(0, max);

export type Recebedor = { chave: string; nome: string; cidade: string };

/** Entrada fora do que o BR Code aceita: o QR sairia e o banco recusaria na hora de pagar. */
export class PixInvalido extends Error {}

// campo 54 tem no máximo 13 caracteres ("9999999999.99"); txid: letras e números, até 25
const VALOR_MAX_CENTS = 999_999_999_999;
const TXID = /^[A-Za-z0-9]{1,25}$/;

export function brCode({ chave, nome, cidade, valorCents, txid }: Recebedor & { valorCents: number; txid: string }) {
  const k = chave.trim();
  if (!k || k.length > 77) throw new PixInvalido("Chave Pix inválida.");
  if (!Number.isInteger(valorCents) || valorCents <= 0 || valorCents > VALOR_MAX_CENTS) throw new PixInvalido("Valor do Pix inválido.");
  if (!TXID.test(txid)) throw new PixInvalido("Identificador do Pix inválido.");
  if (!texto(nome, 25) || !texto(cidade, 15)) throw new PixInvalido("Nome ou cidade do recebedor vazios.");
  const payload = [
    tlv("00", "01"),
    tlv("26", tlv("00", "br.gov.bcb.pix") + tlv("01", k)),
    tlv("52", "0000"), // sem categoria de estabelecimento
    tlv("53", "986"), // real
    tlv("54", (valorCents / 100).toFixed(2)), // 59.90, nunca 59.9
    tlv("58", "BR"),
    tlv("59", texto(nome, 25)),
    tlv("60", texto(cidade, 15)),
    tlv("62", tlv("05", txid)),
  ].join("");
  // O CRC cobre o payload inteiro já com "6304" na frente dele
  const comCampo = `${payload}6304`;
  return comCampo + crc16(comCampo).toString(16).toUpperCase().padStart(4, "0");
}

/** Identificador que aparece no extrato: é por ele que se acha o pagamento. */
export function txidDe(slug: string, tipo: "entrada" | "mensal", competencia: string | null, reemissao = 1) {
  const marca = tipo === "entrada" ? "E" : "M";
  const quando = competencia ? competencia.slice(2).replace("-", "") : "";
  // reemitida (a anterior foi cancelada): outro txid, para o extrato não confundir as duas
  const fim = `${marca}${quando}${reemissao > 1 ? `R${reemissao}` : ""}`;
  // quem cede espaço é o slug: marca, mês e reemissão sempre cabem nos 25
  const negocio = slug.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 25 - fim.length);
  return `${negocio}${fim}`;
}

/** O mês da cobrança no fuso do projeto: toISOString viraria o mês às 21h do dia 31. */
export const competenciaAtual = (agora = new Date()) => dateIn(agora, TIMEZONE).slice(0, 7);

export const vencimentoDe = (competencia: string) => `${competencia}-${String(DIA_VENCIMENTO).padStart(2, "0")}`;

/** Identificador livre para a cobrança do salão (no balcão ou sinal): o que o extrato mostra.
 *  3 caracteres aleatórios no fim: duas cobranças no mesmo milissegundo não repetem o txid. */
export const txidLivre = (prefixo: string) =>
  `${prefixo.toUpperCase().replace(/[^A-Z0-9]/g, "")}${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase().padEnd(3, "0")}`.slice(-25);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cpfValido(d: string) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    return ((s * 10) % 11) % 10;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

function cnpjValido(d: string) {
  if (!/^\d{14}$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = pesos.reduce((s, p, i) => s + Number(d[i]) * p, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

/** A chave Pix como o banco espera: e-mail em minúsculas, aleatória como veio,
 *  CPF/CNPJ só dígitos, telefone +55DDNNNNNNNNN. null quando não é chave.
 *  11 dígitos são CPF se os dígitos verificadores batem; senão, celular. */
export function normalizarChave(entrada: string): string | null {
  const v = entrada.trim();
  if (UUID.test(v.toLowerCase())) return v.toLowerCase();
  if (v.includes("@")) return EMAIL.test(v) && v.length <= 77 ? v.toLowerCase() : null;
  if (/[^\d\s.()/+-]/.test(v)) return null;
  const d = v.replace(/\D/g, "");
  // "(11) 98765-4321" é celular mesmo quando os dígitos formam um CPF válido
  const comCaraDeFone = v.startsWith("+") || v.includes("(");
  if (!comCaraDeFone && d.length === 11 && cpfValido(d)) return d;
  if (!v.startsWith("+") && d.length === 14) return cnpjValido(d) ? d : null;
  // "0 11 98888-7777": o zero do DDD (ou da operadora) não faz parte da chave
  const semZero = !v.startsWith("+") && d.startsWith("0") ? d.replace(/^0+/, "") : d;
  const fone = v.startsWith("+") ? d : semZero.length <= 11 ? `55${semZero}` : semZero;
  // chave de telefone no Pix é celular: DDD + 9 dígitos começando com 9
  return /^55[1-9]\d9\d{8}$/.test(fone) ? `+${fone}` : null;
}

/** O BR Code só leva letras sem acento e números: nome só com outros caracteres sairia vazio.
 *  A tela e o servidor usam a mesma regra. */
export const legivel = (v: string, max: number) => texto(v, max).replace(/[^A-Z0-9]/g, "").length >= 2;
export const ERRO_CHAVE = "Chave inválida. Use CPF, CNPJ, e-mail, celular ou a chave aleatória.";
export const ERRO_NOME = "Informe o nome de quem recebe, como está no banco (letras sem símbolos).";
export const ERRO_CIDADE = "Informe a cidade.";

/** Como a tela mostra a chave salva, para o dono conferir o tipo que o sistema entendeu. */
export const tipoDaChave = (chave: string) =>
  chave.includes("@") ? "e-mail" : chave.startsWith("+") ? "celular" : UUID.test(chave) ? "chave aleatória" : chave.length === 11 ? "CPF" : "CNPJ";

/** O que o salão cadastra para receber; o servidor grava em tenants/{slug}.pix. */
export function recebedorDe(entrada: { chave: string; nome: string; cidade: string }): Recebedor | string {
  const chave = normalizarChave(entrada.chave);
  if (!chave) return ERRO_CHAVE;
  // sem caracteres de controle e com espaços colapsados: é o que vai para o QR e para o banco
  const limpo = (v: string) => v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  const nome = limpo(entrada.nome);
  const cidade = limpo(entrada.cidade);
  // o BR Code só leva letras sem acento e números: nome só com outros caracteres sairia vazio
  if (!legivel(nome, 25)) return ERRO_NOME;
  if (!legivel(cidade, 15)) return ERRO_CIDADE;
  return { chave, nome: nome.slice(0, 60), cidade: cidade.slice(0, 40) };
}
