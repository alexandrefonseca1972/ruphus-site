# Integração ruphus.site ↔ atendys — ajustes após o deploy do atendys de 2026-11-08

> Escrito em 2026-11-09. Ponto de partida: branch `qa-codex` (879b0f4a). Mudanças do atendys publicadas em produção às 23:41 de 2026-11-08 (commit local `41d6646`, cópia em `~/AI/projects/atendys`).
> Leitores: quem implementa no ruphus.site e quem valida em produção. Cada item tem **o problema**, **como confirmar**, **o que mudar**, **os testes** e **o critério de pronto**.

## 0. O que mudou no atendys e afeta o ruphus.site

| # | Mudança no atendys | Efeito no ruphus.site |
|---|---|---|
| A | **Telefone canônico.** Celular BR sai **sempre com o 9º dígito** (13 dígitos, ex. `5531987654321`), inclusive em contas antigas cujo JID no WhatsApp é `553187654321`. Vale para `phone` em `message.received` e `message.status`. A migração `20261109000000_br_mobile_canonical` também reescreveu o histórico do atendys para esse formato. | Toda comparação de telefone feita no ruphus.site com número de 12 dígitos deixa de casar. **Crítico:** os comandos CONFIRMADO/RECUSAR do dono (item 1). |
| B | O **telefone da instância** (`instance.status` → `phone`, vindo do `wuid` da Evolution) **não** foi canonizado: continua como o WhatsApp registra (12 ou 13 dígitos). | `conexao.phone` (número do salão) pode ter 12 dígitos enquanto o remetente do self-chat chega com 13 (item 1). |
| C | **Status pode ir de `failed` para `sent`.** Envio com resultado incerto (`SEND_OUTCOME_UNKNOWN`) que de fato saiu é reconciliado pelo eco e gera `message.status = sent` depois do `failed`. | `atualizarParada` aceita a transição (ordena por `at`), mas mantém o `errorCode` antigo (item 3). |
| D | Mensagens de **conversas temporárias** (ephemeral/visualização única) agora chegam com texto. Antes chegavam vazias e eram descartadas. | Comandos do dono enviados numa conversa temporária passam a funcionar. Nenhuma mudança necessária; testar (item 7). |
| E | Evolution fora do ar **adia** o envio (`DEFERRED_UPSTREAM`, nova tentativa em 60 s) em vez de marcar `failed`. | `message.status` pode chegar com `queued` + `retryAt` em situação nova. `situacaoDe` já trata `retryAt` como "agendada". Testar (item 7). |
| F | **Planejado, ainda não feito no atendys:** timestamp na assinatura do webhook. | O verificador do ruphus.site precisa aceitar os dois formatos antes de o atendys mudar (item 5). |

---

## 1. P0 — Comandos do dono com número de conta antiga (12 dígitos)

### Problema
`processarComandoAgendamento` (`src/lib/whatsapp.server.ts:408`) só aceita o comando quando o remetente é o número do salão ou o WhatsApp pessoal do dono:

```ts
const dono = conexao?.ownerPhone ? soDigitosComDDI(conexao.ownerPhone) : null;
const numeroSalao = conexao?.phone ? soDigitosComDDI(conexao.phone) : null;
const remetente = msg.phone ? soDigitosComDDI(msg.phone) : null;
if (remetente !== numeroSalao && remetente !== dono) return "ignorado";
```

Depois do deploy do atendys, o `remetente` de uma conta antiga chega com **13 dígitos**. Já o `conexao.phone` (gravado por `espelharStatusDaInstancia` a partir do `instance.status`) e o `ownerPhone` (digitado na gaveta) podem estar com **12**. Resultado: **CONFIRMADO/RECUSAR passam a ser ignorados em silêncio** para salões cujo número, ou cujo WhatsApp pessoal do dono, é de conta antiga.

> **CONFIRMADO em 2026-11-09:** 5 das 6 instâncias têm número de conta antiga (12 dígitos), incluindo os salões reais `ruphusbel-main` (`559192361726`) e `barbearia-force-main` (`559192361726`), além de `piloto-91`, `alexandre-teste-atendimento` e `exemplo-vet-main` (`559191121306`). Só `piloto-principal` (`5511948680554`) não é afetado. Os comandos do dono desses salões estão quebrados desde o deploy do atendys (2026-11-08 23:41). **Correção urgente.**

