# Ruphus

`v0.3.0` · Next.js 16 · Firebase · Vercel

**Agenda online e site para quem atende de porta aberta.** Salões, barbearias, pet shops, clínicas e estúdios ganham um endereço próprio, uma agenda que o cliente usa sozinho e um painel para tocar o dia. A Ruphus vende, implanta e cobra por isso — e este repositório é o produto inteiro: o site público, o painel do negócio, o CRM de vendas e a cobrança por Pix.

```
Cliente final ──▶  {slug}.ruphus.site        site + /agendar  (marca sozinho, 24h)
Dono do negócio ─▶ /painel · /{slug}         agenda, serviços, profissionais, clientes
Ruphus ──────────▶ /admin                    funil, carteira, implantação, cobrança
```

---

## Índice

- [O que existe aqui](#o-que-existe-aqui)
- [Stack](#stack)
- [Rodando localmente](#rodando-localmente)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Mapa de rotas](#mapa-de-rotas)
- [Como os dados são organizados](#como-os-dados-são-organizados)
- [Regras de negócio que moram no código](#regras-de-negócio-que-moram-no-código)
- [Segurança](#segurança)
- [Testes](#testes)
- [Scripts de operação](#scripts-de-operação)
- [Deploy](#deploy)
- [Convenções](#convenções)

---

## O que existe aqui

Três produtos no mesmo aplicativo, com um banco só.

### 1. O site e a agenda do cliente final

Cada negócio tem um endereço em `{slug}.ruphus.site`. O site estático mora em `public/s/{slug}` e é servido pelo proxy (`src/proxy.ts`); o agendamento é o app.

- **Uma tela só** para marcar: serviço, profissional e horário, sem recarregar a página.
- **Página de bio** (`/bio/{slug}`), no estilo "link na bio", com ISR de 60s.
- **Resumo pelo WhatsApp é opcional** — quem confirma é o negócio.
- Horário ocupado não aparece; cada profissional tem a própria grade.

### 2. O painel do negócio

- **Agenda** do dia e da semana, com remarcação, confirmação pelo WhatsApp e histórico.
- **Serviços** com preço, duração e validação em tempo real (nome duplicado é barrado).
- **Profissionais** com horário por dia da semana e serviços que cada um faz. O plano inclui **5 profissionais**; o admin da plataforma libera mais.
- **Clientes** com ficha, etiquetas, histórico e planos.
- Um negócio por conta, por padrão.

### 3. O /admin — CRM e cobrança da Ruphus

Quatro telas, escolhidas na barra de cima: **Lista**, **Funil**, **Clientes** e **Cobrança**.

- **Lista** dos negócios prospectados. As visões são recortes prontos — "Atrasados", "Para hoje", "Falei hoje", "Em destaque" — e Filtros e ordem ficam na mesma linha delas.
- **Funil** com arrastar e soltar, conversão entre etapas e relatório de origem e de perdas. No celular a etapa muda dentro da gaveta: arrastar é de mouse.
- **Clientes** (carteira): implantação em 4 passos, saúde (Saudável / Atenção / Em risco) com o motivo, e agendamentos dos últimos 30 dias.
- **Cobrança**: Pix com BR Code, cobranças em atraso, baixa manual e lote mensal. A aba mostra quantas estão vencidas.
- **Alertas**, acima da lista: sem próximo passo, parado há 7+ dias, fechou e não entrou, destaque vencendo. Cada um filtra a lista com um toque, e a faixa some quando não há o que avisar.
- **Mensagens prontas** por etapa, em cadência (dia 0, +3, +10), sem link nem preço no primeiro contato e com saída explícita. A assinatura é definida uma vez pelo admin; sem ela, enviar e copiar ficam travados.
- **Gaveta do negócio**: contato do dono, linha do tempo, cobranças, implantação, objeções respondidas e "Manter em destaque" por 1, 3 ou 7 dias.
- **Ajustes na engrenagem**: quem assina, logout automático, conta, versão e sair. O que falta configurar vira um ponto na engrenagem e uma linha acima da lista, que some quando resolvido.

---

## Stack

| Camada | Escolha | Por quê |
|---|---|---|
| Framework | **Next.js 16.3.5** (App Router, Turbopack) | Server Actions cobrem o back-end inteiro: não há API separada |
| UI | **React 19** + **Tailwind CSS v4** + **@base-ui/react** | `@theme inline`, variantes `has-*`/`group-has-*`; Base UI para diálogo e menu acessíveis |
| Dados | **Firebase** (Firestore + Auth + Storage) | Regras no banco, sem servidor de sessão |
| Servidor | **firebase-admin** em Server Actions | O que decide limite e acesso roda fora do navegador |
| Validação | **zod v4** | Um esquema por entrada, do formulário à gravação |
| Pagamento | Pix **BR Code** gerado no próprio app (`src/lib/pix.ts`) | Sem intermediário e sem taxa por transação |
| Hospedagem | **Vercel** + GitHub Actions | Deploy no merge; os testes rodam no CI |

> **Atenção:** este Next.js não é o das suas lembranças. Antes de escrever código, leia o guia correspondente em `node_modules/next/dist/docs/` — APIs, convenções e estrutura de arquivos mudaram. Isso vale para humanos e para agentes (veja `AGENTS.md`).

---

## Rodando localmente

**Requisitos:** Node 20+, uma chave de serviço do Firebase e o `firebase-tools` (já vem nas devDependencies).

```bash
npm install
cp .env.example .env.local        # preencha (veja a tabela abaixo)
npm run dev                       # http://localhost:3000
```

Mudou o `next.config.ts`? Reinicie o servidor — ele só lê essa configuração ao subir.

Mexeu no `package-lock.json` (inclusive para desfazer um `npm audit fix`)? Rode `npm ci`: lockfile revertido sem reinstalar deixa o `node_modules` inconsistente, e o erro aparece dentro de `node_modules`, longe da causa.

**Cuidado com `vercel link` e `vercel env pull`**: eles reescrevem o `.env.local` e levam junto o que a CLI não conhece, como o `GOOGLE_APPLICATION_CREDENTIALS`. Sem essa linha, o Admin SDK não lê `config/admin` e o admin da plataforma cai no `/painel`.

**Emuladores**, para os testes que tocam o banco:

```bash
npm run test:rules                # regras do Firestore e do Storage
npm run test:booking              # agendamento, cota, CRM e saúde
```

Os emuladores sobem e caem sozinhos dentro de cada comando; nada precisa estar rodando antes.

---

## Variáveis de ambiente

Em `.env.local` (desenvolvimento) e no painel da Vercel (produção).

| Variável | Onde vale | Para quê |
|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | cliente | SDK do navegador |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | cliente | login |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | cliente e scripts | projeto |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | cliente | imagens |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | cliente | SDK |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | cliente | SDK |
| `NEXT_PUBLIC_SITE_URL` | cliente | links absolutos (convite, compartilhar) |
| `FIREBASE_SERVICE_ACCOUNT` | servidor | credencial do Admin SDK, em JSON, na Vercel |
| `GOOGLE_APPLICATION_CREDENTIALS` | servidor local | caminho do `.json` da conta de serviço |
| `OWNER_UID` | scripts | quem vira admin da plataforma no primeiro uso |
| `SITE_URL` | servidor | origem que o proxy usa para consultar a lista de sites fechados |
| `DESATIVADOS_TOKEN` | servidor | segredo entre o proxy e `/api/desativados`; sem ele a lista fica pública (já criado em produção) |

`NEXT_PUBLIC_VERSAO` e `NEXT_PUBLIC_COMMIT` não se preenchem à mão: o `next.config.ts` injeta a versão do `package.json` e o commit da Vercel, que aparecem no rodapé do `/admin`.

---

## Mapa de rotas

| Rota | Quem entra | O que é |
|---|---|---|
| `/` | todos | landing estática, servida pelo proxy |
| `/agendar/{slug}` | cliente final | agendamento, tela única |
| `/bio/{slug}` | cliente final | página de bio, com ISR |
| `/pagar/{id}` | cliente final | cobrança em Pix, com copia e cola |
| `/login` | todos | e-mail e senha ou Google |
| `/convite` | convidado | aceita o convite e entra no negócio |
| `/painel` | dono | lista dos seus negócios e cadastro de um novo |
| `/{slug}` | dono, admin do negócio | agenda do dia |
| `/{slug}/servicos`, `/profissionais`, `/clientes` | dono, admin | cadastros |
| `/admin` | admin da plataforma | CRM, carteira e cobrança |
| `/indisponivel` | — | site fora do ar |

O proxy (`src/proxy.ts`) resolve `{slug}.ruphus.site` para `public/s/{slug}`, mantém `www` e o apex no app, e guarda por um minuto a lista de sites desativados para não consultar o banco a cada visita.

---

## Como os dados são organizados

```
tenants/{slug}                  negócio: nome, ownerId, limiteStaff
  members/{uid}                 acesso: role owner | admin | member, email, nome, viaConvite
  services/{id}                 serviço: nome, duração, preço, ativo
  staff/{id}                    profissional: nome, serviços, horário por dia
  appointments/{id}             agendamento
  customers/{telefone}          cliente do negócio, com etiquetas
    notas/{id}                  anotações da ficha
  plans/{id}                    plano/pacote do cliente
crm/{slug}                      funil: etapa, preço, dono, origem, datas, destaque
  eventos/{id}                  linha do tempo (etapa, mensagem)
  notas/{id}                    anotações do vendedor
cobrancas/{id}                  Pix: valor, vencimento, token, pago em
limites/{uid}                   quantos negócios a conta pode ter
convitesUsados/{jti}            convite já consumido (uso único)
config/admin                    uids que administram a plataforma, e sessões encerradas
config/convite                  segredo que assina os convites
config/pix                      chave Pix da Ruphus, recebedor e cidade
config/crm                      quem assina as mensagens
config/sessao                   minutos até o logout automático
```

Tudo o que decide acesso está em `firestore.rules`, com teste em `rules.test.mjs`. O que a regra não consegue decidir — contar documentos, por exemplo — mora numa Server Action com o Admin SDK.

---

## Regras de negócio que moram no código

Estas são as decisões que se perdem se ficarem só na cabeça de alguém:

- **Cota de negócios** (`src/lib/negocios.server.ts`): 1 por conta. Conta quem é `owner`, e o `admin` só quando entrou por convite (`viaConvite`) — sem isso, o dono de um negócio poderia gastar a cota alheia. A criação roda numa transação: dois cliques não passam juntos. A regra impede o cliente de gravar `viaConvite`, senão daria para queimar a cota de quem tem o uid conhecido.
- **Limite de profissionais** (`src/lib/limites.ts`, `criarProfissional`): 5 por negócio, ajustável pelo admin da plataforma. Criar passa pelo servidor, que conta a equipe numa transação — a regra do Firestore nega `create` no cliente e impede que o negócio aumente o próprio limite.
- **Saúde do cliente** (`src/lib/saude.ts`): _risco_ com cobrança atrasada ou 21 dias sem agendar; _atenção_ com implantação incompleta ou cobrança vencendo em 5 dias. Sem data de fechamento, não se acusa inatividade.
- **Alertas do CRM** (`src/lib/alertas.ts`): negociação sem próximo passo, parada há 7+ dias, venda fechada sem o dono entrar em 7 dias, destaque vencendo hoje.
- **Dinheiro digitado à mão** (`src/lib/dinheiro.ts`): `59,90`, `59.90` e `1.250,00` querem dizer o que parecem.
- **Datas no fuso de quem olha** (`hojeISO()`): em Manaus, `toISOString()` viraria o dia às 20h e todo compromisso de hoje apareceria como atrasado.
- **Revogação de sessão** (`src/lib/revogacao.ts`): o verificador de token não consulta o Firebase Auth (o Admin Auth não carrega na Vercel), então a marca de "sessões encerradas" mora em `config/admin`, documento que os dois guardas já leem — custo zero de leitura.
- **Logout automático** (`src/lib/sessao.ts`): conta por relógio, não por `setTimeout` — aba em segundo plano tem o timer estrangulado pelo navegador.

---

## Segurança

O que sustenta o isolamento entre negócios, e onde mexer com cuidado:

- **Token verificado de verdade** (`src/lib/verify-token.ts`): `jose.jwtVerify` contra o JWKS do Firebase, com issuer, audience e `alg` travados. O Admin Auth não carrega na Vercel — daí a verificação própria.
- **Sessão encerrável** (`src/lib/revogacao.ts`): "Encerrar sessões" no `/admin` marca a conta em `config/admin`, e o token deixa de ser aceito mesmo antes de expirar.
- **Toda ação do painel passa por um guarda**: `requireMember` amarra uid ↔ negócio; `adminAction` cobre as 30 ações do `/admin`. O idToken vai como argumento, não como cookie — não há superfície de CSRF.
- **Fora do alcance do cliente**: `crm`, `cobrancas`, `limites`, `convitesUsados` e `config/*` não são cobertos por regra nenhuma, então são negados por padrão. A exceção é `config/sessao`, que só diz os minutos do logout.
- **Regras são lista fechada**: sob `tenants/{t}` só `services`, `sites` e `staff` estão liberados. Coleção nova nasce negada.
- **Convite**: JWT HS256 com segredo de 256 bits em `config/convite`, válido 7 dias, uso único garantido por `create()` em `convitesUsados/{jti}`. É um bearer: quem tiver o link vira admin daquele negócio.
- **Storage** só aceita `image/*` até 10 MB, e só de membro do negócio.
- **Agendamento anônimo** tem limite por telefone e por dispositivo (IP guardado só como hash). O IP vem de `x-real-ip` ou do último `x-forwarded-for` — o primeiro é escolhido por quem chama.
- **Prospecção por WhatsApp** segue a política da Meta: mensagem curta, sem link no primeiro contato, com saída explícita e no máximo três toques.

Depois de mexer em `firestore.rules` ou `storage.rules`, rode `npm run test:rules` e publique (veja Deploy).

---

## Testes

Sem framework: cada suíte é um arquivo que roda com `tsx` ou `node` e termina imprimindo `ok`. O que toca o banco sobe o emulador do Firebase.

```bash
npm run test:rules        # regras de acesso (Firestore + Storage)
npm run test:booking      # agendamento, cota, eventos do CRM, saúde
npm run test:convite      # convite: criação, validade, aceite
npm run test:cobranca     # Pix, baixa, lote do mês
npm run test:clientes     # ficha, etiquetas, histórico
npm run test:crm          # funil, saúde, alertas, dinheiro, revogação (sem emulador)
npm run test:proxy        # roteamento de {slug}.ruphus.site
npm run test:pix          # BR Code e CRC
npm run test:whatsapp     # montagem dos links
npm run test:scale        # comportamento com volume
```

O CI (`testes`) roda o conjunto a cada push. **Confira a execução do commit final antes de mesclar** — não a de um commit anterior.

---

## Scripts de operação

```bash
npm run admin             # promove um uid a admin da plataforma
npm run convite           # gera convite para um negócio
npm run import:sites      # importa sites e cria os tenants
npm run membros           # preenche e-mail e nome nos acessos antigos (--aplicar grava)
npm run seed:agenda       # popula uma agenda de exemplo
npm run vitrine           # atualiza a vitrine pública
npm run sync:sites        # sincroniza os sites estáticos
```

Todo script que grava tem um modo de simulação: rode sem `--aplicar` primeiro.

---

## Deploy

1. Trabalhe numa branch e abra o PR.
2. O CI roda os testes (~10 min) e a Vercel publica um preview.
3. Com o CI verde **no commit final**, `gh pr merge --squash --delete-branch`.
4. O merge na `main` dispara o deploy de produção.
5. As regras saem à parte, **depois** do código — publicá-las antes quebraria a versão que ainda está no ar:

```bash
npx firebase deploy --only firestore:rules,storage    # projeto padrão: .firebaserc
```

6. Subiu versão? `package.json` e uma entrada no `CHANGELOG.md`.

A versão no ar aparece no rodapé do `/admin` (`v0.3.0 · <commit>`), e vem do `package.json` mais o commit da Vercel.

---

## Convenções

- **Português no código.** Nomes, comentários e mensagens de erro em português; o inglês fica no que veio do framework.
- **Comentário explica o porquê**, nunca o quê. Se descreve o que a linha faz, ele sobra.
- **Erro esperado é classe** (`ErroPrevisto`): a tela mostra a mensagem; o resto vira erro genérico.
- **Uma responsabilidade por arquivo em `src/lib`**, com o servidor isolado em `*.server.ts` e `server-only`.
- **Regra do Firestore é lista fechada**: coleção nova sob `tenants/{t}` nasce negada, e entra na regra só quando alguém decide que o funcionário pode mesmo ler e escrever nela.
- **Acessibilidade não é opcional**: `<button>` de verdade, rótulo em todo campo, alvo de toque de 44px no celular e campo com 16px (senão o iOS dá zoom).
- Mudanças relevantes entram no `CHANGELOG.md`, do ponto de vista de quem usa.

---

© 2026 Ruphus. Todos os direitos reservados.
