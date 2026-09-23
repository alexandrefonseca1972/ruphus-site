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
