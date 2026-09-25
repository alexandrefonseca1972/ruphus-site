# Manual técnico

Como o sistema é feito por dentro: o que roda onde, onde cada dado mora, o que
protege o quê, e o que você precisa saber antes de mexer. O README é a visão de
cima; este arquivo é a planta baixa.

> Versão do produto: veja `package.json` e o rodapé do `/admin` (`v0.3.0 · commit`).

---

## Índice

- [1. Os três produtos num app só](#1-os-três-produtos-num-app-só)
- [2. Onde o código roda](#2-onde-o-código-roda)
- [3. O proxy: como um endereço vira um site](#3-o-proxy-como-um-endereço-vira-um-site)
- [4. Agendamento: como o horário livre é calculado](#4-agendamento-como-o-horário-livre-é-calculado)
- [5. Autenticação e autorização](#5-autenticação-e-autorização)
- [6. Modelo de dados](#6-modelo-de-dados)
- [7. Regras do Firestore e do Storage](#7-regras-do-firestore-e-do-storage)
- [8. Dinheiro: Pix, cobrança e baixa](#8-dinheiro-pix-cobrança-e-baixa)
- [9. CRM: funil, saúde e alertas](#9-crm-funil-saúde-e-alertas)
- [10. Limites, cotas e anti-abuso](#10-limites-cotas-e-anti-abuso)
- [11. Erros: o que chega ao usuário](#11-erros-o-que-chega-ao-usuário)
- [12. Testes](#12-testes)
- [13. Build, deploy e ambientes](#13-build-deploy-e-ambientes)
- [14. Tetos conhecidos](#14-tetos-conhecidos)

---

## 1. Os três produtos num app só

| Quem | Onde | O que faz |
|---|---|---|
| Cliente final | `{slug}.ruphus.site`, `/agendar/{slug}`, `/bio/{slug}`, `/pagar/{id}` | marca horário, vê o minisite, paga |
| Dono do negócio e equipe | `/painel`, `/{slug}` e filhas | agenda, serviços, profissionais, clientes |
| Ruphus | `/admin` | CRM, carteira, cobrança, limites, ajustes |

Um banco só (Firestore), um deploy só (Vercel). O que separa os três é **papel**
e **regra**, não infraestrutura.

---

## 2. Onde o código roda

```
src/proxy.ts                     borda: decide o que cada host e rota servem
src/app/**/page.tsx              telas (a maioria "use client")
src/app/**/actions.ts            Server Actions — é aqui que mora o back-end
src/lib/*.server.ts              só servidor (marcado com "server-only")
src/lib/*.ts                     puro ou isomórfico: regra de negócio testável
src/components/ui/*              base de UI (shadcn) com ajustes de toque
```

**Não existe API REST.** O que o navegador precisa do servidor vem por Server
Action, e o ID token do Firebase viaja **como primeiro argumento** — não há
cookie de sessão, e por isso não há superfície de CSRF.

O painel **lê** o Firestore direto pelo SDK do navegador (protegido pelas
regras) e **escreve pelo servidor** onde a regra não é suficiente: criar
negócio, criar profissional, agendar, remarcar, planos.

### A divisão em `src/lib`

| Arquivo | Ambiente | Papel |
|---|---|---|
| `admin.ts` | servidor | inicializa o Admin SDK (`adminDb`) |
| `verify-token.ts` | servidor | verifica o ID token com `jose` e o JWKS do Firebase |
| `admin-guard.ts` | servidor | `requireAdmin`, `adminAction` |
| `booking.server.ts` | servidor | catálogo, horários, reserva, remarcação, planos, clientes, `requireMember` |
| `negocios.server.ts` | servidor | cota de negócios, criar negócio, criar profissional |
| `crm.ts`, `cobranca.ts`, `convite.ts`, `saude.server.ts` | servidor | CRM, Pix, convites, saúde |
| `scheduling.ts` | isomórfico | schemas zod de serviço, profissional, reserva, plano |
| `datetime.ts` | isomórfico | fuso, `freeSlots`, máscaras, `customerKey`, links de WhatsApp |
| `gerador.ts`, `site-pet.ts`, `site-beleza.ts`, `catalogo.ts` | puro | gerador de sites: planilha → leads, nicho, slug e os dois modelos de página (pet; beleza, que inclui barbearia, salão, estética, unhas e tatuagem); `catalogo.ts` é a tabela de serviços que o `seed:agenda` também usa |
| `gerador.server.ts` | servidor | grava os sites da planilha (prévia e gravação são a mesma conta) |
| `saude.ts`, `alertas.ts`, `clientes.ts`, `dinheiro.ts`, `pix.ts`, `revogacao.ts`, `limites.ts` | puro | regra de negócio, testável sem banco |
| `sessao.ts`, `use-collection.ts`, `firebase.ts` | cliente | logout automático, coleções em tempo real, SDK web |
| `firebase-db.ts`, `sessao-config.ts` | cliente | Firestore do navegador, e o único `onSnapshot` de sessão — separados para quem só faz login não baixar 1 MB de SDK |

`datetime.ts` **não importa zod** de propósito: ele entra no pacote que o
celular do cliente final baixa.

---

## 3. O proxy: como um endereço vira um site

`src/proxy.ts` roda na borda, em toda requisição que não seja `/_next/`.

1. **`{slug}.ruphus.site`** → o slug sai do `Host` pelo regex
   `^([a-z0-9][a-z0-9-]*)\.ruphus\.site$`. `www` e `app` não são sites.
2. **Fora do ar?** `foraDoAr(slug)` consulta `/api/desativados` (cache de 60s em
   memória) e, se o slug estiver lá, reescreve para `/indisponivel` com **404**.
3. **Senão**, reescreve para o arquivo estático em `public/s/{slug}`, com três
   exceções que apontam para o app: `/agendar` → `/agendar/{slug}`, `/bio` →
   `/bio/{slug}`, e `/assets/...` → `/s/assets/...` (pasta compartilhada).
   **Sem pasta em `public/s/{slug}`**, o `/s/{slug}/index.html` cai na rota
   `src/app/s/[slug]/index.html/route.ts`: é assim que os sites do gerador vão
   ao ar sem arquivo e sem deploy (o `public/` responde antes das rotas
   dinâmicas, então os sites da fábrica não passam por ela).
4. **Sem slug** (apex, `www`): `/` → `public/sobre/index.html`, `/privacidade` →
   a página estática; qualquer outra rota segue para o app.

Duas decisões que valem lembrar:

- A **origem** que o proxy usa para buscar a lista vem de `SITE_URL`, não do
  `Host` da requisição: host é entrada de fora e não decide destino de servidor.
- A lista é protegida por `DESATIVADOS_TOKEN`. Sem a variável a rota fica
  aberta (ambiente local); com ela, header errado devolve 404, não 403.

**Tirar um site do ar é marcar `publicado: false` no CRM.** Em até ~90 segundos
o site, o agendamento e o minisite param de responder. Sem deploy.

---

## 4. Agendamento: como o horário livre é calculado

`freeSlots` (`src/lib/datetime.ts`) é uma função pura, e é o coração do produto:

- A grade anda de **15 em 15 minutos**.
- O serviço precisa **caber inteiro** no expediente: `início + duração ≤ fim`.
  Por isso um serviço longo some sozinho perto do fim do dia.
- Horário no passado nunca aparece — a grade encolhe durante o dia.
- Ocupado é sobreposição de intervalos; **cancelado não ocupa**, e ao remarcar o
  próprio agendamento não conta como ocupado.
- Sem janela para aquele dia da semana, o profissional não atende: zero vagas.

Em volta dela, `slotContext` lê **dentro de uma transação** o profissional, os
serviços e os agendamentos do dia. Escolher vários serviços **soma** duração e
preço, e o nome vira `"Corte + Barba"`.

**Duração e preço nunca vêm do formulário público** — são lidos dos documentos
dentro da transação. Remarcar recalcula pelos serviços atuais.

Com "qualquer profissional", `agendaDias` faz a **união** da equipe que faz
todos os serviços escolhidos; cada horário sai com o profissional que atende.

Concorrência: até 10 tentativas por transação; disputa vira a mensagem
"Muita gente agendando ao mesmo tempo. Tente de novo em instantes." Há teste
com 10 reservas simultâneas no mesmo horário exigindo exatamente um sucesso.

Fuso fixo: `America/Sao_Paulo`.

---

## 5. Autenticação e autorização

### O token

`verifyFirebaseToken` (`src/lib/verify-token.ts`) verifica o ID token contra o
JWKS oficial do Firebase, com `issuer`, `audience` e `alg: RS256` travados. Não
usamos `firebase-admin/auth` porque o módulo não carrega nas funções da Vercel.

O **e-mail só é aceito quando o Firebase o verificou** — ele vira autor nas
trilhas de auditoria, e qualquer pessoa cria conta com o e-mail de outra.

### Revogação

Como não passamos pelo Firebase Auth, um token roubado valeria até expirar
(~1h). A marca de "sessões encerradas" mora em `config/admin.revogados[uid]`, o
mesmo documento que os dois guardas **já leem** em toda chamada: custo zero de
leitura. Token com `auth_time` anterior à marca é recusado.

### Os guardas

| Guarda | Uso | Regra |
|---|---|---|
| `requireAdmin` / `adminAction` | tudo em `/admin` | uid ∈ `config/admin.uids` |
| `requireMember` / `memberAction` | ações do painel | é membro daquele negócio, ou admin da plataforma |
| `exigeDono` | renomear e excluir cliente | papel `owner`/`admin` do negócio |

Papéis dentro do negócio: `owner` (quem criou), `admin` (entrou por convite — e
o convite só abre para o e-mail do dono, confirmado), `member` (equipe). O admin
da plataforma entra em qualquer negócio, para dar suporte.

---

## 6. Modelo de dados

```
tenants/{slug}                  name, ownerId, limiteStaff, site.*
  members/{uid}                 uid, role, viaConvite, email, nome, createdAt
  services/{id}                 name, durationMin, priceCents, active, ordem, usos
  staff/{id}                    name, serviceIds[], hours{0..6}, active
  appointments/{id}             start, end, status, serviceIds[], serviceName,
                                durationMin, priceCents, staffId, staffName,
                                customerKey, customerName, customerPhone,
                                planId?, lastHistoryId
  history/{id}                  appointmentId, type, at, by, byName, from?, to?, reason?
  customers/{telefone}          name, phone, updatedAt, etiquetas[], semCampanha
    notas/{id}                  texto, quando, por, porNome
  plans/{id}                    weekday, time, firstDate, lastDate, count, skipped[], status
  limits/{chave}                count, day          (anti-abuso; nenhuma regra expõe)
crm/{slug}                      estagio, entradaCents, mensalCents, proximaAcao,
                                proximaData, publicado, dono*, origem, fixadoAte,
                                entrouEm, fechadoEm, perdidoEm, ultimoContatoEm
  eventos/{id}                  tipo, titulo, detalhe, autor, quando
  notas/{id}                    texto, autor, quando
cobrancas/{id}                  slug, tipo, competencia, valorCents, vencimento,
                                status, token, txid, pagoEm, recebidoCents, baixaPor
limites/{uid}                   negocios
convitesUsados/{jti}            uid, at
config/admin                    uids[], revogados{uid: ms}
config/convite                  secret
config/pix                      chave, nome, cidade, whatsapp
config/crm                      assinatura
config/sessao                   minutos
```

Três decisões que explicam o desenho:

1. **CRM, cobranças, limites e config ficam fora de `tenants/`.** Dentro, o
   membro de menor papel enxergaria. Fora, nenhuma regra os alcança: só o
   Admin SDK entra.
2. **O agendamento guarda cópia** do nome do cliente, do serviço e do preço. O
   histórico precisa dizer o que foi combinado **na época**, não o que o cadastro
   diz hoje.
3. **`customerKey` é o telefone** com DDI: o cliente do negócio é identificado
   pelo número, que é o que ele digita para marcar.

---

## 7. Regras do Firestore e do Storage

A regra é **lista fechada**: coleção nova sob `tenants/{t}` nasce negada.

| Caminho | O que a regra permite |
|---|---|
| `tenants/{t}` | membro lê; dono/admin edita, **menos** `ownerId` e `limiteStaff`; criar e apagar, nunca |
| `members/{uid}` | dono/admin cria e remove, menos o `owner`; **`viaConvite` é só do servidor** |
| `appointments` | membro lê; só muda `status` + `lastHistoryId`, e só junto de um registro novo de histórico no mesmo batch |
| `history` | membro cria com autor e horário cravados pela regra; sem update e sem delete |
| `customers` | membro lê; edita **só** `etiquetas` (≤8) e `semCampanha` |
| `customers/*/notas` | membro cria (autor e horário cravados) e apaga; sem edição |
| `services`, `sites` | membro lê e escreve |
| `staff` | membro lê, edita e exclui; **criar, só pelo servidor** (é lá que o limite do plano é contado) |
| `plans`, `limits` | leitura de plano para membro; `limits` é invisível ao app |
| `config/sessao` | qualquer pessoa logada lê (são os minutos do logout); ninguém escreve |

No Storage: só membro do negócio, só `image/*`, até 10 MB.

Tudo isso tem teste em `rules.test.mjs` — inclusive os casos negativos, como
"coleção que ninguém liberou nasce negada".

---

## 8. Dinheiro: Pix, cobrança e baixa

O BR Code é montado **no projeto** (`src/lib/pix.ts`), sem intermediário e sem
taxa por transação. É Pix **estático**: não há confirmação automática.

- `txid` = slug em maiúsculas + `E`/`M` + `AAMM`, cortado em 25.
- Vencimento: dia **10** da competência.
- CRC16/CCITT-FALSE sobre o payload com `"6304"` incluso, validado por golden
  test campo a campo.

A cobrança tem id previsível (`{slug}-entrada`, `{slug}-2026-10`) e é criada com
`create()`: dois cliques não viram duas cobranças. Cancelar libera a competência
com sufixo `-2`, `-3`…

O link público (`/pagar/{id}?t=…`) não pede login: **o token é a credencial**,
comparado com `timingSafeEqual`, e token errado dá o mesmo 404 de cobrança
inexistente. A resposta pública é recortada: sem slug, sem token, sem quem deu
baixa.

A baixa é manual, só admin da plataforma, e valida valor inteiro positivo, data
e situação (cobrança cancelada não recebe baixa).

### Proposta

`src/lib/proposta.server.ts` guarda um token por negócio em `crm/{slug}` e a
página `/proposta/{slug}?t=…` é pública, sem login — o token é a credencial,
comparado com `timingSafeEqual`, e token errado responde igual a negócio
inexistente. Os valores vêm do CRM, então a proposta é sempre a que foi
combinada. Vale 7 dias; gerar de novo reaproveita o link, "refazer" invalida o
anterior.

O PDF é essa mesma página impressa: `?pdf=1` abre a caixa de impressão, o CSS de
`print` esconde os botões e o rodapé ganha o WhatsApp da Ruphus, já que o arquivo
circula sem a barra de ação. Não há segunda arte para sair de sincronia.

---

## 9. CRM: funil, saúde e alertas

**Etapas:** `novo` → `oferta` → `negociando`, com dois desfechos: `fechado` e
`perdido`. Perder **exige motivo**. Sair de "novo" grava `entrouEm`; entrar em
"fechado" grava `fechadoEm`; voltar ao funil apaga o motivo e `perdidoEm`.

**Saúde** (`src/lib/saude.ts`), a primeira regra que bater vence:

1. cobrança atrasada → **Em risco**
2. 21+ dias sem agendar, sendo cliente há 21+ dias → **Em risco**
3. implantação incompleta (menos de 4 passos) → **Atenção**
4. cobrança vencendo em até 5 dias → **Atenção**
5. senão → **Saudável**

Cliente novo não é acusado de inatividade, e sem data de fechamento não se conta
inatividade nenhuma.

**Implantação, os 4 passos:** convite aceito · serviços cadastrados ·
profissionais cadastrados · primeiro agendamento.

**Alertas** (`src/lib/alertas.ts`) são conta feita sobre o que a lista já
carregou — nenhuma leitura nova: sem próximo passo · parado há 7+ dias · fechou
e não entrou (7+ dias) · destaque vence hoje.

---

## 10. Limites, cotas e anti-abuso

| Limite | Valor | Onde é garantido |
|---|---|---|
| Negócios por conta | 1 (ajustável até 50) | transação no servidor; regra proíbe criar negócio pelo cliente |
| Profissionais por negócio | 5 (ajustável até 50) | transação no servidor; regra proíbe `create` em `staff` |
| Horários ativos por telefone | 3 | consulta no servidor, antes de reservar |
| Reservas por telefone/dia | 5 | contador em `limits/` |
| Reservas por dispositivo/dia | 20 | contador em `limits/`, chave = **hash** do IP |
| Logout por inatividade | 0 (desligado) a 720 min | `config/sessao`, aplicado no cliente |
| Validade do convite | 7 dias, uso único, uma conta só | JWT (claim `e`) + `convitesUsados/{jti}` |

O IP **nunca é gravado**: só `sha256("siteflow:" + ip)` truncado em 16 chars. O
IP vem de `x-real-ip` ou do **último** `x-forwarded-for` — o primeiro é escolhido
por quem chama.

Só conta na cota de negócios quem é `owner` ou `admin` **com `viaConvite`**.
Sem essa marca, o dono de um negócio poderia gastar a cota de outra conta.

---

## 11. Erros: o que chega ao usuário

Uma classe base, `ErroPrevisto`, e três filhas: `UserError` (painel),
`SemAcesso` (admin), `CobrancaErro`, `CrmErro`.

A regra, em todos os wrappers:

```
erro instanceof ErroPrevisto  →  a mensagem vai para a tela
qualquer outra coisa          →  console.error no servidor + frase genérica
```

Ou seja: **mensagem específica é uma decisão**, nunca um vazamento. Nada de
stack, código interno ou detalhe de banco no navegador.

---

## 12. Testes

Sem framework: cada suíte é um arquivo que roda com `tsx` ou `node` e termina
imprimindo `ok`. O que toca o banco sobe o emulador sozinho.

| Comando | Precisa de emulador | Cobre |
|---|---|---|
| `npm run test:proxy` | não | host, rota, travessia de caminho |
| `npm run test:crm` | não | funil, saúde, alertas, dinheiro, revogação |
| `npm run test:clientes` | não | janelas de inatividade |
| `npm run test:pix` | não | CRC16 e golden do BR Code |
| `npm run test:whatsapp` | não | DDI por tamanho do número |
| `npm run test:rules` | sim | regras do Firestore e do Storage |
| `npm run test:booking` | sim | reservas, concorrência, planos, limites, CRM |
| `npm run test:convite` | sim | validade, uso único e a quem o link abre |
| `npm run test:admin` | não | o `select` da lista não pode ficar atrás dos campos lidos |
| `npm run test:cobranca` | sim | Pix, token, baixa |
| `npm run test:scale` | sim | carga e concorrência com equipe grande |
| `npm run test:gerador` | não | leitura da planilha, nicho, slug, HTML escapado e camada Ruphus |
| `npm run test:gerador-banco` | sim | endereço ocupado, reenvio sem apagar agenda e funil, a rota do site |

O CI roda o conjunto a cada push. **Confira a execução do commit final antes de
mesclar** — não a de um commit anterior.

---

## 13. Build, deploy e ambientes

```bash
npm ci            # sempre depois de mexer no package-lock
npm run dev       # http://localhost:3000
npm run build
```

- `next.config.ts` injeta `NEXT_PUBLIC_VERSAO` (do `package.json`) e
  `NEXT_PUBLIC_COMMIT` (da Vercel). **Mudou o config, reinicie o dev.**
- Deploy: merge na `main` → Vercel (região `gru1`).
- As regras saem à parte e **depois** do código:
  `npx firebase deploy --only firestore:rules,storage`.
- O CI (`.github/workflows/testes.yml`) roda os testes; ele **não** faz deploy.

Variáveis: veja a tabela no README. A credencial do Admin SDK é
`FIREBASE_SERVICE_ACCOUNT` (Vercel) ou `GOOGLE_APPLICATION_CREDENTIALS` (local).

> **Cuidado:** `vercel link` e `vercel env pull` reescrevem o `.env.local` e
> levam junto o que a CLI não conhece — inclusive a credencial local. Sem ela, o
> Admin SDK não lê `config/admin` e o admin da plataforma cai no `/painel`.

---

## 14. Tetos conhecidos

Estão marcados no código com o comentário `ponytail:` — são simplificações
deliberadas, com o limite escrito:

- `renameCustomer` usa um batch só: acima de ~499 horários futuros, estoura.
- `agendaDias` faz uma transação por dia × profissional: com equipe grande, fica
  caro.
- Pix estático não concilia pagamento; o `txid` pode não chegar ao extrato.
- O fuso é medido no instante: na virada do horário de verão pode errar 1h.
- Os contadores de anti-abuso ficam guardados; sem TTL.
- Arrastar no funil é só de mouse; no celular a etapa muda pela gaveta.

---

© 2026 Ruphus. Todos os direitos reservados.
