# Plano de implementação — ambiente público de demonstração

> Status: planejado, ainda não implementado.
>
> Objetivo: oferecer uma demonstração pública e interativa da Ruphus em um domínio separado, sem dados reais, sem efeitos externos e sem interferência entre visitantes.

## 1. Contexto e decisão

A Ruphus já possui uma demonstração compartilhada (`barbearia-force`), com dados fictícios, painel do dono, números de teste e restauração diária. As propostas da coleta, porém, misturam dados reais do Maps com serviços, equipe e horários ilustrativos e hoje aceitam reservas reais antes de o dono assumir o negócio.

O novo ambiente terá duas partes:

1. **Navegação pública compartilhada:** site, bio e apresentação da agenda usando a `barbearia-force` atual.
2. **Painel interativo isolado:** ao clicar em “Testar o painel”, o visitante recebe uma sessão temporária e uma cópia própria da demonstração, sem e-mail ou senha.

Usaremos o **mesmo app Next.js e o mesmo Firestore**, com isolamento lógico por tenant. Não haverá fork, segunda aplicação ou segundo banco.

## 2. Resultado esperado

O visitante poderá:

- navegar pelo site e pela bio de um negócio fictício;
- fazer um agendamento fictício;
- confirmar, remarcar ou cancelar atendimentos;
- gerenciar serviços, profissionais e clientes;
- registrar recebimentos e ver comissões;
- consultar caixa, recibos e consumo;
- visualizar simulações de WhatsApp, SMS, e-mail e Pix;
- testar tudo sem afetar a operação real.

As propostas de prospecção deixarão de precisar de dados operacionais fictícios. Elas apontarão para a demonstração centralizada.

## 3. Experiência e percurso comercial

A página inicial terá três chamadas:

- **Ver como cliente:** site, bio e apresentação da agenda, sem login.
- **Testar como dono:** criação de uma sessão temporária com painel completo.
- **Fazer percurso guiado:** roteiro curto pelas principais funcionalidades.

Percurso guiado recomendado:

1. Agendar um horário como cliente.
2. Confirmar o atendimento no painel.
3. Registrar o recebimento no caixa.
4. Ver a comissão calculada.
5. Consultar o histórico do cliente.
6. Simular um lembrete de WhatsApp.
7. Visualizar o recibo.
8. Abrir o CTA para falar com a Ruphus ou criar o negócio real.

Todas as telas interativas terão uma faixa permanente:

> **Ambiente de demonstração** — dados fictícios, alterações temporárias e nenhuma mensagem ou cobrança real.

A primeira versão terá somente a Barbearia Force. Outros nichos só serão adicionados depois de validar o uso.

## 4. Domínio e rotas

O host de demonstração será tratado antes da resolução de tenants em `src/proxy.ts`, evitando que seja interpretado como `{slug}.ruphus.site` ou como domínio próprio de um cliente.

Se for escolhido `demo.ruphus.site`, o slug `demo` também será reservado em `src/lib/tenant-input.ts`.

A mesma aplicação responderá por:

- página inicial da demonstração;
- páginas públicas compartilhadas;
- início, reinício e encerramento de sessão;
- painel do tenant temporário;
- rotina autenticada de limpeza.

A página inicial poderá ser indexável se usada para marketing. Páginas temporárias terão `noindex, nofollow`.

DNS e Caddy serão configurados somente depois que o fluxo funcionar em ambiente de teste. Não haverá um deploy de aplicação separado.

## 5. Modelo de dados e isolamento

Cada tenant temporário terá uma marcação central, sem depender apenas do slug `DEMO`:

```text
demonstracao: true
sessaoDemoId: string
criadoEm: Timestamp
expiraEm: Timestamp
```

Uma função central responderá se um negócio é demonstração e quais limites se aplicam. As proteções atuais que comparam `slug === DEMO` serão revistas, incluindo:

