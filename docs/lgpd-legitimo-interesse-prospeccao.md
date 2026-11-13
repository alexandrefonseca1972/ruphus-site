# Legítimo interesse: prospecção pelo WhatsApp (F3)

Avaliação de legítimo interesse (LGPD, art. 7º, IX, e art. 10) para o tratamento de dados de donos de negócios de beleza na prospecção da Ruphus. Rascunho técnico de 12/11/2026: não é parecer jurídico. A decisão e a revisão ficam com o dono da Ruphus.

## 1. O que é tratado

- **Do negócio (fonte pública):** nome, endereço, telefone comercial, nota e número de avaliações no Google, perfil do Instagram, serviços. Origem: perfil público no Google Maps e no Instagram.
- **Da conversa (fornecido pelo próprio lead):** número de WhatsApp de quem escreve, texto das mensagens, horário, tipo (texto ou mídia), o aceite "posso te mandar por aqui?" com o texto exato da resposta.
- **Não tratado:** dados de clientes do negócio, dados sensíveis (art. 5º, II), conteúdo de áudio (o agente não transcreve: pede texto e passa para uma pessoa).

## 2. Finalidade

Oferecer a um negócio a agenda online e o site demo que a Ruphus montou com os dados públicos dele, e responder às perguntas de quem pediu para falar com a Ruphus.

- O agente de IA só responde a quem **iniciou a conversa** (botão "Falar com a Ruphus" no site demo, anúncio de clique para WhatsApp, QR em visita, ou lead que aceitou continuar). Não há envio frio automático.
- Finalidade legítima, concreta e informada: a primeira mensagem do agente diz que é a assistente virtual da Ruphus.

## 3. Necessidade (minimização)

- Só o necessário para a oferta: dados comerciais públicos e a própria conversa.
- O contexto da IA é isolado por lead: a conversa de um número nunca entra no pedido de outro.
- A IA recebe o nome do negócio, se há site demo e as últimas 10 falas da conversa. Não recebe telefone, endereço nem dados do CRM além disso.
- Áudio e mídia não são processados por IA nesta fase.

## 4. Balanceamento

**Interesse da Ruphus:** prospectar negócios do nicho com uma oferta relevante para eles.

**Expectativa do titular:** o dono de um negócio com perfil público e telefone comercial divulgado espera contato comercial sobre o negócio, sobretudo quando ele mesmo clica para falar.

**Riscos e salvaguardas:**

| Risco | Salvaguarda no código |
|---|---|
| Insistência indesejada | Opt-out determinístico (PARE, SAIR, STOP, PARAR, CANCELAR, DESCADASTRAR) antes de qualquer IA; grava `naoContatarEm` no CRM e na conversa e confirma a saída |
| Mensagem errada da IA (preço, promessa, link estranho) | Validador (`problemasDaResposta`) antes de enviar; falha passa para uma pessoa |
| Conversa longa com robô | Até 6 respostas por lead por dia, custo máximo por conversa, laço com resposta automática (3 seguidas) passa para uma pessoa |
| Assuntos sensíveis à decisão (preço, fechamento, irritação) | Passam direto para uma pessoa, sem IA |
| Prejuízo ao número da plataforma | A prospecção nunca usa a instância nem o número da plataforma (trava fixa no código) |
| Queixa em massa | Disjuntor: opt-out + bloqueio acima de 2% no dia, ou queda do quality_rating, desliga o agente |

**Conclusão provisória:** com o lead iniciando a conversa e as salvaguardas acima, o interesse legítimo prevalece para a finalidade descrita. Envio ativo fora da janela de 24 h só com opt-in registrado (origem, texto exato, data), na F5.

## 5. Transparência

- A primeira mensagem identifica a assistente virtual da Ruphus.
- O site demo diz que é uma proposta da Ruphus, com "Pedir remoção" e link para a política de privacidade.
- **Pendente (dono):** a política de privacidade publicada precisa declarar (a) a prospecção pelo WhatsApp com base em legítimo interesse, (b) o uso de assistente virtual e (c) o envio do texto das conversas à Anthropic (provedor da IA, fora do Brasil: transferência internacional, art. 33). Esta entrega não altera a política publicada.

## 6. Direitos do titular

- Oposição: responder PARE (ou SAIR, STOP) encerra os envios na hora.
- Remoção do site demo: link "Pedir remoção" na faixa do site.
- Acesso, correção e eliminação: pelo contato indicado na política de privacidade.

## 7. Retenção

- Conversas (`prospeccaoConversas/{telefone}` e a subcoleção `recebidas`), envios (`prospeccaoEnvios`): 12 meses, pelo campo `expiraEm` (TTL do Firestore). Ligar uma vez em produção (pendente, dono):
  - `gcloud firestore fields ttls update expiraEm --collection-group=prospeccaoConversas`
  - `gcloud firestore fields ttls update expiraEm --collection-group=recebidas`
  - `gcloud firestore fields ttls update expiraEm --collection-group=prospeccaoEnvios`
- Telemetria da IA (`iaChamadas`): 90 dias, sem o texto da conversa.
- O registro de opt-out (`naoContatarEm`) fica enquanto houver o lead no CRM: é ele que impede novo contato.

## 8. Revisão

Revisar esta avaliação a cada mudança de fonte de leads, de provedor de IA ou de volume (F5), e ao menos uma vez por ano.
