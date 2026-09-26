// Nome de pessoa, como o cadastro, a agenda e o servidor o aceitam: um só lugar para os
// três não divergirem. Letras (com acento), espaço, apóstrofo, hífen e ponto.

/** O que o campo aceita enquanto a pessoa digita: tira número e símbolo, sem espaço duplo. */
export const mascaraNome = (v: string) => v.replace(/[^\p{L}\s'.-]/gu, "").replace(/\s+/g, " ").replace(/^\s/, "").slice(0, 80);

/** A mensagem de erro do nome, ou "" se está certo. */
export function erroNome(v: string) {
  const t = v.trim();
  if (!t) return "Informe seu nome";
  if (/[^\p{L}\s'.-]/u.test(t)) return "Use só letras no nome";
  if ((t.match(/\p{L}/gu) ?? []).length < 2) return "Informe seu nome, com pelo menos 2 letras";
  return "";
}
