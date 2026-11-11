export function destinoInterno(valor: string | null | undefined, origem: string) {
  if (!valor) return "";
  try {
    const base = new URL(origem);
    const destino = new URL(valor, base);
    if (destino.origin !== base.origin) return "";
    return destino.pathname + destino.search + destino.hash;
  } catch {
    return "";
  }
}

export function urlDeVerificacao(origem: string, destino: string | null | undefined) {
  const interno = destinoInterno(destino, origem);
  return interno ? new URL(interno, origem).toString() : undefined;
}