### Como confirmar (antes de mexer)
1. No atendys de produção, liste os números das instâncias. A consulta só lê; rode na VPS:
   ```bash
   ssh vps 'cd /opt/atendys && export $(grep -E "^DATABASE_URL=" .env | xargs) && \
     psql "${DATABASE_URL%%\?*}" -qAt -c "SELECT name, phone, phone ~ '"'"'^55[1-9][0-9][6-9][0-9]{7}$'"'"' AS conta_antiga FROM \"Instance\" WHERE phone IS NOT NULL ORDER BY name"'
   ```
   `conta_antiga = t` significa que aquele salão está afetado.
2. No Firestore, confira `tenants/<slug>` → `whatsapp.phone` e o `ownerPhone` (doc privado) dos salões ativos. Qualquer valor com 12 dígitos começando em `55 + DDD + [6-9]` está afetado.
3. Sintoma em produção: o dono responde "CONFIRMADO" no self-chat e não recebe nem a confirmação nem a mensagem "Não encontrei agendamento…". No log aparece `[atendys] mensagem de 55DD9XXXXXXXX para <slug>` sem a linha `comando de agendamento`.

### O que mudar
1. Em `src/lib/telefone.ts`, criar a mesma regra do atendys (`apps/api/src/utils/phone.ts` → `canonicalBrMobile`):
   ```ts
   /** Celular BR em forma canônica (com o 9º dígito), igual ao atendys. Contas antigas
    *  aparecem no WhatsApp sem o 9; fixo (assinante começando em 2-5) não tem par. */
   export function canonicalBrMobile(digits: string): string {
     return /^55[1-9]\d[6-9]\d{7}$/.test(digits) ? `${digits.slice(0, 4)}9${digits.slice(4)}` : digits;
   }
   ```
   E fazer `soDigitosComDDI` devolver o valor canonizado (`return canonicalBrMobile(d)` / `` canonicalBrMobile(`55${d}`) ``). Assim **todo** telefone que passa por ela (gaveta, comando, envio) fica no mesmo formato. Atenção aos outros 16 usos de `soDigitosComDDI` fora de `telefone.ts`: liste com `grep -rn soDigitosComDDI src` e confirme que nenhum deles depende do formato curto (ex.: comparação com valor já gravado sem canonizar). O envio para o atendys aceita os dois, porque ele mesmo canoniza.
2. Nada muda em `processarComandoAgendamento`: com o item 1, `dono`, `numeroSalao` e `remetente` passam todos por `soDigitosComDDI`.
3. Dados já gravados: **não precisam de migração**. `conexao.phone` e `ownerPhone` são canonizados na leitura pela própria `soDigitosComDDI`. A gaveta continua mostrando o que o dono digitou.
4. **Também no atendys (recomendado, mesma janela):** canonizar o telefone da instância em `apps/api/src/webhooks/webhooks.controller.ts` (`CONNECTION_UPDATE`, ~linha 98: `phone = canonicalBrMobile(digits)`) para o `instance.status` sair consistente. O ruphus.site fica correto mesmo sem isso.

### Testes
- **Unitário** (novo bloco em `whatsapp.test.mts` ou um `telefone.test.mts` com `tsx`):
  - `canonicalBrMobile("553187654321") === "5531987654321"`
  - `canonicalBrMobile("5531987654321") === "5531987654321"` (idempotente)
  - `canonicalBrMobile("553133334444") === "553133334444"` (fixo não muda)
  - `soDigitosComDDI("(31) 8765-4321") === "5531987654321"`; `soDigitosComDDI("+55 31 98765-4321") === "5531987654321"`
- **Integração** (`atendys.test.mts`, que já testa `processarComandoAgendamento` no emulador; rodar com `npm run test:atendys`):
  - conexão com `phone: "553187654321"` (salão de conta antiga) + comando de `"5531987654321"` → **confirma** o pendente.
  - `ownerPhone: "(31) 8765-4321"` + comando de `"5531987654321"` → **confirma**.
  - remetente de terceiro `"5531999990000"` → `"ignorado"` (não regrediu).

