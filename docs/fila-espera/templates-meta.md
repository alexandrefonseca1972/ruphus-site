# Templates da fila de espera para a Meta (WABA Ruphus)

Categoria **Utilidade**, idioma **pt_BR**. Depois de aprovar os dois, ligue `ATENDYS_TEMPLATE_ESPERA=1` no `.env.local` da VPS. Até lá, nenhum aviso sai.

## ruphus_fila_espera_vaga

Corpo:
> Oi, {{1}}! Vagou um horário em {{2}}: {{3}}, {{4}}. Quem tocar primeiro fica com ele. Responda SAIR para não receber mais.

Exemplo das variáveis: {{1}} Juliana · {{2}} *Studio Bela* · {{3}} Corte + escova · {{4}} *domingo, 16/11 às 10:00*

Botões de resposta rápida, nesta ordem:
1. Quero este horário
2. Só serve o meu
3. Não quero mais

## ruphus_fila_espera_troca

Corpo:
> Oi, {{1}}! Vagou {{4}} em {{2}} ({{3}}). Seu horário atual: {{5}}. Quer trocar? Responda SAIR para não receber mais.

Exemplo das variáveis: {{1}} Juliana · {{2}} *Studio Bela* · {{3}} Corte + escova · {{4}} *domingo, 16/11 às 10:00* · {{5}} *14:00*

Botões de resposta rápida, nesta ordem:
1. Trocar de horário
2. Manter o meu
