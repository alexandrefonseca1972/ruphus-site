import "server-only";
import nodemailer from "nodemailer";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { integracao } from "@/lib/integracoes.server";

// E-mail sai de noreply@ruphus.site pelo Resend (domínio verificado lá). Sem a chave
// do Resend, cai na conta da Ruphus no Gmail, por SMTP com senha de app. As chaves
// ficam no /admin (ou no .env do servidor): nada disso chega ao navegador. Sem nenhuma das
// duas, o envio recusa com mensagem clara em vez de falhar no meio.
export class EmailNaoConfigurado extends ErroPrevisto {}

export type EmailSaida = { para: string; assunto: string; texto: string; html?: string };

const REMETENTE = "Ruphus <noreply@ruphus.site>";

export async function enviarEmail(email: EmailSaida) {
  const [chave, usuario, senha] = await Promise.all([integracao("RESEND_API_KEY"), integracao("GMAIL_USER"), integracao("GMAIL_APP_PASSWORD")]);
  if (!chave) return peloGmail(email, usuario, senha);
  try {
    await pelaResend(chave, email, usuario);
  } catch (err) {
    // Resend fora do ar ou lento: o Gmail, se configurado, leva o e-mail
    if (!usuario || !senha) throw err;
    console.error("[email] Resend falhou, enviando pelo Gmail", err);
    await peloGmail(email, usuario, senha);
  }
}

async function pelaResend(chave: string, { para, assunto, texto, html }: EmailSaida, responderPara: string) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    // noreply não lê resposta: quem responder fala com a conta da Ruphus, se houver
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ from: REMETENTE, to: [para], subject: assunto, text: texto, html, ...(responderPara && { reply_to: responderPara }) }),
  });
  if (!r.ok) throw new Error(`Resend recusou o e-mail (${r.status}): ${(await r.text()).slice(0, 300)}`);
}

async function peloGmail({ para, assunto, texto, html }: EmailSaida, usuario: string, senha: string) {
  if (!usuario || !senha) {
    throw new EmailNaoConfigurado("E-mail não configurado: cadastre a chave do Resend (ou a conta e a senha de app do Gmail) no /admin, em Ajustes.");
  }
  // Uma conexão por envio: o envio de proposta é pontual, não vale manter socket aberto
  const transporte = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: usuario, pass: senha },
  });
  // Com HTML, o texto puro segue junto: é ele que aparece onde o HTML não é exibido
  await transporte.sendMail({ from: `"Ruphus" <${usuario}>`, to: para, subject: assunto, text: texto, html });
}
