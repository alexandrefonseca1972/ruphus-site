// Módulos do plano: o agendamento (agenda, agendamento online, equipe, clientes, avisos) e o Caixa vêm
// ligados para todos; o /admin desliga por negócio (tenants/{slug}.modulos, só o servidor grava).
// Só false desliga: negócio de antes deste campo segue com tudo. Sem agendamento não há Caixa — ele
// vive dos atendimentos —, e o painel fica com Serviços (a lista de preços do site) e Meu negócio.

export type Modulos = { caixa?: unknown; agendamento?: unknown } | null | undefined;

export const agendamentoLigado = (m: Modulos) => m?.agendamento !== false;
export const caixaLigado = (m: Modulos) => m?.caixa !== false && agendamentoLigado(m);

/** As telas do painel que existem sem agendamento ("só site"). */
const SO_SITE = new Set(["servicos", "negocio"]);
/** A tela do painel (/{slug}/{tela}/…) existe neste plano? "" é a agenda. */
export function telaDoPlano(m: Modulos, tela: string) {
  if (!agendamentoLigado(m)) return SO_SITE.has(tela);
  if (tela === "caixa") return caixaLigado(m);
  return true;
}
