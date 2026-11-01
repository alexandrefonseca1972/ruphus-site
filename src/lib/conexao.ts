// Conexão do painel com o servidor: cair a internet, o app reiniciar num deploy ou uma
// versão nova ir ao ar não pode deixar a tela parada ou chamando o que não existe mais.
// Código puro: o monitor (components/monitor-conexao.tsx) e as telas usam; os testes também.

/** Evento que o monitor dispara quando a conexão volta: as telas recarregam os dados na hora. */
export const RECONECTOU = "ruphus:reconectou";

/** Espera até a próxima tentativa: 5 s, 10 s, 20 s, 40 s… até 60 s. */
export const esperaDe = (falhas: number) => Math.min(60_000, 5_000 * 2 ** Math.max(0, falhas - 1));

/** A aba é de uma versão anterior: a ação que ela chama não existe mais no servidor. */
export function ehVersaoAntiga(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /server action/i.test(msg) && /not found|failed to find|older or newer deployment/i.test(msg);
}

/** Versão nova no ar: o commit do servidor é outro que o da página (em dev os dois são "local"). */
export const versaoMudou = (daPagina: string, doServidor: string | null | undefined) =>
  !!doServidor && daPagina !== "local" && doServidor !== "local" && doServidor !== daPagina;

// recarregar por versão nova no máximo uma vez por minuto: se o servidor oscilar, não entra em laço
const CHAVE = "ruphus:recarregou-em";
export function recarregarUmaVez(agora = Date.now(), armazem: Pick<Storage, "getItem" | "setItem"> | null = typeof sessionStorage === "undefined" ? null : sessionStorage) {
  try {
    if (agora - Number(armazem?.getItem(CHAVE) ?? 0) < 60_000) return false;
    armazem?.setItem(CHAVE, String(agora));
  } catch {
    // sessionStorage bloqueado: recarrega assim mesmo
  }
  if (typeof location !== "undefined") location.reload();
  return true;
}
