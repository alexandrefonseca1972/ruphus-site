import { montarEmail, primeiroNome } from "@/lib/email-layout";
// Termos de Contratação da Ruphus. O texto sai de docs/contrato-prestacao-servico.md
// para public/termos/{versão}/ (npm run termos). Uma versão publicada não muda: mudou
// o texto, suba CONTRATO_VERSAO e a versão no topo do contrato. O aceite guarda a
// versão que a pessoa leu, e o link aponta para ela para sempre.
export const CONTRATO_VERSAO = "1.3";
export const CONTRATO_URL = `/termos/${CONTRATO_VERSAO}`;
export const CONTRATO_RECUSADO = "Para continuar, aceite os Termos de Contratação.";

/** O resumo das cláusulas essenciais, antes do aceite (Decreto 7.962/2013, art. 4º, I).
 *  Tem de bater com o resumo no topo do contrato. */
export const RESUMO_CONTRATO = [
  "Sem fidelidade: cancele quando quiser, sem multa.",
  "7 dias para desistir, com devolução de tudo o que você pagou.",
  "Publicação do site, paga uma vez, e mensalidade pré-paga (dia 10), nos valores da proposta ou da tabela dos Termos. Reajuste só uma vez por ano, pelo IPCA.",
  "Mensagens por WhatsApp e SMS saem de um saldo pré-pago do negócio. Sem saldo, os envios aos seus clientes param até a recarga; o agendamento continua. Saldo não usado não é devolvido no cancelamento.",
  "Caixa e comissões incluídos, sem adicional na mensalidade.",
  "Depois de 10 dias de atraso, o site e o agendamento podem sair do ar. Nada é apagado.",
  "Manutenção incluída dentro dos limites mensais. Edição de imagem e vídeo não está incluída.",
] as const;

/** A confirmação do aceite que vai por e-mail (Decreto 7.962/2013, art. 4º, III):
 *  qual versão, quando, para qual negócio, e o link que guarda aquele texto. */
export function emailDoAceite(a: { slug: string; versao: string; quando: Date; site: string; negocio?: string; dono?: string }) {
  const url = `${a.site.replace(/\/+$/, "")}/termos/${a.versao}`;
  const quando = a.quando.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "long", timeStyle: "short" });
  const endereco = `${a.slug}.ruphus.site`;
  const negocio = a.negocio?.trim() || endereco;
  return montarEmail({
    assunto: `Você aceitou os Termos de Contratação da Ruphus (versão ${a.versao})`,
    faixa: "Comprovante de aceite",
    titulo: "Termos de Contratação aceitos",
    subtitulo: `Guarde este e-mail: ele confirma o aceite para ${negocio}.`,
    previa: `Versão ${a.versao}, aceita em ${quando}.`,
    blocos: [
      ...(primeiroNome(a.dono) ? [{ p: `Oi, ${primeiroNome(a.dono)}! Seu negócio está na Ruphus. Abaixo ficam os dados do aceite e o resumo do que vale entre nós.` }] : []),
      { dados: [["Negócio", negocio === endereco ? endereco : `${negocio}\n${endereco}`], ["Versão", a.versao], ["Aceito em", `${quando} (horário de Brasília)`]] },
      { lista: [...RESUMO_CONTRATO], titulo: "O que você aceitou, em resumo" },
      { p: "O texto completo que você aceitou fica guardado no endereço do botão e não muda. Você pode desistir em até 7 dias corridos, com devolução de tudo o que pagou: é só falar com a Ruphus pelo WhatsApp." },
    ],
    acao: { texto: "Ler os Termos aceitos", url },
    motivo: "Você recebeu este e-mail porque aceitou os Termos de Contratação da Ruphus.",
  });
}
