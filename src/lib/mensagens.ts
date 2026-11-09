import { formatBRL, formatLongDate, formatTime } from "@/lib/datetime";

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

/** O Pix copia e cola para o cliente, pelo WhatsApp (do negócio ou do aparelho). */
export function textoPix(c: { valorCents: number; nome: string; codigo: string; mensagem?: string }) {
  return `${c.mensagem ?? `Pix de ${formatBRL(c.valorCents)} para ${c.nome}`}. Copie o código abaixo e cole no app do banco, em "Pix copia e cola":\n\n${c.codigo}`;
}

export function textoConvite(c: { nome: string; negocio: string; url: string; email: string; dias: number }) {
  const primeiro = primeiroNome(c.nome);
  return `Oi${primeiro ? `, ${primeiro}` : ""}! Este link libera seu acesso à agenda do ${c.negocio} na Ruphus:\n\n${c.url}\n\nEntre ou crie a conta com este e-mail (${c.email}). O link vale ${c.dias} dias e só funciona uma vez.`;
}

/** Confirmação do vale ao profissional: vai sempre por e-mail, é o registro dele do que recebeu. */
export function textoVale(c: { nome: string; negocio: string; valorCents: number; forma: string; data: string }) {
  const primeiro = primeiroNome(c.nome);
  const dia = c.data.split("-").reverse().join("/");
  return `Oi${primeiro ? `, ${primeiro}` : ""}! ${c.negocio} registrou um vale de ${formatBRL(c.valorCents)} pago a você em ${dia} (${c.forma}).\n\nO valor é um adiantamento da sua comissão e será descontado do próximo pagamento.\n\nSe não recebeu este valor, fale com ${c.negocio}.`;
}
