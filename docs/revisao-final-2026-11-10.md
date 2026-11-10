# Revisão profunda e final do ruphus-site — 10/11/2026

Base revisada: `origin/main` em `6b966a11` (publicado na VPS às 09:52 de 10/11/2026). Revisão só de leitura, feita por seis revisores em paralelo (segurança, agendamento, WhatsApp/atendys/conversas, admin/fábrica, painel/financeiro, arquitetura/operação) e conferida por amostragem no código. `npm run lint` e `npm run typecheck` passam. Os testes puros rodados pelos revisores passam; os que dependem do emulador não foram rodados nesta revisão (rodam no CI).

Resultado geral: nenhum achado crítico. Oito achados altos, trinta médios e cerca de quarenta e cinco baixos, depois de juntar os repetidos. O isolamento entre tenants, as transações de reserva e a assinatura do webhook estão corretos.

## Altos

| # | Onde | Problema | Correção |
|---|------|----------|----------|
| A1 | `src/app/api/agendar/route.ts:102` | O aviso de novo agendamento vai primeiro para o self-chat do salão (`conn.phone ?? conn.ownerPhone`) e pede "Responda CONFIRMADO". O atendys trata resposta `fromMe` como eco (`webhooks.controller.ts:273`, `persistOutboundEcho`) e não gera `message.received`. O CONFIRMADO respondido no self-chat nunca chega. A confirmação pelo número do próprio salão não funciona hoje. | Mandar o aviso para `conn.ownerPhone` e só cair no self-chat sem número pessoal, avisando que ali não dá para confirmar. |
| A2 | `src/lib/whatsapp.server.ts:525` | `respostaPara = numeroSalao ?? dono` manda a resposta do comando (confirmado, não entendi, lista de códigos) para o self-chat mesmo quando o comando veio do celular pessoal do dono. Com mais de um pendente ele nunca vê a lista. | `respostaPara = remetente`. |
| A3 | `src/app/[tenant]/caixa/page.tsx:96` + `src/lib/financeiro.server.ts:361` | A tela lê lançamentos só com `mes` em [anterior, atual, seguinte]; o servidor soma também `mesComissao == mes`. Um sinal pago dois ou mais meses antes do atendimento (a agenda aceita até 90 dias) fica fora da conta da tela, o `valorCents` enviado nunca bate com o devido e `pagar` recusa sempre com "Feche e abra de novo". Essa comissão não tem como ser paga. | Somar na tela uma segunda consulta `where("mesComissao","==",mes)`, ou deixar o servidor devolver o devido e a tela só confirmar. |
| A4 | `src/lib/sessao.ts:45-63` | A inatividade é contada por aba (`ultimo` é local), mas o `signOut` vale para todas as abas e para o PWA. Uma aba esquecida derruba a sessão de quem está trabalhando em outra, no meio de uma folha do Caixa. | Guardar o último toque em `localStorage` (com o evento `storage`) e só sair quando todas as abas estiverem paradas. |
| A5 | `scripts/deploy-vps.sh:41` | `systemctl is-enabled` é sempre falso para o `ruphus-coleta`, que o admin liga só com `start` (`coleta-actions.ts:67-91`). O worker ligado continua rodando de dentro de `app-prev`, e o deploy seguinte faz `rm -rf app-prev` debaixo dele: o tsx compila imports sob demanda e eles quebram. | `systemctl is-active --quiet ruphus-coleta && systemctl restart ruphus-coleta`. |
| A6 | `scripts/deploy-vps.sh:34` | `npm ci` e `next build` rodam na VPS de 1 vCPU e 3,8 GB ao lado do app (heap 1280 MB) e do worker (`MemoryMax=1500M`), sem teto de memória nem prioridade baixa. O OOM killer pode escolher o `next start`. | `systemd-run --scope -p MemoryMax=1800M nice -n 19 …` com `NODE_OPTIONS=--max-old-space-size=1536`; melhor ainda, buildar no GitHub Actions e mandar o pacote. |
| A7 | `src/app/api/cron/lembretes/route.ts:18` | `enviarLembretesDoDia()` é a única etapa sem `.catch`, e `emParalelo` relança o primeiro erro. Um negócio com erro persistente dá 500 em todo ciclo, e aí comandos pendentes, SMS e `vigiarConexoes` nunca rodam. | Pôr o mesmo `.catch((e) => (console.error("[cron] lembretes", e), 0))` das outras etapas. |
| A8 | `src/lib/atendys.ts:254` (confiança média) | O tenant é criado sem `recipientMsgPerDay/Week`, então valem os padrões do atendys (3 por dia e 10 por semana por destinatário). Os avisos ao dono entram nessa conta: a partir do 4º agendamento do dia (ou do 11º da semana) o aviso para na cota. No canal oficial um dono com vários negócios soma todos. | Provisionar limites maiores ou isentar o número do dono no atendys. Conferir antes a configuração dos tenants em produção. |

