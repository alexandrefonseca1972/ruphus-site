/** Quantos profissionais um negócio pode cadastrar, até o admin da plataforma mudar.
 *
 * Fica num arquivo só, sem import: o número é lido no painel (cliente), no /admin
 * e no servidor. O limite de negócios por conta mora em negocios.server.ts. */
export const LIMITE_STAFF_PADRAO = 5;
export const LIMITE_STAFF_MAX = 50;

/** O limite deste negócio: o que o admin definiu, ou o padrão. */
export const limiteStaffDe = (limiteStaff?: number | null) => limiteStaff ?? LIMITE_STAFF_PADRAO;

/** Teto do logout automático por inatividade (12 horas). 0 desliga. */
export const MINUTOS_MAX = 720;

/** Validade do convite de acesso ao painel, em dias. Sete, não trinta: o link
 *  dá acesso de admin do negócio a quem o tiver na mão, e link é repassado. */
export const DIAS_CONVITE = 7;

/** O aviso do logout automático aparece este tanto antes do fim. */
export const AVISO_SESSAO_MS = 60_000;

/** Em que ponto está quem está parado há `parado` ms, com logout em `minutos` (0 desliga).
 *  Com prazo de 1 minuto não há aviso: ele cobriria a sessão inteira. */
export function faseDaSessao(parado: number, minutos: number): "ativa" | "aviso" | "sair" {
  const limite = minutos * 60_000;
  if (!minutos || parado < limite - AVISO_SESSAO_MS) return "ativa";
  if (parado >= limite) return "sair";
  return minutos >= 2 ? "aviso" : "ativa";
}
