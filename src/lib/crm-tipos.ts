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
