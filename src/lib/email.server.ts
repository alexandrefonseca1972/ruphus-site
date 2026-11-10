import "server-only";
import nodemailer from "nodemailer";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { integracao } from "@/lib/integracoes.server";

// E-mail sai de noreply@ruphus.site pelo Resend (domínio verificado lá). Sem a chave
// do Resend, cai na conta da Ruphus no Gmail, por SMTP com senha de app. As chaves
// ficam no /admin (ou no .env do servidor): nada disso chega ao navegador. Sem nenhuma das
// duas, o envio recusa com mensagem clara em vez de falhar no meio.
export class EmailNaoConfigurado extends ErroPrevisto {}

/** de: o nome que aparece como remetente (o negócio, no recibo): sai de contato@ruphus.site, não do noreply */
export type EmailSaida = { para: string; assunto: string; texto: string; html?: string; de?: string };

const REMETENTE = "Ruphus <noreply@ruphus.site>";
const CONTATO = "contato@ruphus.site";
// nome no cabeçalho From: sem aspas, <>, nem quebra de linha (injeção de cabeçalho)
const nomeDe = (de: string) => de.replace(/["<>\r\n\\]/g, "").trim().slice(0, 60);

// O endereço de contato (EMAIL_CONTATO, ex.: contato@ruphus.site): quem responde fala com ele, e no
// Gmail ele é o remetente — o Gmail só respeita isso se o endereço estiver em "Enviar e-mail como"
// na conta; sem ele, a conta do Gmail responde e assina, como antes.
const contas = async () => {
  const [chave, usuario, senha, contato] = await Promise.all([integracao("RESEND_API_KEY"), integracao("GMAIL_USER"), integracao("GMAIL_APP_PASSWORD"), integracao("EMAIL_CONTATO")]);
  return { chave, usuario, senha, contato: contato || usuario };
};

export async function enviarEmail(email: EmailSaida) {
  const { chave, usuario, senha, contato } = await contas();
  if (!chave) return peloGmail(email, usuario, senha, contato);
  try {
    await pelaResend(chave, email, contato);
  } catch (err) {
    // Resend fora do ar ou lento: o Gmail, se configurado, leva o e-mail
    if (!usuario || !senha) throw err;
    console.error("[email] Resend falhou, enviando pelo Gmail", err);
    await peloGmail(email, usuario, senha, contato);
  }
}

/** Teste do /admin: força um canal (o de sempre tenta o Resend e cai no Gmail sem avisar qual saiu). */
export async function enviarEmailPor(canal: "resend" | "gmail", email: EmailSaida) {
  const { chave, usuario, senha, contato } = await contas();
  if (canal === "gmail") return peloGmail(email, usuario, senha, contato);
  if (!chave) throw new EmailNaoConfigurado("Sem a chave do Resend: cadastre-a acima para testar este canal.");
  return pelaResend(chave, email, contato);
}

async function pelaResend(chave: string, { para, assunto, texto, html, de }: EmailSaida, responderPara: string) {
  const from = de ? `"${nomeDe(de)}" <${CONTATO}>` : REMETENTE;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    // noreply não lê resposta: quem responder fala com a conta da Ruphus, se houver
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ from, to: [para], subject: assunto, text: texto, html, ...(responderPara && { reply_to: responderPara }) }),
  });
  if (!r.ok) throw new Error(`Resend recusou o e-mail (${r.status}): ${(await r.text()).slice(0, 300)}`);
}

async function peloGmail({ para, assunto, texto, html, de }: EmailSaida, usuario: string, senha: string, remetente = usuario) {
  if (!usuario || !senha) {
    throw new EmailNaoConfigurado("E-mail não configurado: cadastre a chave do Resend (ou a conta e a senha de app do Gmail) no /admin, em Ajustes.");
  }
  // Uma conexão por envio: o envio de proposta é pontual, não vale manter socket aberto
  const transporte = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: usuario, pass: senha },
    // como o Resend (10 s): sem isto o padrão do nodemailer espera 2 min para conectar e 10 min no socket
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  // Com HTML, o texto puro segue junto: é ele que aparece onde o HTML não é exibido
  await transporte.sendMail({ from: `"${de ? nomeDe(de) : "Ruphus"}" <${remetente}>`, replyTo: remetente, to: para, subject: assunto, text: texto, html });
}
