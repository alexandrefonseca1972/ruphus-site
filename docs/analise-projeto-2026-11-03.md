# Análise profunda do ruphus-site — achados (03/11/2026)

## Contexto

> Revisado em 03/11/2026 contra `5afe1d7`: afirmações conferidas no código; corrigidos o item da remoção (catálogo pagina de 24 em 24), o do `fora` (a landing depende dele) e a contagem de testes; acrescentados três achados dos QAs do dia.

Pedido: analisar o projeto inteiro e listar os achados relevantes em performance, escalabilidade, latência, segurança, UX, responsividade, mobile e qualidade de código. Nada foi editado. Três agentes de leitura (segurança, performance, UX/código) varreram o repositório; os itens de severidade alta foram conferidos no código pelo líder.

Estado geral: base sólida. `tsc` 0 erros, ESLint 0 erros e 1 aviso, 0 `any`, 0 TODO, 31 arquivos de teste (29 scripts no CI), Server Actions todas com zod + checagem de membro/papel, regras do Firestore negam por padrão, reservas em transação serializável, sem CSRF (token por argumento, sem cookie). Os problemas abaixo são o que falta para a plataforma aguentar uso real.

---

## 1. Segurança

### Alta
- **Remoção em massa das páginas de proposta.** O link "Pedir remoção" leva `?t=` que é HMAC fixo do slug (`src/lib/remocao.server.ts:9-17`, impresso no HTML público em `src/lib/gerador.ts:490`). Os slugs são os subdomínios, e `GET /api/catalogo?q=` devolve 24 por busca, enumerável com várias buscas. Script lê cada subdomínio, pega o `t` e chama a action `remover` (`src/app/remover/[slug]/page.tsx:18-22`). Repositório é público no GitHub. Correção: token aleatório por proposta guardado no `crm`, ou confirmação por WhatsApp/e-mail do dono, com limite por IP.

