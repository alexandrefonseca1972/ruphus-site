# Fila de espera (serviço extra): plano de execução

O plano completo, com as decisões e os detalhes de cada tarefa, está em `~/.claude/plans/fa-a-uma-analise-profunda-zazzy-candy.md`. Os mockups estão em https://claude.ai/artifact/TSREgGcr3U96NWA2r7pAZ5.

O checklist visual fica em `docs/plano-fila-espera.html`. A página recarrega a cada 30 s e é atualizada pelo Opus.

## Regras para quem implementa (Haiku)
1. Faça uma tarefa por vez. Ao terminar, rode o critério de aceite e registre uma linha em "Registro".
2. Não mexa em arquivos fora da lista da tarefa. Não instale dependências. Não rode `git push`, deploy, scripts contra produção nem `--no-verify`. Nunca envie WhatsApp real: injete `enviar` nos testes.
3. Leia antes de escrever. Rode `graphify query` antes de grep ou leitura de arquivo, e reuse os helpers citados.
4. Se um teste falhar duas vezes, pare e escreva `BLOQUEIO:` no Registro.
5. **Não faça commit.** O commit é do Opus, depois da revisão. Há alterações de outra frente no working tree (`gerador*`, `catalogo.ts`, `financeiro.ts`, `painel-tipos.ts`, `site-editorial.ts`, `public/s/assets/otica/`): **não toque nelas**.

## Fase 0: preparação (Opus)
- [x] F0.1 Branch `feat/fila-espera`
- [x] F0.2 Plano em tarefas (este arquivo)
- [x] F0.3 Checklist HTML aberto no navegador
- [ ] F0.4 🙋 Template `oferta_espera` submetido à Meta (dono). O texto sai na F4.1

## Fase 1: serviço extra (solicitação e liga/desliga)
- [x] F1.1 `src/lib/modulos.ts`: `esperaLigada` (opt-in), com teste em `modulos.test.mts`
- [x] F1.2 `src/app/admin/actions.ts`: `modulosDoNegocioAction` e `definirModulosAction` com `espera`; pedido atendido ao ligar; `CAMPOS_DA_LISTA`
- [x] F1.3 `src/app/admin/plano-gaveta.tsx`: linha "Fila de espera" com selo, etiqueta de pedido, alerta de canal oficial e rollback em erro
- [x] F1.4 Painel "Meu negócio": cartão com 3 estados; `solicitarEsperaAction` e `cancelarSolicitacaoEsperaAction` com `alertarAdmin` idempotente
- [x] F1.5 `firestore.rules`: `espera` só pelo servidor, com caso em `rules.test.mjs`
- [x] F1.6 `espera-solicitacao.test.mts` e script `test:espera-f1` (package.json e CI)
- [x] F1.G Gate: tsc, lint, testes, graphify, revisão Opus, commit

## Fase 2: domínio puro
- [x] F2.1 `src/lib/fila-espera.ts`: tipos, Zod, `compativel`, `ordenar`, `podeAvisar`, `venceEm` e constantes
- [x] F2.2 `ocupadosDoDia` em `datetime.ts`; `agendaDias` devolve `ocupados` só com o módulo ligado
- [x] F2.3 `fila-espera.test.mts` e script `test:espera-f2`; regressão `test:booking`
- [x] F2.G Gate

## Fase 3: grade, folha e entrada (UI pública)
- [x] F3.1 `entrarNaFilaAction` e `sairDaFilaAction`: validação, erros previstos, idempotência, limites, `vagou`
- [x] F3.2 Grade: selo "livre", variante "avisar" ou "esperando" e acessibilidade
- [x] F3.3 Folha em modo `esperar`; caixa "quero trocar"; linha no estado "acabou de ser marcado"; validação em tempo real e máscara
- [x] F3.4 Memória local `espera:<tenant>` e faixa "Esperando…" com "Sair"
- [x] F3.5 `TEXTO_ACEITE_ESPERA`, `TERMO_ESPERA_VERSAO` e `optInDaEspera`
- [x] F3.6 `espera-entrada.test.mts` e script `test:espera-f3`; build; conferência no navegador em 390px e 1280px
- [x] F3.G Gate

## Fase 4: motor
- [x] F4.1 Template `oferta_espera` (reserva e troca) com flag; ações `eq`, `es`, `en`, `et` e `em` em `lerBotao`
- [x] F4.2 Consumo: tipo `espera` (5¢)
- [x] F4.3 `fila-espera.server.ts`: `processarLiberacoes` (cursor, idempotência, falhas isoladas) e `expirarAvisos`
- [x] F4.4 Cron `/api/cron/fila-espera`, `deploy/crontab.txt` e `vigiarCron`
- [x] F4.5 Índices em `firestore.indexes.json`
- [x] F4.6 `espera-motor.test.mts` e script `test:espera-f4`; regressão
- [x] F4.G Gate

