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

/** Abre link externo; se o navegador (ou webview do Instagram/Facebook) bloquear, navega na própria aba. */
export function openExternal(url: string) {
  const win = window.open(url, "_blank", "noopener");
  if (!win) location.href = url;
}