### Média
- **Sites do Storage na mesma origem do /admin.** `www.ruphus.site/s/{slug}/…` serve HTML/SVG/JS do bucket com o content-type gravado (`src/lib/site-arquivo.server.ts:25`; reescrita em `src/proxy.ts:84-85`). XSS num template roda na origem onde o IndexedDB guarda o token do admin. Correção: no www, redirecionar `/s/*` para `{slug}.ruphus.site`, ou `Content-Security-Policy: sandbox` nessas respostas.
- **Sem cabeçalhos de segurança.** `next.config.ts:9-20` só cobre `/sw.js`; `deploy/Caddyfile.ruphus` não acrescenta nada. Faltam HSTS, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`. /admin e /painel aceitam iframe (clickjacking). Correção: bloco `header` no Caddy.
- **Agendamento público dispara WhatsApp do salão para qualquer número.** Recibo vai para o `customerPhone` digitado (`src/app/api/agendar/route.ts:99-107`). Limites por telefone/IP (`src/lib/booking.server.ts:292-340`) caem com rotação de IPv6; sem captcha. Risco: banimento do número do salão + horários ocupados por reservas falsas. Correção: Turnstile, ou contar IPv6 por /64, ou só enviar recibo depois de o salão confirmar.
- **`/api/catalogo` vaza a lista `fora`** (quem saiu do ar ou pediu remoção), em cache público (`src/app/api/catalogo/route.ts:69`). `/api/desativados` protege a mesma lista com token. Correção: devolver só os slugs que estão na vitrine da landing (`public/sobre/index.html:1213-1216` usa a lista para esconder cards; tirar de vez quebra a vitrine).

### Baixa
- Repositório público expõe IP da VPS e deploy como `root` (`scripts/deploy-vps.sh:8`, `docs/plano-migracao-vps.md:1`). `firestore-debug.log` está no histórico (commit `0226708b`), sem segredo. JSON do adminsdk, `.env*` e `scripts-debug-wtsfy.ts` nunca foram versionados (conferido com `git log --all`).
- Credenciais antigas do WhatsApp podem continuar em `tenants/{slug}.whatsapp`, legível por qualquer membro (`src/lib/whatsapp.server.ts:75-80`, `firestore.rules:38`). Correção: rodar `scripts/mover-segredos-whatsapp.mts` e conferir.
- Regras gravam autor por `request.auth.token.email` sem `email_verified` (`firestore.rules:75,106`); o servidor já exige (`src/lib/verify-token.ts:23-25`).
- `getAgenda` público e sem limite (`src/app/agendar/[tenant]/actions.ts:18-26`): amplificação de custo (ver Performance 2).
- Webhook do atendys sem janela anti-replay; busca do tenant roda antes de checar assinatura (`src/app/api/webhooks/atendys/route.ts:51-55`).
- `AGENDAMENTO_SEM_LIMITE=1` desliga a trava até em produção (`src/lib/booking.server.ts:318`). Correção: ignorar quando `NODE_ENV=production`.
- `npm audit --omit=dev`: 4 altas (todas `@grpc/grpc-js` via SDK `firebase`), 9 moderadas. `shadcn`, `@types/nodemailer`, `@types/qrcode` em `dependencies`.

---

## 2. Performance, latência e escala

### Alta
- **Arquivos dos sites batem no Storage em todo pedido.** `src/app/s/[slug]/[...arquivo]/route.ts:11` faz 1 leitura Firestore (`foraDoAr`) + metadados + download por arquivo; página com 30 arquivos = ~30 leituras e 60 operações de Storage. `doStorage` baixa o arquivo inteiro para o heap e copia (`site-arquivo.server.ts:34-35`). Cache na Cloudflare de só 60 s (`site-arquivo.ts:44-45`); domínio próprio não passa pela Cloudflare. Correção: stream da resposta, `max-age` de 1 dia para imagens, cache em memória de 60 s da lista de fora do ar (como o proxy já faz).
- **Agenda pública: 150-200 leituras por carga, sem login.** `booking.server.ts:260-291` abre uma transação por dia × profissional (7 × 5 = 35). Repete a cada troca de serviço, profissional ou semana. Correção: ler tenant, equipe, serviços e status uma vez, agendamentos da semana numa consulta, montar a grade em memória; transação só na reserva.
- **`/agendar/[tenant]` renderiza no servidor a cada visita** (sem `revalidate`/`generateStaticParams`; `/bio` já tem, `bio/[tenant]/page.tsx:91-93`). Correção: `revalidate = 60` + `revalidatePath` ao editar serviços/equipe.
- **Tela de clientes escuta 365 dias de agendamentos em tempo real** (`src/app/[tenant]/clientes/page.tsx:61,75`), lista de clientes sem limite. Salão com 30 atendimentos/dia baixa ~11 mil docs no celular. Correção: gravar última visita no doc do cliente e consultar por ela; paginar.

### Média
- **Proxy busca listas pela internet e bloqueia a visita** quando o cache de 60 s vence (`src/proxy.ts:17-31,39-53`; `SITE_URL` = `https://www.ruphus.site`, sai pela Cloudflare e volta). Correção: `http://localhost:3001` e revalidar em segundo plano.
- **`public/s/assets` (66 MB) sai com `max-age=0`.** Correção: regra em `headers()` para `/s/assets/:path*`.
- **Índice do admin: ~30 mil leituras, ~11 s, ~120 MB a cada deploy ou 12 h ocioso** (`src/lib/painel-indice.server.ts:15,282-319`). Cresce com a base; com 50 mil leads passa a espera da tela (20 s). Sem índice, Carteira faz 9 consultas por cliente (`saude.server.ts:29-37`). Correção: aquecer no boot via `instrumentation.ts`; tirar do `crm` os ~12 mil docs triviais.
- **Resumo do dia lê todos os agendamentos de hoje da plataforma** com docs completos (`src/app/admin/actions.ts:300-310`). Correção: `.count()` e `.select()`.
- **Build na mesma VPS que atende.** Cache do Turbopack desligado (`next.config.ts:24`, +1 min), `npm ci` completo, disputa CPU/RAM com app e worker de coleta; `vigia.sh` reinicia após 2 falhas de 15 s. Cada restart dá segundos de 502 e zera o cache ISR. Correção: build fora com `output: "standalone"`; no mínimo `nice`/`CPUWeight` e copiar `.next/cache`.
- **Cron de lembretes serial** (`src/lib/lembretes-whatsapp.server.ts:35-89`); curl corta em 120 s (`deploy/crontab.txt`). Com ~100 negócios estoura. SMS tem o mesmo laço (`sms-agendamento.server.ts:127-129`). Correção: 5-10 em paralelo.
- **JS pesado no painel** (build de 01/11, gzip): `/[tenant]` ~400 KB, `/painel` ~380 KB, `/admin` ~240 KB, `/agendar` ~136 KB. Firestore 162 KB gz em todas as telas do negócio; zod completo com idiomas 88 KB gz entra até na página pública de agendar. `/painel` carrega Firestore só para `myTenants` (`src/lib/tenants.ts:41`). Correção: `zod/mini`, server action no `/painel`. Confirmar com build atual.
- **Cascata no painel:** layout só no cliente (`[tenant]/layout.tsx:1,51-60`): HTML → 400 KB JS → auth → 3 leituras → listeners. 3-4 idas e voltas antes de dado. Aceitável para app instalado; resolver de vez pede sessão em cookie e layout no servidor.

