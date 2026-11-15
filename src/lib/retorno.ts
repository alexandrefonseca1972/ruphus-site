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
