import "server-only";
import nodemailer from "nodemailer";
import { ErroPrevisto } from "@/lib/erro-previsto";

// E-mail sai da conta da Ruphus no Gmail, por SMTP com senha de app. A senha
// fica só no ambiente do servidor: nada disso chega ao navegador. Sem as
// variáveis, o envio recusa com mensagem clara em vez de falhar no meio.
export class EmailNaoConfigurado extends ErroPrevisto {}

export type EmailSaida = { para: string; assunto: string; texto: string; html?: string };

export async function enviarEmail({ para, assunto, texto, html }: EmailSaida) {
  const usuario = process.env.GMAIL_USER;
  const senha = process.env.GMAIL_APP_PASSWORD;
  if (!usuario || !senha) {
    throw new EmailNaoConfigurado("E-mail não configurado: faltam GMAIL_USER e GMAIL_APP_PASSWORD no ambiente.");
  }
  // Uma conexão por envio: o envio de proposta é pontual, e manter conexão aberta
  // numa função serverless só guarda socket que a Vercel encerra de qualquer jeito.
  const transporte = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: usuario, pass: senha },
  });
  // Com HTML, o texto puro segue junto: é ele que aparece onde o HTML não é exibido
  await transporte.sendMail({ from: `"Ruphus" <${usuario}>`, to: para, subject: assunto, text: texto, html });
}
