# Plano de correção — revisão final de 10/11/2026

Origem: `docs/revisao-final-2026-11-10.md` (revisão de `origin/main` em `6b966a11`). Este arquivo é o índice; o detalhe de cada item (trecho atual, trecho novo, teste e critério de pronto) está nos quatro arquivos da pasta `docs/plano-correcao-2026-11-10/`. O plano foi escrito para ser executado por um modelo pequeno, um item de cada vez, sem decidir nada por conta própria.

| Parte | Arquivo | Itens | PRs |
|---|---|---|---|
| 1 | `plano-correcao-2026-11-10/1-whatsapp.md` | A1, A2, A7, A8, M1–M4, B1–B6 | 3 |
| 2 | `plano-correcao-2026-11-10/2-agendamento.md` | M1–M4, B1–B8 (B4a, B4b) | 4 |
| 3 | `plano-correcao-2026-11-10/3-painel.md` | A3, A4, M1–M7, B1–B8 | 4 |
| 4 | `plano-correcao-2026-11-10/4-operacao.md` | A5, A6, O1–O8, S1–S3, F1–F5, L1–L22 | 6 |

Os ids (A, M, B, O, S, F, L) são de cada arquivo; o mesmo id pode existir em partes diferentes. Ao citar um item, cite a parte junto: "parte 3, A3".

## Regras para quem executa

1. Um PR por vez, na ordem da seção "Ordem" abaixo. Cada branch sai de `origin/main` atualizado: `git fetch origin && git switch -c <branch> origin/main`.
2. Antes de editar, abra o arquivo e confira que o "Trecho atual" do plano está lá, igual. Se não estiver (linha diferente é normal; texto diferente não é), pare e avise. Não adapte.
3. Troque o "Trecho atual" pelo "Trecho novo" inteiro. Não mude nada fora do trecho, nem comentários vizinhos.
4. Todo item marcado com "DECISÃO DO USUÁRIO" tem um padrão escrito. Siga o padrão, salvo instrução contrária recebida antes de começar o PR. A lista das decisões está mais abaixo; peça a resposta de todas antes do primeiro PR da parte.
5. Depois de cada item, rode o teste indicado nele. Depois de todos os itens do PR, rode `npm run lint`, `npm run typecheck` e os testes do PR. Testes com emulador (`test:booking`, `test:financeiro`, `test:convite`, `test:atendys`, `test:rules`, entre outros) precisam do Firebase CLI instalado; eles são rodados por `firebase emulators:exec`, já embutido no script npm.
6. Se um teste que já existia quebrar, pare e mostre a saída. Não ajuste o teste antigo para passar.
7. Nada de placeholder: sem `TODO`, sem `test.skip`, sem função vazia "para depois". Se um item não puder ser terminado, o PR não abre.
8. Mensagem de commit e título do PR em português, como os do histórico (`git log --oneline -20`). O corpo do PR lista os ids do plano e os comandos de teste que passaram.
9. Não faça deploy. Deploy é `bash scripts/deploy-vps.sh` a partir da `main`, e só o usuário manda rodar.
10. Dois itens não são código deste repositório e ficam como pedido ao atendys (parte 1, B6 e A8c). Só registre no corpo do PR.

## Ordem dos 17 PRs

A ordem evita conflito: PRs da mesma parte mexem nos mesmos arquivos e testes, então o seguinte só começa depois do anterior entrar na `main`. Partes diferentes raramente se tocam; mesmo assim, siga a ordem.