### Pronto quando
`npm run test:atendys` e `npm run test:whatsapp` passam com os casos acima, e o roteiro manual 7.2 passa num salão de conta antiga.

---

## 2. P1 — Outros pontos que comparam ou guardam telefone

| Onde | Situação | Ação |
|---|---|---|
| `registrarMensagemRecebida` (`whatsapp.server.ts:245`) grava `phone` em `tenants/<slug>/whatsappInbox` | Histórico antigo com 12 dígitos, novo com 13. Hoje **nenhuma tela lê** `whatsappInbox` (`grep -rn whatsappInbox src`) | Nenhuma agora. Se uma tela agrupar por telefone no futuro, agrupar por `canonicalBrMobile(phone)`. |
| `customerPhone` dos agendamentos usado no envio ao cliente | O atendys canoniza na entrada; o envio funciona com 12 ou 13 | Nenhuma. Opcional: gravar já canonizado no agendamento novo, via `soDigitosComDDI` do item 1. |
| Opt-out do cliente ("SAIR") | Quem bloqueia é o **atendys** (Recipient). Ele agora casa as duas formas | Nenhuma no ruphus.site. Validar no roteiro 7.4. |

---

## 3. P1 — Transição `failed` → `sent` em `message.status`

### Problema
`atualizarParada` (`src/lib/mensagens-paradas.server.ts:57`) grava o novo status quando o `at` é mais novo, mas só escreve `errorCode` quando ele vem preenchido:

```ts
tx.update(ref, { status, at, ...(retryAt !== undefined && { retryAt }), ...(errorCode && { errorCode }), ... });
```

Um `sent` depois de `failed` deixa o `errorCode` antigo no documento. Qualquer tela que mostre "erro" pelo `errorCode` vai exibir falha numa mensagem enviada.

### O que mudar
Quando `status` for `sent`, `delivered` ou `read`, limpar o erro: `errorCode: FieldValue.delete()`. Os demais status mantêm o comportamento atual.

### Testes
`mensagens.test.mts` (`npm run test:mensagens`), ou no emulador se a função exigir Firestore:
- sequência `failed (errorCode=SEND_OUTCOME_UNKNOWN, at=1)` → `sent (at=2)` ⇒ doc com `status=sent` e **sem** `errorCode`.
- `sent (at=2)` seguido de `failed (at=1)` atrasado ⇒ continua `sent` (a ordenação por `at` já garante; o teste protege).

### Pronto quando
Os testes passam e nenhuma tela mostra erro para mensagem com `status ∈ {sent, delivered, read}`.

---

## 4. P2 — Falhas de entrega de webhook para `https://ruphus.site/api/webhooks/atendys` (03–04/11)

Os logs do atendys (`/root/.pm2/logs/atendys-*-out-*.log`) mostram entregas repetidas falhando entre 03 e 04/11 (`Entrega falhou (tentativa 1..4)`). A causa ainda não foi vista: o log está cortado e, depois do deploy, mostra só o host, não a URL completa.

### Como investigar
1. No atendys, as entregas falhas desse destino. A consulta só lê:
   ```sql
   SELECT "id", "event", "status", "attempts", "createdAt", "updatedAt"
   FROM "WebhookDelivery"
   WHERE "url" LIKE 'https://ruphus.site/%' AND "status" <> 'delivered'
   ORDER BY "updatedAt" DESC LIMIT 50;
   ```
   A tabela não guarda o erro: o motivo (HTTP xxx / erro de rede) está só no log do worker. Cruze o `id` com `grep <id> /root/.pm2/logs/atendys-worker-out-*.log`.
2. No ruphus.site, os logs do mesmo período: `journalctl -u ruphus-site --since "2026-11-03" --until "2026-11-05" | grep -i "webhook atendys\|api/webhooks/atendys"`.
3. Causas prováveis, em ordem:
   - **401 `Assinatura inválida` / `Tenant sem segredo`:** o `atendysWebhookSecret` do negócio diverge do secret cadastrado no tenant do atendys (rotação de um lado só).
   - **5xx / timeout (> 15 s):** trabalho síncrono antes do 200. A rota já usa `after()` para comandos e push; verificar se a falha foi anterior a essa mudança.
   - **400 `Evento sem instância`:** evento novo sem `instance`.

