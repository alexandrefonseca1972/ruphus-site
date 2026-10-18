import { diaCurto } from "@/lib/crm-tipos";
import { formatBRL } from "@/lib/datetime";

// Quem lê o e-mail é o dono, e o nome do negócio e o da assinatura vêm de campo
// digitado: tudo que entra no HTML passa por aqui antes.
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Assunto, texto puro e HTML do e-mail que leva a proposta. Os valores e o prazo
 *  são os mesmos da página: o que chega na caixa de entrada bate com o que o dono
 *  abre no link. O texto puro vai junto com o HTML, para quem não exibe HTML. */
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
  const entrada = formatBRL(p.entradaCents);
  const mensal = formatBRL(p.mensalCents);
  const prazo = diaCurto(p.valeAte);
  return {
    assunto: `Proposta da Ruphus para ${p.nome}`,
    texto: [
      oi,
      `Montei a proposta do ${p.nome} numa página só, com o que está incluído e os valores:`,
      `Entrada de ${entrada} para publicar e ${mensal} por mês, sem taxa por agendamento.`,
      `Proposta completa: ${p.url}`,
      `Ela vale até ${prazo}. Qualquer dúvida, é só responder este e-mail.`,
      fecho,
    ].join("\n\n"),
    html: `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:#F4F2EE;font-family:Arial,Helvetica,sans-serif;color:#17150F;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F2EE;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;border-radius:16px;">
<tr><td style="padding:32px 32px 8px;">
<p style="margin:0 0 8px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6F6A5E;">Proposta da Ruphus</p>
<h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;font-weight:700;">Agenda online para o ${esc(p.nome)}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4A4639;">${esc(oi)}</p>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4A4639;">Montei a proposta do ${esc(p.nome)} numa página só, com o que está incluído e os valores combinados.</p>
</td></tr>
<tr><td style="padding:0 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E2DDD3;border-radius:12px;">
<tr>
<td width="50%" style="padding:18px 20px;border-right:1px solid #E2DDD3;">
<p style="margin:0 0 4px;font-size:12px;color:#6F6A5E;">Entrada para publicar</p>
<p style="margin:0;font-size:22px;font-weight:700;">${esc(entrada)}</p>
</td>
<td width="50%" style="padding:18px 20px;">
<p style="margin:0 0 4px;font-size:12px;color:#6F6A5E;">Mensalidade</p>
<p style="margin:0;font-size:22px;font-weight:700;">${esc(mensal)}<span style="font-size:13px;font-weight:400;color:#6F6A5E;"> / mês</span></p>
</td>
</tr>
</table>
<p style="margin:12px 0 0;font-size:13px;color:#6F6A5E;">Sem taxa por agendamento.</p>
</td></tr>
<tr><td style="padding:28px 32px 8px;" align="left">
<table role="presentation" cellpadding="0" cellspacing="0">
<tr><td style="border-radius:999px;background:#17150F;">
<a href="${esc(p.url)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px;">Ver a proposta completa</a>
</td></tr>
</table>
<p style="margin:14px 0 0;font-size:13px;line-height:1.6;color:#6F6A5E;">Ela vale até ${esc(prazo)}. Qualquer dúvida, é só responder este e-mail.</p>
</td></tr>
<tr><td style="padding:24px 32px 32px;">
<p style="margin:0;font-size:15px;line-height:1.6;color:#4A4639;">${fecho.split("\n").map(esc).join("<br>")}</p>
</td></tr>
</table>
<p style="margin:16px 0 0;font-size:11px;color:#8B8578;">Ruphus · agenda online e site para negócios de atendimento</p>
</td></tr>
</table>
</body>
</html>`,
  };
}
