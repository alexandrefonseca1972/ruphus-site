// Texto vindo de fora (Maps, mensagem de lead, saída de IA) antes de gravar, mostrar ou mandar à IA.
// Sem "server-only": a tela usa a mesma regra.

/** NFC; sem controle nem largura zero (salvo ZWNJ/ZWJ); espaços colapsados; no máximo `max` caracteres (por ponto de código).
 *  `linhas`: as quebras de linha ficam (\r\n vira \n); o resto do controle vira espaço, como sempre. */
export function textoSeguro(s: string, max: number, linhas = false): string {
  const sujo = s
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u200B\u2060\uFEFF\u00AD]/g, "") // largura zero e hífen invisível somem
    // controle (\n, \t, \0...) e formatação (bidi) viram espaço; ZWNJ e ZWJ ficam: compõem emoji (👩‍🔧) e escrita
    .replace(linhas ? /(?![\u200C\u200D\n])[\p{Cc}\p{Cf}]/gu : /(?![\u200C\u200D])[\p{Cc}\p{Cf}]/gu, " ");
  const limpo = (linhas ? sujo.replace(/[^\S\n]+/g, " ").replace(/ ?\n ?/g, "\n") : sujo.replace(/\s+/g, " ")).trim();
  // Array.from conta por ponto de código: o corte não parte um emoji ao meio
  return Array.from(limpo).slice(0, max).join("").trimEnd();
}

/** Texto de fora dentro de um bloco delimitado da IA (<mensagem_do_lead>…): NFKC antes (o "＜" e o
 *  "＞" de largura total viram "<" e ">") e depois "<" e ">" trocados por "‹" e "›": quem escreve
 *  "</mensagem_do_lead>" não fecha o bloco. */
export const blocoDeDado = (s: string, max: number) => textoSeguro(s.normalize("NFKC"), max).replace(/</g, "‹").replace(/>/g, "›");

/** Para log (L-1): toda sequência de 6 ou mais dígitos (telefone, documento) vira "…" e os 4 últimos. */
export const mascararDigitos = (s: string) => s.replace(/\d{6,}/g, (m) => `…${m.slice(-4)}`);
