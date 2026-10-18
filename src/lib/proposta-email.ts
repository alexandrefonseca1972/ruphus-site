import { diaCurto } from "@/lib/crm-tipos";
import { formatBRL } from "@/lib/datetime";

/** Assunto e corpo do e-mail que leva a proposta. Os valores e o prazo são os
 *  mesmos da página: o que chega na caixa de entrada bate com o que o dono abre
 *  no link. Só texto puro, sem HTML, para não cair no lixo eletrônico. */
export function emailDaProposta(p: {
  nome: string;
  donoNome: string | null;
  url: string;
  valeAte: string;
  entradaCents: number;
  mensalCents: number;
  assinatura: string | null;
}) {
  const oi = `Oi${p.donoNome ? `, ${p.donoNome.split(" ")[0]}` : ""}!`;
  const fecho = [p.assinatura, "Ruphus"].filter(Boolean).join("\n");
  return {
    assunto: `Proposta da Ruphus para ${p.nome}`,
    texto: [
      oi,
      `Montei a proposta do ${p.nome} numa página só, com o que está incluído e os valores:`,
      `Entrada de ${formatBRL(p.entradaCents)} para publicar e ${formatBRL(p.mensalCents)} por mês, sem taxa por agendamento.`,
      `Proposta completa: ${p.url}`,
      `Ela vale até ${diaCurto(p.valeAte)}. Qualquer dúvida, é só responder este e-mail.`,
      fecho,
    ].join("\n\n"),
  };
}