- `src/lib/canal-oficial.server.ts`;
- `src/lib/whatsapp.server.ts`;
- `src/lib/tenants.ts`;
- `src/app/[tenant]/actions.ts`;
- `src/app/api/webhooks/atendys/route.ts`.

Tenants temporários não poderão entrar em:

- CRM ou funil comercial;
- métricas de clientes reais;
- vitrine da landing;
- catálogo de propostas;
- cobranças;
- lembretes automáticos;
- coleta de leads;
- monitoramento de conexões;
- relatórios de faturamento;
- contagens de negócios por cidade.

O modelo atual de autorização por membro será preservado. Cada visitante terá acesso somente ao próprio tenant temporário.

## 6. Sessões temporárias e autenticação

### Criação

A cópia será criada somente quando o visitante pedir o painel. A navegação pública continuará usando a demonstração compartilhada, evitando uma cópia por visita.

O acesso será automático e limitado ao tenant temporário, sem publicar a senha da demonstração atual, que muda a cada restauração (`src/lib/demo.server.ts`).

O modelo de token Firebase existente será reutilizado, com emissão controlada pelo servidor e sem uma conta permanente do visitante.

### Duração e controles

A sessão inicial terá duas horas. O visitante verá o tempo restante e poderá:

- **Reiniciar dados:** volta à cópia inicial;
- **Encerrar e apagar meus dados:** exclui a sessão imediatamente;
- **Iniciar nova demonstração:** cria outra sessão depois da expiração ou encerramento.

### Construção dos dados

Será extraído de `restaurarDemo` um construtor reutilizável de dados fictícios, evitando duplicar serviços, equipe, clientes e agenda.

`donoDaDemo` e `config/demo` continuarão exclusivos da demonstração compartilhada usada pelo admin e não serão reutilizados para visitantes.

### Expiração e exclusão

Uma rotina autenticada excluirá:

- tenant e subcoleções;
- agendamentos, clientes, planos e histórico;
- lançamentos, comissões e recibos;
- eventos simulados;
- uploads no Storage;
- vínculo temporário de acesso.

## 7. Conteúdo fictício

A demonstração reutilizará e ampliará a Barbearia Force:

- seis serviços e três profissionais com disponibilidades distintas;
- clientes recorrentes, ausentes, com plano, falta, etiquetas e opt-out;
- agendamentos passados e futuros calculados a partir do dia atual;
- plano recorrente ativo;
- recebimentos, sinal, contas fixas e vales;
- comissões com percentuais diferentes;
- estorno e recibo;
- e-mails somente em `example.com`;
- telefones exclusivamente fictícios.

A restauração diária da demonstração compartilhada atual continuará. A cópia por visitante impedirá interferência durante o teste.

## 8. Simulações e efeitos externos

| Integração | Comportamento na demonstração |
|---|---|
| WhatsApp | Prévia da conversa e evento fictício; nenhuma chamada ao atendys ou à Meta |
| SMS | Prévia da mensagem; nenhuma chamada ao provedor |
| E-mail | Visualização local; nenhum envio |
| Pix | Fluxo ilustrativo sem cobrança nem QR pagável, com marca d’água “SIMULAÇÃO” |
| Notificações | Somente dentro da interface inicialmente |
| Uploads | Tipos, quantidade e tamanho limitados; exclusão na limpeza |

Nenhuma credencial de produção será usada por ações de demonstração.

Todo ponto de efeito externo falhará fechado: sem um adaptador explícito de simulação, a integração real não será executada.

## 9. Antiabuso, privacidade e retenção

- Uma sessão ativa por visitante e cota por IP para novas sessões.
- Proteção anti-automação no botão de criação do painel.
- Limites de clientes, serviços, agendamentos, uploads e operações por sessão.
- Expiração automática e exclusão manual imediata.
- Aviso para não inserir dados pessoais reais.
- Analytics agregado, sem telefone ou e-mail do visitante.

Eventos medidos:

- início da demonstração;
- agendamento fictício;
- entrada no painel;
- confirmação de atendimento;
- registro no caixa;
- abertura de comissões;
- simulação de mensagem;
- conclusão do percurso guiado;
- clique no CTA comercial.

