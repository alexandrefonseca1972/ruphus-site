import { ErroPrevisto } from "@/lib/erro-previsto";
import { SLUG_SITE } from "@/lib/site-arquivo";

// Ajudantes das ações do admin (actions.ts, modelos-actions.ts). Ficam fora delas porque
// arquivo "use server" só exporta função assíncrona.

/** O slug vem do navegador e vira caminho no banco: "a/b/c" escreveria em outra coleção */
export function slugValido(slug: string) {
  if (!SLUG_SITE.test(slug)) throw new ErroPrevisto("Negócio inválido.");
}

/** O HTML do site com <base> no domínio dele, para as fotos carregarem dentro do admin. */
export function comBase(html: string, slug: string) {
  const r = html.replace("<head>", `<head><base href="https://${slug}.ruphus.site/">`);
  if (r === html) throw new Error("Modelo sem <head>: não dá para montar a pré-visualização.");
  return r;
}