## Fase 5: respostas no WhatsApp
- [x] F5.1 Botões `eq`, `es`, `en`, `et` e `em` em `src/lib/fila-espera-botoes.server.ts` (`book`/`reschedule` e Pix)
- [x] F5.2 Avisos ao dono e `origem:"espera"` no histórico
- [x] F5.3 `espera-botoes.test.mts` e script `test:espera-f5`; regressão
- [x] F5.G Gate

## Fase 6: acabamento
- [x] F6.1 Manual (`ajuda/conteudo.tsx`)
- [x] F6.2 Versão 0.43.0
- [x] F6.3 Suíte completa e build
- [x] F6.4 Ponta a ponta no navegador
- [x] F6.5 Revisão final Opus e verificador
- [ ] F6.6 🙋 Merge, deploy e flag do template (dono)

## Registro
- 2026-11-15: F0 (Opus). Branch `feat/fila-espera` criado a partir de `b0a3586f`. Plano e checklist criados. O working tree tem alterações alheias à fila, que não entram nos commits.
- 2026-11-15: F1 (Haiku: F1.1–F1.6; Opus: revisão e correções). Revisão Opus: 2 MUST-FIX corrigidos (a chave do alerta passa a ser por pedido, porque o `alertarAdmin` segura 6 h por chave; negócio "só site" não pede nem liga, com `UserError`). NITs corrigidos: `CAMPOS_DA_LISTA` sem campos não lidos (o `test:admin` acusou), plano lido de um só documento (`planoDe`/`lerEstado`), schema recusa `{}`, demo não pede, `aria-live` persistente, `role=alert` só na mensagem, texto "vai ativar o serviço", `mudar` tipado, dica "sem agendamento". Testes novos: cancelar sem pedido, ligar sem pedido, só site, pedido concorrente com 1 alerta. Gate: tsc 0, eslint 0, `test:admin`, `test:espera-f1` e `test:rules` verdes; `graphify update` feito. Pendente na F6.1: âncora `/ajuda#fila-espera`.
- 2026-11-15: F2 (Haiku: F2.1 e F2.2; Opus: revisão e correções). Revisão Opus: 2 MUST-FIX corrigidos. (1) A grade só mostra ocupados com 60 min ou mais de antecedência (`ANTECEDENCIA_MIN`), alinhada a `compativel`. (2) `ocupadosDoDia` recebe as janelas de toda a equipe e rareia depois de juntar, então não intercala 09:00/09:15. Também: `Set` para os livres, `DiaDaAgenda` tipado com `ocupados?`, a troca vence 60 min antes do preferido, JSDoc do fuso em `compativel`, `hhmm`/`toMin` exportados (sem duplicar) e "qualquer profissional" vira `staffId: null`. Testes novos: equipe com janelas defasadas; módulo ligado em `agendaDias` (Ana ocupada e Bia livre) no `booking.test.mts`. Gate: tsc 0, eslint 0, `test:booking`, `test:espera-f2` e `test:bio` verdes; `graphify update` feito.
- 2026-11-15: F3 (Haiku: servidor e UI; Opus: revisão, correções e conferência no navegador). Correções do Opus:
  - Ocupados passam a ser o início dos atendimentos marcados ("09h, 10h, 11h ocupados", como no cenário), e não uma grade rareada.
  - Ninguém toma a espera de outra pessoa: sem o token, a espera não muda.
  - A troca fecha a espera simples do mesmo dia.
  - O limite por aparelho é checado antes de ler a agenda; sem IP, todos dividem um balde.
  - A transação faz todas as leituras antes das escritas.
  - Semana ou dia só com ocupados não aparece como "cheio".
  - No painel (ficha do cliente), sem fila.
  - Sair só some da tela quando o servidor confirma.
  - A lista local é atualizada por id e de forma funcional.
  - Agendar o horário esperado encerra a espera.
  - O aceite da troca vem desmarcado e com texto próprio.
  - O botão sem aceite mostra o erro e foca a caixa.
  - Faixa única, só com o módulo ligado.
  - Token gerado com `getRandomValues`.
  - `aria-disabled` no "esperando" e rótulos em 11px.

  Conferência no navegador, com o dev apontado para o emulador (sem tocar em produção), negócio semeado "fila-demo" e 16/11 com 09h/10h/11h ocupados:
  - grade com os ocupados e o selo "livre";
  - folha "Avisar se 10:00 vagar";
  - erro sem aceite, com foco;
  - máscara do telefone;
  - entrada gravada com `staffId: null`;
  - faixa "Esperando 16/11 às 10:00";
  - Sair grava `saiu`;
  - módulo desligado deixa a grade igual à de antes;
  - 390px e 1280px sem erro no console.

  Capturas em `docs/fila-espera/`. Gate: tsc, lint e build verdes; `test:espera-f1`, `test:espera-f2`, `test:espera-f3`, `test:booking`, `test:rules` e `test:admin` verdes; graphify atualizado.
