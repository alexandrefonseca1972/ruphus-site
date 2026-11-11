// O e-mail padrão da Ruphus (avisos ao admin e ao dono): a mesma identidade do convite — fundo
// creme, "RUPHUS ●", faixa escura com o título, cartão branco, botão escuro e o rodapé da empresa.
// Sem React nem Firebase: o HTML sai daqui e o texto puro também, porque é ele que aparece onde o
// HTML não é exibido (e o par ajuda a não cair no spam). Tudo que é dado entra escapado.

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type Bloco =
  /** parágrafo comum */
  | { p: string }
  /** número ou dado principal em destaque (saldo, valor a lançar) */
  | { destaque: string; rotulo: string; nota?: string }
  /** pares rótulo → valor (negócio, quando, versão) */
  | { dados: [string, string][] }
  /** passos ou orientação (lista numerada) */
  | { passos: string[]; titulo?: string }
  /** texto técnico em fonte fixa (erro, comando da VPS) */
  | { tecnico: string; titulo?: string };

export type Email = {
  /** assunto: o admin recebe com [Ruphus] na frente, o dono não */
  assunto: string;
  /** linha pequena acima do título (ex.: "Aviso do sistema", "Mensagens pré-pagas") */
  faixa: string;
  titulo: string;
  /** frase curta abaixo do título, na faixa escura */
  subtitulo?: string;
  /** texto que o leitor de e-mail mostra ao lado do assunto */
  previa?: string;
  blocos: Bloco[];
  acao?: { texto: string; url: string };
  /** por que a pessoa recebeu (rodapé) */
  motivo: string;
  /** tom da marca na faixa: alerta (âmbar) para o admin, normal (verde) para o dono */
  tom?: "normal" | "alerta";
};

const COR = { fundo: "#F4F2EE", tinta: "#17150F", texto: "#4A4639", apagado: "#6F6A5E", suave: "#8B8578", caixa: "#F7F5EF", linha: "#EFEBE3", verde: "#2C6A53", ambar: "#F2C94C" };
const EMPRESA = "Ruphus · Fonseca Gestão e Tecnologia Ltda · CNPJ 59.500.429/0001-90 · Manaus/AM";

/** HTML do e-mail (tabelas e estilos inline: o que os leitores de e-mail aceitam). */
export function htmlDoEmail(e: Email) {
  const ponto = e.tom === "alerta" ? COR.ambar : COR.verde;
  const blocos = e.blocos.map(bloco).join("\n");
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(e.assunto)}</title></head>
<body style="margin:0;padding:0;background:${COR.fundo};font-family:Arial,Helvetica,sans-serif;color:${COR.tinta};">
${e.previa ? `<div style="display:none;max-height:0;overflow:hidden;">${esc(e.previa)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COR.fundo};padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
<tr><td style="padding:0 4px 14px;">
<span style="font-size:20px;font-weight:700;letter-spacing:3px;color:${COR.tinta};">RUPHUS</span><span style="color:${ponto};font-size:20px;">&nbsp;&#9679;</span>
</td></tr>
<tr><td style="background:${COR.tinta};border-radius:20px 20px 0 0;padding:32px 32px 28px;">
<p style="margin:0 0 10px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${e.tom === "alerta" ? COR.ambar : "#B9B2A2"};">${esc(e.faixa)}</p>
<h1 style="margin:0;font-size:24px;line-height:1.25;font-weight:700;color:#FFFFFF;">${esc(e.titulo)}</h1>
${e.subtitulo ? `<p style="margin:10px 0 0;font-size:15px;line-height:1.6;color:#D9D3C5;">${esc(e.subtitulo)}</p>` : ""}
</td></tr>
<tr><td style="background:#FFFFFF;border-radius:0 0 20px 20px;padding:28px 32px 32px;">
${blocos}
${e.acao ? botao(e.acao) : ""}
</td></tr>
</table>
<p style="margin:18px 0 0;font-size:11px;line-height:1.6;color:${COR.suave};">${EMPRESA}<br>${esc(e.motivo)}</p>
</td></tr>
</table>
</body>
</html>`;
}