### Baixa
- `desativados` lê docs completos do CRM sem `.select()` (`src/lib/crm.ts:294`).
- `revalidate = 30` em `/api/desativados` e `/api/dominios` não faz nada (rota dinâmica por ler header; sem token o build prerenderiza 404 fixo).
- `og.jpg` do site gerado: 4 fetch ao Google Fonts + foto via Cloudflare + Satori + sharp a cada regeneração, cache 1 h zerado no deploy (`src/app/s/[slug]/og.jpg/route.tsx:23-47`). Correção: TTF em disco, foto local.
- Compressão em dobro: Next comprime e Caddy também (`encode gzip`). Correção: `compress: false` + `encode zstd gzip`.
- Estado em memória por processo (proxy, índice, catálogo, integrações): correto com 1 instância, quebra com 2.
- `ruphus-site.service` sem `MemoryHigh`/`--max-old-space-size`.
- Leituras em série: `cobrarMes` (`admin/actions.ts:586-592`), `myTenants` (`tenants.ts:41-44`), `cotaDe`/`criarNegocio` (`negocios.server.ts:27,51`).
- Nenhum `next/image`; fontes Geist/Geist Mono/Instrument Serif vão em toda página.

---

## 3. UX, responsividade e mobile

### Alta
- **Nenhum `error.tsx`, `global-error.tsx`, `not-found.tsx` ou `loading.tsx` em `src/app`.** Tenant inexistente em `/agendar/x` mostra 404 do Next em inglês; exceção no cliente mostra "Application error". Correção: criar em pt-BR na raiz e em `[tenant]`, `agendar/[tenant]`.
- **Faixa "Sem conexão" permanente no iOS 15.** `monitor-conexao.tsx:26` usa `AbortSignal.timeout` (Safari ≥16); o booking evita de propósito (`booking-form.tsx:334-335`). Correção: `AbortController` + `setTimeout`.

