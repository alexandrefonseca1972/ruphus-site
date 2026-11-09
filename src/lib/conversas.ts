// Regras da tela de Conversas sem React nem Firebase: ordem da lista, nome do cliente vindo do
// cadastro, textos dos bloqueios e do estado de envio. Testadas em conversas-tela.test.mts.
import type { ConversaInbox, MotivoSemResposta, RespostaInbox, StatusMensagemInbox } from "@/lib/atendys";
import { soDigitosComDDI } from "@/lib/telefone";

/** Não lidas primeiro; dentro de cada grupo, a mais recente primeiro. */
export const naoLida = (c: Pick<ConversaInbox, "unreadCount" | "manuallyUnread">) => c.unreadCount > 0 || c.manuallyUnread;
export function ordenarConversas<T extends Pick<ConversaInbox, "unreadCount" | "manuallyUnread" | "lastActivityAt">>(lista: T[]) {
  return [...lista].sort((a, b) => Number(naoLida(b)) - Number(naoLida(a)) || b.lastActivityAt.localeCompare(a.lastActivityAt));
}

/** Junta páginas sem repetir conversa (a lista anda enquanto se pagina: a mais nova vence). */
export function juntarConversas<T extends { id: string }>(atual: T[], nova: T[]) {
  const ids = new Set(nova.map((c) => c.id));
  return [...nova, ...atual.filter((c) => !ids.has(c.id))];
}

/** Cliente do cadastro pelo telefone, com ou sem o 9º dígito (conta antiga). */
export type ClienteDoCadastro = { key: string; name: string; phone: string };
export function indiceDeClientes(clientes: ClienteDoCadastro[]) {
  const mapa = new Map<string, ClienteDoCadastro>();
  for (const c of clientes) {
    const canon = soDigitosComDDI(c.phone) ?? soDigitosComDDI(c.key);
    if (canon) mapa.set(canon, c);
  }
  return (telefone: string | null) => (telefone ? mapa.get(soDigitosComDDI(telefone) ?? telefone) : undefined);
}

/** (91) 98888-7777 a partir de 5591988887777; fora do padrão BR, +dígitos. */
export function telefoneLegivel(digitos: string | null) {
  if (!digitos) return "Contato sem número";
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digitos);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : `+${digitos}`;
}

export function nomeDaConversa(c: Pick<ConversaInbox, "contactName" | "contactPhone">, doCadastro?: { name: string }) {
  return doCadastro?.name || c.contactName || telefoneLegivel(c.contactPhone);
}

export const POR_QUE_NAO_RESPONDE: Record<MotivoSemResposta, string> = {
  REPLY_WINDOW_CLOSED: "O cliente não escreve há mais de 24 horas. O WhatsApp só deixa responder depois que ele mandar uma nova mensagem.",
  RECIPIENT_OPTED_OUT: "Este cliente pediu para não receber mensagens do negócio.",
  INSTANCE_PAUSED: "O WhatsApp do negócio está em pausa. As respostas voltam quando a pausa acabar.",
  CONVERSATION_NOT_ADDRESSABLE: "O WhatsApp não informou o número deste contato: dá para ler, não para responder.",
};

/** Quanto falta da janela de 24 h, em texto curto; null se fechada ou sem prazo. */
export function janelaRestante(fim: string | null, agora = Date.now()) {
  if (!fim) return null;
  const min = Math.floor((Date.parse(fim) - agora) / 60_000);
  if (!(min > 0)) return null;
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h${min % 60 && h < 3 ? ` ${min % 60} min` : ""}`;
}

export const ROTULO_STATUS: Record<StatusMensagemInbox, string> = {
  queued: "Na fila",
  awaiting_manual: "Aguardando envio manual",
  sent: "Enviada",
  delivered: "Entregue",
  read: "Lida",
  failed: "Não enviada",
  cancelled: "Cancelada",
};

/** O que dizer logo depois de responder (o resultado final chega no histórico). */
export function avisoDoEnvio(r: Pick<RespostaInbox, "status" | "retryAt" | "manualHandoffRequired">, hora: (iso: string) => string) {
  if (r.manualHandoffRequired || r.status === "awaiting_manual") return "A cota do WhatsApp do negócio acabou por agora: envie esta pelo WhatsApp, no botão abaixo, ou ela fica aguardando.";
  if (r.status === "queued" && r.retryAt) return `Na fila: sai às ${hora(r.retryAt)} (limite de envios do número).`;
  return null;
}

/** Chave de idempotência nova por envio: o duplo clique repete a mesma. */
export const novaChave = () => `r-${crypto.randomUUID()}`;