## Médios

### Segurança
- `src/app/painel/actions.ts:21` e `src/app/[tenant]/actions.ts:130` — `quem()` aceita conta com e-mail não confirmado e `criarNegocioAction` cria o negócio; com isso `convidarEquipeAction` manda e-mails sem limite para qualquer endereço via noreply@ruphus.site, com o nome do negócio livre no assunto. Canal de spam que queima a reputação do domínio. — Exigir `email_verified` em `criarNegocio` e pôr cota diária de convites por negócio.
- `src/app/[tenant]/actions.ts:444` — `enviarReciboEmailAction` manda e-mail com remetente exibido igual ao nome do negócio, livre, para qualquer endereço, sem cota. — Cota diária por tenant e sufixo fixo no From (`"<nome> via Ruphus"`).
- `src/app/[tenant]/actions.ts:545` — `decidirEnvioAction` não chama `exigeGestor`: qualquer membro da equipe recebe o wa.me com telefone e texto do cliente, enquanto a lista (`mensagensParadasAction`) é só de gestor. Apontado por dois revisores. — `await exigeGestor(data.tenantId, user.uid)`.

### WhatsApp e conversas
- `src/lib/atendys.ts:418` (efeito em `lembretes-whatsapp.server.ts:128`) — envio de texto e template sai sem `idempotency-key`, que o atendys aceita. Timeout ou 5xx depois do aceite solta a reserva do lembrete e o próximo ciclo reenvia, duplicando e gastando a cota. — Chave fixa por lembrete (`lembrete:{slug}:{agId}:{start}`); com `AtendysForaDoAr`, manter a reserva e conferir o status.
- `src/app/[tenant]/conversas/conversa.tsx:150` — qualquer `ok:false` troca a chave de idempotência, inclusive timeout ou 5xx do atendys. Se a resposta já tinha saído, o reenvio duplica. — Devolver um sinal "incerto" nesses casos e manter a chave.
- `src/lib/whatsapp.server.ts:538` — quando a consulta de status falha (atendys fora do ar), o comando vira "ignorado" e o pendente é apagado; o CONFIRMADO/RECUSAR do dono se perde. — Com `vivo === null`, lançar, para o cron reprocessar.

### Agendamento
- `src/lib/datetime.ts:164` — `customerKey` não acrescenta o 9º dígito em celular antigo, mas `soDigitosComDDI` acrescenta. "85 9123-4567" e "85 99123-4567" viram dois clientes e dois contadores; os limites por telefone valem em dobro. — Passar por `canonicalBrMobile` antes de gerar a chave e migrar as chaves já gravadas.
- `src/lib/booking.server.ts:598` + `src/lib/sinal.server.ts:68-74` — reserva feita a menos de `prazoMin` do início ganha prazo do sinal igual ao próprio início; o cron cancela a reserva na hora em que o cliente chega, se o salão ainda não tocou "Sinal recebido". A vaga volta ao link com o cliente na cadeira. — Não cancelar depois do início (só marcar "vencido"), ou teto do prazo em início menos margem.
- `src/lib/sinal.server.ts:76-80` — qualquer erro passageiro na transação grava `sinal.status` "erro" para sempre; o horário nunca expira e `confirmarSinal` recusa. O dono não consegue mais registrar o Pix. — Contar falhas e só desistir depois de N; aceitar "erro" em `confirmarSinal`.
- `src/lib/booking.server.ts:243-245` — `slotContext` exige profissional e serviços ativos, e a remarcação passa por ele (linha 725). Depois de "Tirar do link" ou desativar um serviço, nem o painel nem o WhatsApp remarcam os horários já marcados. `createPlan` também não aceita (linha 634). — Na remarcação e no plano do painel exigir só que o profissional exista e faça os serviços.

