// Seleção de cidades da coleta: marcar todas, desmarcar e sortear, sempre dentro do limite do
// pedido (LIMITES.cidades). Valem para as cidades visíveis: com a busca preenchida, só as
// que aparecem na lista. Código puro: a tela e os testes usam.

/** Marca as visíveis que faltam, na ordem da lista, até o limite. cortadas: as que não couberam. */
export function marcarTodas(escolhidas: string[], visiveis: string[], limite: number) {
  const faltam = visiveis.filter((c) => !escolhidas.includes(c));
  const cabem = Math.max(0, limite - escolhidas.length);
  return { lista: [...escolhidas, ...faltam.slice(0, cabem)], cortadas: Math.max(0, faltam.length - cabem) };
}

/** Desmarca as visíveis (todas, sem busca); as marcadas fora da busca ficam. */
export const desmarcar = (escolhidas: string[], visiveis: string[]) => escolhidas.filter((c) => !visiveis.includes(c));

/** Sorteia n entre as visíveis ainda não marcadas, sem passar do limite (Fisher–Yates parcial). */
export function sortear(escolhidas: string[], visiveis: string[], n: number, limite: number, aleatorio: () => number = Math.random) {
  const pool = visiveis.filter((c) => !escolhidas.includes(c));
  const quantas = Math.max(0, Math.min(Math.floor(n), pool.length, limite - escolhidas.length));
  for (let i = 0; i < quantas; i++) {
    const j = i + Math.floor(aleatorio() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return [...escolhidas, ...pool.slice(0, quantas)];
}
