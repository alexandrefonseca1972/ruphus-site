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

export function brCode({ chave, nome, cidade, valorCents, txid }: Recebedor & { valorCents: number; txid: string }) {
  const payload = [
    tlv("00", "01"),
    tlv("26", tlv("00", "br.gov.bcb.pix") + tlv("01", chave.trim())),
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
export function txidDe(slug: string, tipo: "entrada" | "mensal", competencia: string | null) {
  const marca = tipo === "entrada" ? "E" : "M";
  const quando = competencia ? competencia.slice(2).replace("-", "") : "";
  const negocio = slug.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `${negocio}${marca}${quando}`.slice(0, 25);
}

/** O mês da cobrança no fuso do projeto: toISOString viraria o mês às 21h do dia 31. */
export const competenciaAtual = (agora = new Date()) => dateIn(agora, TIMEZONE).slice(0, 7);

export const vencimentoDe = (competencia: string) => `${competencia}-${String(DIA_VENCIMENTO).padStart(2, "0")}`;

/** Identificador livre para a cobrança do salão (no balcão ou sinal): o que o extrato mostra. */
export const txidLivre = (prefixo: string) =>
  `${prefixo.toUpperCase().replace(/[^A-Z0-9]/g, "")}${Date.now().toString(36).toUpperCase()}`.slice(-25);

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

/** A chave Pix como o banco espera: e-mail em minúsculas, aleatória como veio,
 *  CPF/CNPJ só dígitos, telefone +55DDNNNNNNNNN. null quando não é chave.
 *  11 dígitos são CPF se os dígitos verificadores batem; senão, celular. */
export function normalizarChave(entrada: string): string | null {
  const v = entrada.trim();
  if (UUID.test(v.toLowerCase())) return v.toLowerCase();
  if (v.includes("@")) return EMAIL.test(v) && v.length <= 77 ? v.toLowerCase() : null;
  if (/[^\d\s.()/+-]/.test(v)) return null;
  const d = v.replace(/\D/g, "");
  if (!v.startsWith("+") && d.length === 11 && cpfValido(d)) return d;
  if (!v.startsWith("+") && d.length === 14) return d;
  const fone = v.startsWith("+") ? d : d.length <= 11 ? `55${d}` : d;
  return /^55\d{10,11}$/.test(fone) ? `+${fone}` : null;
}

/** O que o salão cadastra para receber; o servidor grava em tenants/{slug}.pix. */
export function recebedorDe(entrada: { chave: string; nome: string; cidade: string }): Recebedor | string {
  const chave = normalizarChave(entrada.chave);
  if (!chave) return "Chave Pix inválida. Use CPF, CNPJ, e-mail, celular ou a chave aleatória.";
  const nome = entrada.nome.trim();
  const cidade = entrada.cidade.trim();
  if (nome.length < 2) return "Informe o nome de quem recebe, como está no banco.";
  if (cidade.length < 2) return "Informe a cidade.";
  return { chave, nome: nome.slice(0, 60), cidade: cidade.slice(0, 40) };
}
