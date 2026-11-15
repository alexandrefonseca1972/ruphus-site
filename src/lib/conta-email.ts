import { montarEmail, primeiroNome } from "@/lib/email-layout";

/** Confirmação do e-mail de quem criou conta (ou pediu de novo). Substitui o modelo padrão do
 *  Firebase: a mesma identidade dos outros e-mails, e o link em ruphus.site, não em firebaseapp.com
 *  (link de outro domínio que o remetente leva a mensagem para o spam). */
export function emailDeConfirmacao(c: { nome?: string | null; email: string; url: string }) {
  const nome = primeiroNome(c.nome);
  return montarEmail({
    assunto: "Confirme seu e-mail na Ruphus",
    faixa: "Confirmação de e-mail",
    titulo: "Confirme seu e-mail",
    subtitulo: "Falta um toque para cadastrar o seu negócio.",
    previa: "Toque em Confirmar e-mail e volte para a Ruphus.",
    blocos: [
      { p: `${nome ? `Oi, ${nome}!` : "Oi!"} Recebemos o cadastro de ${c.email} na Ruphus. Toque no botão abaixo para confirmar que este e-mail é seu.` },
      { passos: ["Confirme o e-mail pelo botão.", "Cadastre o seu negócio: nome, ramo e WhatsApp.", "Ajuste serviços e horários e divulgue o link."], titulo: "Seus próximos passos" },
      { p: "Se a tela da Ruphus estiver aberta, ela continua sozinha assim que você confirmar." },
    ],
    acao: { texto: "Confirmar e-mail", url: c.url },
    motivo: "Você recebeu este e-mail porque alguém criou uma conta na Ruphus com este endereço. Se não foi você, é só ignorar.",
  });
}
