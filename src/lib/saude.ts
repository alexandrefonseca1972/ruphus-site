// Saúde de um cliente da Ruphus (negócio fechado): a regra fica aqui, sem banco,
// para o teste e a tela usarem a mesma coisa.

export type Saude = "ok" | "atencao" | "risco";
export type SituacaoCobranca = "sem" | "em_dia" | "vence" | "atrasada";

export const ROTULO_SAUDE: Record<Saude, string> = { ok: "Saudável", atencao: "Atenção", risco: "Em risco" };

const DIA = 86_400_000;
/** Sem agendamento por tanto tempo, o cliente deixou de usar (ou nunca começou) */
export const DIAS_SEM_AGENDAR = 21;
/** Cobrança que vence dentro disso já pede atenção */
export const DIAS_PARA_VENCER = 5;

export type Passos = { convite: boolean; servicos: boolean; profissionais: boolean; agendamento: boolean };

/** O estado e a frase que explica: quem olha a lista precisa do porquê, não só da cor. */
export function classificar(x: {
  passos: Passos;
  ultimoAgendamentoMs: number | null;
  clienteDesdeMs: number | null;
  cobranca: SituacaoCobranca;
  diasParaVencer: number | null;
  agora: number;
}): { saude: Saude; motivo: string } {
  const feitos = Object.values(x.passos).filter(Boolean).length;
  // quem virou cliente há pouco ainda não teve tempo de agendar: não é risco
  // sem a data de fechamento não dá para dizer que parou: não acusa inatividade
  const cliente = x.clienteDesdeMs === null ? 0 : (x.agora - x.clienteDesdeMs) / DIA;
  const parado = x.ultimoAgendamentoMs === null ? cliente : (x.agora - x.ultimoAgendamentoMs) / DIA;

  if (x.cobranca === "atrasada") return { saude: "risco", motivo: "Cobrança atrasada." };
  if (parado >= DIAS_SEM_AGENDAR && cliente >= DIAS_SEM_AGENDAR) {
    return {
      saude: "risco",
      motivo: x.ultimoAgendamentoMs === null ? `Nenhum agendamento desde que virou cliente.` : `Sem agendamento há ${Math.floor(parado)} dias.`,
    };
  }
  if (feitos < 4) {
    const falta = !x.passos.convite
      ? "o dono ainda não entrou no painel"
      : !x.passos.servicos
        ? "falta cadastrar os serviços"
        : !x.passos.profissionais
          ? "falta cadastrar quem atende"
          : "ainda não recebeu o primeiro agendamento";
    return { saude: "atencao", motivo: `Implantação em ${feitos} de 4: ${falta}.` };
  }
  if (x.cobranca === "vence") {
    return { saude: "atencao", motivo: x.diasParaVencer === 0 ? "Cobrança vence hoje." : `Cobrança vence em ${x.diasParaVencer} dia(s).` };
  }
  return { saude: "ok", motivo: "Implantado, agendando e com a cobrança em dia." };
}
