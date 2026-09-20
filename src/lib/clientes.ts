/** Faixas de "sem vir há" oferecidas na lista de clientes. A maior manda na
 *  consulta: o Firestore devolve essa janela uma vez, e trocar de faixa é só
 *  recortar o que já está na memória. */
export const JANELAS = [
  { dias: 30, rotulo: "30 dias" },
  { dias: 60, rotulo: "60 dias" },
  { dias: 90, rotulo: "90 dias" },
  { dias: 180, rotulo: "6 meses" },
  { dias: 365, rotulo: "1 ano" },
] as const;

export const MAIOR_JANELA = Math.max(...JANELAS.map((j) => j.dias));
export const DIA_EM_MS = 86_400_000;

export type Visita = { customerKey: string; status: string; startMs: number };

/** Quem esteve no negócio de `desdeMs` para cá.
 *
 * Três decisões moram aqui, e nenhuma é óbvia:
 *
 * - conta o `start` do agendamento, não o `updatedAt` do cliente: este último é
 *   a data em que a pessoa *marcou*, e quem marcou há 70 dias para ontem esteve
 *   aqui ontem;
 * - cancelado e falta não são visita;
 * - horário futuro conta como ativo, porque essa pessoa está voltando e não
 *   deve entrar numa campanha de "sumidos".
 */
export function ativosDesde(visitas: readonly Visita[], desdeMs: number) {
  return new Set(
    visitas
      .filter((v) => v.startMs >= desdeMs && (v.status === "booked" || v.status === "confirmed"))
      .map((v) => v.customerKey),
  );
}
