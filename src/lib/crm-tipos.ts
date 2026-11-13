import { z } from "zod";

// Os mesmos estágios do servidor, importáveis pelo componente de tela
export const ESTAGIOS = ["novo", "oferta", "negociando", "fechado", "perdido"] as const;
export type Estagio = (typeof ESTAGIOS)[number];

// O funil tem três etapas e dois desfechos. A tela desenha os dois grupos
// diferente porque "fechado" e "perdido" não são o passo seguinte de
// "negociando": são a saída. Desenhados como iguais, a fila de cinco quebra a
// linha e o estágio vira uma escolha entre cinco botões soltos.
export const ETAPAS = ["novo", "oferta", "negociando"] as const satisfies readonly Estagio[];
export const DESFECHOS = ["fechado", "perdido"] as const satisfies readonly Estagio[];
export const ROTULO: Record<Estagio, string> = {
  novo: "Novo",
  oferta: "Oferta enviada",
  negociando: "Negociando",
  fechado: "Fechado",
  perdido: "Perdido",
};
export const COR: Record<Estagio, string> = {
  novo: "bg-[#F3EFE7] text-[#4A4639]",
  oferta: "bg-[#FBEDE6] text-[#A8502B]",
  negociando: "bg-[#FBF3DC] text-[#7A5A2E]",
  fechado: "bg-[#E7EEE9] text-[#2C6A53]",
  perdido: "bg-[#F1E7E7] text-[#8A2F2F]",
};

/** Na tela, "Novo" se divide em dois: quem já recebeu mensagem e segue sem responder é "Em contato".
 *  No banco a etapa é a mesma (novo); a divisão sai dos toques e do último contato. */
export type EtapaNaTela = Estagio | "contato";
export const ETAPAS_NA_TELA = ["novo", "contato", "oferta", "negociando", "fechado", "perdido"] as const satisfies readonly EtapaNaTela[];
export const etapaNaTela = (c?: { estagio?: Estagio; toques?: number | null; ultimoContatoEm?: string | null } | null): EtapaNaTela => {
  const e = c?.estagio ?? "novo";
  return e === "novo" && (c?.toques || c?.ultimoContatoEm) ? "contato" : e;
};
export const ROTULO_NA_TELA: Record<EtapaNaTela, string> = { ...ROTULO, contato: "Em contato" };
export const COR_NA_TELA: Record<EtapaNaTela, string> = { ...COR, contato: "bg-[#E8EEF3] text-[#2F4A5C]" };

/** O que a Ruphus cobra por padrao, em centavos. Mesmo numero que o JSON-LD da
 *  landing anuncia ("R$ 250 + R$ 89,90/mes"): um negocio novo ja nasce com ele
 *  no cartao, e so se digita quando o acerto sai do padrao. */
export const PRECO_PADRAO = { entradaCents: 250_00, mensalCents: 89_90 } as const;
/** A mensalidade que o negócio vale no funil: a combinada, ou a padrão enquanto nada foi combinado. */
export const mensal = (c: Pick<Crm, "mensalCents"> | undefined) => c?.mensalCents ?? PRECO_PADRAO.mensalCents;
/** Quanto tempo a proposta fica de pé. Curto de propósito: proposta sem prazo não fecha. */
export const DIAS_PROPOSTA = 7;

/** Os toques da prospecção: cada mensagem enviada agenda a próxima, e a terceira sem
 *  resposta agenda o encerramento. Poucos e com saída, como manda o playbook. */
export const CADENCIA: Record<string, { proxima: string; dias: number }> = {
  "Primeiro contato": { proxima: "Lembrete", dias: 3 },
  Lembrete: { proxima: "Última tentativa", dias: 7 },
  "Última tentativa": { proxima: "Sem resposta: encerrar como perdido", dias: 7 },
};
/** M-7: o PARE dado no número de prospecção barra a cadência e a proposta de quem não é cliente;
 *  cliente fechado segue recebendo a proposta. Object.hasOwn: "constructor" não é cadência (L-9). */
export const barradoPeloPareDoAgente = (modelo: string, estagio: Estagio) => Object.hasOwn(CADENCIA, modelo) || (modelo === "Proposta" && estagio !== "fechado");
/** O próximo passo foi agendado pela cadência (não combinado pelo vendedor) */
export const daCadencia = (acao: unknown) => Object.values(CADENCIA).some((p) => p.proxima === acao);
/** Respondeu: o próximo passo vira falar com ele hoje */
export const DEPOIS_DA_RESPOSTA = "Responder e mandar a proposta";
/** O detalhe da perda que "Pediu para parar" grava; é por ele que "Desfazer" sabe devolver ao funil */
export const DETALHE_PAROU = "Pediu para não receber mensagens";
/** Depois disto, sem resposta, insistir vira spam */
export const TOQUES_MAX = 3;

