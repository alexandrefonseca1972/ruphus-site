// Os mesmos estágios do servidor, importáveis pelo componente de tela
export const ESTAGIOS = ["novo", "oferta", "negociando", "fechado", "perdido"] as const;
export type Estagio = (typeof ESTAGIOS)[number];
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

export type Crm = {
  estagio: Estagio;
  valorCents: number | null;
  fechadoEm: string | null;
  proximaAcao: string | null;
  proximaData: string | null;
  publicado: boolean;
  notas: number;
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
