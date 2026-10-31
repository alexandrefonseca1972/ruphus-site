import "server-only";
import nodemailer from "nodemailer";
import { ErroPrevisto } from "@/lib/erro-previsto";

// E-mail sai de noreply@ruphus.site pelo Resend (domínio verificado lá). Sem a chave
// do Resend, cai na conta da Ruphus no Gmail, por SMTP com senha de app. As chaves
// ficam só no ambiente do servidor: nada disso chega ao navegador. Sem nenhuma das
// duas, o envio recusa com mensagem clara em vez de falhar no meio.
export class EmailNaoConfigurado extends ErroPrevisto {}

export type EmailSaida = { para: string; assunto: string; texto: string; html?: string };

const REMETENTE = "Ruphus <noreply@ruphus.site>";

export async function enviarEmail(email: EmailSaida) {
  if (!process.env.RESEND_API_KEY) return peloGmail(email);
  try {
    await pelaResend(process.env.RESEND_API_KEY, email);
  } catch (err) {
    // Resend fora do ar ou lento: o Gmail, se configurado, leva o e-mail
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) throw err;
    console.error("[email] Resend falhou, enviando pelo Gmail", err);
    await peloGmail(email);
  }
}

async function pelaResend(chave: string, { para, assunto, texto, html }: EmailSaida) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    // noreply não lê resposta: quem responder fala com a conta da Ruphus, se houver
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ from: REMETENTE, to: [para], subject: assunto, text: texto, html, ...(process.env.GMAIL_USER && { reply_to: process.env.GMAIL_USER }) }),
  });
  if (!r.ok) throw new Error(`Resend recusou o e-mail (${r.status}): ${(await r.text()).slice(0, 300)}`);
}

async function peloGmail({ para, assunto, texto, html }: EmailSaida) {
  const usuario = process.env.GMAIL_USER;
  const senha = process.env.GMAIL_APP_PASSWORD;
  if (!usuario || !senha) {
    throw new EmailNaoConfigurado("E-mail não configurado: falta RESEND_API_KEY (ou GMAIL_USER e GMAIL_APP_PASSWORD) no ambiente.");
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
