export { cn } from "cn"

/**
 * onSubmit que mantém os campos quando dá erro (o `action` de <form> do React limpa o formulário
 * a cada envio). Para limpar depois de salvar, chame form.reset().
 */
export const handleSubmit =
  (fn: (data: FormData, form: HTMLFormElement) => unknown) => (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    fn(new FormData(e.currentTarget), e.currentTarget);
  };

/**
 * Abre link externo em nova aba. Devolve false quando o navegador bloqueia
 * (webview do Instagram/Facebook), para quem chamou decidir quando navegar na própria aba.
 * Obs.: com "noopener" na lista de features, window.open devolve null mesmo quando abre.
 */
export function openExternal(url: string) {
  const win = window.open(url, "_blank");
  if (!win) return false;
  try {
    win.opener = null;
  } catch {
    // Já navegou para outro domínio: opener vira somente leitura
  }
  return true;
}
