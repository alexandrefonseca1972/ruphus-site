import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import nodemailer from "nodemailer";
import { verificarChaveAdmin } from "@/lib/atendys";
import { integracao } from "@/lib/integracoes.server";

// Confere, sem efeito colateral (nada é enviado, nada é cobrado), se cada chave de Ajustes funciona:
// saldo da Comtele, domínios do Resend, login SMTP do Gmail, lista do atendys, modelos da Anthropic.
// O detalhe vai para a tela do /admin: nunca leva a chave nem o corpo cru da resposta.

export type Situacao = { situacao: "ok" | "erro" | "ausente"; detalhe: string };

const TEMPO = 10_000;
const ok = (detalhe: string): Situacao => ({ situacao: "ok", detalhe });
const erro = (detalhe: string): Situacao => ({ situacao: "erro", detalhe });
const ausente = (detalhe: string): Situacao => ({ situacao: "ausente", detalhe });
const falhaDeRede = (servico: string) => erro(`${servico} não respondeu em ${TEMPO / 1000}s. Tente de novo.`);
const recusou = (servico: string, status: number) =>
  erro(status === 401 || status === 403 ? `${servico} recusou a chave (${status}): confira se ela está certa e ativa.` : `${servico} respondeu ${status}.`);

async function sms(): Promise<Situacao> {
  const chave = await integracao("COMTELE_API_KEY");
  if (!chave) return ausente("Sem a chave, nenhum SMS sai.");
  try {
    const r = await fetch("https://sms.comtele.com.br/api/v2/credits/", { headers: { "auth-key": chave }, signal: AbortSignal.timeout(TEMPO) });
    const corpo = (await r.json().catch(() => null)) as { Success?: boolean; Object?: unknown } | null;
    if (!r.ok || !corpo?.Success) return recusou("A Comtele", r.status === 200 ? 401 : r.status);
    const saldo = Number(corpo.Object);
    if (!Number.isFinite(saldo)) return ok("Chave válida.");
    return saldo > 0 ? ok(`Chave válida · saldo de ${saldo.toLocaleString("pt-BR")} SMS.`) : erro("Chave válida, mas sem saldo: nenhum SMS sai até recarregar.");
  } catch {
    return falhaDeRede("A Comtele");
  }
}

async function resend(chave: string): Promise<Situacao> {
  try {
    const r = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${chave}` }, signal: AbortSignal.timeout(TEMPO) });
    if (r.ok) {
      const { data } = (await r.json().catch(() => ({}))) as { data?: { name: string; status: string }[] };
      const dominio = data?.find((d) => d.name === "ruphus.site");
      if (!dominio) return erro("Chave do Resend válida, mas o domínio ruphus.site não está cadastrado nela.");
      return dominio.status === "verified" ? ok("Resend válido · ruphus.site verificado.") : erro(`Resend válido, mas o domínio ruphus.site está "${dominio.status}" (precisa estar verificado).`);
    }
    // chave só de envio (a recomendada) não lista domínios: é válida mesmo assim
    const nome = ((await r.json().catch(() => null)) as { name?: string } | null)?.name;
    if (r.status === 401 && nome === "restricted_api_key") return ok("Resend válido (chave só de envio).");
    return recusou("O Resend", r.status);
  } catch {
    return falhaDeRede("O Resend");
  }
}

async function gmail(usuario: string, senha: string): Promise<Situacao> {
  const transporte = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: usuario, pass: senha }, connectionTimeout: TEMPO, greetingTimeout: TEMPO });
  try {
    await transporte.verify();
    return ok(`Gmail válido (${usuario}).`);
  } catch (e) {
    const codigo = (e as { code?: string; responseCode?: number }).code;
    return erro(codigo === "EAUTH" ? "O Gmail recusou a conta ou a senha de app." : "O Gmail não respondeu. Tente de novo.");
  } finally {
    transporte.close();
  }
}

async function email(): Promise<Situacao> {
  const [chave, usuario, senha] = await Promise.all([integracao("RESEND_API_KEY"), integracao("GMAIL_USER"), integracao("GMAIL_APP_PASSWORD")]);
  const partes = await Promise.all([chave ? resend(chave) : null, usuario && senha ? gmail(usuario, senha) : null]);
  const feitas = partes.filter((p): p is Situacao => !!p);
  if (!feitas.length) return ausente("Sem o Resend nem o Gmail, nenhum e-mail sai.");
  // vale se ao menos um canal funciona; o detalhe mostra os dois
  return { situacao: feitas.some((p) => p.situacao === "ok") ? "ok" : "erro", detalhe: feitas.map((p) => p.detalhe).join(" ") };
}

async function whatsapp(): Promise<Situacao> {
  if (!(await integracao("ATENDYS_ADMIN_KEY"))) return ausente("Sem a chave, nenhum WhatsApp pode ser conectado.");
  try {
    const n = await verificarChaveAdmin();
    return ok(`Chave válida · ${n} ${n === 1 ? "negócio" : "negócios"} no atendys.`);
  } catch (e) {
    return erro(e instanceof Error ? e.message : "O serviço de WhatsApp não respondeu.");
  }
}

async function alertas(): Promise<Situacao> {
  const destino = await integracao("ALERTA_EMAIL");
  if (!destino) {
    const reserva = await integracao("GMAIL_USER");
    return reserva ? ok(`Sem e-mail próprio: os alertas vão para ${reserva}.`) : ausente("Sem destino: os alertas do sistema não chegam a ninguém.");
  }
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(destino) ? ok(`Alertas vão para ${destino}.`) : erro(`"${destino}" não parece um e-mail.`);
}

async function ia(): Promise<Situacao> {
  const chave = await integracao("ANTHROPIC_API_KEY");
  if (!chave) return ausente("Sem a chave, o assistente da seção Visual fica desligado.");
  try {
    await new Anthropic({ apiKey: chave, timeout: TEMPO, maxRetries: 0 }).models.list({ limit: 1 });
    return ok("Chave válida.");
  } catch (e) {
    const status = (e as { status?: number }).status;
    return status ? recusou("A Anthropic", status) : falhaDeRede("A Anthropic");
  }
}

/** Situação de cada grupo de Ajustes (as chaves de INTEGRACOES), conferida ao vivo e em paralelo. */
export async function verificarIntegracoes(): Promise<Record<string, Situacao>> {
  const [s, e, w, a, i] = await Promise.all([sms(), email(), whatsapp(), alertas(), ia()]);
  return { "SMS (Comtele)": s, "E-mail": e, "WhatsApp (atendys)": w, Alertas: a, "IA (Anthropic)": i };
}
