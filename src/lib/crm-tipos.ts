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

/** O que a Ruphus cobra por padrao, em centavos. Mesmo numero que o JSON-LD da
 *  landing anuncia ("R$ 250 + R$ 59,90/mes"): um negocio novo ja nasce com ele
 *  no cartao, e so se digita quando o acerto sai do padrao. */
export const PRECO_PADRAO = { entradaCents: 250_00, mensalCents: 59_90 } as const;

/** Por que um negócio saiu do funil sem fechar. Obrigatório ao marcar "perdido". */
export const MOTIVOS_PERDA = {
  preco: "Preço",
  ja_tem: "Já tem site ou agenda",
  sem_interesse: "Sem interesse agora",
  nao_respondeu: "Não respondeu",
  fechou: "Fechou o negócio",
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
};

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
