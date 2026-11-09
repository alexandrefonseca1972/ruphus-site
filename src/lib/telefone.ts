// Utilidades de telefone brasileiro compartilhadas entre a tela e o servidor:
// o campo do WhatsApp do dono valida na hora (feedback visual) e a ação valida
// de novo com a mesma regra (quem chama sem passar pela tela). Sem "server-only"
// de propósito: a gaveta (cliente) importa deste arquivo.

/** Celular BR na forma canônica, com o 9º dígito — a mesma regra do atendys
 *  (canonicalBrMobile em apps/api/src/utils/phone.ts). Conta antiga aparece no WhatsApp
 *  sem o 9 (55+DDD+8 dígitos); desde 2026-11-08 o atendys manda o telefone sempre com o 9.
 *  Sem canonizar dos dois lados, o self-chat do salão (5591992361726) não batia com o
 *  número gravado da instância (559192361726) e o CONFIRMADO do dono era ignorado.
 *  Fixo (assinante começando em 2-5) não tem par e fica como está. */
export function canonicalBrMobile(digits: string): string {
  return /^55[1-9]\d[6-9]\d{7}$/.test(digits) ? `${digits.slice(0, 4)}9${digits.slice(4)}` : digits;
}

/** O gateway exige DDI+DDD+número (só dígitos). Quem digita costuma pôr só DDD+número.
 *  Sai canonizado: o mesmo celular, com ou sem o 9, vira um só valor (comparações e envio). */
export function soDigitosComDDI(phone: string): string | null {
  const d = phone.replace(/\D/g, "");
  if (/^55\d{10,11}$/.test(d)) return canonicalBrMobile(d); // já veio com DDI
  if (/^\d{10,11}$/.test(d)) return canonicalBrMobile(`55${d}`); // formato local: assume Brasil
  return null;
}

export function telefoneBrValido(phone: string): boolean {
  return soDigitosComDDI(phone) !== null;
}

/** Máscara de digitação: (11) 98877-7777 ou +55 (11) 98877-7777.
 *  O estado continua sendo só dígitos; a máscara é só apresentação. */
export function mascaraTelefoneBR(valor: string): string {
  let d = valor.replace(/\D/g, "").slice(0, 13);
  if (!d) return "";
  let ddi = "";
  // DDI só entra na máscara quando passa de 11 dígitos (DDD+número completo)
  if (d.length > 11 && d.startsWith("55")) {
    ddi = "+55 ";
    d = d.slice(2);
  }
  if (d.length <= 2) return ddi + d;
  const ddd = d.slice(0, 2);
  const num = d.slice(2);
  if (num.length <= 4) return `${ddi}(${ddd}) ${num}`;
  if (num.length <= 8) return `${ddi}(${ddd}) ${num.slice(0, 4)}-${num.slice(4)}`;
  return `${ddi}(${ddd}) ${num.slice(0, 5)}-${num.slice(5)}`;
}
