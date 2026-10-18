import { diaCurto } from "@/lib/crm-tipos";
import { formatBRL } from "@/lib/datetime";

// Quem lê o e-mail é o dono, e o nome do negócio e o da assinatura vêm de campo
// digitado: tudo que entra no HTML passa por aqui antes.
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Mesmo conteúdo da página da proposta, em forma de e-mail: o que o dono lê na
// caixa de entrada é o que ele encontra no link.
const DORES = [
  "Quanto tempo sai do dia respondendo “tem horário amanhã?” no WhatsApp?",
  "Quantos clientes desistem porque quiseram marcar à noite ou no domingo e ninguém respondeu?",
  "Quando dois clientes pedem o mesmo horário, quem avisa a segunda pessoa?",
] as const;

const FUNCIONALIDADES = [
  ["Agenda aberta 24 horas", "O cliente vê os horários livres e marca sozinho, de madrugada ou no domingo, sem tirar você do atendimento."],
  ["Cada profissional com o horário dele", "Quem atende o quê, em que dia e em que hora. O sistema nunca oferece horário ocupado."],
  ["Serviços com preço e duração", "O encaixe é calculado na hora: serviço de uma hora reserva uma hora."],
  ["Ficha de cada cliente", "Histórico, etiquetas e anotações: alergias, preferências, o que foi combinado."],
  ["Seu endereço na internet", "Site com seus serviços e o link de agendamento pronto para a bio do Instagram."],
  ["Manutenção incluída", "Mudou horário, preço ou telefone? A gente atualiza. A mensalidade cobre isso."],
] as const;

const VANTAGENS = [
  "Sem taxa por agendamento: o que você cobra fica com você.",
  "Sem instalar programa, sem fidelidade. Se um dia não servir mais, é só avisar.",
  "Até 5 profissionais no plano, cada um com a própria agenda e os próprios horários.",
  "Painel para ver o dia e a semana, remarcar e consultar o histórico do cliente, de qualquer celular.",
] as const;

