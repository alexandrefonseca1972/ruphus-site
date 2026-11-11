export function tituloDeNovoAgendamento(quantidade: number, negocio: string) {
  if (quantidade <= 0) return "";
  return `(${quantidade}) ${quantidade === 1 ? "Novo agendamento" : "Novos agendamentos"} · ${negocio}`;
}
