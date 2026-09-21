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
