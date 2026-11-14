import { z } from "zod";
import { dateIn, formatPhone, phoneError } from "@/lib/datetime";
import { cpfValido } from "@/lib/pix";
import { soDigitosComDDI, telefoneFalso } from "@/lib/telefone";

// Nascimento, e-mail, CPF, outro telefone e cuidados do cliente, que o dono registra na ficha. A tela e o
// servidor usam as mesmas regras: o que a tela avisa é o que o servidor recusa.

/** DD/MM/AAAA enquanto a pessoa digita: só dígitos, com as barras no lugar. */
export function mascaraData(v: string) {
  // colou a data em ISO (AAAA-MM-DD): vira DD/MM/AAAA em vez de embaralhar os dígitos
  const colado = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(v);
  const digitos = colado ? `${colado[3]}${colado[2]}${colado[1]}` : v.replace(/\D/g, "");
  // Dígito a dígito: o que não cabe na posição é descartado sozinho, sem levar o resto
  // (apagar o dia de 12/05/1990 não pode zerar o mês e o ano). Dia 4-9 e mês 2-9 no
  // primeiro dígito ganham o zero na frente.
  let d = "";
  for (const c of digitos) {
    if (d.length >= 8) break;
    const n = Number(c);
    if (d.length === 0) d += n > 3 ? `0${c}` : c;
    else if (d.length === 1) d += (d === "3" && n > 1) || (d === "0" && n === 0) ? "" : c;
    else if (d.length === 2) d += n > 1 ? `0${c}` : c;
    else if (d.length === 3) d += (d[2] === "1" && n > 2) || (d[2] === "0" && n === 0) ? "" : c;
    else d += c;
  }
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join("/");
}

/** "31/12/1990" → "1990-12-31"; o contrário para mostrar o que está gravado. */
export const isoDeBR = (v: string) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
};
export const brDeIso = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split("-").reverse().join("/") : "");

/** O erro da data digitada (DD/MM/AAAA), ou "" se está certa. Vazio é permitido. */
export function erroNascimento(v: string, hoje = new Date()) {
  if (!v) return "";
  if (v.length < 10) return "Complete a data: DD/MM/AAAA";
  const iso = isoDeBR(v);
  const [a, m, d] = iso.split("-").map(Number);
  const data = new Date(Date.UTC(a, m - 1, d));
  // 31/02 vira 03/03 no Date: se o dia ou o mês mudou, a data não existe
  if (!iso || data.getUTCMonth() !== m - 1 || data.getUTCDate() !== d) return "Essa data não existe";
  if (a < 1900 || Number(dateIn(hoje).slice(0, 4)) - a > 120) return "Confira o ano";
  // no fuso do negócio: em UTC, depois das 21h a data de amanhã passava
  if (iso > dateIn(hoje)) return "A data não pode ser no futuro";
  return "";
}

/** Idade completa na data de hoje. */
export function idade(iso: string, hoje = new Date()) {
  const [a, m, d] = iso.split("-").map(Number);
  const [ha, hm, hd] = dateIn(hoje).split("-").map(Number);
  return ha - a - (hm < m || (hm === m && hd < d) ? 1 : 0);
}

/** E-mail enquanto a pessoa digita: sem espaço e em minúsculas. */
export const mascaraEmail = (v: string) => v.replace(/\s/g, "").toLowerCase().slice(0, 254);

const Email = z.email();
/** O erro do e-mail, ou "" se está certo. Vazio é permitido. */
export const erroEmail = (v: string) =>
  !v ? "" : v.length > 254 || !Email.safeParse(v).success ? "E-mail incompleto: confira o @ e o domínio" : "";

/** CPF enquanto a pessoa digita: 000.000.000-00. O que se grava são só os dígitos. */
export function mascaraCpf(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
}
/** O erro do CPF (com ou sem máscara), ou "" se está certo. Vazio é permitido. */
export function erroCpf(v: string) {
  const d = v.replace(/\D/g, "");
  if (!d) return "";
  if (d.length < 11) return "Complete o CPF: 11 dígitos";
  return cpfValido(d) ? "" : "CPF inválido: confira os números";
}

/** Outro telefone enquanto a pessoa digita: (11) 98877-6655 ou (11) 3333-4444, nunca mais de 11 dígitos. */
export const mascaraTelefoneContato = (v: string) => formatPhone(v);

