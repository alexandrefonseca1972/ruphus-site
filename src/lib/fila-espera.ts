// Fila de espera: regras puras (sem Firestore, sem I/O). Quem chama lê e grava; aqui só se decide.
import { z } from "zod";
import { AgendaQuery, BookingInput, hhmm } from "@/lib/scheduling";
import { toMin } from "@/lib/datetime";

/** Antecedência mínima, em minutos, para avisar uma vaga no mesmo dia */
export const ANTECEDENCIA_MIN = 60; // ponytail: 60 min fixo; virar por tenant se algum salão precisar de mais folga
/** Prazo para o cliente responder ao aviso antes de a vaga ser oferecida a outro */
export const PRAZO_AVISO_MIN = 10; // ponytail: 10 min; subir se o cliente reclamar que não dá tempo de ver o WhatsApp
/** Quantos avisos uma mesma vaga pode gerar, no total */
export const MAX_AVISOS_POR_VAGA = 3; // ponytail: teto de avisos por vaga; acima disso vira spam
/** Quantos avisos um mesmo telefone pode receber em 24 horas */
export const MAX_AVISOS_24H = 2; // ponytail: limite por telefone; contra spam, não por tenant
/** Intervalo mínimo entre dois avisos ao mesmo telefone */
export const INTERVALO_AVISOS_MIN = 360; // ponytail: 6 h fixas; o cron não pensa em horário comercial
/** Quantas esperas abertas um mesmo telefone pode ter ao mesmo tempo */
export const MAX_ESPERAS_ATIVAS_POR_TELEFONE = 3; // ponytail: teto por telefone; sobe se houver caso real de família

export type StatusEspera = "aguardando" | "avisada" | "agendada" | "trocada" | "saiu" | "expirada";
export type TipoEspera = "esperar" | "troca";
export type Espera = {
  id: string;
  tipo: TipoEspera;
  customerKey: string;
  nome: string;
  telefone: string;
  serviceIds: string[];
  staffId: string | null;
  data: string;
  preferido: string;
  agendamentoId?: string;
  /** só serve o horário preferido ("Só serve o meu" no WhatsApp) */
  exato?: boolean;
  status: StatusEspera;
  criadaEm: number;
  avisos: { inicio: string; staffId: string; em: number }[];
};

export const EntradaEsperaInput = BookingInput.pick({
  tenantId: true,
  serviceIds: true,
  date: true,
  customerName: true,
  customerPhone: true,
}).extend({
  // "qualquer profissional" (vazio) vira null: a espera vale para quem estiver livre
  staffId: AgendaQuery.shape.staffId.transform((v) => v || null),
  preferido: hhmm,
  // presente = troca: o cliente já tem um horário livre marcado e quer trocar pelo preferido
  agendamentoId: z.string().min(1).max(128).regex(/^[^/]+$/).optional(),
  aceite: z.literal(true, { error: "Marque o aceite para receber o aviso no WhatsApp." }),
  token: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
});
export type EntradaEspera = z.infer<typeof EntradaEsperaInput>;

/** "HH:MM" -> minutos desde 00:00 */
export const paraMin = toMin;

/** Vaga serve para a espera? Todas as regras precisam valer ao mesmo tempo.
 *  `hoje` e `agoraMin` são do fuso do negócio (todayIn(fuso) e agoraNaParede(fuso)), nunca de
 *  Brasília: num negócio de Manaus a antecedência erraria por 1 h. */
export function compativel(
  e: Espera,
  vaga: { data: string; inicio: string; staffId: string; livreAteMin: number },
  ctx: { duracaoMin: number; hoje: string; agoraMin: number },
): boolean {
  const inicioMin = paraMin(vaga.inicio);
  return (
    e.status === "aguardando" &&
    e.data === vaga.data &&
    (e.staffId === null || e.staffId === vaga.staffId) &&
    inicioMin + ctx.duracaoMin <= vaga.livreAteMin &&
    (vaga.data > ctx.hoje || (vaga.data === ctx.hoje && inicioMin - ctx.agoraMin >= ANTECEDENCIA_MIN)) &&
    ((e.tipo !== "troca" && !e.exato) || vaga.inicio === e.preferido)
  );
}

/** Quem é avisado primeiro. Devolve cópia nova; o array de entrada não muda. */
export function ordenar(esperas: Espera[], inicio: string): Espera[] {
  const alvo = paraMin(inicio);
  const distancia = (e: Espera) => Math.abs(paraMin(e.preferido) - alvo);
  return [...esperas].sort(
    (a, b) =>
      Number(a.tipo === "troca") - Number(b.tipo === "troca") ||
      Number(b.preferido === inicio) - Number(a.preferido === inicio) ||
      distancia(a) - distancia(b) ||
      a.criadaEm - b.criadaEm ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** Pode mandar mais um aviso a este telefone? avisosEm são instantes (ms) dos avisos já enviados. */
export function podeAvisar(avisosEm: number[], agoraMs: number): boolean {
  const DIA_MS = 24 * 60 * 60000;
  if (avisosEm.filter((em) => agoraMs - em < DIA_MS).length >= MAX_AVISOS_24H) return false;
  if (avisosEm.length && agoraMs - Math.max(...avisosEm) < INTERVALO_AVISOS_MIN * 60000) return false;
  return true;
}

/** Instante (ms) até quando o cliente pode responder ao aviso enviado em emMs */
export const prazoDoAviso = (emMs: number) => emMs + PRAZO_AVISO_MIN * 60000;

/** Até quando a espera vale. Troca: ANTECEDENCIA_MIN antes do preferido (depois disso compativel
 *  já recusa, e a espera ficaria parada à toa); esperar: no fim do dia. */
export function venceEm(e: Espera): { data: string; ateMin: number } {
  // ponytail: fim do dia, não o fim do expediente; trocar se o cron avisar fora do horário
  return e.tipo === "troca" ? { data: e.data, ateMin: paraMin(e.preferido) - ANTECEDENCIA_MIN } : { data: e.data, ateMin: 24 * 60 };
}
