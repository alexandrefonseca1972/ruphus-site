# Templates da fila de espera para a Meta (WABA Ruphus)

Categoria **Utilidade**, idioma **pt_BR**. Enviados à Meta em 15/11/2026 na WABA Ruphus (25334532499523029), status "Em análise". O primeiro texto ("Vagou um horário… quem tocar primeiro fica com ele") foi apontado pela Meta como Marketing e seria recusado; o texto abaixo deixa claro que é resposta a um pedido da cliente. Depois de aprovar os dois, ligue `ATENDYS_TEMPLATE_ESPERA=1` no `.env.local` da VPS. Até lá, nenhum aviso sai.

## ruphus_fila_espera_vaga

Corpo:
> Oi, {{1}}! Você pediu aviso na lista de espera de {{2}}. O horário que você aguardava ficou disponível: {{3}}, {{4}}. Deseja reservar? Responda SAIR para não receber mais avisos.

Exemplo das variáveis: {{1}} Juliana · {{2}} *Studio Bela* · {{3}} Corte + escova · {{4}} *domingo, 16/11 às 10:00*

Botões de resposta rápida, nesta ordem:
1. Quero este horário
2. Só serve o meu
3. Não quero mais

## ruphus_fila_espera_troca

Corpo:
> Oi, {{1}}! Você pediu para trocar seu horário em {{2}} ({{3}}). Ficou disponível: {{4}}. Seu horário atual: {{5}}. Deseja trocar? Responda SAIR para não receber mais avisos.

Exemplo das variáveis: {{1}} Juliana · {{2}} *Studio Bela* · {{3}} Corte + escova · {{4}} *domingo, 16/11 às 10:00* · {{5}} *14:00*

Botões de resposta rápida, nesta ordem:
1. Trocar de horário
2. Manter o meu
