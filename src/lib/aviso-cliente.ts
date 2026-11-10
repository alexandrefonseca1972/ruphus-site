import type { Canal, Destinatario, StatusEnvio, TipoEnvio } from "@/lib/consumo";
import { erroLegivel } from "@/lib/consumo-tela";
import type { AvisoCliente } from "@/lib/mensagens";

// Aviso ao cliente pelo WhatsApp oficial com o wa.me de reserva. Funções puras: o servidor decide o
// que gravar no agendamento (avisoFalhou) e a agenda decide quando mostrar "Enviar pelo WhatsApp".

/** Avisos ao cliente que têm um texto para o wa.me (mensagens.ts). Pix, recibo e resposta ficam de fora. */
export const TIPOS_AVISO = ["recebido", "confirmado", "cancelado", "reagendado", "lembrete"] as const;
export type TipoAviso = (typeof TIPOS_AVISO)[number];
export const ehAviso = (t: unknown): t is TipoAviso => (TIPOS_AVISO as readonly unknown[]).includes(t);

/** Gravado no agendamento quando o aviso ao cliente não chegou; some quando um do mesmo tipo sai. */
export type AvisoFalhou = { tipo: TipoAviso; em: number; motivo?: string };

const SAIU: readonly StatusEnvio[] = ["enviado", "entregue", "lido"];

/** O que um envio faz com a marca do agendamento: marca (falhou ou sem saldo), limpa (saiu um do
 *  mesmo tipo) ou nada. Só WhatsApp ao cliente com agendamento: o SMS que falta saldo não diz que o
 *  WhatsApp não chegou, e um SMS que sai não apaga a falha do WhatsApp. */
export function efeitoNoAviso(e: { canal: Canal; destinatario: Destinatario; tipo: TipoEnvio; agendamentoId?: string | null; status: StatusEnvio; erro?: string | null }):
  | { acao: "marca"; tipo: TipoAviso; motivo: string }
  | { acao: "limpa"; tipo: TipoAviso }
  | null {
  if (e.canal !== "whatsapp" || e.destinatario !== "cliente" || !e.agendamentoId || !ehAviso(e.tipo)) return null;
  if (e.status === "sem-saldo") return { acao: "marca", tipo: e.tipo, motivo: "sem saldo de mensagens" };
  if (e.status === "falhou") return { acao: "marca", tipo: e.tipo, motivo: erroLegivel(e.erro ?? null) ?? "o WhatsApp recusou a entrega" };
  if (SAIU.includes(e.status)) return { acao: "limpa", tipo: e.tipo };
  return null;
}

/** O texto do wa.me para um aviso que não chegou, ou null quando já não faz sentido mandar: o
 *  horário passou (ou foi cancelado depois). O recibo de um horário que já foi confirmado vira a
 *  confirmação; o cancelamento só vale com o horário cancelado. */
export function avisoPendente(a: { avisoFalhou?: AvisoFalhou | null; status: string; start: number }, agora: number): AvisoCliente | null {
  const f = a.avisoFalhou;
  if (!f) return null;
  if (f.tipo === "cancelado") return a.status === "cancelled" ? "cancelado" : null;
  if (!(a.status === "booked" || a.status === "confirmed") || a.start <= agora) return null;
  if (f.tipo === "reagendado") return "remarcado";
  if (f.tipo === "recebido") return a.status === "confirmed" ? "confirmado" : "recebido";
  return f.tipo;
}

/** Resposta do aviso pelo painel (Confirmar/Cancelar). */
export type SituacaoAviso = "enviada" | "agendada" | "parada" | "falhou" | "sem_aceite" | "sem_canal" | "sem_saldo";
export type ResultadoAviso = { situacao: SituacaoAviso; motivo?: string };

/** O painel avisa pela API? Só no canal oficial e com o aceite do cliente; fora disso, o wa.me de sempre. */
export const avisaPelaApi = (canalOficial: boolean | undefined, consentimento: { aceito?: boolean } | undefined) => canalOficial === true && consentimento?.aceito === true;

/** O que a faixa da agenda diz depois do aviso pela API, e se oferece o wa.me de reserva. Parada na
 *  cota não oferece: o "Enviar agora" de Mensagens paradas já é o caminho, e dois mandariam duas vezes. */
export function faixaDoAviso(r: ResultadoAviso | null, acao: string): { texto: string; waMe: boolean } {
  if (r?.situacao === "enviada") return { texto: `${acao}. Cliente avisado pelo WhatsApp.`, waMe: false };
  if (r?.situacao === "agendada") return { texto: `${acao}. O aviso ao cliente sai pelo WhatsApp em breve.`, waMe: false };
  if (r?.situacao === "parada") return { texto: `${acao}. O aviso ao cliente parou na cota do dia do WhatsApp: decida em Mensagens paradas.`, waMe: false };
  const motivo =
    !r ? "sem conexão com o servidor"
    : r.situacao === "sem_saldo" ? "sem saldo de mensagens"
    : r.situacao === "sem_aceite" ? "o cliente não autorizou mensagens automáticas"
    : r.situacao === "sem_canal" ? "o WhatsApp automático não está ligado"
    : (r.motivo ?? "o WhatsApp recusou a entrega");
  return { texto: `${acao}. O aviso automático não saiu (${motivo.replace(/\.$/, "")}): avise pelo WhatsApp.`, waMe: true };
}