### Média
- **Foco perdido após reservar** (`booking-form.tsx:375-376`): árvore troca, foco cai no `body`; `role="status"` nasce com conteúdo. Correção: `tabIndex=-1` + `focus()` no h2 quando `reserva` muda.
- **"Hoje" no fuso de Brasília, não do negócio** (`agendar/[tenant]/page.tsx:33`, `actions.ts:22` usam `todayIn()`; `booking.server.ts:237` usa fuso da UF). No AC/AM entre 22h e 0h somem os horários da noite. Correção: `todayIn(fusoDaUF(uf))`.
- **Pendências de `docs/analise-ux-ui-agendamento-mobile.md`:** rascunho da escolha não persiste (`:182-191`); calendário `grid-cols-7` estreito em 320 px (`:1016`); rótulos de 10 px (`:783,829,889,930,945,1011,1050`); desmarcar o único serviço é ignorado sem aviso (`:300`); botão de confirmar não fixo com teclado aberto (`:842`); catálogo longo sem expansão (`:892`). Já resolvidos: texto do sinal, preço em linha, "fechado" × "sem vagas", zoom iOS.
- **Modo escuro quebra agendar e admin.** `layout.tsx:54` põe `.dark` + `color-scheme: light dark`; essas rotas pintam só o `<main>`, o `body` e os controles nativos ficam escuros. Correção: `color-scheme: light` e fundo no wrapper.
- **Service worker nunca atualiza** (`public/sw.js:9`, `VERSAO = "v1"` fixo) e `/_next/static` cache-first cresce sem limite. Correção: injetar commit no build ou podar no `activate`.
- **Faixa de conexão tapa a navegação inferior** (`monitor-conexao.tsx:84` z-60 sobre `[tenant]/layout.tsx:135` z-10).
- **SW só registrado em `[tenant]`** (`app-instalado.tsx:122`), mas `start_url` é `/painel`: primeira abertura do app instalado sem SW nem `offline.html`.
- **Gaveta do admin sem semântica de diálogo** (`admin/page.tsx:1523-1530`): sem `role="dialog"`, Esc não fecha, sem trap de foco, fundo rola, botão voltar do Android sai do admin. Correção: Base UI `Dialog` drawer.
- **Logout do admin incompleto** (`admin/page.tsx:663,900` chama `signOut` direto, não `sair()` de `sessao.ts:35`): não cancela push nem limpa cache.
- **Totais do Caixa estouram em 320 px** (`caixa/page.tsx:181,359`).
- **Classe do bottom-sheet copiada 4×** (`contas-fixas.tsx:49`, `lancamento-folha.tsx:134`, `comissoes-historico.tsx:39`, `profissionais/acesso.tsx:76`). Extrair `Sheet`.
- **`AlertDialogContent` sem `max-h`/rolagem** (`components/ui/alert-dialog.tsx:54`); `crm-gaveta.tsx:585` já resolveu localmente.
- **Mensagens de erro:** `permission-denied` vira "endereço pode já estar em uso" em leituras (`auth-errors.ts:15`, `use-collection.ts:35`); `Error.message` cru em inglês em `reschedule.tsx:39,58`, `plan-form.tsx:114`, `clientes/[customer]/page.tsx:102`; `useCollection` descarta docs fora do schema em silêncio (`:30-32`).
- **Serviço sem profissional segue "No link" no painel** (`[tenant]/servicos`): desde o #212 ele sai do `/agendar`, mas a contagem "N no link de agendamento" e o selo continuam contando.
- **Cancelar horário abre o WhatsApp com aviso marcado por padrão** (`reschedule.tsx`/menu da agenda): abre aba nova; com popup bloqueado, troca a aba atual.
- **Rotas inexistentes respondem 200** (`/qualquer-coisa` cai em `[tenant]`): soma ao item de `not-found.tsx`.
- Popover de Ajustes com `max-h-[80vh]` (único `vh`, corta atrás da barra do Safari) (`admin/page.tsx:792`).
- 136 ocorrências de `text-[9-11px]` em `src/app`, muitas informativas. Piso de 12 px.
- `animate-pulse` sem `motion-reduce` (`negocio/page.tsx:119-131`, `pix-qr.tsx:101`); sem regra global de `prefers-reduced-motion`.
- 1.385 cores hex fixas em 31 arquivos; tokens de `globals.css:136-173` não usados pelo admin e booking; dois cinzas quase iguais (`#6B6555` × `#6F6A5E`).

### Baixa
- `Input` base 32 px sem variante mobile (`components/ui/input.tsx:10`); `Button` só sobe a 44 px abaixo de 640 px (tablet fica com 28-32 px).
- Campos sem rótulo: `<select>` em `whatsapp-negocio.tsx:243`, input em `share-link.tsx:41`; popover de `share-link.tsx:36` sem Esc/trap.
- Contraste 2.65:1 em "–/sem vagas" (`booking-form.tsx:1036,1041`); foco quase invisível fora do painel (`outline-ring/50`).
- Funil arrasta só com mouse (há alternativa); cabeçalhos sem `aria-sort`; nav inferior 7 itens de 10 px.
- `manifest.ts`: `orientation: portrait` trava tablet; `theme_color` fixo; sem `screenshots`.
- Detecção de iOS duplicada (`app-instalado.tsx:50`, `avisos.tsx:23`); `.dark` só na carga.
- `Instrument_Serif` carregada 2× (`fonte-serifa.ts:5`, `admin/layout.tsx:5`); `fonte-serifa.ts` mistura fonte com hook sem "use client".
- Sobras do template em `public/` (`next.svg`, `vercel.svg`, `file.svg`, `globe.svg`, `window.svg`).
- `[tenant]/layout.tsx:76-77`: "Carregando…"/"Negócio não encontrado" sem `role="status"` nem link de volta.

---

## 4. Qualidade de código e manutenção

### Alta
- **`AdminPage` é um componente de 2.226 linhas** (`admin/page.tsx:118-2344`), 52 `useState`, 5 `useEffect`; cada tecla re-renderiza tudo. Cortes marcados por comentários: barra/ajustes `:712-910`, abas/filtros `:911-1190`, lista `:1255-1490`, nav `:1492-1521`, gaveta `:1523-2344` (venda `:1612`, combinado `:1677`, etapa `:1736`, preço/proposta `:1819`, limites `:2040-2067`, acessos `:2119-2159`, rodapé `:2290`).

