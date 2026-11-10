# Plano: pesquisa de avaliação pós-pagamento

> Status: guardado para implementar no futuro (07/11/2026). Protótipo: [prototipo-avaliacao.html](prototipo-avaliacao.html) (abrir no navegador) · Artifact: https://claude.ai/artifact/4LSv6hZX74E9p8wMcV87mW

## Context
Hoje o "Recebi" do caixa (`baixarAgendamento`) registra o pagamento e não manda nada ao cliente (`financeiro.server.ts:236`, "sem WhatsApp ao cliente"). O negócio não tem retorno sobre o atendimento. A pesquisa usa nota 1–5 e comentário opcional. O link vai por WhatsApp automático, cerca de 2h depois do pagamento. O painel mostra a média por profissional. Hoje não existe nenhum código de avaliação: tudo que se chama "rating" no projeto é a nota do Google, em `site.rating`.

## Etapa 0 — Protótipo para avaliação (agora, sem tocar no repo)
Antes de implementar, montar um protótipo navegável das telas e do fluxo. Ele é publicado como Artifact privado, em HTML com dados fictícios.
- Antes, ler o visual do painel para o protótipo parecer o app de verdade. Os arquivos são `src/app/[tenant]/painel-layout.tsx`, a página do negócio (`/[tenant]/negocio`), `caixa/page.tsx`, os tokens de cor/fonte em `globals.css` e o `booking-form.tsx` público.
- Telas, com navegação por passos e um seletor celular/computador:
  1. **Negócio → Avaliações (dono)**: um interruptor "Pedir avaliação após o pagamento", que vem **desligado**. A opção é do dono, e as opções abaixo só aparecem com ele ligado:
     - o prazo de envio: 1h, 2h (padrão) ou no dia seguinte às 10h;
     - a mensagem editável, com prévia;
     - o aviso de que só vai por WhatsApp conectado e de que respeita "não receber campanhas".
  2. **Caixa → "Recebi"**: o fluxo atual, mais uma linha discreta "Pesquisa de avaliação será enviada às 16:40". Só aparece se a opção estiver ligada.
  3. **WhatsApp do cliente**: a prévia da mensagem com o link.
  4. **Página pública /avaliar**: logo e nome do negócio, serviço, profissional e data. Tem 5 estrelas, um comentário opcional e Enviar. Depois vem a tela "Obrigado", com os estados "já avaliado" e "link inválido".
  5. **Painel → aba Avaliações**: média geral, total e a média por profissional. Lista os comentários recentes, com filtro por nota.
  6. **Estado desligado**: a aba sugere ligar a opção, com um link para a tela 1.
- O dono navega, comenta, e ajustamos. Só depois disso seguem as mudanças abaixo.

## Decisões
- **Gatilho**: o cron, não o `baixarAgendamento`. Assim o caixa continua sem envio síncrono, e o cron respeita a janela 22h–7h30 e o fuso.
- **Link**: `/avaliar/[tenant]/[appointmentId]?t=<hmac>`. É uma assinatura HMAC sem token gravado, no padrão de `remocao.server.ts:9`, com prefixo `"avaliacao:"+CRON_SECRET`.
- **Gravação**: `tenants/{t}/avaliacoes/{appointmentId}`. O doc id é o mesmo do agendamento, então cada atendimento tem no máximo uma avaliação. A escrita é só no servidor.
- **Liga/desliga é opcional e fica com o dono**: `avaliacao.enabled` vem desligado. Junto ficam `avaliacao.atrasoMin` e `avaliacao.mensagem`. É uma action própria, `configurarAvaliacaoAction`, gated por `exigeGestor`, no padrão de `configurarLembretesWhatsAppAction` (`[tenant]/actions.ts:351`). Não cria um `modulos.*` novo.
- O envio respeita `customers/{key}.semCampanha`.