function bloco(b: Bloco) {
  if ("p" in b) return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${COR.texto};">${linhas(b.p)}</p>`;
  if ("destaque" in b)
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;background:${COR.caixa};border-radius:14px;"><tr><td style="padding:18px 20px;">
<p style="margin:0 0 4px;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${COR.apagado};">${esc(b.rotulo)}</p>
<p style="margin:0;font-size:26px;font-weight:700;color:${COR.tinta};">${esc(b.destaque)}</p>
${b.nota ? `<p style="margin:8px 0 0;font-size:13px;line-height:1.6;color:${COR.apagado};">${linhas(b.nota)}</p>` : ""}
</td></tr></table>`;
  if ("dados" in b)
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;border-top:1px solid ${COR.linha};">
${b.dados.map(([r, v]) => `<tr><td width="1%" style="padding:10px 24px 10px 0;border-bottom:1px solid ${COR.linha};font-size:13px;color:${COR.apagado};white-space:nowrap;vertical-align:top;">${esc(r)}</td><td style="padding:10px 0;border-bottom:1px solid ${COR.linha};font-size:14px;color:${COR.tinta};word-break:break-word;">${linhas(v)}</td></tr>`).join("\n")}
</table>`;
  if ("passos" in b)
    return `${b.titulo ? titulo(b.titulo) : ""}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">
${b.passos.map((t, i) => `<tr><td width="34" style="padding:0 0 12px;vertical-align:top;"><span style="display:inline-block;width:24px;height:24px;line-height:24px;text-align:center;border-radius:12px;background:${i === 0 ? COR.tinta : "#EFEBE2"};color:${i === 0 ? "#FFFFFF" : COR.tinta};font-size:12px;font-weight:700;">${i + 1}</span></td><td style="padding:2px 0 12px;vertical-align:top;font-size:14px;line-height:1.55;color:${COR.texto};">${linhas(t)}</td></tr>`).join("\n")}
</table>`;
  return `${b.titulo ? titulo(b.titulo) : ""}<pre style="margin:0 0 18px;padding:14px 16px;background:${COR.caixa};border-radius:12px;font-family:Menlo,Consolas,monospace;font-size:12px;line-height:1.5;color:${COR.tinta};white-space:pre-wrap;word-break:break-word;">${esc(b.tecnico)}</pre>`;
}

const titulo = (t: string) => `<p style="margin:6px 0 10px;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${COR.apagado};">${esc(t)}</p>`;
const linhas = (t: string) => esc(t).replace(/\n/g, "<br>");
const botao = (a: { texto: string; url: string }) => `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:8px 0 0;">
<tr><td align="center" style="border-radius:999px;background:${COR.tinta};">
<a href="${esc(a.url)}" style="display:block;padding:15px 26px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px;">${esc(a.texto)}</a>
</td></tr></table>
<p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:${COR.suave};">O botão não abriu? Copie no navegador:<br><a href="${esc(a.url)}" style="color:${COR.apagado};word-break:break-all;">${esc(a.url)}</a></p>`;

/** O mesmo e-mail em texto puro. */
export function textoDoEmail(e: Email) {
  const partes = [e.titulo, e.subtitulo ?? "", ...e.blocos.map(textoDe), e.acao ? `${e.acao.texto}: ${e.acao.url}` : "", "Ruphus", e.motivo];
  return partes.filter(Boolean).join("\n\n");
}

function textoDe(b: Bloco) {
  if ("p" in b) return b.p;
  if ("destaque" in b) return `${b.rotulo}: ${b.destaque}${b.nota ? `\n${b.nota}` : ""}`;
  if ("dados" in b) return b.dados.map(([r, v]) => `${r}: ${v}`).join("\n");
  if ("passos" in b) return `${b.titulo ? `${b.titulo}\n` : ""}${b.passos.map((t, i) => `${i + 1}. ${t}`).join("\n")}`;
  return `${b.titulo ? `${b.titulo}\n` : ""}${b.tecnico}`;
}

/** Pronto para enviarEmail: assunto, texto e HTML. */
export const montarEmail = (e: Email) => ({ assunto: e.assunto, texto: textoDoEmail(e), html: htmlDoEmail(e) });