### Média
- **Telefone em dois módulos com regras diferentes:** `datetime.ts:94-136` (`formatPhone`, `linkWhatsApp`, `phoneError`, `customerKey`, `whatsappLink`) × `telefone.ts` (`soDigitosComDDI`, `mascaraTelefoneBR`); 36 `replace(/\D/g` em 25 arquivos. Dinheiro: `formatBRL` em `datetime.ts`, cópias inline em `sinal.ts:26` e `crm.ts:249`. Correção: tudo de telefone em `telefone.ts`, dinheiro em `dinheiro.ts`, `datetime.ts` só datas.
- **`todayIn()` sem fuso em ~15 lugares** (`bio/[tenant]/page.tsx:74,132,206`, `financeiro.server.ts:106,218`, `sinal.server.ts:33`, `agendar/actions.ts:22`). Modelo "hora de parede de Brasília" é consistente mas frágil. Correção: `hojeDoNegocio(uf)` e proibir o sem argumento. `FUSO_UF` sem Fernando de Noronha.
- **Arquivos grandes com cortes naturais:** `booking-form.tsx` 1.176 (cabeçalho `:96-177`, confirmado `:406-648`, etapa contato `:709-861`, grade `:1006-1127`, hook `useReservar` `:309-385`); `crm-gaveta.tsx` 853 (já exporta 11 componentes, um arquivo por seção); `admin/actions.ts` 888 (~60 ações: acessos `:173-260`, CRM `:332-430`, proposta `:483-530`, cobrança `:561-611`, domínio `:617-650`, site `:652-757`, WhatsApp `:769-835`, SMS `:837-888`); `booking.server.ts` 676 (catálogo `:19-200`, slots `:202-296`, reserva `:297-525`, planos `:527-628`, remarcação `:629-676`).
- **Testes:** 31 `*.test.mts` soltos na raiz com `node:assert`, sem runner, sem `npm test`, sem cobertura, sem teste de UI/E2E dos fluxos críticos (booking-form, painel). ~12 sobem emulador próprio, CI lento. **CI não roda `tsc --noEmit` nem `next build`**: erro de tipo só aparece no deploy. Correção: `tests/`, `node --test`, um único `emulators:exec`, smoke E2E do agendamento, `tsc` no CI.
- 28 `eslint-disable` (11 `exhaustive-deps`, 6 `set-state-in-effect`, 10 `no-img-element`), todos justificados. 1 aviso: import `renderClaro` sem uso em `admin/actions.ts:45`.

### Baixa
- `cn` importado de dois jeitos (`@/lib/utils` em 17 arquivos × `"cn"` em `components/ui/*`).
- Scripts de uso único versionados sem entrada no `package.json`: `migrar-podologia.mts`, `limpar-catalogo.mts`, `corrigir-telefones.mts`, `consolidar-planilhas.mts`, `gerar-miniaturas.py`.
- `src/lib/nichos/*` não é código morto (usado por `site-claro.ts`, `site-editorial.ts`).
- 19 comentários `ponytail:` com teto e caminho de upgrade descritos (débito rastreável).

---

## Ordem sugerida de ataque

0. **Itens baratos (um PR):** cabeçalhos de segurança; `AbortController` no monitor de conexão; import sem uso; `AGENDAMENTO_SEM_LIMITE` ignorado em produção.
1. **Segurança alta + médias baratas:** token por proposta na remoção; cabeçalhos no Caddy; só a parte da vitrine no `fora` do catálogo; CSP `sandbox` ou redirect em `/s/*` no www.
2. **Performance alta:** stream + cache em `[...arquivo]`; `revalidate` em `/agendar`; grade sem transação; janela da tela de clientes.
3. **UX alta:** páginas de erro/404 em pt-BR; `AbortController` no monitor de conexão; `VERSAO` do SW no build.
4. **Abuso do WhatsApp:** Turnstile ou recibo só após confirmação do salão.
5. **Manutenção:** `tsc` no CI; quebrar `admin/page.tsx`; consolidar telefone/dinheiro; `hojeDoNegocio(uf)`.

## Verificação

Cada item traz arquivo:linha. Para os de performance com números de bundle, rodar `npm run build` atual e `next experimental-analyze` antes de agir. Lint e tsc brutos: `/private/tmp/claude-502/-Users-alexandrefonseca-products-ruphus-site/b151b3d2-5dad-47f7-98d9-d8e78b482157/scratchpad/eslint.json` e `.../tsc.txt`.