## Mudanças
1. **`src/lib/financeiro.server.ts` `baixarAgendamento`**: na mesma transação, gravar `paidAt: now` no appointment. É o marcador que o cron usa.
2. **`src/lib/avaliacao.server.ts`** (novo):
   - `assinar(tenant, id)` e `confere(tenant, id, t)` com HMAC e `timingSafeEqual`.
   - `enviarPesquisasPendentes()`: copia a estrutura de `enviarLembretesDoDia` (`lembretes-whatsapp.server.ts:30`).
   - Para cada tenant com `whatsapp.avaliacaoEnabled==true`, buscar os appointments com `paidAt` entre agora−24h e agora−2h e sem `avaliacaoEnviadaEm`.
   - Reservar o envio em transação com `avaliacaoEnviadaEm`. Pular os clientes com `semCampanha`.
   - Enviar com `enviarTexto(lerConexao(...), customerPhone, msg)` (`atendys.ts:268`). Se falhar, limpar o marcador e chamar `registrarErroNotificacao`.
   - `salvarAvaliacao(tenant, id, {nota, comentario})`: valida com zod (nota int 1–5, comentário até 500 caracteres) e grava com `create()`. Se o doc já existir, devolve "já avaliado".
   - A avaliação leva `staffId`, `staffName`, `serviceName`, `customerName` e `createdAt`, lidos do appointment.
3. **`src/app/api/cron/lembretes/route.ts`**: chamar também `enviarPesquisasPendentes()`. A rota de cron existente roda a cada 10 min, então não precisa de uma entrada nova no crontab.
4. **`src/app/avaliar/[tenant]/[id]/page.tsx`** (nova, pública):
   - Token inválido → `notFound()`, como em `pagar/[id]/page.tsx`. Usar `robots: noindex`.
   - A página tem 5 estrelas (radios nativos), uma textarea e um botão. O server action chama `salvarAvaliacao` e a tela mostra "obrigado".
   - No mesmo arquivo de `src/proxy.ts:116` (domínio próprio), acrescentar `avaliar` só se for trivial. Senão, usar o link no domínio principal.
5. **`firestore.rules`**: `match /avaliacoes/{id}` com `read: if isMember(tenant)` e `write: if false`.
6. **`src/app/[tenant]/avaliacoes/page.tsx`** (nova):
   - Lista as avaliações com `useCollection` e zod.
   - Mostra a média geral e a média por profissional (com contagem), e os comentários recentes.
   - A aba vai em `painel-layout.tsx:91-98` e é gated por `podeGerir`.
7. **Ajuste na tela do negócio**: um checkbox "Pedir avaliação após o pagamento" junto do lembrete.

## Testes
- `avaliacao.test.mts` com o emulador, no padrão de `financeiro.test.mts`. Vira o script `test:avaliacao` no `package.json`. Ele cobre:
  - HMAC: aceita o token certo e rejeita o adulterado.
  - `salvarAvaliacao`: nota 0 ou 6 rejeitada, e a segunda gravação recusada.
  - `enviarPesquisasPendentes`: com a atendys mockada como em `atendys.test.mts`, envia só uma vez. Respeita `semCampanha` e não envia com `paidAt` de menos de 2h.
- `rules.test.mjs`: um membro lê `avaliacoes`, um anônimo não lê, e ninguém escreve.

## Verificação
- `npm run test:avaliacao && npm run test:rules && npm run build`.
- Teste manual no dev:
  1. Ligar a opção e dar "Recebi" num agendamento.
  2. Ajustar `paidAt` para agora−3h no emulador e chamar `GET /api/cron/lembretes` com Bearer.
  3. Conferir o log do envio, abrir o link, avaliar e ver o resultado na aba Avaliações.
  4. Abrir o link de novo: deve mostrar "já avaliado". Trocar o `t` deve dar 404.

## Fora do escopo
- O link da avaliação no recibo.
- Pedir avaliação no Google quando a nota for 5.
- Resposta "nota 5" pelo webhook.
- Avaliação em lançamento manual: não tem cliente.

## Em aberto (decidir ao retomar)
- **Nome da aba**: no celular, a barra de baixo passa de 6 para 7 itens, e no protótipo a aba ficou como "Notas". A alternativa é colocar as avaliações dentro de Clientes.
- **Estorno**: um pagamento estornado antes do envio deve cancelar a pesquisa. O protótipo já mostra isso, mas o plano acima ainda não. Falta acrescentar: o cron confere se o `lancamentos/ag-{id}` segue sem estorno.
- **Taxa de resposta**: o painel mostra "62% responderam". Para isso, é preciso contar os envios (`avaliacaoEnviadaEm`) em relação às avaliações.
- **Configuração no protótipo**: ela tem `avaliacao.{enabled, atrasoMin, mensagem}` e prazo de 1h, 2h ou "dia seguinte 10h". O item 2 do plano ainda cita `whatsapp.avaliacaoEnabled` e 2h fixas: alinhar com as Decisões.
