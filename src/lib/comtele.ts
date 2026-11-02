// SMS pela Comtele (painel antigo, API v2: https://docs.comtele.com.br/). Funções puras: o número e o
// texto no formato que a operadora cobra menos. O envio mora em comtele.server.ts.

/** O número como a Comtele pede (DDD + número, sem o 55), só para celular: fixo não recebe SMS.
 *  "5511912345678", "(11) 91234-5678" → "11912345678"; fixo ou inválido → null. */
export function numeroSms(telefone: string): string | null {
  let d = String(telefone ?? "").replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) d = d.slice(2);
  return /^[1-9][1-9]9\d{8}$/.test(d) ? d : null;
}

/** O texto num SMS só (até 160 caracteres e sem acento): com acento ou símbolo fora do alfabeto do
 *  SMS, a operadora cobra a cada 70 caracteres, e a conta é da Ruphus. */
export function textoSms(texto: string) {
  const simples = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E\n]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return simples.length <= 160 ? simples : `${simples.slice(0, 157).trimEnd()}...`;
}