### Admin e fábrica
- `src/lib/gerador.server.ts:252` — "criar" grava o tenant com `set(..., {merge:true})` depois de checar existência fora de transação. Se um cadastro público criar o mesmo slug nesse intervalo, o tenant é sobrescrito (`ownerId` vira OWNER_UID). — `writer.create` quando `acao==="criar"` e mandar a falha para `falharam`.
- `src/lib/foto.server.ts:66` (via `api/admin/foto/route.ts:20`) — upload grava direto em `sites/{slug}/fotos/{slot}.jpg`; a foto não publicada entra no site em até 60 s, apesar do aviso "Entra no site ao publicar". — Subir como `fotos/rascunho-{slot}.jpg` e copiar em `definirVisual`.
- `src/app/api/dominios/route.ts:16` — quando o Firestore falha, responde 200 com mapa vazio; o proxy (`src/proxy.ts:71`) troca o mapa bom pelo vazio e todos os domínios próprios caem por 1 min. — 503 no catch.
- `src/app/api/desativados/route.ts:17` — mesmo padrão: sites tirados do ar voltam ao ar enquanto durar a falha. — 503 no catch.
- `src/proxy.ts:160` — redirecionamento do subdomínio para o domínio próprio é 308 (permanente). Depois de `soltarDominio`, quem já visitou continua indo para o domínio antigo. — 307.
- `src/lib/dominio.server.ts:63` — domínio "ativo" nunca é conferido de novo; se o DNS mudar ou o domínio expirar, `{slug}.ruphus.site` continua redirecionando para lá. — Cron que roda `verificarDominio` nos ativos.

### Painel e financeiro
- `src/lib/sessao.ts:53-57` — o logout automático não avisa antes e termina com `location.replace`; folha do Caixa com valor digitado se perde. — Aviso "vai sair em 1 min" com "continuar", ou adiar com diálogo aberto.
- `src/lib/sessao.ts:26-28` — o logout automático também cancela a inscrição de push; depois de entrar de novo, os avisos ficam desligados até religar à mão. — Cancelar o push só no "Sair" manual.
- `src/lib/pix.ts:69-73` — `txidDe` corta em 25 caracteres depois de pôr o slug na frente; com slug longo sai o mesmo txid em todos os meses e na reemissão. — Cortar o slug antes, para caber competência e sufixo.
- `src/lib/use-collection.ts:36-39` (em `caixa/page.tsx:96`) — lançamento fora do esquema some da lista só com aviso no console; Entrou/Saiu/Sobrou ficam errados sem alerta. — Contar os descartados e mostrar alerta no Caixa.
- `src/app/[tenant]/painel-layout.tsx:72-73` — qualquer exceção (rede caída) vira "Você não tem acesso a este negócio"; "Voltar" leva ao mesmo negócio. — Separar erro de rede de permission-denied.
- `src/app/[tenant]/clientes/[customer]/page.tsx:141` e `src/lib/clientes.ts:47` — "Total gasto" soma `priceCents` da agenda, contando "booked" passado não recebido e ignorando baixa e estornos. — Com Caixa ligado, somar os lançamentos do cliente; sem, rotular "Valor de tabela".
- `src/app/[tenant]/comissoes-historico.tsx:28-33` — vales não entram em "Comissão paga", mas o Caixa conta os vales como pagos; rótulo "de estorno" inclui vales. — Somar vales em `pago` e trocar o rótulo.