Esses dados mostrarão se a demonstração gera contratações ou apenas curiosidade.

## 10. Integração com propostas

Depois que a sandbox estiver validada:

- propostas não assumidas deixarão de aceitar reservas reais;
- o CTA “Testar todas as funcionalidades” levará ao domínio de demonstração;
- exemplos serão identificados como ilustrativos;
- a agenda real só será habilitada depois que o dono revisar serviços, preços, equipe e horários.

As correções estruturais da coleta e da geração parcial ficam fora deste plano. Não haverá reescrita da coleta nesta implementação.

## 11. Sequência de implementação em PRs

### PR 1 — Fundação e domínio

- Marcação central de demonstração e guardas.
- Tratamento do host em `src/proxy.ts`.
- Reserva do slug, se necessário.
- Página inicial e navegação pública usando a demonstração atual.
- Faixa de identificação e `noindex` nas páginas temporárias.

### PR 2 — Sessões isoladas

- Construtor reutilizável dos dados fictícios.
- Cópia por visitante.
- Login automático e autorização por tenant.
- Expiração, reinício, encerramento e limpeza.
- Exclusão de demos de CRM, métricas e rotinas operacionais.

### PR 3 — Experiência e simulações

- Percurso guiado.
- Simulação de WhatsApp, SMS, e-mail e Pix.
- Limites contra abuso e analytics.
- Acabamento mobile e acessibilidade.

### PR 4 — Integração e publicação

- CTA nas propostas.
- Bloqueio de reservas em propostas não assumidas.
- DNS e Caddy.
- Publicação na VPS e smoke test.

### PR 5 — Operação e aprendizado

- Monitoramento de sessões criadas, expiradas e excluídas.
- Erros, custo e conversão.
- Ajustes no percurso com base no uso real.

## 12. Verificação

### Testes automatizados

- Unitários: expiração, cotas, identificação de demo e seleção de host.
- Emulador: isolamento entre duas sessões e entre demo e tenant real.
- E2E: duas pessoas alteram dados simultaneamente sem interferência.
- E2E: agendamento → confirmação → caixa → comissão → recibo.
- Limpeza completa, incluindo Storage e vínculo de acesso.
- Reinício e encerramento manual da sessão.

Comandos padrão e suítes relacionadas:

```bash
npm run lint
npm run typecheck
npm run test:proxy
npm run test:rules
npm run test:booking
npm run test:gerador-banco
npm run test:demo
```

O CI deverá incluir a nova suíte `test:demo`.

### Garantias de segurança e operação

- Nenhum WhatsApp, SMS, e-mail, Pix ou push real é produzido.
- Nenhuma demonstração aparece em CRM, vitrine, catálogo, métricas, coleta ou cobrança.
- Um visitante não lê nem altera a sessão de outro.
- Uma sessão não acessa nenhum tenant real.
- Toda sessão expira e é apagada no prazo.
- O ambiente funciona no celular, por teclado e com leitor de tela.
- As páginas temporárias possuem `noindex, nofollow`.

### Smoke test em produção

Antes de divulgar o link nas propostas:

1. Abrir o domínio real.
2. Criar duas sessões diferentes e validar o isolamento.
3. Executar o percurso completo.
4. Confirmar que nenhum provedor externo foi chamado.
5. Conferir a limpeza e as métricas agregadas.
6. Validar o CTA comercial e a experiência mobile.

## 13. Premissas

- O domínio exato será escolhido na implantação.
- A primeira versão terá apenas a Barbearia Force.
- O painel interativo será isolado por visitante desde o início.
- A navegação pública continuará compartilhada.
- O mesmo Firebase poderá ser usado com isolamento lógico e regras fechadas. Um projeto separado só será necessário se a auditoria mostrar que esse isolamento não é suficiente.
- Não haverá fork, segundo banco, envios reais, cobranças reais nem dados pessoais verdadeiros na demonstração.
