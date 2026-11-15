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
- [ ] F3.1 `entrarNaFilaAction` e `sairDaFilaAction`: validação, erros previstos, idempotência, limites, `vagou`
- [ ] F3.2 Grade: selo "livre", variante "avisar" ou "esperando" e acessibilidade
- [ ] F3.3 Folha em modo `esperar`; caixa "quero trocar"; linha no estado "acabou de ser marcado"; validação em tempo real e máscara
- [ ] F3.4 Memória local `espera:<tenant>` e faixa "Esperando…" com "Sair"
- [ ] F3.5 `TEXTO_ACEITE_ESPERA`, `TERMO_ESPERA_VERSAO` e `optInDaEspera`
- [ ] F3.6 `espera-entrada.test.mts` e script `test:espera-f3`; build; conferência no navegador em 390px e 1280px
- [ ] F3.G Gate

## Fase 4: motor
- [ ] F4.1 Template `oferta_espera` (reserva e troca) com flag; ações `eq`, `es`, `en`, `et` e `em2` em `lerBotao`
- [ ] F4.2 Consumo: tipo `espera` (5¢)
- [ ] F4.3 `fila-espera.server.ts`: `processarLiberacoes` (cursor, idempotência, falhas isoladas) e `expirarAvisos`
- [ ] F4.4 Cron `/api/cron/fila-espera`, `deploy/crontab.txt` e `vigiarCron`
- [ ] F4.5 Índices em `firestore.indexes.json`
- [ ] F4.6 `espera-motor.test.mts` e script `test:espera-f4`; regressão
- [ ] F4.G Gate

## Fase 5: respostas no WhatsApp
- [ ] F5.1 Botões `eq`, `es`, `en`, `et` e `em2` em `botoes-whatsapp.server.ts` (`book`/`reschedule` e Pix)
- [ ] F5.2 Avisos ao dono e `origem:"espera"` no histórico
- [ ] F5.3 `espera-botoes.test.mts` e script `test:espera-f5`; regressão
- [ ] F5.G Gate

## Fase 6: acabamento
- [ ] F6.1 Manual (`ajuda/conteudo.tsx`)
- [ ] F6.2 Versão 0.43.0
- [ ] F6.3 Suíte completa e build
- [ ] F6.4 Ponta a ponta no navegador
- [ ] F6.5 Revisão final Opus e verificador
- [ ] F6.6 🙋 Merge, deploy e flag do template (dono)

## Registro
- 2026-11-15: F0 (Opus). Branch `feat/fila-espera` criado a partir de `b0a3586f`. Plano e checklist criados. O working tree tem alterações alheias à fila, que não entram nos commits.
- 2026-11-15: F1 (Haiku: F1.1–F1.6; Opus: revisão e correções). Revisão Opus: 2 MUST-FIX corrigidos (a chave do alerta passa a ser por pedido, porque o `alertarAdmin` segura 6 h por chave; negócio "só site" não pede nem liga, com `UserError`). NITs corrigidos: `CAMPOS_DA_LISTA` sem campos não lidos (o `test:admin` acusou), plano lido de um só documento (`planoDe`/`lerEstado`), schema recusa `{}`, demo não pede, `aria-live` persistente, `role=alert` só na mensagem, texto "vai ativar o serviço", `mudar` tipado, dica "sem agendamento". Testes novos: cancelar sem pedido, ligar sem pedido, só site, pedido concorrente com 1 alerta. Gate: tsc 0, eslint 0, `test:admin`, `test:espera-f1` e `test:rules` verdes; `graphify update` feito. Pendente na F6.1: âncora `/ajuda#fila-espera`.
- 2026-11-15: F2 (Haiku: F2.1 e F2.2; Opus: revisão e correções). Revisão Opus: 2 MUST-FIX corrigidos. (1) A grade só mostra ocupados com 60 min ou mais de antecedência (`ANTECEDENCIA_MIN`), alinhada a `compativel`. (2) `ocupadosDoDia` recebe as janelas de toda a equipe e rareia depois de juntar, então não intercala 09:00/09:15. Também: `Set` para os livres, `DiaDaAgenda` tipado com `ocupados?`, a troca vence 60 min antes do preferido, JSDoc do fuso em `compativel`, `hhmm`/`toMin` exportados (sem duplicar) e "qualquer profissional" vira `staffId: null`. Testes novos: equipe com janelas defasadas; módulo ligado em `agendaDias` (Ana ocupada e Bia livre) no `booking.test.mts`. Gate: tsc 0, eslint 0, `test:booking`, `test:espera-f2` e `test:bio` verdes; `graphify update` feito.