### Arquitetura e operação
- `deploy/crontab.txt:4` — `curl -fsS … >/dev/null` sem `MAILTO`: cron parado ou `CRON_SECRET` divergente passa sem ninguém ver. — `|| logger -t ruphus-cron "lembretes falhou"`, gravar `config/cron.ultimo` e alertar no /admin se passar de 30 min.
- `src/instrumentation.ts:3` — não exporta `onRequestError`; erro de Server Component em produção vira só um digest no journald. — Exportar chamando `alertarAdmin`.
- `scripts/deploy-vps.sh:39` — `systemctl restart` derruba o app por alguns segundos e o Caddy devolve 502. — `lb_try_duration 30s` e `lb_try_interval 250ms` no `reverse_proxy` do `deploy/Caddyfile.ruphus`.
- `scripts/deploy-vps.sh:43-47` — se o health check falha, o script sai com 1 e deixa a versão ruim no ar. — Na falha, executar o rollback do comentário da linha 6.
- `src/instrumentation.ts:5` + `src/lib/painel-indice.server.ts:15,287-296` — cada boot monta listeners em `tenants` (~15 mil docs), `crm` e `members` e eles ficam 12 h na memória sem ninguém abrir o /admin. — Montar só na primeira consulta ou baixar `OCIOSO_MS` para ~1 h.
- `src/app/s/[slug]/index.html/route.ts:22-28` — três idas em série (`foraDoAr`, `doStorage`, `lerSite`); o Storage quase sempre dá 404 desde a conversão. Além disso a ordem é a inversa do og.jpg: um `index.html` sobrado no Storage esconde as edições do gerador. — Gerador primeiro, Storage só sem `gerado.sub`, e `foraDoAr` em paralelo.
- `src/app/s/[slug]/og.jpg/route.tsx:18-44` — `force-dynamic`, sem autenticação, sem `foraDoAr`, dois fetches ao Google Fonts e sharp a cada pedido, sem timeout. Amplificação barata de CPU e site removido ainda gera a imagem. — Validar slug com `SLUG_SITE`, `AbortSignal.timeout(5000)`, cache da fonte e do JPEG, e `foraDoAr`.
- `src/lib/email.server.ts:66` — transporte nodemailer sem timeout; SMTP lento prende a server action por até 10 min. — `connectionTimeout 10_000`, `greetingTimeout 10_000`, `socketTimeout 20_000`.

## Baixos

### Segurança
- `src/app/agendar/[tenant]/actions.ts:10` e `:18` — `getSlots` e `getAgenda` públicos sem limite de chamadas. — Limitar por IP ou cache curto.
- `src/lib/cobranca.ts:165` — cobrança sem `token` abre com `?t=` vazio (dois buffers de tamanho 0 passam no `timingSafeEqual`). — `if (!guardado || …)`.
- `src/app/api/webhooks/atendys/route.ts:190` e `src/app/api/agendar/route.ts:148` — telefone completo do cliente no log. — Só os 4 últimos dígitos.
- `firestore.rules:119`, `:161`, `:170` — `etiquetas`, `services` e `staff` sem validação de tipo e tamanho dos campos. — `keys().hasOnly` e `size() <= 80`.
- `package.json` — `npm audit --omit=dev`: 4 altas (`@grpc/grpc-js`, modo servidor, não se aplica) e 6 moderadas (`uuid`, `minimatch`). — `npm audit fix` sem `--force`.
- `next.config.ts:12` — sem Content-Security-Policy em /admin e /painel. — CSP com `script-src 'self'` e nonce.

### WhatsApp e conversas
- `src/app/api/agendar/route.ts:151` e `:219` — envio que deu certo apaga o `lastNotifyError` gravado pelo webhook para outra mensagem. — Limpar só erro anterior ao início deste envio.
- `src/app/api/webhooks/atendys/route.ts:87` — segredo do `message.status` vem de `lerConexao`, que exige `instanceId`; depois de desconectar, o "failed" é recusado como assinatura inválida. — `lerConfigWhatsApp`.
- `src/lib/atendys.ts:461` — 409 do opt-in identificado por regex no texto em português. — Códigos próprios no atendys.
- `src/lib/whatsapp.server.ts:262` — `message.received` sem `messageId` ganha id aleatório e perde o dedupe. — Sem `messageId`, não gravar o pendente.
- `src/app/[tenant]/actions.ts:668` e `:682` — `arquivarConversaAction` e `agirNaMensagemAction` exportadas como server action sem nenhuma tela usar (knip confirma). — Remover até a tela existir.
- `src/app/[tenant]/actions.ts:498` — Pix pelo WhatsApp é a única mensagem ao cliente sem `comAvisoSair`. — `comAvisoSair(textoPix(...))`.
- `src/lib/conversas.server.ts:64` (confiança baixa) — conversa com `contactPhone` null aparece para a equipe, e pode ser a do dono. — Esconder da equipe as sem número.