/** O que se cobra por mês: o Caixa está incluído e não entra como adicional. */
export const mensalidadeDe = (c: Pick<Crm, "mensalCents" | "caixaCents"> | undefined) => c?.mensalCents ?? 0;

/** Por que um negócio saiu do funil sem fechar. Obrigatório ao marcar "perdido". */
export const MOTIVOS_PERDA = {
  preco: "Preço",
  ja_tem: "Já tem site ou agenda",
  sem_interesse: "Sem interesse agora",
  nao_respondeu: "Não respondeu",
  fechou: "Fechou o negócio",
  // pelo "Pedir remoção" da faixa de proposta: o próprio negócio tirou a página do ar
  remocao: "Pediu a remoção da página",
  outro: "Outro",
} as const;
export type MotivoPerda = keyof typeof MOTIVOS_PERDA;

/** Como o contato chegou. Os sites importados em lote entram como "importado". */
export const ORIGENS = {
  porta: "Porta a porta",
  instagram: "Instagram",
  indicacao: "Indicação",
  anuncio: "Anúncio",
  importado: "Importado",
  cadastro: "Cadastro no site",
  outro: "Outro",
} as const;
export type Origem = keyof typeof ORIGENS;

export type Crm = {
  estagio: Estagio;
  /** Entrada, cobrada uma vez */
  entradaCents: number | null;
  /** Mensalidade: e ela que se acumula, e por isso manda nos totais */
  mensalCents: number | null;
  /** Valor legado do antigo adicional; não entra em novas cobranças porque o Caixa está incluído */
  caixaCents: number | null;
  fechadoEm: string | null;
  proximaAcao: string | null;
  proximaData: string | null;
  publicado: boolean;
  notas: number;
  /** Quem decide: o telefone do site é o da recepção, e cobrança e proposta vão para o dono */
  donoNome: string | null;
  donoPapel: string | null;
  donoWhatsapp: string | null;
  donoEmail: string | null;
  /** Outros WhatsApp do negócio (sócio, gerente…): só para falar, proposta e cobrança seguem com o do dono */
  outrosContatos: Contato[];
  motivoPerda: MotivoPerda | null;
  detalhePerda: string | null;
  /** null = ainda não informado; a tela e os números tratam como "importado" */
  origem: Origem | null;
  indicadoPor: string | null;
  /** Quando saiu de "novo" pela primeira vez: é daqui que se conta o tempo até fechar */
  entrouEm: string | null;
  perdidoEm: string | null;
  /** Último contato enviado pelo painel: alimenta "Falei hoje" e a ordem do dia */
  ultimoContatoEm: string | null;
  /** Em destaque no topo da lista até esta data (inclusive) */
  fixadoAte: string | null;
  /** O anúncio de onde veio o cadastro (utm_* do link), quando veio de um */
  utm: Utm | null;
  /** Mensagens da cadência de prospecção já enviadas (Primeiro contato, Lembrete, Última tentativa) */
  toques: number;
  /** Quando o lead respondeu: a cadência para aqui */
  respondeuEm: string | null;
  /** Pediu para não receber mais mensagens: nenhum contato de prospecção sai daqui */
  naoContatarEm: string | null;
  /** Primeira vez que o dono abriu o link da proposta atual */
  propostaVistaEm: string | null;
  /** A variante A/B do "Primeiro contato" confirmado: a tabela por variante do funil sai daqui */
  varianteId: string | null;
  /** Primeira visita real ao site demo (beacon, sem prévia de link) */
  siteVistoEm: string | null;
};

export type Contato = { nome: string; whatsapp: string };

/** Os parâmetros utm_* do link do anúncio, guardados no navegador até o cadastro. */
export type Utm = Partial<Record<"source" | "medium" | "campaign" | "content" | "term", string>>;
/** Como a campanha aparece no funil: o nome da campanha, ou a fonte quando não há nome. */
export const campanhaDe = (u: Utm | null | undefined) => (u ? u.campaign || u.source || null : null);

/** Um acontecimento na linha do tempo do negócio. Parte é gravada (notas, estágio,
 *  mensagens); parte é lida do que já existe (convite aceito, agendamento, cobrança). */
