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
