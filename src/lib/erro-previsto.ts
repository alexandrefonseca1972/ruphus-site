/** Erro que a tela pode mostrar como está; o resto vira "não foi possível" e vai para o log */
export class ErroPrevisto extends Error {}

/** Teto atingido (orçamento de IA do dia, toques da cadência): a tela mostra o motivo. */
export class LimiteAtingido extends ErroPrevisto {
  readonly codigo = "LimiteAtingido";
}
