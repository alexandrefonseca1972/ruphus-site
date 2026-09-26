# Mudanças

O que entrou em cada versão, do ponto de vista de quem usa. Cada linha aponta
o PR, onde está o porquê.

## Em avaliação

### Fora quem não tem telefone
- **33 sites da fábrica sem WhatsApp nem telefone saem do ar** (#79), da vitrine
  e da landing (836 → 803 sites), e os 34 negócios sem telefone (com a conta de
  teste `salao-de-boas-caras`) saem do banco. Sem contato não há proposta nem
  agendamento.
### Gerador lê o levantamento do jeito que ele vem
- **Nomes de coluna do levantamento** (#78): "Nota geral", "Nº de avaliações" e
  "Score de oportunidade" passam a valer. Os 106 sites do Piauí tinham saído sem
  a nota do Google por isso.
- **"Não verificado" não vira dado** (#78): "não verificado", "não visível",
  "N/A", "-" contam como vazio; telefone mascarado ("(86) 3XXX-XXXX") segue
  recusado.
- **UF sem coluna UF** (#78): a do DDD mais comum da planilha. Os 106 sites do
  Piauí, que estavam sem UF, ganharam "PI".

### Depois de agendar: agenda do celular e como chegar
- **Como chegar** (#75): mapa, endereço (ou bairro e cidade, quando a casa não
  cadastrou a rua) e botões de Google Maps, Waze e copiar o endereço.
- **Salvar na agenda** (#75, #76): arquivo de agenda com lembrete 2 horas antes,
  ou o Google Agenda — discreto no rodapé (#76): a ação da tela é falar com o
  negócio, pelo nome dele ("Falar com Barbearia Force no WhatsApp").
- **Mais claro** (#75): o nome da casa no topo, "amanhã"/"daqui a 3 dias", o valor
  com "pago no local", "A casa vai te chamar no **seu** WhatsApp" (o número
  mostrado é o do cliente, e parecia ser o da casa) e desmarcar com botão e
  mensagem pronta.

### Formulários que conferem enquanto a pessoa digita
- **Criar conta** (#74): nome só com letras, e-mail sem espaço e em minúsculas,
  erro embaixo do campo ao sair dele (em português, no lugar do aviso do
  navegador) e o cursor vai para o primeiro campo errado. A senha nova pede 8
  caracteres com letra e número, e a lista embaixo marca cada requisito ao
  digitar; quem já tem conta segue entrando com a senha que criou.
- **Dados do negócio** (#74): WhatsApp com máscara `(96) 99999-0000`, UF só com
  duas letras, cidade e bairro sem símbolos, Instagram só com o que um perfil
  aceita. Vale no cadastro, no "Meu negócio" e na aba Site do admin.

### Anúncios medidos, do clique ao negócio criado
- **Campanha no funil** (#72): links com `utm_*` (por exemplo
  `www.ruphus.site/?utm_source=instagram&utm_campaign=setembro`) ficam guardados
  no navegador por 30 dias e vão para o funil quando o negócio é criado. O funil
  ganha o quadro "Anúncios" (cadastros e fechados por campanha), e a gaveta diz
  de qual anúncio o negócio veio.
- **Pixel da Meta nos Ajustes do `/admin`** (#72): com o ID salvo, a landing
  registra visita e clique no WhatsApp, e o cadastro registra o negócio criado
  ("CompleteRegistration"). Vazio desliga. A privacidade explica o Pixel.

### Landing
- **WhatsApp flutuante** (#72) no lugar do botão do topo; sobe quando a barra de
  baixo aparece.
- **Demonstrações na conta de exemplo** (#72): "Ver um site", a agenda e a bio
  abrem a `barbearia-force`, não o site de um negócio real.

### Encontrável no Google
- **Um endereço só** (#71): `ruphus.site` leva a `www.ruphus.site` e `/sobre` à
  raiz; antes a landing respondia nos três, e o Google dividia a página.
- **`robots.txt` e sitemap de verdade** (#71): antes as duas URLs devolviam a
  tela do app ("Carregando…").
- **Título e descrição falam de agendamento online** (#71), e os dados
  estruturados apontam para o endereço certo, com logo que existe e Macapá e
  Santana entre as cidades.
- **O app fica fora da busca** (#71): login, painel, admin e a agenda de cada
  negócio levam `noindex`. A landing e a privacidade continuam indexáveis.

### O site só é oficial depois da entrada paga
- **Cadastro nasce como prévia** (#70): faixa "prévia feita com a Ruphus, ainda
  não publicada" (sem "Pedir remoção", foi o dono que criou) e fora do Google. O
  "Meu negócio" avisa e tem o botão "Publicar meu site", que abre o WhatsApp.
- **Baixa da entrada publica** (#70): ao marcar a entrada como paga na aba
  Cobrança, o site gerado (cadastro ou prospecção) perde a faixa, entra no Google
  e o rodapé deixa de dizer "demonstração". Antes a faixa da prospecção nunca
  saía, nem depois de vendido. Reenviar a planilha não despublica.

## 0.9.0 — 25/09/2026

### O admin completa o site de quem se cadastrou sozinho
- **Aba "Site" na gaveta do negócio** (#67): diz de onde o site vem (sem site,
  cadastro, prospecção ou fábrica) e edita os dados dele mais a nota e as
  avaliações do Google, que o dono não informa. Uma prévia mostra campo a campo
  o que muda antes de publicar. Conta antiga sem site ganha o site por aqui.
- **A planilha não regrava o site do cadastro** (#67): o mesmo telefone de um
  cliente que se cadastrou vira "pular". Antes virava "atualizar", que trazia de
  volta a faixa de proposta e sobrescrevia o que o dono editou.

### Cadastro novo não passa despercebido
- **Entra no funil com o contato para hoje** (#69): quem se cadastra sozinho já
  chega com "Dar boas-vindas: cadastrou sozinho no site" combinado para o dia.
  Aparece em "Para hoje" no `/admin` e, se passar do dia, em "Atrasados".

### Sites de beleza
- **Menu legível sobre a foto do topo** (#68): links e "Contato" ficam brancos
  até a página rolar. Vale para barbearia, salão, estética e unhas.

## 0.8.0 — 25/09/2026

### Quem cria a conta sozinho já sai com site e agenda prontos
- **Site no ar no cadastro** (#61): o `/painel` pede também ramo (os 23 nichos
  do gerador), WhatsApp e cidade, e o negócio nasce com o site em
  `{slug}.ruphus.site` no modelo do ramo. Antes o endereço dava 404.
- **Agenda aberta no primeiro minuto** (#61): serviços do ramo e uma equipe com o
  nome do dono, fazendo todos eles. Saúde entra sem preço, como no gerador.
- **Aba "Meu negócio"** (#61): o dono edita nome, ramo, WhatsApp, endereço,
  cidade, Instagram e horário; o site, a imagem do WhatsApp e a bio mudam na
  hora. Negócio criado antes ganha o site ao escolher o ramo; site feito pela
  fábrica tem os dados de contato atualizados, e a página continua a mesma.
- **O site é do dono** (#61): sem a faixa "Esta página é uma proposta" nem o
  "Pedir remoção", que valem só para os sites de prospecção.
- **Todo cadastro entra no funil** (#61) com a origem "Cadastro no site" e o
  e-mail do dono, pronto para convite e cobrança.
- **A landing mostra o produto** (#61): site, agenda e painel ganham cada um o
  botão da demo ao vivo, o menu leva direto à Agenda e ao Painel, a barra de
  baixo troca a demo conforme a seção, e "Criar minha conta" aparece no painel,
  no preço e no fechamento.
- **"Criar minha conta" cai no cadastro** (#62): o login abre em "Criar conta",
  não em "Entrar".
- **Funcionalidades na primeira tela** (#63): atalhos para Site, Agenda online,
  Painel e Link da bio no lugar dos selos de números, que repetiam a contagem da
  busca. A prévia no celular não fica mais com o aviso de proposta coberto pelo
  entalhe.
- **A landing conta todos os sites** (#66): os do gerador (161, de Macapá e
  Santana) entram na busca, na lista e nos números, via `/api/catalogo`; antes
  a página só conhecia os estáticos. Dois estáticos que tinham ficado fora do
  catálogo voltam. 673 → 836 sites, 14 → 16 cidades.

## 0.7.0 — 25/09/2026

### Quatro modelos-base novos no gerador de sites
- **Saúde, Aulas e cursos, Fitness e Automotivo** (#60), cada um cobrindo vários
  nichos com fotos, paletas, textos, serviços e perguntas próprios:
  odontologia, fisioterapia, psicologia, nutrição e clínica; idiomas, reforço,
  música e autoescola; academia, pilates, lutas e dança; oficina, estética
  automotiva e pneus. São 16 nichos novos, somando 23.
- Os modelos reaproveitam as duas páginas que já estão no ar (#60): Saúde e
  Aulas na clara, a dos sites de pet; Fitness e Automotivo na editorial, a de
  barbearia e tatuagem. O HTML de pet e de beleza saiu idêntico ao de antes da
  mudança, conferido por hash.
- Saúde segue as regras dos conselhos (#60): sem preço anunciado (a agenda nasce
  com valor zero), sem antes e depois, sem promessa de resultado.
- Fotos de banco Pexels, conferidas uma a uma (#60): nada de logomarca legível,
  e autoescola só com alunos adultos.
- Aula experimental e avaliação física entram na agenda sem preço (#60).

### Correções
- **Galeria com foto repetida** (#60): com 4 fotos no nicho, a terceira repetia a
  primeira. Toda galeria agora tem 5 ou 6, e um teste confere as 3 distintas.
- "Lava-jato" com hífen e "competição" (que caía em pet shop) (#60).

## 0.6.1 — 25/09/2026

### Tatuagem e imagem de compartilhamento no gerador de sites
- **Estúdio de tatuagem agora vira site** (#59): no modelo editorial, o mesmo
  dos 10 estúdios da fábrica, com fotos de estúdio, as paletas deles (lilás,
  vermelho, cobre, petróleo) e os serviços que anunciam — tatuagem autoral, fine
  line, blackwork, cobertura e orçamento. Antes a linha caía em "nicho não
  reconhecido".
- **Imagem de compartilhamento no padrão da fábrica** (#59): o link de um site
  gerado enviado no WhatsApp mostrava a foto crua (e cortada, na de beleza, que
  é em pé). Agora é a mesma composição dos og.jpg da fábrica — foto escurecida,
  traço na cor do site, nome na fonte de título dele, ramo e cidade — montada na
  hora em `/og.jpg` e entregue em JPEG de ~40 KB, abaixo do que o WhatsApp aceita.
- Orçamento entra na agenda com 30 minutos e sem preço (#59): é a conversa com o
  artista, e anunciar R$ 80 por ela afastava o cliente.

## 0.6.0 — 24/09/2026

### Gerador de sites
- **Planilha de leads vira site no ar** (#58): na aba Gerador do `/admin`, um
  `.xlsx` com nome, telefone e categoria vira, por linha, um site-proposta em
  `{slug}.ruphus.site` no mesmo padrão dos que já estão no ar — com agenda,
  dono e ficha no funil, como o importador fazia. Sem commit e sem deploy: a
  página é montada do Firestore na hora.
- Dois modelos, tirados das famílias que já existem (#58): **pet** (pet shop e
  veterinária, o modelo dos 241 sites de pet) e **beleza** (barbearia, salão,
  estética e unhas, o modelo editorial). Paleta, fontes, textos e fotos variam
  por site, sempre iguais para o mesmo endereço.
- A prévia mostra o endereço de cada linha antes de gravar (#58). Endereço de
  site da fábrica ou de negócio real nunca é sobrescrito; mandar a planilha de
  novo atualiza pelo telefone sem apagar agenda, preço ou estágio no funil.
- **Sem negócio em dobro** (#58): o telefone identifica o negócio. Se ele já tem
  site da fábrica ou conta real, a linha fica de fora ("já tem site: …"); se já
  tem site gerado, atualiza aquele mesmo que o nome tenha mudado na planilha. O
  mesmo telefone em duas abas entra uma vez só, e nome + cidade iguais aos de
  outro negócio aparecem como "possível duplicado" na prévia.
- Planilha de levantamento com várias abas (#58): lê todas as levas, reconhece
  "Categoria(s)", "Nº avaliações" e o @ do Instagram no texto da rede social,
  aceita massoterapia, podologia, bronzeamento, dermatologia, maquiagem e
  tranças, avisa telefone fixo e leva score e gancho de abordagem para o funil
  como nota do negócio.
- `npm run gerar:sites -- planilha.xlsx` faz o mesmo pela linha de comando,
  simulando por padrão (#58). Foi assim que saíram os 151 sites de beleza e
  estética de Macapá e Santana.
- Os sites gerados não herdam três defeitos dos da fábrica (#58): telefone da
  Ruphus no JSON-LD, caminho `sobreassets` na imagem e botão de Instagram que
  abria o WhatsApp.

### Correções
- **A foto da `/bio` dos 241 sites de pet dava 404** (#58): o caminho do banco
  de imagens compartilhado ganhava o slug na frente.
- `assets` entrou nos endereços reservados (#58).

## 0.5.4 — 24/09/2026

### E-mails de acesso com link no próprio domínio
- **Os links dos e-mails de senha e de confirmação passam a abrir em
  `ruphus.site/conta`** (#57): antes iam para `siteflow-57b6b.firebaseapp.com`,
  e um link de outro domínio num e-mail de `noreply@ruphus.site` foi um dos
  motivos de o Outlook mandar a redefinição de senha para o lixo eletrônico.
- A página pede um clique para confirmar e-mail em vez de aplicar ao abrir
  (#57): o Outlook abre os links antes da pessoa, e o código vale uma vez só.
- `conta` entrou na lista de endereços reservados (#57).

## 0.5.3 — 24/09/2026

### README e manual técnico alinhados
- **O README descrevia o convite como bearer** (#56): "quem tiver o link vira
  admin daquele negócio" era verdade até a 0.4.1 e deixou de ser. Documentação
  errada sobre quem entra no painel é pior que documentação nenhuma.
- Proposta com link e PDF, convite de uma conta só, `test:admin` e os módulos
  `firebase-db.ts` / `sessao-config.ts` entraram nas listas onde faltavam (#56).
- `npm run convite` agora está documentado como exigindo `donoEmail` (#56).
- **A versão saiu do topo do README** (#56): era um número escrito à mão que
  envelhecia a cada release — estava em `v0.3.0` com a 0.5.2 no ar. No lugar,
  um link para o CHANGELOG, que é onde a informação já mora.

## 0.5.2 — 24/09/2026

### Manual do vendedor alinhado ao produto
- **O manual dizia que a proposta ia "sem anexo"** (#55): o PDF entrou na 0.4.0 e
  o texto ficou para trás. Agora explica o "Baixar PDF" e por que o arquivo
  funciona sozinho se for repassado.
- **E descrevia o convite no modelo antigo** (#55): passou a dizer que o link só
  abre com o e-mail do dono confirmado, e que é por isso que o botão depende do
  e-mail na aba Venda. Fechar venda também avisa quando o convite não sai.

### Lint volta a ter dono
- **O CI passou a rodar `npm run lint`** (#55): ele só reclamava na máquina de
  quem lembrasse de rodar, e por isso seis erros ficaram parados no manual.
- `no-unused-vars` deixou de acusar `const { a, b, ...resto }`, que é como se
  descarta campo, e o eslint parou de olhar `public/`, que são assets servidos
  como estão e não código compilado (#55).

## 0.5.1 — 24/09/2026

### Painel e login mais leves
- **O SDK do Firestore saiu do /admin e do /login** (#54): eles só precisam de
  login, mas baixavam 1 MB de JS do Firestore porque `db` morava no mesmo
  módulo que `auth` — bastava importar um para arrastar o outro. O /admin caiu
  de 1804 KB para 1268 KB de JS, e o /login de 1671 KB para 1136 KB.
- O /painel continua com o Firestore: ele lista os negócios da conta com uma
  consulta de verdade (#54).

## 0.5.0 — 23/09/2026

### Convite é sempre de uma conta só
- **Não existe mais link de convite aberto** (#53): em 0.4.1 o link só ficava
  preso quando o e-mail do dono estava cadastrado; sem ele, seguia valendo para
  a primeira conta que usasse. Agora o destinatário é parte do convite — sem
  e-mail, não sai link.
- A gaveta troca o botão por "Convidar {e-mail}" quando dá para convidar, e por
  um aviso apontando a aba Venda quando falta o e-mail: o que falta é um dado a
  uma aba de distância, não um erro depois do clique (#53).
- O lote diz quais negócios ficaram sem link e por quê, em vez de vir menor sem
  explicação. Fechar venda com convite avisa se o convite não saiu (#53).
- Token assinado sem destinatário deixa de valer, como já acontecia com os links
  antigos sem uso único (#53).

## 0.4.1 — 23/09/2026

### Convite preso a quem foi convidado
- **O link do convite passa a valer só para o e-mail do dono** (#52): antes o
  uso único garantia que o link abrisse uma vez, mas não *para quem* — repassado
  antes do dono usar, virava acesso de admin do negócio para um estranho. Agora,
  quando o e-mail está cadastrado na aba Venda, ele viaja assinado dentro do
  token e só aquela conta entra, com o endereço confirmado.
- A gaveta diz em que estado cada link saiu — preso a uma conta, ou aberto para
  a primeira que usar —, a mensagem de WhatsApp avisa com qual e-mail entrar, e
  a planilha do lote ganhou a coluna `abre_com_o_email` (#52).
- Negócio sem e-mail do dono continua gerando link aberto: é o que o canal
  permite garantir. Preencher o e-mail antes de convidar fecha caso a caso (#52).

## 0.4.0 — 23/09/2026

A proposta agora também vai como anexo, e o painel abre bem mais rápido.

### Proposta em PDF
- **"Baixar PDF" na gaveta do negócio** (#51): quem prefere anexo a link salva a
  proposta pelo próprio navegador e manda por e-mail ou WhatsApp. É a mesma
  página do link impressa — não existe uma segunda arte para sair do lugar —,
  com os blocos inteiros, sem os botões da tela e com o WhatsApp da Ruphus no
  rodapé, porque o PDF circula sozinho e precisa dizer para onde responder.

### Abertura do /admin
- **Uma viagem ao servidor em vez de quatro** (#51): o painel pedia lista,
  resumo do dia, CRM e assinatura em paralelo, mas o Next despacha uma ação por
  vez — eram quatro esperas em fila, cada uma conferindo o login de novo. Agora
  é uma chamada só, com o paralelo do lado do servidor.
- **A lista pede só os campos que mostra** (#51): eram 271 KB de documentos
  completos a cada abertura, com endereço, foto e cor que a tela não usa; caiu
  para 97 KB. A contagem de acessos deixou de trazer o conteúdo dos membros
  (1188 ms → 659 ms).
- **Um canal a menos abrindo junto** (#51): o tempo de logout automático chega
  com o resto do painel, em vez de abrir uma conexão do Firestore só para ler um
  campo enquanto a tela ainda carrega.

## 0.3.0 — 23/09/2026

O CRM virou ferramenta de trabalho diário, o painel passou a caber no celular e
a revisão de segurança fechou o que estava aberto.

### CRM
- **Carteira, implantação e saúde** (#39): a visão "Clientes" mostra os negócios
  fechados do mais em risco ao mais saudável, com a implantação em quatro passos
  e o motivo de cada diagnóstico. "Venda fechada" gera a cobrança da entrada,
  abre as boas-vindas e já leva o convite.
- **Alertas** (#42): sem próximo passo, parado há 7+ dias, fechou e não entrou,
  destaque vencendo hoje. Cada um filtra a lista com um toque, e a faixa some
  quando não há o que avisar.
- **Falei hoje e destaque** (#42): a mensagem enviada passou a marcar a data no
  próprio negócio, o que trouxe a visão "Falei hoje", a ordenação por último
  contato e a possibilidade de fixar um negócio no topo por 1, 3 ou 7 dias.
- **Abordagem refeita** (#40): cinco modelos em cadência (dia 0, +3, +10), sem
  link e sem preço no primeiro contato, assinados por uma pessoa — a assinatura
  é definida uma vez pelo admin —, e as objeções mais comuns com resposta pronta.
- **Topo reorganizado** (#45): configuração foi para o menu da engrenagem; a
  faixa acima da lista ficou para os alertas e para a pendência que se resolve.

### Painel no celular
- **Campo nenhum dá mais zoom no iPhone**, os botões ganharam alvo de 40–44px e
  nada termina embaixo da barra de gestos (#40).
- A gaveta do CRM empilha em uma coluna, a carteira vira cartão, o funil avisa
  que no toque a etapa muda pela gaveta, e o cabeçalho da agenda deixou de
  estourar a tela (#40).

### Limites e cobrança
- **Cinco profissionais por negócio**, liberáveis pelo admin da plataforma, com
  a contagem feita no servidor (#42, #43).
- Preço com vírgula deixou de apagar a mensalidade: "59,90" vale o que parece (#42).
- "Cobranças em atraso" virou aba, com o número de vencidas no rótulo (#42).

### Segurança
- **Open redirect no login** fechado: `//evil.com` passava pelo teste de "começa
  com barra" e levava a vítima para fora do site (#43).
- A regra pega-tudo do Firestore virou lista fechada, `staff` passou a ser criado
  pelo servidor e `viaConvite` deixou de ser gravável pelo cliente (#43).
- **Encerrar sessões** de uma conta, sem esperar o token expirar (#44); renomear
  cliente passou a exigir dono ou admin; o convite caiu de 30 para 7 dias.
- Baixa de cobrança validada, upload restrito a imagem, e a lista de sites fora
  do ar deixou de ser pública (#43).

### Outros
- Logout automático por inatividade, configurável pelo admin (#42).
- Rodapé do `/admin` com a versão e o commit no ar (#42).
- README do projeto, no lugar do texto do create-next-app (#42).

## 0.2.0 — 21/09/2026

A agenda deixou de ser uma tela de formulário e virou o produto; a cobrança do
produto passou a existir.

### Agendamento
- **Uma tela só**, com os horários já visíveis na chegada: escolher
  profissional deixou de ser passo (a agenda nasce como a união da equipe), a
  faixa de dias mostra quantas vagas cada dia tem e quem já agendou neste
  navegador confirma em um toque (#23).
- **Confirmar avisa a casa no mesmo toque**: o botão é o link do WhatsApp com o
  resumo pronto, e o agendamento guarda se o recado foi levado. A agenda do
  painel marca "não avisou" (#26).
- Serviços ordenados pelo que mais se agenda, e nenhum vem marcado por
  padrão (#25).
- O botão de Google Agenda saiu da confirmação: o que confirma o horário é o
  recado no WhatsApp (#22).

### Cobrança
- **Pix da Ruphus para os negócios** (#27): o BR Code é montado no projeto, sem
  intermediário e sem taxa; a cobrança vira um link que o dono abre no celular
  (`/pagar/<id>?t=…`), e a baixa é manual no admin, com visão de atrasados e o
  corte do site a um clique. Pix estático não confirma pagamento — a fronteira
  para um PSP com webhook é a função `baixar()`.

### Entrada e landing
- A tela de entrada ganhou saída para o site (#21).
- A landing passou a falar com uma voz só: um acento, a condensada nos títulos
  e o celular em pé sobre a esteira dos sites publicados (#29).
- A prévia da landing não abre mais 404 no `next dev` (#28).

### Dados
- `seed:agenda` deixou de cadastrar "Tabela de preços" como serviço (#24), e
  rodou em produção: 675 negócios com catálogo e agenda aberta.