- 2026-11-15: F4 (Haiku: templates e motor; Opus: revisão com 6 MUST-FIX e 5 SHOULD-FIX, todas corrigidas por um executor Opus).
  - Janela da vaga: só se oferece início dentro do horário liberado.
  - Marcador por vaga (`esperaVagas`) e cursor `>=` com ids, o que torna o reprocessamento inofensivo.
  - Lease no cron.
  - Mudanças de estado só em transação condicional.
  - Esperas expiram pela data mesmo com o módulo desligado, no demo ou sem negócio.
  - Limite por telefone em `esperaFones`, dentro da transação, entre esperas e negócios.
  - Chave de envio com `eventoId`.
  - Evento que falha vira pendência.
  - `nao_sai` pula para o próximo candidato.
  - Pendência com 5 falhas alerta o admin.
  - Cache por execução.
  - Índices com COLLECTION e COLLECTION_GROUP.
  - Consumo não trata a espera como agendamento.
  - `vigiarCron` vigia o cron da fila.
  - Webhook ignora os botões `e*` até a F5.

  Textos para a Meta em `docs/fila-espera/templates-meta.md` (🙋 dono). Gate: tsc, lint e build verdes; `test:espera-f1` a `f4`, `canal-oficial`, `consumo`, `integracoes`, `booking`, `sinal`, `rules` e `admin` verdes. `test:atendys` falha também no `main` (b0a3586f), antes do branch: a previsão de saldo ("deve acabar em ~N dias") depende da data. Não é da fila; fica anotado para o dono.
- 2026-11-15: F5 (Haiku: respostas aos botões; Opus: revisão com 2 MUST-FIX e 3 médias, corrigidas por um executor Opus).
  - A vaga recusada (es/en/em ou beco sem saída) é reoferecida na hora (`reofertar`).
  - Botão antigo não reagenda horário cancelado, e o `extra` precisa bater com o aviso atual.
  - Corrida "Quero" × expiração: a cliente fica `agendada`.
  - Texto sem prometer confirmação pelo WhatsApp (o agendamento nasce com `aceiteWhatsapp: false`, porque o aceite da espera não cobre as mensagens do atendimento).
  - Troca só com o mesmo profissional.
  - Troca com sinal ou pagamento vai para o negócio.
  - "Quero" numa espera de troca é recusado.
  - Telefone sem truncar.
  - Push de oferta agrupado por vaga.
  - Prazo do sinal com data.

  Gate: tsc, lint e build verdes; `test:espera-f1` a `f5`, `canal-oficial`, `consumo`, `booking`, `sinal`, `rules`, `admin` e `integracoes` verdes. `test:atendys` tem só a falha que já existia no `main` (previsão de saldo, dependente da data).
- 2026-11-15: F6 (Haiku: manual e changelog; Opus: revisão final do branch inteiro e verificador).
  - Revisão final: 1 MUST-FIX corrigido (a caixa de troca voltava marcada a cada abertura, o que era inscrição sem consentimento).
  - SHOULD corrigidos: botão com o módulo desligado responde "encerrada"; o admin não liga sem `ATENDYS_TEMPLATE_ESPERA`; `TEXTO_ACEITE_TROCA` próprio na evidência; o manual corrigido (sinal na troca, sem lembrete no horário marcado pela fila, ordem da troca); `.env.example`; lease do cron só apaga o próprio; mensagem neutra contra enumeração.
  - O verificador pediu e entraram 4 testes: corrida entre "Quero" e reserva do site, remarcação × reserva e restauração × reserva, DEMO sem envio, espera sem aceite sem envio.
  - Gate: tsc, lint, `test:espera-f1` a `f5`, `booking`, `rules`, `admin`, `canal-oficial`, `consumo`, `integracoes`, `sinal` e `bio` verdes. Build verde no worktree limpo do commit. No working tree, o build falha só por `gerador.server.ts` (outra frente em andamento, campo `sobrancelha`).
  - A ponta a ponta no navegador foi feita na F3 (grade, folha, entrar e sair). O motor e os botões têm ponta a ponta nos testes do emulador.

  Pendente com o dono: F0.4 (templates na Meta) e F6.6 (merge, deploy com crontab e índices, flag).
