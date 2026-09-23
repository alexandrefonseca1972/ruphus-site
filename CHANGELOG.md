# Mudanças

O que entrou em cada versão, do ponto de vista de quem usa. Cada linha aponta
o PR, onde está o porquê.

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
