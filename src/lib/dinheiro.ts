/** Dinheiro digitado à mão, do jeito que o brasileiro escreve.
 *
 * O <input type="number"> parecia resolver e não resolvia: com step={10} o
 * navegador considera 59,90 inválido, e quem digita vírgula ("59,90") faz o
 * campo devolver string vazia — a mensalidade era apagada sem ninguém ver. */

/** "59,90", "59.90" e "1.250,00" querem dizer o que parecem: com vírgula, o
 *  ponto é milhar; sem vírgula, um ponto seguido de 1 ou 2 dígitos no fim é a
 *  casa decimal. Devolve NaN para o que não é número. */
export function cents(v: string) {
  const limpo = v.trim();
  if (!limpo) return NaN;
  const n = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : /\.\d{1,2}$/.test(limpo)
      ? limpo.replace(/\.(?=\d{3})/g, "")
      : limpo.replace(/\./g, "");
  return Math.round(Number(n) * 100);
}

/** 5990 → "59,90". Para preencher o campo, sem o "R$" que já está ao lado. */
export const emReais = (c: number) => (c / 100).toFixed(2).replace(".", ",");
