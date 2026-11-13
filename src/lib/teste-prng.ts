// Só para teste: PRNG com semente (mulberry32), para o sorteio de escolherVariante e do produtor ser
// determinístico. A produção usa crypto (randomInt em prospeccao-fila.server.ts).
export function prng(semente: number) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