### Pronto quando
Causa identificada e registrada aqui. Entregas `pending`/`failed` do período reenfileiradas pelo endpoint de ops do atendys (`POST /admin/deliveries/:id/retry`, com a chave admin), ou descartadas conscientemente.

---

## 5. P2 — Timestamp na assinatura do webhook (anti-replay)

Hoje a assinatura é `HMAC-SHA256(secret, body)` em `x-atendys-signature`, sem tempo. Quem capturar um webhook pode reenviá-lo indefinidamente. A `messageId` de `message.received` é deduplicada pelo `create`, mas `instance.status` e `message.status` não.

### Formato novo (proposto, mesmo desenho do Stripe)
- Header `x-atendys-timestamp`: epoch em **segundos**.
- Header `x-atendys-signature-v2`: `HMAC-SHA256(secret, "${timestamp}.${body}")` em hex.
- O header antigo `x-atendys-signature` continua sendo enviado durante a transição.

### Ordem de rollout (obrigatória)
1. **ruphus.site primeiro:** o verificador aceita **v2 se presente** (e então exige timestamp dentro de ±300 s) **ou v1** (comportamento atual). Deploy.
2. **atendys:** passa a enviar `x-atendys-timestamp` + `x-atendys-signature-v2`, além do v1. Ponto do código: `apps/api/src/queues/queue-workers.service.ts`, `processDelivery` (montagem dos headers, ~linha 649: `'x-atendys-signature': signature`). Deploy.
3. **Depois de 7 dias sem nenhum webhook só-v1** (logar a versão usada): o ruphus.site passa a **exigir** v2. Opcionalmente, o atendys deixa de mandar v1.

### O que mudar no ruphus.site
- `src/lib/atendys.ts`: nova `assinaturaV2Valida(segredo, bruto, timestamp, assinatura, agora = Date.now())`, com `timingSafeEqual` igual à v1 e rejeição se `|agora/1000 - timestamp| > 300`.
- `src/app/api/webhooks/atendys/route.ts`: ler os dois headers. Se `x-atendys-signature-v2` existir, validar por v2; senão, por v1 (o regex de 64 hex continua). Registrar `console.log` com a versão para o passo 3.
- **Configuração:** nenhuma variável nova. A tolerância de 300 s fica como constante (relógio da VPS sincronizado por NTP; conferir com `timedatectl` nas duas pontas, que hoje são o mesmo servidor).

### Testes (`atendys.test.mts`)
- v2 válida dentro da janela → aceita.
- v2 com timestamp de 301 s atrás → recusa.
- v2 com corpo alterado → recusa.
- v2 assinada sobre `body` sem o prefixo de timestamp → recusa.
- só v1 válida → aceita (fase de transição).
- v1 e v2 presentes, v2 inválida → **recusa** (v2 presente manda).

---

## 6. Configuração e ambiente

- **Nada novo em `.env.local` / `.env.production`** para os itens 1–5.
- Testes com emulador: `npm run test:atendys` exige o Firebase CLI e o emulador de Firestore (`firebase emulators:exec`), como os demais `test:*` com emulador.
- Typecheck e lint antes do deploy: `npm run typecheck && npm run lint`.
- Deploy do ruphus.site (fluxo da VPS): git archive da branch → `/opt/ruphus-site/app.next`, copiar `.env.local`/`.env.production`, `npm ci && npm run build` como `ruphus`, trocar (`app` → `app-prev`, para rollback), `systemctl restart ruphus-site`.

---

## 7. Roteiro de validação em produção (manual)

Fazer com um salão de teste e dois celulares: **um de conta antiga** (registrado sem o 9, se houver) e **um de conta nova**. Anotar data/hora de cada passo para cruzar com os logs.

### 7.1 Agendamento online com aceite (regressão geral)
1. Agendar pelo site público com o aceite de WhatsApp marcado.
2. Esperado: o dono recebe o aviso no self-chat/WhatsApp pessoal; o cliente recebe a confirmação **com** o rodapé "Para não receber mais mensagens, responda SAIR."
3. Sem o aceite: o cliente **não** recebe nada, e o dono é avisado de que o cliente não autorizou.

