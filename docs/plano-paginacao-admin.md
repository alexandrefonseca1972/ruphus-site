# Plano: painel do admin paginado no servidor

Status: fase 1 no ar (PR #178); fase 2 implementada (índice e rota, sem uso pela tela).
Escrito em 2026-11-01, depois dos PRs #176 e #177. Revisado no mesmo dia com a
avaliação de riscos (seção 5) e os requisitos de qualidade de cada mudança (seção 6).

## 1. Onde estamos

Cada abertura do `/admin` chama `abrirPainel` (`src/app/admin/actions.ts`), que lê
e manda ao navegador a base inteira. Medido em produção em 01/11:

| Parte | Leituras no Firestore | Vai ao navegador |
|---|---|---|
| `tenants` (9 campos) | ~14,9 mil | 14,9 mil itens, **3,2 MB** |
| `crm` | ~14,9 mil | 1,6 mil itens, 734 KB (o resto é trivial, PR #176) |
| `members` | 4 (PR #176) | — |

A tela mostra **40 itens** por vez (`PAGINA`, 8 KB). Todo o resto serve para o
navegador calcular, sobre a lista inteira:

- busca por trecho (nome, slug, cidade, telefone, sem acento);
- filtros: UF, cidade, nicho, situação (cliente dentro), estágio, prazo, fora do ar,
  caixa, "falei hoje", destaque e alerta em foco;
- contagem de cada chip **ignorando a própria dimensão** (`passa(e, "uf")` etc.);
- contagem de cada visão (Atrasados, Para hoje…) e dos prazos;
- ordenação por relevância (nota × log das avaliações), nota, avaliações, nome,
  compromisso ou último contato, com os destacados no topo;
- alertas (`src/lib/alertas.ts`), métricas do funil (`funil.tsx`), totais do
  cabeçalho (mensalidades) e a carteira (`carteira.tsx`, que procura os fechados na
  lista).

Custo: ~30 mil leituras por abertura (o plano gratuito dá 50 mil por dia), 4 MB
de payload e picos de memória no servidor ao montar e serializar tudo (pico de
2,24 GB medido em 01/11).

## 2. Por que não paginar direto no Firestore

A saída óbvia, uma consulta paginada por filtro, esbarra em quatro limites:

1. **Busca por trecho**: o Firestore não faz "contém". Seria preciso um índice de
   busca à parte (Algolia, Typesense) ou tokens de prefixo gravados no documento.
2. **Ordenação por relevância**: é calculada. Precisaria virar campo gravado, e as
   ordens "compromisso" e "contato" dependem do `crm`, que mora em outra coleção.
3. **Filtros que cruzam coleções**: estágio, prazo e fora do ar estão no `crm`;
   UF, cidade e nicho estão no `tenants`. Sem join, seria preciso copiar campos
   de uma coleção para a outra e manter a cópia em todos os lugares que escrevem.
4. **Contagens dos chips**: cada chip ignora a própria dimensão. Seriam dezenas de
   agregações `count()` a cada filtro mudado, e um índice composto por combinação.

Dá para fazer, mas é reescrever a tela e boa parte das escritas.

## 3. Proposta: índice em memória no servidor

O servidor guarda **uma** cópia enxuta da lista e responde só a página pedida.
A lógica de filtro, ordem e contagem que hoje roda no navegador passa a rodar no
servidor, sobre essa cópia.

### 3.1 O índice (`src/lib/painel-indice.server.ts`)

- **Montado sob demanda**, na primeira consulta do admin, não no início do
  processo: deploy e reinício sem ninguém no admin não custam leitura.
- **Mantido por listeners** (`onSnapshot`) em `tenants`, `crm`, `config/admin` e
  `members` de fora da plataforma (a consulta `not-in` do PR #176). Cada mudança
  custa uma leitura, venha de onde vier: admin, painel do dono, gerador, cobrança.
- **Desmontado depois de 2 h sem consulta** (`OCIOSO_MS`): solta os listeners e a
  memória. A próxima consulta monta de novo.
- **Troca atômica**: a montagem preenche estruturas novas e só então substitui as
  antigas, com `versao` incrementada. Uma consulta nunca vê o índice pela metade.
- **Pré-calcula** o que a consulta usaria a cada vez: o texto de busca já sem
  acento, a relevância e a ordem base de cada ordenação (refeita só quando a
  `versao` muda).
- **Escritas do próprio processo** (mudar estágio, anotar, marcar em lote) aplicam
  a mudança no índice na hora, antes de responder. O listener confirma depois. Isso
  evita que a tela pisque o valor antigo no ~1 s até o listener chegar.

### 3.2 A consulta (`src/lib/painel-consulta.ts`)

Funções puras, sem Firestore, testáveis com dados de teste. Saem do `page.tsx` com
duas correções de desempenho que não mudam o resultado:

- **Uma passada só**: para cada negócio, calcula quais filtros ele reprova (uma
  máscara de bits). Ele entra na contagem de um chip de UF se reprova no máximo o
  filtro de UF, e assim para cada dimensão. Hoje são ~20 passadas pela lista
  (uma por grupo de chips, visão e prazo).
- **`Intl.Collator("pt-BR")`** criado uma vez, no lugar de `localeCompare` a cada
  comparação: ordenar 15 mil nomes cai de 87 ms para 29 ms (medido), e a ordem
  base fica em cache por `versao`.

Medido na fase 1 (20 mil negócios sintéticos, Mac de desenvolvimento): a primeira
versão levava 431 ms. As correções que levaram a ~45–60 ms (a variação é a carga da
máquina) e ~30 ms na busca:

- `diaLocal` com um `Intl.DateTimeFormat` por fuso, reaproveitado: o
  `toLocaleDateString` com fuso monta um formatador a cada chamada (~105 µs);
- posição alfabética calculada uma vez por lista, e a ordenação compara números;
- relevância calculada uma vez por negócio, não a cada comparação;
- destacados separados no laço, em vez de recalcular o destaque a cada comparação;
- texto de busca sem acento guardado por negócio.

A primeira consulta depois de uma lista nova (cache frio) leva ~160 ms. A medição que
vale para a meta de 50 ms é a da fase 2, na VPS.

### 3.3 O endpoint (`src/app/api/admin/painel/route.ts`)

Rota `GET` com o token em `Authorization: Bearer`, em vez de server action: o Next
despacha uma server action por vez (comentário em `page.tsx`), e a busca digitada
viraria fila. Com `fetch`, a requisição velha é cancelada (`AbortController`).
Sem `cacheComponents` no `next.config.ts`, a rota roda a cada requisição (doc do
Next 16, `15-route-handlers.md`); mesmo assim responde com `Cache-Control:
no-store, private`, porque leva telefones e nomes.

A resposta traz: os itens da página (40; "mostrar mais" pede 80, 120…) com o CRM
deles, o total filtrado, as contagens (chips, visões, prazos, alertas), as métricas
e os primeiros cartões de cada coluna do funil, os totais do cabeçalho e o estado
do índice (`versao`, `montadoEm`). Os alertas vão com a contagem (`total`), sem a lista de
slugs: o foco num alerta é o filtro `alerta`, aplicado no servidor.

### 3.4 A tela

Guarda só os filtros e a página atual. A busca espera 300 ms depois da última
tecla. A carteira pede os fechados ao servidor; o Gerador e a Coleta só pedem a
página de novo. Durante as fases 3 e 4, `/admin?modo=antigo` mantém o caminho
atual, para voltar atrás sem deploy.

## 4. O que muda

| | Hoje | Depois |
|---|---|---|
| Leituras por abertura do admin | ~30 mil | 0 com o índice montado |
| Leituras para montar o índice | — | ~30 mil, uma vez por sessão de uso (até 2 h ocioso) |
| Payload por abertura | ~4 MB | ~10–20 KB |
| Memória do servidor | picos de até 2,24 GB ao montar e serializar | **+~120 MB de RSS fixos** enquanto o índice existe (medido) |
| Primeira consulta depois de deploy | ~5 s (hoje) | até ~11 s (montagem medida: 10,8 s) |
| Filtro ou busca | instantâneo, no navegador | uma ida ao servidor, alvo < 50 ms de CPU |

## 5. Riscos

Medidos em 01/11 quando indicado. Cada risco tem a correção que entra no plano.

| # | Risco | Evidência | Correção |
|---|---|---|---|
| R1 | **Listener não aceita `select()`**: o índice guarda o documento inteiro | SDK 9.2.0: "Queries that contain field masks cannot be listened to via `onSnapshot()`" | Aceitar. Medido: +~120 MB de RSS e +90 MB de heap com `tenants` e `crm` inteiros. Cabe no limite de heap de 1.280 MB. Desmontar quando ocioso (3.1). |
| R2 | **Leituras podem não cair**: cada montagem lê ~30 mil, e hoje houve 6 reinícios | Log da VPS de 01/11 | Montagem sob demanda, não no boot; desmontagem só depois de 2 h ociosa. Registrar no log cada montagem, para medir as leituras reais na primeira semana. Se piorar, aumentar `OCIOSO_MS`. |
| R3 | **Reconexão relê tudo**: listener desconectado por mais de 30 min é cobrado como consulta nova | Regra de cobrança do Firestore | Coberto por R2. O log de montagem também registra reconexões. |
| R4 | **CPU bloqueia o processo**: 1 vCPU; filtro e ordem rodam no mesmo processo que serve os sites públicos | Ordenar: 87 ms com `localeCompare`; busca sem pré-normalizar: 16 ms | Uma passada (3.2), `Intl.Collator`, ordem base em cache, busca pré-normalizada (1 ms). Registrar consultas acima de 50 ms. Teste de desempenho com 20 mil itens sintéticos e teto de 50 ms. |
| R5 | **Primeira consulta lenta**: montar leva 10,8 s | Medido | A rota espera a montagem até 20 s; passou disso, responde 503 com `Retry-After: 2`. A tela mostra "Preparando o painel…" e tenta de novo. |
| R6 | **Listener cai e o índice fica velho** | `onError` só é chamado em erro definitivo; falha de rede o SDK reconecta sozinho | `onError` solta o índice inteiro; a próxima consulta monta de novo (sem ninguém no admin, não relê nada). Montagem que falha espera de 1 s a 60 s, crescendo, antes de tentar outra vez; nesse meio a rota responde 503. A resposta leva `versao` e `montadoEm`. Callback de snapshot nunca lança: erro de um documento é registrado e pulado. |
| R7 | **Documento estranho no Firestore** (campo de outro tipo, nome vazio, nota 50) | 14,9 mil documentos gravados por vários caminhos ao longo de meses | Cada documento passa por um schema zod tolerante (6.3): campo inválido vira o valor neutro (`null`, `""`), documento sem nome usa o slug. Uma linha de log por montagem com a contagem de documentos corrigidos. |
| R8 | **Fuso horário**: "hoje", "atrasada" e "falei hoje" hoje usam o fuso do navegador; no servidor, usariam `TZ=America/Sao_Paulo` | `diaLocal` e `hojeISO` no `page.tsx`; `Environment=TZ` no serviço | A tela manda `hoje` (AAAA-MM-DD) e `tz` (nome IANA). O servidor valida (6.4) e calcula com eles. Teste na virada da meia-noite e com fuso diferente. |
| R9 | **Tela pisca valor antigo** depois de uma ação, até o listener chegar | Listener leva ~1 s | Escrita do próprio processo atualiza o índice na hora (3.1). A tela ignora respostas mais velhas que a última pedida (número de sequência). |
| R10 | **Endpoint expõe dados pessoais** (telefone, nome, valores) | Dados do CRM | Exige `requireAdmin` em toda requisição; token só no cabeçalho, nunca na URL (URL vai para log do Caddy); `Cache-Control: no-store, private`; erro nunca devolve stack nem dado interno. |
| R11 | **`requireAdmin` lê `config/admin` a cada requisição**: com busca digitada, uma leitura por tecla | `src/lib/admin-guard.ts` | O índice já ouve `config/admin`; a rota usa essa cópia quando o índice está montado. A verificação do token (`verifyFirebaseToken`) continua em toda requisição. |
| R12 | **Consulta abusiva** (página enorme, busca de 1 MB, parâmetro desconhecido) | Rota nova exposta | Schema estrito (6.4): página até 2.000 itens, busca até 100 caracteres, parâmetro desconhecido recusado com 400. |
| R13 | **Divergência com a tela atual**: a regra de um filtro muda sem querer na mudança | Lógica espalhada por 2.236 linhas | Fase 1 extrai sem mudar; teste de paridade entre a função antiga e a nova com dados sintéticos sorteados (6.5). Fase 2 compara em produção, só lendo. |
| R14 | **Mais de um processo** teria um índice e listeners em cada um | Hoje há um processo só | Funciona igual, pagando a montagem em cada um. Registrado aqui para quando houver escala. |
| R15 | **Voltar atrás** se a fase 3 ou 4 der problema | — | `/admin?modo=antigo` até a fase 5; cada fase é um PR com deploy, e o `deploy-vps.sh` mantém o `app-prev`. |

## 6. Requisitos de cada mudança

### 6.1 Tipagem forte

- **Um arquivo de contrato** (`src/lib/painel-tipos.ts`, sem `server-only`, usado
  pela tela e pelo servidor): o schema zod da consulta, o tipo da resposta e os
  enums. Os tipos saem do schema (`z.infer`), nunca escritos à mão em dois lugares.
- **Enums fechados** para ordem, estágio, prazo, situação, visão e alerta, com
  `satisfies Record<Ordem, Comparador>` nas tabelas: esquecer um caso é erro de
  compilação.
- **Slug com marca** (`z.string().regex(SLUG).brand<"Slug">()`): um texto qualquer
  não passa por slug sem validar.
- **Resposta como união discriminada**: `{ ok: true, ... } | { ok: false, codigo,
  erro }`. A tela trata cada `codigo` com `switch` exaustivo.
- **Sem `any` e sem `as`** nos arquivos novos, a não ser na fronteira com o
  Firestore, e sempre depois do schema zod. `strict` já está ligado no
  `tsconfig.json`.

### 6.2 Tratamento de erro

**Na rota**, cada erro vira um código HTTP e uma mensagem para pessoas:

| Erro | Resposta |
|---|---|
| Token ausente, inválido ou vencido | 401 "Sessão expirada. Entre novamente." |
| Conta sem permissão ou sessão revogada | 403 "Área restrita." |
| Consulta inválida (zod) | 400 com o campo e o limite (reaproveita `invalido()` do `admin-guard.ts`) |
| Índice montando há mais de 20 s | 503 + `Retry-After: 2` |
| Qualquer outro | 500 "Não foi possível agora."; o log leva o tipo do erro e os filtros, sem telefone nem token |

**No índice**: callbacks de snapshot dentro de `try/catch`; documento com problema
é pulado e contado; `onError` dispara a remontagem com espera crescente; uma
montagem que falhar não derruba a anterior (troca atômica).

**Na tela**: 401 usa o fluxo de sessão expirada que já existe (PR #173: token novo
e uma nova tentativa); 503 mostra "Preparando o painel…" e tenta de novo; queda de
rede mantém a página atual na tela, com aviso e botão "Tentar de novo";
cancelamento por `AbortController` é ignorado; resposta fora de ordem é descartada.

### 6.3 Sanitização dos dados do Firestore

Cada `tenant` e cada `crm` passa por um schema zod tolerante antes de entrar no
índice:

- `nome`: texto, sem caracteres de controle, até 120 caracteres; vazio usa o slug.
- `telefone`: fica como foi gravado (a busca acha "(91) 9…", e a tela formata), limpo e
  até 30 caracteres; com menos de 8 ou mais de 15 dígitos, `null`.
- `uf`: uma das 27 siglas (`UFS` de `src/lib/coleta.ts`); fora disso, `null`. Em
  01/11 nenhum dos 14.937 negócios tinha UF fora das 27 siglas, mas o campo do
  cadastro é texto livre.
- `cidade`: `limparTexto` de `painel-tipos.ts` (a mesma da consulta), até 80 caracteres.
- `estagio`: fora da lista, "novo" (o `negocio()` já faz; não pode haver outro caminho).
- `nota`: número de 0 a 5; `avaliacoes`: inteiro ≥ 0; fora disso, `null`.
- `crm`: passa pelo `negocio()` que já existe em `src/lib/crm.ts`, que converte
  `Timestamp` em ISO e já é testado.

Na saída, nada é renderizado como HTML: a tela usa React, que escapa o texto, e a
rota responde JSON. O CSV de convites continua com a proteção contra fórmula que
já existe (`baixar` no `page.tsx`).

### 6.4 Validação da consulta

Schema estrito (`z.strictObject`): parâmetro desconhecido é recusado.

| Parâmetro | Regra |
|---|---|
| `busca` | teto bruto de 400 caracteres antes da limpeza; `normalize("NFC")`, sem controles C0/C1 nem de direção (bidi), `trim`; até 100 caracteres |
| `uf` | uma das 27 siglas ou vazio |
| `cidade` | o rótulo do chip ("Cidade/UF", ou só "Cidade" quando o negócio não tem UF), mesma limpeza da busca, até 100 caracteres. O índice limpa a cidade gravada com a mesma função (6.3), senão as duas formas não casam |
| `nicho` | um dos nichos conhecidos (`nichoDe` em `painel-tipos.ts`) ou vazio |
| `situacao`, `estagio`, `prazo`, `ordem`, `alerta` | enums fechados. Não há `visao`: a visão é um preset dos filtros e se deduz deles (`visaoDe`) |
| `fora`, `caixa`, `fixados`, `contato` | booleanos (`z.stringbool()`, zod 4.6) |
| `n` | só dígitos (`"0x28"`, `"4e1"` e `" 40 "` são recusados), de 1 a 2.000 |
| `hoje` | AAAA-MM-DD, a até 1 dia da data do servidor |
| `tz` | nome IANA aceito por `Intl.DateTimeFormat`, até 64 caracteres, guardado na grafia canônica |

Dentro da consulta (`Filtros`), a UF é texto: o chip vem do valor gravado, e quem
confere a sigla é esta fronteira e a limpeza do índice. Assim um valor fora do
padrão no Firestore continua filtrando, como antes.

Os mesmos schemas valem para as server actions novas ou alteradas (por exemplo,
`espacosGerados` já valida slug e tamanho).

### 6.5 Testes

No padrão do projeto (`tsx` com `node:assert`; emulador na porta 8085):

1. **`painel-consulta.test.mts`** (puro, entra no CI):
   - cada filtro sozinho e combinado;
   - contagem de chip ignorando a própria dimensão (o caso "chip promete 115 e
     entrega lista vazia" do comentário no `page.tsx`);
   - contagem de cada visão; prazos; alertas;
   - cada ordenação, com desempate e destacados no topo;
   - busca sem acento e por telefone;
   - limites da página (`n` igual a 0, 1, 2.000 e maior que o total);
   - virada da meia-noite e fuso diferente.
2. **Paridade** (fase 1): a função antiga, copiada do `page.tsx`, contra a nova, em
   500 bases sintéticas sorteadas com semente fixa. Tem que dar igual em todas.
3. **Desempenho**: 20 mil negócios sintéticos; a consulta mais cara (todos os chips
   e a ordenação por nome) tem que ficar abaixo de 50 ms.
4. **`painel-tipos.test.mts`**: o schema recusa parâmetro desconhecido, `n` fora do
   limite, busca longa, UF inexistente, data fora da janela, fuso inválido e
   caracteres de controle; e aceita texto com aspas, `<script>` e emoji como texto
   comum.
5. **`painel-indice.test.mts`** (emulador): criar, alterar e apagar um negócio
   aparece no índice; documento estranho é corrigido e contado; CRM trivial não
   entra; acesso de cliente aparece e some com o `member`; erro de listener leva à
   remontagem; desmontagem por ociosidade; troca atômica (consulta durante a
   remontagem vê a versão anterior inteira).
6. **Rota** (emulador com Auth, como o `test:booking`): 401 sem token, 403 sem
   permissão, 400 com consulta inválida, 503 com índice montando, 200 com o formato
   do contrato e `Cache-Control: no-store`.
7. **Produção, só leitura** (fase 2): para 50 combinações de filtro, a página e as
   contagens do endpoint batem com o cálculo atual sobre os mesmos dados, como foi
   feito nos PRs #176 e #177.
8. **Antes de cada merge**: `tsc`, `eslint`, os testes acima, `npm run build` e o CI.

## 7. Fases

Cada fase é um PR com deploy, e a tela funciona igual no fim de cada uma.

1. **Extrair a lógica**: contrato (6.1) e funções puras (3.2) em
   `src/lib/painel-consulta.ts`, com os testes 1 a 4. A tela passa a importá-las.
   Nenhuma mudança de comportamento.
2. **Índice e endpoint**: listeners, rota e testes 5 a 7, ainda sem uso pela tela.
   Medir a memória e as leituras da montagem na VPS. As escritas do próprio processo
   atualizando o índice na hora (3.1, R9) ficam para a fase 3, quando a tela passa a ler
   do índice. `npm run test:painel-indice` (emulador) e `npm run conferir:indice`
   (produção, só leitura, ~60 mil leituras).
3. **Lista no servidor**: lista, visões, chips, alertas e busca passam a vir do
   endpoint, com `?modo=antigo` como saída.
4. **Funil, carteira e cabeçalho** passam a vir do endpoint.
5. **Desligar o antigo**: o `abrirPainel` deixa de mandar `espacos` e `crm`; saem o
   `espacosGerados` do PR #176 e o `?modo=antigo`.

Depois da fase 3, uma semana de observação: leituras reais por dia (log de
montagem), memória do processo e consultas acima de 50 ms.

## 8. Fora deste plano

- Busca com erro de digitação ou por relevância de texto (exigiria um motor de busca).
- Exportar a lista filtrada inteira (hoje não existe; dá para acrescentar no
  endpoint depois).
