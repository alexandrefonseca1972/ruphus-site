/** Roda `fn` em cada item, no máximo `n` de cada vez. Um item que lança não para os outros: o
 *  erro do primeiro sobe só depois que todos terminaram (quem chama não conta envio pela metade). */
export async function emParalelo<T>(itens: readonly T[], n: number, fn: (item: T) => Promise<void>) {
  let proximo = 0;
  const erros: unknown[] = [];
  const trabalhador = async () => {
    while (proximo < itens.length) await fn(itens[proximo++]).catch((e) => erros.push(e));
  };
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, trabalhador));
  if (erros.length) throw erros[0];
}
