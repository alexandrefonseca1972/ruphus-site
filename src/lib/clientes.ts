/** Quem esteve no negócio dentro da janela consultada.
 *
 * Três decisões moram aqui, e nenhuma é óbvia:
 *
 * - conta o `start` do agendamento, não o `updatedAt` do cliente: este último é
 *   a data em que a pessoa *marcou*, e quem marcou há 70 dias para ontem esteve
 *   aqui ontem;
 * - cancelado e falta não são visita;
 * - horário futuro conta como ativo, porque essa pessoa está voltando e não
 *   deve entrar numa campanha de "sumidos".
 *
 * A janela em si é a consulta (`start >= hoje - N dias`): o que chega aqui já
 * está dentro dela, futuros inclusive.
 */
export function ativosNaJanela(visitas: readonly { customerKey: string; status: string }[]) {
  return new Set(
    visitas.filter((v) => v.status === "booked" || v.status === "confirmed").map((v) => v.customerKey),
  );
}
