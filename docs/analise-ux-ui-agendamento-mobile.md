# Análise de UX/UI do agendamento em dispositivos móveis

Data: 2 de novembro de 2026.

## Resumo

O agendamento tem uma boa base para celular: dispensa cadastro, exige poucos dados e mantém a ação de continuar na base da tela. As principais oportunidades são esclarecer o pagamento por sinal, melhorar a legibilidade e preservar as escolhas durante interrupções.

A primeira rodada recomendada é corrigir as mensagens de sinal Pix, ampliar a leitura do calendário e garantir que o preço permaneça visível no resumo fixo. Não é necessária uma reformulação visual para resolver esses pontos.

## Método e limites

- Duas avaliações independentes: revisão estática de UX e verificação automática com o detector Impeccable.
- O detector retornou zero alertas. Isso não elimina problemas de conteúdo, fluxo ou composição mobile.
- A inspeção visual no navegador não foi concluída. Dimensões derivadas das classes CSS são estimativas, não medições da interface renderizada.
- Não foram realizados agendamentos nem testes em aparelho real, teclado virtual, zoom ou leitor de tela.
- As referências abaixo correspondem ao código analisado; os números de linha podem mudar.

## Achados priorizados

| Prioridade | Achado | Impacto | Recomendação |
| --- | --- | --- | --- |
| Alta | A confirmação informa o sinal Pix, mas também promete “sem pagar nada agora”. A tela seguinte mostra “horário reservado” enquanto o sinal ainda é necessário. | Pode gerar expectativa incorreta sobre pagamento e garantia do horário. | Condicionar o texto à cobrança. Quando houver sinal, explicitar “Aguardando sinal”, valor e prazo, sem sugerir confirmação de pagamento automática. |
| Alta | O calendário tem sete colunas, rótulos de 9 px e largura estimada de 36 px por dia em uma tela de 320 px. | Dificulta leitura e toque preciso em telas estreitas. | Usar dias com pelo menos 44 px de largura e textos maiores; permitir rolagem horizontal se necessário e mostrar o mês de referência. |
| Alta | Serviços e preço compartilham uma linha truncada no resumo fixo. | Nomes longos podem ocultar o valor antes de continuar. | Separar o preço em um elemento que não seja truncado. Resumir seleções extensas, por exemplo “Corte + 2 serviços”, mantendo acesso ao resumo completo. |
| Média | Serviço, profissional, data, horário e etapa ficam apenas no estado da página. O armazenamento existente preserva contato e chave de idempotência, não o rascunho. | Recarregar ou reabrir a página pode obrigar a pessoa a repetir a seleção. | Preservar um rascunho por negócio na sessão e revalidar a disponibilidade antes de confirmar. |
| Média | Qualquer dia sem horários recebe “fechado”; a lista inicial exibe apenas os primeiros 12 horários. | Pode confundir lotação com fechamento e dificultar a descoberta de opções mais tarde. | Usar “Sem vagas” quando não houver informação de fechamento. Facilitar a descoberta de horários por período, preservando acesso a todos. |
| Média | Todos os serviços aparecem antes dos profissionais e horários. | Catálogos extensos aumentam a rolagem até a tarefa principal. | Para listas grandes, oferecer expansão progressiva e manter os selecionados visíveis. Evitar adicionar busca ou controles extras em catálogos curtos. |

### Referências ao código

Arquivo principal: `src/app/agendar/[tenant]/booking-form.tsx`.

| Tema | Linhas de referência |
| --- | --- |
| Aviso de sinal e promessa de não pagar agora | 708–712 e 836 |
| Sucesso e instrução de pagamento pendente | 428 e 477–480 |
| Calendário, tamanho dos textos e rótulo “fechado” | 996–1020 |
| Resumo fixo com truncamento | 1132–1145 |
| Estado das escolhas e armazenamento existente | 178–187, 218–230 e 306–313 |
| Limite inicial de horários | 1074 |
| Lista completa de serviços | 873–907 |

## Ajustes complementares

- Avaliar campos de 16 px em vez dos 15 px definidos em `CAMPO` (linha 67), verificando o zoom ao focar no Safari iOS.
- Aumentar a legibilidade dos rótulos e dicas de 9–10 px, especialmente datas, dados do resumo e validações.
- Mostrar nomes suficientemente completos para distinguir profissionais homônimos; atualmente a identificação visual usa o primeiro nome truncado (linha 972).
- Verificar a confirmação com teclado aberto e aviso de sinal: nessa etapa o botão deixa de ser fixo e pode exigir rolagem adicional (824–834).
- Rever a tentativa de desmarcar o único serviço: o código impede a ação silenciosamente, apesar da aparência de multisseleção (linha 287).

## Boas decisões a preservar

- Agendamento sem conta, com apenas nome e WhatsApp, autocomplete e teclado adequado.
- Botão “Continuar” na base da tela, com tratamento de safe area.
- Horários com aproximadamente 48 px de altura e serviços com pelo menos 56 px.
- Seleção automática do primeiro dia com disponibilidade.
- Estados de carregamento, mensagens acessíveis e foco no campo inválido.
- Timeout, retentativas e idempotência para reduzir problemas em conexões instáveis e evitar reservas duplicadas.
- Endereço, rotas, calendário e contato disponíveis após a reserva.

## Sequência recomendada e validação

1. Corrigir as mensagens sobre sinal e o estado da reserva. Conferir cenários com e sem sinal, incluindo prazo expirado.
2. Melhorar o calendário e a microtipografia. Validar telas de 320, 375 e 390 px, transição de mês e dias sem vagas.
3. Separar preço e descrição no resumo fixo. Validar serviços longos, múltiplos serviços, nomes longos de profissionais e safe area.
4. Tratar recuperação de rascunho e catálogos extensos. Validar recarga, horário que deixou de estar disponível e acesso aos horários posteriores aos 12 iniciais.

Antes de implementar, confirmar os riscos de layout na interface renderizada. Esta análise identifica oportunidades; não comprova aumento de conversão nem substitui teste de usabilidade com clientes.