### 7.2 Comando do dono (item 1)
1. Com um agendamento pendente, o dono responde **CONFIRMADO** pelo self-chat do número do salão.
2. Repetir pelo WhatsApp pessoal cadastrado na gaveta.
3. Repetir com **RECUSAR**.
4. Repetir **numa conversa com mensagens temporárias ativadas** (item D).
5. Esperado em todos: agendamento confirmado/cancelado no painel, cliente avisado (se aceitou) e resposta ao dono. Log: `comando de agendamento em <slug>: confirmado|recusado`.
6. **Obrigatório num salão de conta antiga:** é o cenário que quebrava.

### 7.3 Mensagem parada na cota e status (itens 3 e E)
1. Forçar a cota (salão com limite baixo) e gerar um lembrete: aparece em "mensagens paradas" (`awaiting_manual`).
2. "Manter agendada" → status `queued` com `retryAt` → tela mostra "agendada".
3. Se possível, provocar `failed` → `sent` (ou simular com POST assinado no ambiente local) e conferir que a tela não mostra erro.

### 7.4 Opt-out do cliente (compliance, ponta a ponta)
1. Do celular de **conta antiga**, o cliente responde **SAIR** a uma mensagem do salão.
2. Criar novo agendamento para o mesmo cliente, digitando o número **com o 9** no site.
3. Esperado: **nenhuma** mensagem chega ao cliente. No atendys, o envio sai como `failed`/`OPT_OUT` (ou `NOT_OPTED_IN`). No ruphus.site nada quebra.
4. Repetir com o celular de conta nova (controle).

### 7.5 Conexão do WhatsApp
1. Desconectar o aparelho do salão (Aparelhos conectados → sair).
2. Esperado: `instance.status` disconnected → painel mostra desconectado e o dono recebe o aviso de queda (push).
3. Reconectar pelo QR na gaveta → status connected.

### 7.6 Segurança do webhook (item 5, depois do rollout)
1. POST sem assinatura → 401.
2. POST com v2 e timestamp velho → 401.
3. Reenvio de um corpo capturado após 5 min → 401.
4. Evento legítimo do atendys → 200, e o log mostra `v2`.

---

## 8. Validação pós-deploy e rollback

- **Logs:** `journalctl -u ruphus-site -f`. Procurar `[webhook atendys]`, `[atendys] comando de agendamento`, erros 401 inesperados.
- **atendys:** `pm2 logs atendys-worker --lines 100 | grep -i "ruphus.site"`. Entregas falhando para o host `ruphus.site` indicam regressão no verificador.
- **Rollback ruphus.site:** trocar `app-prev` → `app` e `systemctl restart ruphus-site`.
- **Rollback atendys** (se o problema for o lado dele): código em `/opt/backups/atendys-code-pre-20261108-224109.tgz`; banco em `/opt/backups/atendys-20261108-234136.sql.gz` (restaurar **perde** o que entrou depois do deploy: só em último caso).

---

## 9. Ordem de execução (checklist)

- [x] 1. Confirmar o impacto do item 1 (consultas da seção 1, "Como confirmar"). 5 de 6 instâncias afetadas.
- [x] 2. Implementar `canonicalBrMobile` + `soDigitosComDDI` canonizando (item 1) e os testes. **Feito: PR #281 (squash `d67fbf9b`), em produção desde 2026-11-09 00:22.** Falta o roteiro manual 7.2 num salão de conta antiga.
- [x] 3. Limpar `errorCode` em `sent/delivered/read` (item 3) e os testes.
- [x] 4. `npm run typecheck && npm run lint && npm run test:whatsapp && npm run test:mensagens && npm run test:atendys`.
- [ ] 5. Deploy do ruphus.site; roteiro 7.1, 7.2 (com conta antiga), 7.3, 7.4, 7.5.
- [ ] 6. (atendys) Canonizar o telefone da instância no `CONNECTION_UPDATE` (item 1, passo 4); deploy pelo `scripts/deploy.sh`.
- [ ] 7. Investigar e registrar a causa das falhas de 03–04/11 (item 4).
- [x] 8. Verificador v1+v2 no ruphus.site (item 5) + testes; deploy.
- [ ] 9. (atendys) Enviar timestamp + assinatura v2; deploy; roteiro 7.6.
- [ ] 10. Após 7 dias só com v2: exigir v2 no ruphus.site.