### Agendamento
- `src/app/[tenant]/actions.ts:169-173` — `excluirProfissionalAction` apaga profissional com horários futuros e plano ativo; horários ficam órfãos. — Recusar enquanto houver futuro, como `deleteCustomer`.
- `src/lib/scheduling.ts:102` — `BookingInput` aceita 12–13 dígitos sem o 55; cada variação vira telefone novo e escapa do limite. — Exigir `telefoneBrValido`.
- `src/lib/booking.server.ts:392`, `:706`, `actions.ts:523` — `start > new Date()` trata hora de Brasília como instante real; no AM e no AC erra em 1–2 h. — `agoraNaParede(fusoDe(site))`.
- `src/lib/pix.ts:82-83` — `txidLivre` usa só o milissegundo. — 2–3 caracteres aleatórios.
- `sinal.test.mts:62` — `depois` calculado uma vez; r3 e r7 falham num CI lento. — Recalcular em cada chamada.
- `booking.test.mts:355-356` — id do contador com `todayIn()` depois da reserva; falha se cruzar a meia-noite. — Guardar o dia antes.
- `src/app/[tenant]/plan-form.tsx:48` — `hoje` em Brasília, não no fuso do negócio. — `todayIn(fuso)`.

### Admin e fábrica
- `src/lib/dominio.server.ts:39` — `conectarDominio` só confere colisão com `dominio.host`, não com `dominio.raiz`. — Conferir host e raiz nos dois campos.
- `src/app/api/dominios/tls/route.ts:19` — cada SNI desconhecido vira 2 queries sem cache negativo. — Cache negativo por host por alguns minutos.
- `src/lib/gerador.server.ts:206` — reenviar planilha ("atualizar") regrava nome, endereço, instagram, horário e bairro editados pelo admin. — Marcar `gerado.editadoEm` e avisar na prévia.
- `src/app/admin/coleta-actions.ts:256` — `previaDaColeta` relê todos os tenants da UF a cada lote de 300. — Ler a UF uma vez.
- `scripts/coletar.mts:116` — `seAindaMeu` fora da transação dos lotes; worker antigo pode gravar em pedido que já não é dele. — Repetir antes de cada `commit()`.
- `src/app/admin/page.tsx:466` e `:396` — `setEventos`/`setAcessos` depois do await sem conferir `abertoRef.current === slug`; linha do tempo de um negócio na gaveta de outro. — Mesmo guarda da linha 328.
- `src/app/admin/actions.ts:166` — `SLUG` exige 3 caracteres; `SLUG_SITE` aceita 2; site "jc" dá "Negócio inválido." — Usar `SLUG_SITE`.

### Painel e financeiro
- `src/lib/financeiro.server.ts:53` e `:88` — `editar` aceita qualquer valor em `cm-` sem conferir o devido. — Travar valor de `cm-`.
- `src/app/[tenant]/aviso-novo-agendamento.tsx:101-108` — com cache persistente, o som toca para agendamentos de até 5 min antes de abrir o painel. — Ignorar enquanto `snap.metadata.fromCache`.
- `src/app/[tenant]/caixa/page.tsx:546` — `key={nome}` duplica com dois profissionais de mesmo nome. — Índice ou id.
- `src/app/[tenant]/clientes/[customer]/page.tsx:177` — botão "corrigir" aparece para a equipe e o servidor recusa. — Só com `tenant.podeGerir`.
- `src/app/[tenant]/clientes/[customer]/page.tsx:297` — `toLocaleDateString` sem `timeZone`. — `timeZone: TIMEZONE`.
- `src/app/login/page.tsx:138` — "Peça outro à Ruphus — eles valem 7 dias" também no convite da equipe, com o 7 fixo. — "peça a quem enviou" e `DIAS_CONVITE`.
- `src/lib/booking.server.ts:128` — "Cliente nao encontrado." sem acento.
- `src/lib/recibo.ts:22-30` — valor por extenso quebra acima de R$ 1 milhão. — Tratar milhão ou limitar.
- `src/lib/convite.ts:178-181` — quem já é "member" e abre convite de dono recebe ok, continua member e grava aceite dos Termos. — Recusar com mensagem.

