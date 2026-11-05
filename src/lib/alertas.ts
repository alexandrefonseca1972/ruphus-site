import type { Crm } from "@/lib/crm-tipos";

/** Alertas do CRM: o que passou do ponto e ninguém percebeu.
 *
 * Tudo sai do que a lista já carrega (o negócio e o doc do CRM), sem leitura
 * nova: é uma conta em cima do que está na tela. Cada alerta responde a uma
 * pergunta que o vendedor não faz sozinho no fim do dia. */

/** Negociação sem contato há tanto tempo já esfriou. */
export const DIAS_PARADO = 7;
/** Fechou, cobrou, e o dono ainda não entrou: a implantação empacou. */
export const DIAS_SEM_ENTRAR = 7;

export type Alerta = {
  id: "viu_proposta" | "sem_proxima" | "parado" | "sem_toque" | "implantacao" | "destaque";
  rotulo: string;
  /** O que fazer, não só o que aconteceu */
  detalhe: string;
  urgente: boolean;
  slugs: string[];
};

type Negocio = { slug: string; acessos: number };

// meio-dia para o fuso não mudar a conta de dias
const diasAte = (iso: string | null, hoje: string) =>
  iso ? Math.floor((Date.parse(`${hoje}T12:00:00`) - Date.parse(iso)) / 86_400_000) : Infinity;

const emNegociacao = (c: Crm | undefined) => c?.estagio === "oferta" || c?.estagio === "negociando";
const emAberto = (c: Crm) => c.estagio !== "fechado" && c.estagio !== "perdido";

export function alertas(negocios: Negocio[], crm: Record<string, Crm>, hoje: string): Alerta[] {
  const semProxima: string[] = [];
  const parados: string[] = [];
  const implantacao: string[] = [];
  const destaque: string[] = [];
  const viuProposta: string[] = [];
  const semToque: string[] = [];

  for (const n of negocios) {
    const c = crm[n.slug];
    if (emNegociacao(c)) {
      // O erro mais comum de CRM: conversa viva e nada combinado para depois
      if (!c!.proximaData) semProxima.push(n.slug);
      // Sem contato nenhum também conta: o negócio foi aberto e largado
      if (diasAte(c!.ultimoContatoEm, hoje) >= DIAS_PARADO) parados.push(n.slug);
    }
    // Fechado, mas o dono nunca entrou no painel: sem isso não existe implantação
    if (c?.estagio === "fechado" && n.acessos <= 1 && diasAte(c.fechadoEm, hoje) >= DIAS_SEM_ENTRAR) {
      implantacao.push(n.slug);
    }
    if (c?.fixadoAte === hoje) destaque.push(n.slug);
    // Abriu a proposta depois da última conversa: é quando ela está sendo pensada
    if (c?.propostaVistaEm && emAberto(c) && (!c.ultimoContatoEm || c.propostaVistaEm > c.ultimoContatoEm)) viuProposta.push(n.slug);
    // Recebeu mensagem, não respondeu e nada ficou agendado: é o lead que sumia de todas as filas
    if (c?.estagio === "novo" && c.ultimoContatoEm && !c.proximaData && !c.respondeuEm && !c.naoContatarEm) semToque.push(n.slug);
  }

  return [
    {
      id: "viu_proposta",
      rotulo: "Abriu a proposta",
      detalhe: "O dono abriu a proposta depois do último contato: é a hora de falar.",
      urgente: true,
      slugs: viuProposta,
    },
    {
      id: "sem_proxima",
      rotulo: "Sem próximo passo",
      detalhe: "Em negociação e sem nada combinado: marque o que fazer e quando.",
      urgente: true,
      slugs: semProxima,
    },
    {
      id: "parado",
      rotulo: `Parado há ${DIAS_PARADO}+ dias`,
      detalhe: "Negociação sem contato há mais de uma semana. Retome ou feche como perdido.",
      urgente: true,
      slugs: parados,
    },
    {
      id: "sem_toque",
      rotulo: "Contatado sem próximo toque",
      detalhe: "Recebeu mensagem, não respondeu e nada ficou agendado. Mande o próximo toque ou encerre.",
      urgente: false,
      slugs: semToque,
    },
    {
      id: "implantacao",
      rotulo: "Fechou e não entrou",
      detalhe: `Vendido há ${DIAS_SEM_ENTRAR}+ dias e o dono ainda não acessou o painel.`,
      urgente: true,
      slugs: implantacao,
    },
    {
      id: "destaque",
      rotulo: "Destaque vence hoje",
      detalhe: "Amanhã sai do topo da lista. Resolva ou renove o prazo.",
      urgente: false,
      slugs: destaque,
    },
  ].filter((a) => a.slugs.length) as Alerta[];
}
