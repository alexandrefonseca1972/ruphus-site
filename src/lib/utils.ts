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
