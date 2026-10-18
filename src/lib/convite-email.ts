/** Assunto e corpo do e-mail com o convite de acesso ao painel. O link abre só com
 *  o e-mail do dono (é o que o token guarda) e serve uma vez: por isso o texto pede
 *  para não repassar. Texto puro, como o da proposta, para não cair no spam. */
export function emailDoConvite(c: {
  nome: string;
  slug: string;
  donoNome: string | null;
  url: string;
  email: string;
  dias: number;
  assinatura: string | null;
}) {
  const oi = `Oi${c.donoNome ? `, ${c.donoNome.split(" ")[0]}` : ""}!`;
  const fecho = [c.assinatura, "Ruphus"].filter(Boolean).join("\n");
  return {
    assunto: `Acesso ao painel do ${c.nome}`,
    texto: [
      oi,
      `Aqui é da Ruphus. O site do ${c.nome} já está no ar em https://${c.slug}.ruphus.site, e a agenda online também.`,
      `Este link dá acesso ao painel para você cadastrar serviços, equipe e horários:\n${c.url}`,
      `O acesso abre com o e-mail ${c.email}: é só entrar ou criar a conta com ele. O link vale ${c.dias} dias e serve uma vez só, então não repasse.`,
      fecho,
    ].join("\n\n"),
  };
}
