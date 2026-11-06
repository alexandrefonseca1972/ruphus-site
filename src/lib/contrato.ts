// Termos de Contratação da Ruphus. O texto sai de docs/contrato-prestacao-servico.md
// para public/termos/{versão}/ (npm run termos). Uma versão publicada não muda: mudou
// o texto, suba CONTRATO_VERSAO e a versão no topo do contrato. O aceite guarda a
// versão que a pessoa leu, e o link aponta para ela para sempre.
export const CONTRATO_VERSAO = "1.1";
export const CONTRATO_URL = `/termos/${CONTRATO_VERSAO}`;
export const CONTRATO_RECUSADO = "Para continuar, aceite os Termos de Contratação.";

/** O resumo das cláusulas essenciais, antes do aceite (Decreto 7.962/2013, art. 4º, I).
 *  Tem de bater com o resumo no topo do contrato. */
export const RESUMO_CONTRATO = [
  "Sem fidelidade: cancele quando quiser, sem multa.",
  "7 dias para desistir, com devolução de tudo o que você pagou.",
  "Taxa de ativação e mensalidade pré-paga (dia 10), nos valores da proposta ou da tabela dos Termos. Reajuste só uma vez por ano, pelo IPCA.",
  "Depois de 10 dias de atraso, o site e o agendamento podem sair do ar. Nada é apagado.",
  "Manutenção incluída dentro dos limites mensais. Edição de imagem e vídeo não está incluída.",
] as const;

/** A confirmação do aceite que vai por e-mail (Decreto 7.962/2013, art. 4º, III):
 *  qual versão, quando, para qual negócio, e o link que guarda aquele texto. */
export function emailDoAceite(a: { slug: string; versao: string; quando: Date; site: string }) {
  const url = `${a.site.replace(/\/+$/, "")}/termos/${a.versao}`;
  const quando = a.quando.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "long", timeStyle: "short" });
  return {
    assunto: `Você aceitou os Termos de Contratação da Ruphus (versão ${a.versao})`,
    texto: [
      "Olá!",
      `Este e-mail confirma que você aceitou os Termos de Contratação da Ruphus, versão ${a.versao}, em ${quando} (horário de Brasília), para o negócio ${a.slug}.ruphus.site.`,
      `O texto que você aceitou fica guardado neste endereço e não muda:\n${url}`,
      `Você pode desistir em até 7 dias corridos, com devolução de tudo o que pagou. Basta responder pelo WhatsApp da Ruphus.`,
      "Ruphus",
    ].join("\n\n"),
  };
}
