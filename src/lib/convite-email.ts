// nome do negócio, do dono e assinatura vêm de campo digitado: tudo que entra no HTML passa por aqui
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// o que o dono faz no painel, na ordem em que a agenda fica pronta
const PASSOS = [
  ["Confira os serviços", "Preço e duração de cada um, do jeito que você cobra."],
  ["Cadastre quem atende", "Cada profissional com os serviços e os horários dele."],
  ["Divulgue o link", "Na bio do Instagram e no status do WhatsApp."],
] as const;

/** Assunto e corpo do e-mail com o convite de acesso ao painel. O link abre só com
 *  o e-mail do dono (é o que o token guarda) e serve uma vez: por isso o texto pede
 *  para não repassar. O texto puro vai junto do HTML: é ele que aparece onde o HTML
 *  não é exibido, e o par ajuda a não cair no spam. */
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
    html: htmlDoConvite(c, oi, fecho),
  };
}

function htmlDoConvite(c: Parameters<typeof emailDoConvite>[0], oi: string, fecho: string) {
  const site = `${c.slug}.ruphus.site`;
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Acesso ao painel do ${esc(c.nome)}</title></head>
<body style="margin:0;padding:0;background:#F4F2EE;font-family:Arial,Helvetica,sans-serif;color:#17150F;">
<div style="display:none;max-height:0;overflow:hidden;">Seu painel do ${esc(c.nome)} está pronto: entre com ${esc(c.email)} e deixe a agenda do seu jeito.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F2EE;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

<tr><td style="padding:0 4px 14px;">
<span style="font-size:20px;font-weight:700;letter-spacing:3px;color:#17150F;">RUPHUS</span><span style="color:#2C6A53;font-size:20px;">&nbsp;&#9679;</span>
</td></tr>

<tr><td style="background:#17150F;border-radius:20px 20px 0 0;padding:36px 32px 32px;">
<p style="margin:0 0 12px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#B9B2A2;">Seu painel está pronto</p>
<h1 style="margin:0;font-size:28px;line-height:1.2;font-weight:700;color:#FFFFFF;">${esc(c.nome)}</h1>
<p style="margin:12px 0 0;font-size:15px;line-height:1.6;color:#D9D3C5;">O site e a agenda online já estão no ar em <a href="https://${esc(site)}" style="color:#F2C94C;text-decoration:none;font-weight:700;">${esc(site)}</a>.</p>
</td></tr>

<tr><td style="background:#FFFFFF;border-radius:0 0 20px 20px;padding:32px;">
<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#17150F;font-weight:700;">${esc(oi)}</p>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4A4639;">Aqui é da Ruphus. Pelo painel você cuida de serviços, equipe e horários, e acompanha cada agendamento pelo celular.</p>

<table role="presentation" cellpadding="0" cellspacing="0" width="100%">
<tr><td align="center" style="border-radius:999px;background:#17150F;">
<a href="${esc(c.url)}" style="display:block;padding:16px 28px;font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px;">Entrar no painel</a>
</td></tr>
</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0;background:#F7F5EF;border-radius:14px;">
<tr><td style="padding:18px 20px;">
<p style="margin:0 0 4px;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#6F6A5E;">Entre com este e-mail</p>
<p style="margin:0;font-size:16px;font-weight:700;color:#17150F;word-break:break-all;">${esc(c.email)}</p>
<p style="margin:8px 0 0;font-size:13px;line-height:1.6;color:#6F6A5E;">Entre ou crie a conta com ele. O link vale ${c.dias} dias e serve uma vez só, então não repasse.</p>
</td></tr>
</table>

<p style="margin:28px 0 14px;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#6F6A5E;">No painel, em três passos</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${PASSOS.map(([t, d], i) => `<tr><td width="38" style="padding:0 0 14px;vertical-align:top;">
<span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;border-radius:13px;background:${i === 0 ? "#17150F" : "#EFEBE2"};color:${i === 0 ? "#FFFFFF" : "#17150F"};font-size:12px;font-weight:700;">${i + 1}</span>
</td><td style="padding:2px 0 14px;vertical-align:top;">
<p style="margin:0;font-size:15px;font-weight:700;color:#17150F;">${esc(t)}</p>
<p style="margin:2px 0 0;font-size:14px;line-height:1.5;color:#4A4639;">${esc(d)}</p>
</td></tr>`).join("\n")}
</table>

<p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:#8B8578;">O botão não abriu? Copie este endereço no navegador:<br><a href="${esc(c.url)}" style="color:#6F6A5E;word-break:break-all;">${esc(c.url)}</a></p>

<p style="margin:28px 0 0;padding-top:20px;border-top:1px solid #EFEBE3;font-size:15px;line-height:1.6;color:#4A4639;">${fecho.split("\n").map(esc).join("<br>")}</p>
</td></tr>
</table>
<p style="margin:18px 0 0;font-size:11px;line-height:1.6;color:#8B8578;">Ruphus · Fonseca Gestão e Tecnologia Ltda · CNPJ 59.500.429/0001-90 · Manaus/AM<br>Você recebeu este e-mail porque o acesso ao painel do ${esc(c.nome)} foi liberado para ${esc(c.email)}.</p>
</td></tr>
</table>
</body>
</html>`;
}