| # | Parte | Branch | Conteúdo |
|---|---|---|---|
| 1 | 4 | `fix/deploy-rollback-e-teto` | A5, A6, O3, O4, L13 — deploy: worker reiniciado, build com teto de memória, rollback automático, Caddy sem 502 |
| 2 | 1 | `fix/whatsapp-aviso-dono` | A8, A1, A2, M3, B3 — aviso e resposta ao dono no número certo, limite por destinatário |
| 3 | 1 | `fix/whatsapp-cron-idempotencia` | A7, M1, B1, B2 — cron não cai por um negócio, lembrete com chave de idempotência |
| 4 | 3 | `fix/caixa-comissao-tela` | A3, M4, M7, B1, B3 — comissão com sinal antigo, lançamento descartado visível, vales |
| 5 | 3 | `fix/sessao-entre-abas` | A4, M1, M2 — logout automático contado entre abas, com aviso, sem desligar o push |
| 6 | 4 | `fix/alertas-cron-e-erros` | O1, O2, O5, O8, F5 — cron parado avisa, `onRequestError`, índice do admin fora do boot, timeout do SMTP, domínio reverificado |
| 7 | 2 | `fix/telefone-canonico` | M1, B2 — chave do cliente com 9º dígito, telefone sem 55 recusado, script de migração só com relatório |
| 8 | 2 | `fix/sinal-cron` | B5, M2, M3 — cron do sinal não cancela depois do início, erro passageiro tenta de novo |
| 9 | 4 | `fix/sites-publicos-e-dominios` | O6, O7, F3, F4, L6, L7 — gerador antes do Storage, og.jpg com timeout, listas do proxy sem falso vazio, 307 |
| 10 | 4 | `fix/cota-de-email-e-regras` | S1, S2, L1, L2, L3 — cota de convites e recibos, e-mail confirmado, regras de conteúdo, log sem telefone |
| 11 | 1 | `fix/painel-whatsapp-acoes` | B4, M2, M4, B5 — ações sem uso removidas, chave de idempotência mantida em falha incerta, `exigeGestor`, aviso SAIR no Pix |
| 12 | 2 | `fix/painel-remarcacao-fuso` | M4, B1, B3, B6, B7, B8 — remarcação do painel com serviço oculto, não excluir profissional com horário, fuso do negócio |
| 13 | 3 | `fix/painel-acesso-e-clientes` | M5, M6, B2, B4, B5 — erro de rede separado de sem acesso, total gasto real, som do cache, botão corrigir, fuso |
| 14 | 4 | `fix/fabrica-fotos-e-gerador` | F1, F2, L8, L9, L10, L11, L12 — foto só troca ao publicar, gerar com `create`, edição preservada, gaveta |
| 15 | 2 | `fix/pix-txid` | B4a, B4b — txid único e com competência |
| 16 | 3 | `fix/convite-e-recibo` | B6, B7, B8 — texto do convite, extenso acima de R$ 1 milhão, member em convite de dono |
| 17 | 4 | `chore/limpeza-e-ci` | L5, L14, L15, L16, L17, L18, L19, L20, L21, L22 — audit fix, `.env.example`, `SITE_BASE`, rotas e scripts mortos, testes no CI |

Parte 4, L4 (CSP) é fase 2: não implementar. Parte 4, A6 tem uma fase 2 (build no GitHub Actions): não implementar.

## Decisões do usuário

Responder antes de começar o PR indicado. Sem resposta, vale o padrão.

| PR | Parte/item | Pergunta | Padrão |
|---|---|---|---|
| 1 | 4, A6 | Teto de memória do build na VPS: 1800M ou 2200M? | 1800M; subir para 2200M se o primeiro build morrer por OOM. Nunca acima de 2200M. |
| 2 | 1, A8 | Limite por destinatário nos tenants do atendys: (a) 30/dia e 150/semana, (b) 50 e 300, (c) 100 e 500. | (a). O script `limites:whatsapp`, que ajusta os tenants já existentes, roda na VPS só com OK do usuário. |
| 6 | 4, O5 | Além de tirar o índice do admin do boot, baixar `OCIOSO_MS` de 12 h para 1 h? | Não mudar (só tirar do boot). |
| 7 | 2, M1 | Rodar `scripts/migrar-chave-cliente.mts --aplicar` em produção ou só o relatório? | Só o relatório. Duplicados nunca são mesclados. |
| 10 | 4, S1 | Exigir e-mail confirmado para criar negócio (um passo a mais no funil para quem entra com e-mail e senha; Google já vem confirmado)? | Sim, exigir. |
| 11 | 1, M4 | `decidirEnvioAction` só para gestor (a equipe perde os botões na agenda e lê "O dono decide em Mensagens") ou manter como está? | Exigir gestor. |
| 11 | 1, B5 | Aviso de SAIR no Pix antes do código Pix ou no fim da mensagem? | Antes do código, para quem copia a mensagem não levar o aviso ao app do banco. |
| 12 | 2, M4 | A remarcação feita pelo cliente no WhatsApp continua exigindo serviço e profissional no link? | Sim, continua exigindo. Só o painel deixa de exigir. |
| 12 | 2, M4 | O plano recorrente novo pelo painel deve aceitar serviço oculto ou profissional fora do link? | Não mexer em `createPlan`. Se precisar, é outra tarefa. |
| 17 | 4, L21 | Mover também o `tsx` de devDependencies para dependencies (o worker usa)? | Não mover. |

## Pedidos ao atendys (fora dos PRs)

- Parte 1, B6: códigos próprios para os três casos de 409 do opt-in, em vez de `VALIDATION_ERROR` com texto em português.
- Parte 1, A8c: isenção do número do dono no limite por destinatário, ou limite separado por finalidade (`notification` vs `reminder`).

## Fora deste plano

Itens da revisão sem instrução detalhada, por serem fase 2 ou dependerem de medição: CSP com nonce (parte 4, L4); build no GitHub Actions (parte 4, A6 fase 2); separar `src/app/admin/page.tsx` por aba; ícones SVG comuns entre `site-claro.ts` e `site-editorial.ts` (parte 4, L19 só cobre a luminância); 9 `eslint-disable exhaustive-deps` sem motivo escrito.