/** O erro do outro telefone (celular ou fixo), ou "" se está certo. Vazio é permitido.
 *  `principal` é o telefone do cadastro: repetir o mesmo número não acrescenta nada. */
export function erroTelefoneContato(v: string, principal = "") {
  const d = v.replace(/\D/g, "");
  if (!d) return "";
  if (d.length < 10) return "Complete com DDD: (11) 98877-6655";
  const erro = phoneError(d);
  if (erro) return erro;
  const numero = soDigitosComDDI(d);
  if (!numero) return "Telefone inválido";
  if (d.length === 10 && /^[6-9]/.test(d.slice(2))) return "Celular tem 9 depois do DDD: (11) 98877-6655";
  if (telefoneFalso(numero)) return "Esse número parece inventado. Confira";
  if (principal && soDigitosComDDI(principal) === numero) return "É o mesmo telefone do cadastro";
  return "";
}

/** Celular (recebe WhatsApp) ou fixo: 11 dígitos depois do 55, ou 10 com 6-9 depois do DDD. */
export function ehCelular(telefone: string) {
  const d = telefone.replace(/\D/g, "");
  const local = d.length > 11 && d.startsWith("55") ? d.slice(2) : d;
  return local.length === 11 || (local.length === 10 && /^[6-9]/.test(local.slice(2)));
}

/** Contato que a ficha do cliente manda para a página de agendamento (?nome=…&fone=…).
 *  Vem da URL, que qualquer um monta: só nome curto e telefone de 10 a 13 dígitos; senão null. */
export function contatoDaUrl(q: Record<string, string | string[] | undefined>) {
  const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const nome = limparTexto(um(q.nome) ?? "").replace(/\s+/g, " ").slice(0, 80).trim();
  const fone = (um(q.fone) ?? "").replace(/\D/g, "");
  return nome && /^\d{10,13}$/.test(fone) ? { nome, fone } : null;
}

/** Domínios que mais se erra ao digitar: "gmial.com" vira a sugestão "gmail.com". */
const DOMINIOS: Record<string, string> = {
  "gmial.com": "gmail.com", "gamil.com": "gmail.com", "gmai.com": "gmail.com", "gmail.co": "gmail.com", "gmail.com.br": "gmail.com", "gmal.com": "gmail.com", "gnail.com": "gmail.com",
  "hotmal.com": "hotmail.com", "hotmai.com": "hotmail.com", "hotmial.com": "hotmail.com", "hotmail.co": "hotmail.com", "homail.com": "hotmail.com",
  "outlok.com": "outlook.com", "outloo.com": "outlook.com", "yaho.com": "yahoo.com", "yahoo.co": "yahoo.com", "icloud.co": "icloud.com", "iclod.com": "icloud.com",
};
/** O e-mail corrigido quando o domínio parece um erro de digitação, ou "". */
export function sugestaoEmail(v: string) {
  const [nome, dominio] = v.split("@");
  const certo = dominio && DOMINIOS[dominio];
  return nome && certo ? `${nome}@${certo}` : "";
}

/** Texto livre limpo: sem caracteres de controle nem espaço sobrando, no máximo uma linha em branco seguida. */
export const limparTexto = (v: string) =>
  v
    .normalize("NFC")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export const MAX_CUIDADOS = 300;

/** O que o servidor aceita: a data em ISO, o e-mail limpo, CPF e telefone só com dígitos
 *  (telefone com DDI) e os cuidados aparados. Tudo pode vir vazio; o que falta vira "". */
export const DadosCliente = z.object({
  nascimento: z
    .string()
    .trim()
    .refine((v) => !v || !erroNascimento(brDeIso(v) || "x"), "Data de nascimento inválida"),
  email: z
    .string()
    .transform(mascaraEmail)
    .refine((v) => !erroEmail(v), "E-mail inválido"),
  cpf: z
    .string()
    .default("")
    .refine((v) => !erroCpf(v), "CPF inválido")
    .transform((v) => v.replace(/\D/g, "")),
  telefoneContato: z
    .string()
    .default("")
    .refine((v) => !erroTelefoneContato(v), "Telefone inválido")
    .transform((v) => soDigitosComDDI(v) ?? ""),
  cuidados: z.string().default("").transform(limparTexto).refine((v) => v.length <= MAX_CUIDADOS, "Cuidados: no máximo 300 letras"),
});
export type DadosCliente = z.infer<typeof DadosCliente>;