export type Evento = {
  id: string;
  tipo: "nota" | "estagio" | "mensagem" | "convite" | "agendamento" | "cobranca" | "pagamento";
  titulo: string;
  detalhe: string | null;
  autor: string;
  quando: string;
};

export type Nota = { id: string; texto: string; quando: string; autor: string };

/** As etapas da cadência como entram no id do evento (`slug__etapa__envioId`). */
export const ETAPA_DO_MODELO = { "Primeiro contato": "primeiro", Lembrete: "lembrete", "Última tentativa": "ultima" } as const;
export type EtapaCadencia = (typeof ETAPA_DO_MODELO)[keyof typeof ETAPA_DO_MODELO];
export const etapaDoModelo = (modelo: string): EtapaCadencia | null =>
  Object.hasOwn(ETAPA_DO_MODELO, modelo) ? ETAPA_DO_MODELO[modelo as keyof typeof ETAPA_DO_MODELO] : null;

/** O que a gaveta manda quando o vendedor confirma o envio ("Sim" ou "Editei"). `envioId` nasce no
 *  clique (o envio pendente): dois "Sim" do mesmo envio dão o mesmo id e gravam uma vez só, e dois
 *  envios diferentes nunca colidem. O número do toque e a variante saem do servidor, não daqui. */
export const EnvioConfirmado = z.object({
  envioId: z.uuid(),
  textoEnviado: z.string().trim().min(1).max(1000),
  editado: z.boolean(),
});
export type EnvioConfirmado = z.infer<typeof EnvioConfirmado>;

/** O envio a que uma resposta ou um opt-out se liga (null: nada confirmado ainda). */
const Ligacao = { envioId: z.string().nullable(), varianteId: z.string().nullable(), textoEnviado: z.string().nullable() };

/** Os eventos da prospecção medida (F1), gravados em crm/{slug}/eventos com `tipo` como discriminante. */
export const EventoProspeccao = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("envio_confirmado"), etapa: z.enum(["primeiro", "lembrete", "ultima"]), toque: z.number().int().min(1), varianteId: z.string().nullable(), textoEnviado: z.string(), editado: z.boolean() }),
  z.object({ tipo: z.literal("resposta_humana"), ...Ligacao }),
  z.object({ tipo: z.literal("resposta_automatica"), ...Ligacao }),
  z.object({ tipo: z.literal("optout"), ...Ligacao }),
  z.object({ tipo: z.literal("site_visto") }),
  // falha do copiloto ou do agente de IA: o código do erro (IAIndisponivel, SaidaIAInvalida...), nunca a mensagem inteira
  z.object({ tipo: z.literal("ia_falha"), origem: z.enum(["copiloto", "agente"]), codigo: z.string() }),
]);
export type EventoProspeccao = z.infer<typeof EventoProspeccao>;
export type TipoProspeccao = EventoProspeccao["tipo"];

/** Na linha do tempo, os eventos da prospecção aparecem como mensagem. */
export const tipoNaTela = (tipo: unknown): Evento["tipo"] => {
  const t = String(tipo) as Evento["tipo"] | TipoProspeccao;
  switch (t) {
    case "nota":
    case "estagio":
    case "mensagem":
    case "convite":
    case "agendamento":
    case "cobranca":
    case "pagamento":
      return t;
    case "envio_confirmado":
    case "resposta_humana":
    case "resposta_automatica":
    case "optout":
    case "site_visto":
    case "ia_falha":
      return "mensagem";
    default:
      t satisfies never;
      return "mensagem";
  }
};

// Hoje no fuso de quem está olhando. toISOString() devolveria a data em UTC e,
// em Manaus, a partir das 20h já apontaria o dia seguinte — todo compromisso de
// hoje apareceria como atrasado no fim da tarde.
export const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Em que pé está a próxima ação combinada. As datas são "AAAA-MM-DD", que compara como texto. */
export type Prazo = "atrasada" | "hoje" | "futura";
export const prazoDe = (c: Pick<Crm, "proximaData"> | undefined, hoje: string): Prazo | null =>
  !c?.proximaData ? null : c.proximaData < hoje ? "atrasada" : c.proximaData === hoje ? "hoje" : "futura";

/** "2026-09-25" → "25/09" */
export const diaCurto = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");

/** Autor da nota que o Gerador grava com o levantamento do lead; o admin a mostra à parte do histórico. */
export const AUTOR_LEVANTAMENTO = "Gerador de sites";
