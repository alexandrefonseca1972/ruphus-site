import type { Canal, Destinatario, StatusEnvio, TipoEnvio } from "@/lib/consumo";
import { erroLegivel } from "@/lib/consumo-tela";
import type { AvisoCliente } from "@/lib/mensagens";

// Aviso ao cliente pelo WhatsApp oficial com o wa.me de reserva. Funções puras: o servidor decide o
// que gravar no agendamento (avisoFalhou) e a agenda decide quando mostrar "Enviar pelo WhatsApp".

/** Avisos ao cliente que têm um texto para o wa.me (mensagens.ts). Pix, recibo e resposta ficam de fora. */
export const TIPOS_AVISO = ["recebido", "confirmado", "cancelado", "reagendado", "lembrete"] as const;
export type TipoAviso = (typeof TIPOS_AVISO)[number];
export const ehAviso = (t: unknown): t is TipoAviso => (TIPOS_AVISO as readonly unknown[]).includes(t);

/** Gravado no agendamento quando o aviso ao cliente não chegou. em: quando o envio falhou (o status
 *  do envio); envioId: qual envio (sem ele, recusa do atendys antes de virar envio). optOut: o cliente
 *  pediu SAIR; a agenda mostra o motivo, mas não oferece o wa.me. */
export type AvisoFalhou = { tipo: TipoAviso; em: number; motivo?: string; envioId?: string; optOut?: boolean };

export const SAIU: readonly StatusEnvio[] = ["enviado", "entregue", "lido"];
export const MOTIVO_OPT_OUT = "o cliente pediu para não receber mensagens";

/** O que um envio faz com a marca do agendamento: marca (falhou ou sem saldo), limpa (saiu um aviso)
 *  ou nada. Só WhatsApp ao cliente com agendamento: o SMS que falta saldo não diz que o WhatsApp não
 *  chegou, e um SMS que sai não apaga a falha do WhatsApp. */
export function efeitoNoAviso(e: { canal: Canal; destinatario: Destinatario; tipo: TipoEnvio; agendamentoId?: string | null; status: StatusEnvio; erro?: string | null }):
  | { acao: "marca"; tipo: TipoAviso; motivo: string; optOut?: boolean }
  | { acao: "limpa"; tipo: TipoAviso }
  | null {
  if (e.canal !== "whatsapp" || e.destinatario !== "cliente" || !e.agendamentoId || !ehAviso(e.tipo)) return null;
  if (e.status === "sem-saldo") return { acao: "marca", tipo: e.tipo, motivo: "sem saldo de mensagens" };
  if (e.status === "falhou") return { acao: "marca", tipo: e.tipo, motivo: erroLegivel(e.erro ?? null) ?? "o WhatsApp recusou a entrega" };
  if (SAIU.includes(e.status)) return { acao: "limpa", tipo: e.tipo };
  return null;
}

// ordem da conversa: o recibo vem antes da confirmação (ou remarcação), que vem antes do lembrete
const ORDEM: Record<Exclude<TipoAviso, "cancelado">, number> = { recebido: 0, confirmado: 1, reagendado: 1, lembrete: 2 };

/** Um aviso que saiu apaga a marca? O cliente recebeu algo igual ou mais adiante na conversa: a
 *  confirmação entregue cobre o recibo que falhou, o lembrete cobre os dois. O cancelamento entregue
 *  cobre tudo; a marca de cancelamento só sai com um cancelamento entregue. */
export function saidaCobre(saiu: TipoAviso, marca: TipoAviso): boolean {
  if (marca === "cancelado") return saiu === "cancelado";
  if (saiu === "cancelado") return true;
  return ORDEM[marca] <= ORDEM[saiu];
}

/** Uma marca vale por 3 dias depois da falha ou do horário (o que for depois): a de um cancelamento
 *  antigo não fica para sempre na agenda. */
const VALIDADE_MS = 3 * 86_400_000;

/** O que a agenda faz com a marca: o texto do wa.me (waMe false: o cliente pediu SAIR, só o aviso),
 *  ou null quando já não faz sentido: o horário passou (ou foi cancelado depois), ou a marca venceu.
 *  O recibo de um horário que já foi confirmado vira a confirmação; o cancelamento só vale com o
 *  horário cancelado. */
export function avisoPendente(a: { avisoFalhou?: AvisoFalhou | null; status: string; start: number }, agora: number): { texto: AvisoCliente; waMe: boolean } | null {
  const f = a.avisoFalhou;
  if (!f) return null;
  if (agora > Math.max(f.em, a.start) + VALIDADE_MS) return null;
  const waMe = !f.optOut;
  if (f.tipo === "cancelado") return a.status === "cancelled" ? { texto: "cancelado", waMe } : null;
  if (!(a.status === "booked" || a.status === "confirmed") || a.start <= agora) return null;
  const texto: AvisoCliente = f.tipo === "reagendado" ? "remarcado" : f.tipo === "recebido" && a.status === "confirmed" ? "confirmado" : f.tipo;
  return { texto, waMe };
}

/** Resposta do aviso pelo painel (Confirmar/Cancelar). "enviando": o envio segue depois da resposta;
 *  se não chegar, a falha aparece no horário (avisoFalhou). */
export type SituacaoAviso = "enviando" | "falhou" | "sem_aceite" | "sem_canal" | "sem_saldo";
export type ResultadoAviso = { situacao: SituacaoAviso; motivo?: string };

/** O painel avisa pela API? Só no canal oficial e com o aceite do cliente; fora disso, o wa.me de sempre. */
export const avisaPelaApi = (canalOficial: boolean | undefined, consentimento: { aceito?: boolean } | undefined) => canalOficial === true && consentimento?.aceito === true;

/** O que a faixa da agenda diz depois do aviso pela API, e se oferece o wa.me de reserva. Enviando
 *  não promete "avisado": o envio ainda não saiu, e a falha aparece depois no próprio horário. */
export function faixaDoAviso(r: ResultadoAviso | null, acao: string): { texto: string; waMe: boolean } {
  if (r?.situacao === "enviando") return { texto: `${acao}. Avisando o cliente pelo WhatsApp…`, waMe: false };
  const motivo =
    !r ? "sem conexão com o servidor"
    : r.situacao === "sem_saldo" ? "sem saldo de mensagens"
    : r.situacao === "sem_aceite" ? "o cliente não autorizou mensagens automáticas"
    : r.situacao === "sem_canal" ? "o WhatsApp automático não está ligado"
    : (r.motivo ?? "o WhatsApp recusou a entrega");
  return { texto: `${acao}. O aviso automático não saiu (${motivo.replace(/\.$/, "")}): avise pelo WhatsApp.`, waMe: true };
}