const COMECA = [
  "Você entra no painel pelo convite que a gente manda.",
  "Cadastramos juntos os serviços e quem atende, com os horários.",
  "O link entra na sua bio, e os clientes começam a marcar.",
] as const;

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
  const entrada = formatBRL(p.entradaCents);
  const mensal = formatBRL(p.mensalCents);
  const prazo = diaCurto(p.valeAte);
  const fecho = [p.assinatura, "Ruphus"].filter(Boolean).join("\n");
  const rodape = "Ruphus · Fonseca Gestão e Tecnologia Ltda · CNPJ 59.500.429/0001-90 · Manaus/AM";

  return {
    assunto: `Proposta da Ruphus para ${p.nome}`,
    texto: [
      oi,
      `Montei a proposta do ${p.nome}: uma agenda online com o seu site, para o cliente marcar sozinho, a qualquer hora, sem depender de você responder mensagem.`,
      `Isso soa familiar?\n${DORES.map((d) => `• ${d}`).join("\n")}`,
      `A Ruphus resolve isso: a agenda fica aberta o dia inteiro, e o horário ocupado some para o próximo cliente.`,
      `O que está incluído:\n${FUNCIONALIDADES.map(([t, d]) => `• ${t}: ${d}`).join("\n")}`,
      `Por que a Ruphus:\n${VANTAGENS.map((v) => `• ${v}`).join("\n")}`,
      `Investimento:\nPara publicar: ${entrada}, uma vez, com a implantação feita junto com você.\nPor mês: ${mensal}, com agenda no ar, atualizações e suporte.`,
      `Como começa:\n${COMECA.map((c, i) => `${i + 1}. ${c}`).join("\n")}\nLeva menos de um dia entre o sim e a agenda recebendo marcação.`,
      `Proposta completa, com tudo em uma página: ${p.url}`,
      `Ela vale até ${prazo}. Qualquer dúvida, é só responder este e-mail.`,
      fecho,
      rodape,
    ].join("\n\n"),
    html: `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F4F2EE;font-family:Arial,Helvetica,sans-serif;color:#17150F;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F2EE;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;border-radius:16px;">

<tr><td style="padding:32px 32px 8px;">
<p style="margin:0 0 8px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6F6A5E;">Proposta da Ruphus</p>
<h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;font-weight:700;">Agenda online e site para o ${esc(p.nome)}</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4A4639;">${esc(oi)}</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4A4639;">Montei a proposta do ${esc(p.nome)}: uma agenda online com o seu site, para o cliente marcar sozinho, a qualquer hora, sem depender de você responder mensagem.</p>
</td></tr>

<tr><td style="padding:8px 32px 0;">
<p style="margin:0 0 10px;font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#6F6A5E;">Isso soa familiar?</p>
<ul style="margin:0;padding:0 0 0 18px;font-size:15px;line-height:1.7;color:#4A4639;">
${DORES.map((d) => `<li style="margin:0 0 6px;">${esc(d)}</li>`).join("\n")}
</ul>
<p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:#17150F;">A Ruphus resolve isso: a agenda fica aberta o dia inteiro, e o horário ocupado some para o próximo cliente.</p>
</td></tr>

<tr><td style="padding:28px 32px 0;">
<p style="margin:0 0 12px;font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#6F6A5E;">O que está incluído</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${FUNCIONALIDADES.map(([t, d]) => `<tr><td style="padding:0 0 14px;vertical-align:top;">
<p style="margin:0;font-size:15px;font-weight:700;color:#17150F;">${esc(t)}</p>
<p style="margin:2px 0 0;font-size:14px;line-height:1.6;color:#4A4639;">${esc(d)}</p>
</td></tr>`).join("\n")}
</table>
</td></tr>

<tr><td style="padding:8px 32px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F5EF;border-radius:12px;">
<tr><td style="padding:20px 22px;">
<p style="margin:0 0 10px;font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#6F6A5E;">Por que a Ruphus</p>
<ul style="margin:0;padding:0 0 0 18px;font-size:14px;line-height:1.7;color:#4A4639;">
${VANTAGENS.map((v) => `<li style="margin:0 0 4px;">${esc(v)}</li>`).join("\n")}
</ul>
</td></tr>
</table>
</td></tr>

<tr><td style="padding:28px 32px 0;">
<p style="margin:0 0 12px;font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#6F6A5E;">Investimento</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E2DDD3;border-radius:12px;">
<tr>
<td width="50%" style="padding:18px 20px;border-right:1px solid #E2DDD3;vertical-align:top;">
<p style="margin:0 0 4px;font-size:12px;color:#6F6A5E;">Para publicar</p>
<p style="margin:0;font-size:22px;font-weight:700;">${esc(entrada)}</p>
<p style="margin:4px 0 0;font-size:12px;line-height:1.5;color:#6F6A5E;">uma vez, com a implantação feita junto com você</p>
</td>
<td width="50%" style="padding:18px 20px;vertical-align:top;">
<p style="margin:0 0 4px;font-size:12px;color:#6F6A5E;">Por mês</p>
<p style="margin:0;font-size:22px;font-weight:700;">${esc(mensal)}<span style="font-size:13px;font-weight:400;color:#6F6A5E;"> / mês</span></p>
<p style="margin:4px 0 0;font-size:12px;line-height:1.5;color:#6F6A5E;">agenda no ar, atualizações e suporte</p>
</td>
</tr>
</table>
<p style="margin:10px 0 0;font-size:13px;color:#6F6A5E;">Sem taxa por agendamento e sem fidelidade.</p>
</td></tr>

<tr><td style="padding:28px 32px 0;">
<p style="margin:0 0 12px;font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#6F6A5E;">Como começa</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${COMECA.map((c, i) => `<tr><td style="padding:0 0 10px;font-size:14.5px;line-height:1.6;color:#2E2B22;">
<span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:11px;background:#EFEBE2;font-size:11px;font-weight:700;margin-right:8px;">${i + 1}</span>${esc(c)}
</td></tr>`).join("\n")}
</table>
<p style="margin:4px 0 0;font-size:13px;color:#6F6A5E;">Leva menos de um dia entre o sim e a agenda recebendo marcação.</p>
</td></tr>

<tr><td style="padding:28px 32px 8px;" align="left">
<table role="presentation" cellpadding="0" cellspacing="0">
<tr><td style="border-radius:999px;background:#17150F;">
<a href="${esc(p.url)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px;">Ver a proposta completa</a>
</td></tr>
</table>
<p style="margin:14px 0 0;font-size:13px;line-height:1.6;color:#6F6A5E;">Proposta válida até ${esc(prazo)}. Qualquer dúvida, é só responder este e-mail.</p>
</td></tr>

<tr><td style="padding:24px 32px 32px;">
<p style="margin:0;font-size:15px;line-height:1.6;color:#4A4639;">${fecho.split("\n").map(esc).join("<br>")}</p>
</td></tr>
</table>
<p style="margin:16px 0 0;font-size:11px;line-height:1.6;color:#8B8578;">${esc(rodape)}</p>
</td></tr>
</table>
</body>
</html>`,
  };
}
