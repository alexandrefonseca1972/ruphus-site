import { formatLongDate, formatTime } from "@/lib/datetime";

// Textos que vão ao cliente e à equipe. Um lugar só: o servidor monta a mensagem que sai pelo
// WhatsApp do negócio e o painel monta a mesma para o wa.me, sem as duas cópias divergirem.

export type AvisoCliente = "confirmado" | "cancelado" | "remarcado";

type Horario = { customerName: string; serviceName: string; staffName: string; start: Date };

const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0];

export function textoAvisoCliente(tipo: AvisoCliente, a: Horario, negocio: string, urlAgendar: string) {
  const quando = `${formatLongDate(a.start)} às ${formatTime(a.start)}`;
  const oi = `Olá, ${primeiroNome(a.customerName)}!`;
  if (tipo === "confirmado") return `${oi} Seu horário na ${negocio} está confirmado: ${a.serviceName} com ${a.staffName}, ${quando}. Até lá!`;
  if (tipo === "cancelado") return `${oi} Seu horário na ${negocio} de ${quando} (${a.serviceName} com ${a.staffName}) foi cancelado. Para marcar outro horário: ${urlAgendar}`;
  return `${oi} Seu horário na ${negocio} foi remarcado para ${quando} (${a.serviceName} com ${a.staffName}). Se não puder, é só responder esta mensagem.`;
}

export function textoConvite(c: { nome: string; negocio: string; url: string; email: string; dias: number }) {
  const primeiro = primeiroNome(c.nome);
  return `Oi${primeiro ? `, ${primeiro}` : ""}! Este link libera seu acesso à agenda do ${c.negocio} na Ruphus:\n\n${c.url}\n\nEntre ou crie a conta com este e-mail (${c.email}). O link vale ${c.dias} dias e só funciona uma vez.`;
}
