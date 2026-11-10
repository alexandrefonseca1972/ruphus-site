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

/** Telefone que o levantamento inventou: o número todo com um dígito só (99999-9999),
 *  quatro pares (98811-2233, o padrão da planilha falsa da Paraíba) ou uma escada
 *  (91234-5678). Site com ele mandaria o WhatsApp do "negócio" para um estranho. */
export const telefoneFalso = (telefone: string) => {
  const n = telefone.slice(-8);
  return /^(\d)\1{7}$/.test(n) || /^(\d)\1(\d)\2(\d)\3(\d)\4$/.test(n) || "0123456789".includes(n) || "9876543210".includes(n);
};

/** DDDs em uso no Brasil (Anatel). */
const DDDS = new Set(
  "11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99".split(" "),
);
const EXEMPLO = "Informe um celular com DDD, ex.: (91) 99999-0000";

/** WhatsApp pessoal do dono (recebe os pedidos de agendamento): só celular brasileiro, com DDD
 *  válido. Aceita 11 dígitos (DDD + 9 + 8), 13 (55 na frente) e a forma antiga sem o 9 (55 + DDD + 8
 *  dígitos de celular), que sai canonizada. Recusa fixo, número inventado e o fixo do negócio com um
 *  9 na frente (`foneDoNegocio`: o site.phone). Devolve o canônico de 13 dígitos ou a mensagem. */
export function celularDoDono(valor: string, foneDoNegocio?: string | null): { numero: string } | { erro: string } {
  const numero = soDigitosComDDI(valor);
  if (!numero) return { erro: EXEMPLO };
  if (!DDDS.has(numero.slice(2, 4))) return { erro: `DDD inválido. ${EXEMPLO}` };
  if (numero.length !== 13 || numero[4] !== "9") return { erro: `Esse é um telefone fixo, que não recebe WhatsApp. ${EXEMPLO}` };
  if (telefoneFalso(numero)) return { erro: "Esse número parece inventado. Confira e informe o seu celular." };
  const negocio = foneDoNegocio ? soDigitosComDDI(foneDoNegocio) : null;
  if (negocio?.length === 12 && numero === `${negocio.slice(0, 4)}9${negocio.slice(4)}`) {
    return { erro: "Esse é o telefone fixo do negócio, que não recebe WhatsApp. Informe o seu celular." };
  }
  return { numero };
}
