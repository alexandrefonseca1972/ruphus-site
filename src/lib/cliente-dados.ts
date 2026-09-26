import { z } from "zod";

// Data de nascimento e e-mail do cliente, que o dono registra na ficha. A tela e o
// servidor usam as mesmas regras: o que a tela avisa é o que o servidor recusa.

/** DD/MM/AAAA enquanto a pessoa digita: só dígitos, com as barras no lugar. */
export function mascaraData(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 8);
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
  if (a < 1900) return "Confira o ano";
  if (iso > hoje.toISOString().slice(0, 10)) return "A data não pode ser no futuro";
  return "";
}

/** Idade completa na data de hoje. */
export function idade(iso: string, hoje = new Date()) {
  const [a, m, d] = iso.split("-").map(Number);
  const [ha, hm, hd] = [hoje.getFullYear(), hoje.getMonth() + 1, hoje.getDate()];
  return ha - a - (hm < m || (hm === m && hd < d) ? 1 : 0);
}

/** E-mail enquanto a pessoa digita: sem espaço e em minúsculas. */
export const mascaraEmail = (v: string) => v.replace(/\s/g, "").toLowerCase().slice(0, 254);

const Email = z.email();
/** O erro do e-mail, ou "" se está certo. Vazio é permitido. */
export const erroEmail = (v: string) => (!v || Email.safeParse(v).success ? "" : "E-mail incompleto: confira o @ e o domínio");

/** O que o servidor aceita: a data em ISO (ou vazia) e o e-mail limpo (ou vazio). */
export const DadosCliente = z.object({
  nascimento: z
    .string()
    .trim()
    .refine((v) => !v || !erroNascimento(brDeIso(v) || "x"), "Data de nascimento inválida"),
  email: z
    .string()
    .transform(mascaraEmail)
    .refine((v) => !erroEmail(v), "E-mail inválido"),
});
export type DadosCliente = z.infer<typeof DadosCliente>;