### Arquitetura e dívidas
- `deploy/ruphus-site.service:9` — heap e jemalloc só na VPS; reinstalar do repo perde isso. — Copiar as linhas `Environment=`.
- `.env.example:1` — faltam 10 variáveis que o código usa.
- `src/lib/atendys.ts:21` — URL base com três nomes de env e padrões diferentes (apex vs www em `admin/actions.ts:147`). — Um `BASE_URL`.
- `src/lib/foto.server.ts:2` — import estático do sharp anula o import preguiçoso de `admin/actions.ts:742`.
- `src/app/api/webhooks/wtsfy/route.ts:1` — rota morta (410). — Apagar.
- `src/lib/tenants.ts:42` — `tenantCollection` sem uso.
- `src/lib/site-claro.ts:91` — luminância WCAG duplicada de `contraste.ts`; ícones SVG duplicados de `site-editorial.ts`.
- `src/app/admin/page.tsx:1` — componente cliente de 2.399 linhas. — Separar por aba.
- `scripts/migrar-nicho.mts` e mais 7 scripts de migração já rodados. — Apagar.
- `scripts/coletar.mts` — `write-excel-file` em devDependencies, usado em produção. — Mover para dependencies.
- 9 `eslint-disable exhaustive-deps` sem motivo escrito (ex.: `conversas/conversa.tsx:107`). Fora isso: 0 TODO, 0 `any`, 0 `@ts-ignore`, 32 `ponytail:` documentados.

## Sem teste no CI

- Scripts que existem e o workflow não roda: `test:conversas` (o piloto está em produção no ruphusbel), `test:canal-oficial`, `test:recibo`, `test:mensagens`, `test:coleta`.
- Módulos server sem nenhum teste: `lembretes-whatsapp.server` (núcleo do cron), `email.server`, `dominio.server`, `site-arquivo.server`, `recibo.server`, `renovar-site.server`, `segredo.server`, `contrato.server`.
- Rotas sem teste: `api/cron/lembretes`, `api/cron/demo`, `api/dominios`, `api/dominios/tls`, `api/desativados`, `api/conversas/[tenant]/midia`, `api/conversas/[tenant]/responder-arquivo`, `api/catalogo`, `api/marketing`, `api/vitrine`, `api/admin/painel`.

## O que está sólido

- Toda action de tenant passa por `requireMember` (com revogação) e por `exigeGestor`/`exigeDono`/`profissionalDaConta`, com ids resolvidos dentro de `tenants/{tenantId}`. A apikey do atendys fica no doc privado e sai filtrada por `paraTela`.
- Webhook só aceita assinatura v2 (HMAC com timestamp, janela de 300 s, comparação em tempo constante); dedupe pela caixa de entrada; pendente apagado na mesma transação do agendamento; botões do canal oficial conferem dono e telefone.
- Reserva, remarcação e plano fazem todas as leituras antes das escritas, com o limite e a repetição pelo pedido dentro da transação. Cancelado libera a vaga. `datasDoPlano` não pula nem duplica semana.
- Dinheiro sempre em centavos inteiros; escritas do Caixa idempotentes por id e em transação; dia do caixa em America/Sao_Paulo; convite de uso único preso ao e-mail confirmado.
- Path traversal coberto em `/s/`; `/remover` com HMAC e teto diário; TLS on-demand bloqueado por fora pelo Caddy; HTML dos sites escapado e prévia em iframe com sandbox; sem segredo no repositório.
- Firebase Admin inicializado uma vez; caches em módulo com teto; deploy com trava atômica e mesmo `NEXT_DEPLOYMENT_ID` no build e no start; cron confere o segredo em tempo constante.

## Não coberto

Corpo de cada action de `src/app/admin/actions.ts` (todas embrulhadas em `adminAction`), `cobranca.tsx`, `crm-gaveta.tsx`, o resto de `admin/page.tsx` além da gaveta, `funil-consulta.ts`, as 1.464 linhas de `booking-form.tsx` além do envio e das datas, `negocio/page.tsx`, `servicos/page.tsx`, `profissionais/*`, `app-instalado`, contraste de cores, e o estado dos dados em produção (por exemplo, se apikeys antigas ainda estão no doc `tenants/{slug}`, que qualquer membro lê).
