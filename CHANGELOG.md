# Mudanças

O que entrou em cada versão, do ponto de vista de quem usa. Cada linha aponta
o PR, onde está o porquê.

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
