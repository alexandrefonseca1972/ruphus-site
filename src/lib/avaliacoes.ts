import { z } from "zod";

export const ATRASOS_AVALIACAO = [15, 30, 60, 120] as const;
export const ATRASO_AVALIACAO_PADRAO = 30;
export const COMENTARIO_AVALIACAO_MAX = 1000;

export const ConfigAvaliacoes = z.object({
  enabled: z.boolean(),
  delayMin: z.number().int().refine((v) => ATRASOS_AVALIACAO.includes(v as (typeof ATRASOS_AVALIACAO)[number]), "Escolha um intervalo válido."),
});
export type ConfigAvaliacoes = z.infer<typeof ConfigAvaliacoes>;

export const NotaObrigatoria = z.number({ error: "Escolha uma nota de 1 a 5." }).int().min(1, "Escolha uma nota de 1 a 5.").max(5, "Escolha uma nota de 1 a 5.");
export const NotaOpcional = NotaObrigatoria.nullable();

export const RespostaAvaliacao = z.object({
  tenantId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/, "Link inválido."),
  appointmentId: z.string().min(1).max(128).regex(/^[^/]+$/, "Link inválido."),
  token: z.string().regex(/^[a-f0-9]{64}$/, "Link inválido."),
  notas: z.object({
    servico: NotaObrigatoria,
    profissional: NotaObrigatoria,
    atendimento: NotaObrigatoria,
    ambiente: NotaOpcional,
    localizacao: NotaOpcional,
  }),
  comentario: z.string().max(COMENTARIO_AVALIACAO_MAX, `Use no máximo ${COMENTARIO_AVALIACAO_MAX} caracteres.`),
});
export type RespostaAvaliacao = z.infer<typeof RespostaAvaliacao>;

export type NotasAvaliacao = RespostaAvaliacao["notas"];

export function mediaGeral(notas: NotasAvaliacao): number {
  const valores = Object.values(notas).filter((v): v is number => v !== null);
  return valores.reduce((total, nota) => total + nota, 0) / valores.length;
}

export function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] || "";
}

/** O resumo da tela do dono, calculado no navegador sobre as respostas do período. As médias do
 *  servidor (getAggregateFromServer) não servem aqui: o Firestore aceita no máximo 5 agregações por
 *  consulta (a tela pedia 7) e cada média com filtro de data exige um índice composto próprio. */
export function resumirAvaliacoes(respostas: readonly { staffId: string; notaGeral: number; notas: NotasAvaliacao }[]) {
  const media = (valores: (number | null)[]) => {
    const v = valores.filter((x): x is number => x !== null);
    return v.length ? v.reduce((t, n) => t + n, 0) / v.length : null;
  };
  const chaves = ["servico", "profissional", "atendimento", "ambiente", "localizacao"] as const;
  const porStaff = new Map<string, number[]>();
  for (const r of respostas) porStaff.set(r.staffId, [...(porStaff.get(r.staffId) ?? []), r.notaGeral]);
  return {
    total: respostas.length,
    geral: media(respostas.map((r) => r.notaGeral)),
    categorias: Object.fromEntries(chaves.map((c) => [c, media(respostas.map((r) => r.notas[c]))])) as Record<(typeof chaves)[number], number | null>,
    porStaff: [...porStaff].map(([id, notas]) => ({ id, total: notas.length, media: media(notas) })),
  };
}
