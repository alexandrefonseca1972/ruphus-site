# Roteiro de teste — Ruphus (todas as funcionalidades)

Versão de referência: `main` em `a85ee5e` (05/11/2026). Cada item tem um código (ex.: `AG-03`), o passo e o resultado esperado. Marque `[x]` quando passar; anote o código do que falhar.

## Antes de começar

**Ambiente:** produção (`www.ruphus.site`) — não há homologação. Teste local com `npm run dev` só para o que tem efeito real.

**Contas**
| Conta | Para quê |
|---|---|
| `admin@ruphus.app` | /admin e tudo da plataforma |
| `demo@ruphus.site` (senha no /admin → Demonstração) | painel do dono da demo `barbearia-force` |
| Conta de teste sua (Google ou e-mail) | cadastro de negócio, convite de equipe, papel "member" |
| Celular seu | agendamento público, push, WhatsApp e SMS de teste |

**Legenda de risco**
- ⚠ **efeito real**: manda WhatsApp/SMS/e-mail, cobra, publica ou tira site do ar, roda Coleta. Só na demo ou num negócio de teste seu, com números seus.
- 🔒 **demo bloqueia**: a demo recusa de propósito; o teste é ver a recusa.
- 📱 **testar também no celular** (viewport 390 px ou aparelho).

**Regras de ouro**
1. Nunca mexer em negócio real (CRM, cobrança, site, WhatsApp).
2. Telefones de cliente: só números seus. O agendamento público manda WhatsApp de verdade se o negócio tiver WhatsApp conectado.
3. Depois de testar na demo: /admin → Demonstração → **Restaurar padrão** (troca a senha).
4. Erro de cache do navegador (`failed-precondition`): limpar dados do site e repetir; anotar.

**Ordem sugerida:** 0 (automatizados) → 1 (público) → 2 (conta) → 3 (painel do dono) → 4 (equipe) → 5 (admin) → 6 (automações) → 7 (regressão rápida pós-deploy).

---

## 0. Testes automatizados (antes do QA manual)

- [ ] `AUT-01` `npm run lint && npm run typecheck` → sem erro.
- [ ] `AUT-02` Suítes com emulador: `npm run test:rules`, `test:booking`, `test:scale`, `test:convite`, `test:cobranca`, `test:financeiro`, `test:atendys`, `test:integracoes`, `test:painel-indice`, `test:gerador-banco`, `test:sinal` → cada uma termina com "… ok" e `exited successfully`.
- [ ] `AUT-03` Suítes sem emulador: `test:proxy`, `test:site-arquivo`, `test:avisos`, `test:clientes`, `test:crm`, `test:pix`, `test:whatsapp`, `test:admin`, `test:sms`, `test:consumo`, `test:painel`, `test:gerador`, `test:ia`, `test:foto-rota`, `test:coleta`, `test:lembrete`, `test:proposta-email`, `test:convite-email`, `test:sinal-puro`, `test:conexao`, `test:coleta-tempo`, `test:coleta-selecao` → todas ok.
- [ ] `AUT-04` CI do PR verde (job `testes`).

---

## 1. Público (sem login)

### 1.1 Landing `/`
- [ ] `LP-01` Abrir `ruphus.site` → redireciona (308) para `www.ruphus.site`; `/sobre` → `/`.
- [ ] `LP-02` Seções carregam: hero, O que fazemos, Agenda, Menos falta, Painel, Como funciona, Alguns deles, Preço (R$ 250 + R$ 89,90/mês; domínio R$ 100; Caixa incluído; profissional extra R$ 15), Dúvidas (9 itens abrem/fecham), CTA final, rodapé.
- [ ] `LP-03` Busca "Procure o nome do seu negócio": digitar parte de um nome → até 24 resultados, contador "N sites com “termo”"; sem acento/maiúscula também acha; várias palavras → todas precisam casar.
- [ ] `LP-04` Busca sem resultado → "Nenhum site com esse nome" + estado "Ainda não tem um site com esse nome…" e botão "Pedir o meu no WhatsApp".
- [ ] `LP-05` Busca vazia → volta a vitrine curada.
- [ ] `LP-06` Prévia no celular (iframes) alterna sites; "Abrir o site inteiro ↗" abre o site atual.
- [ ] `LP-07` Barra fixa aparece ao rolar além do hero e some no CTA final; link de demo muda conforme a seção.
- [ ] `LP-08` CTAs de WhatsApp abrem `wa.me/5511948680554` com texto; demos abrem `barbearia-force.ruphus.site`, `/agendar`, `/bio`; rodapé: Acessar painel, Termos (`/termos`), Privacidade.
- [ ] `LP-09` Abrir com `?utm_source=teste&utm_campaign=x` → `localStorage["ruphus:utm"]` gravado (DevTools).
- [ ] `LP-10` 📱 Layout no celular sem rolagem horizontal.
- [ ] `LP-11` `/termos`, `/termos/1.0`, `/privacidade` abrem.

### 1.2 Site do negócio `/s/{slug}` e subdomínio
- [ ] `SITE-01` `https://barbearia-force.ruphus.site/` → site abre; `www.ruphus.site/s/barbearia-force` (como página) → 308 para o subdomínio.
- [ ] `SITE-02` `{slug}.ruphus.site/agendar` e `/bio` funcionam.
- [ ] `SITE-03` Site de proposta (não pago) → faixa "Esta página é uma proposta da Ruphus…" com "Pedir remoção · Privacidade"; código-fonte com `noindex, nofollow`.
- [ ] `SITE-04` Site publicado (entrada paga) → sem faixa, `index, follow`.
- [ ] `SITE-05` Site de cadastro (criado pelo próprio dono) → sem faixa.
- [ ] `SITE-06` `/s/{slug}/og.jpg` → imagem com nome, ramo, cidade.
- [ ] `SITE-07` Arquivo inexistente como página → HTML "Página não encontrada… Ir para o início do site"; como asset → texto "Arquivo não encontrado".
- [ ] `SITE-08` Site tirado do ar (ver `GAV-03`) → em até ~90 s `/` mostra `/indisponivel` ("Este site está fora do ar") com status 404; `/agendar` e `/bio` → 404.
- [ ] `SITE-09` Domínio próprio ativo (se houver um de teste) → subdomínio redireciona 308 para o domínio; host secundário → principal; `/agendar` e `/bio` funcionam no domínio.

### 1.3 Bio `/bio/{slug}`
- [ ] `BIO-01` Capa (ou inicial), avatar, nome, cidade/UF, nota e avaliações.
- [ ] `BIO-02` Selo "Aberto agora · até HHhMM" / "Fechado agora" coerente com os horários da equipe (horário de Brasília).
- [ ] `BIO-03` Atalhos: WhatsApp ("Olá! Vim pelo Instagram do {nome}."), Instagram, Como chegar, Ligar — só os que têm dado.
- [ ] `BIO-04` "Serviços" abre: "N serviços · a partir de R$ X"; cada item leva ao agendamento.
- [ ] `BIO-05` "Horário" abre: "Hoje: …" e os 7 dias.
- [ ] `BIO-06` Barra fixa "Agendar online" com próximos horários livres.
- [ ] `BIO-07` Com agenda online desligada (`PN-NEG-08`) → itens e barra viram "Falar no WhatsApp".
- [ ] `BIO-08` 📱 Layout no celular.

### 1.4 Agendamento público `/agendar/{slug}`
Pré: negócio de teste (ou demo) com serviços, profissionais e agenda online ligada. ⚠ Se o negócio tiver WhatsApp conectado, sai mensagem real ao número digitado.

**Passo 1 — serviço, profissional, horário**
- [ ] `AG-01` Cabeçalho: iniciais, nome, nota, cidade; ícone de WhatsApp com "Olá! Quero marcar um horário no {nome}."
- [ ] `AG-02` Nada pré-selecionado; texto "Toque num serviço e os horários mais cedo aparecem logo abaixo dele."
- [ ] `AG-03` Escolher 2 serviços → "somando: …" com duração e preço somados; nome vira "A + B".
- [ ] `AG-04` Tentar 6 serviços → servidor aceita no máximo 5.
- [ ] `AG-05` "Com quem?" só aparece com mais de 1 profissional apto; padrão "Qualquer um"; trocar serviço que o escolhido não faz → volta para "Qualquer um".
- [ ] `AG-06` Faixa de 7 dias: "N livres" / "sem vagas" / "fechado"; abre no primeiro dia com vaga.
- [ ] `AG-07` "outra data": aceita até hoje+90; fora disso é ignorado.
- [ ] `AG-08` Grade de 15 em 15 min; nenhum horário passado; serviço cabe até o fim do expediente.
- [ ] `AG-09` Grade mostra todos os horários agrupados por manhã/tarde/noite, sem "Ver todos".
- [ ] `AG-10` Dia sem vaga → "Nenhum horário livre nesta data…".
- [ ] `AG-11` 📱 Barra fixa inferior com Continuar; desktop: caixa "você está agendando".

**Passo 2 — confirmar**
- [ ] `AG-12` Nome inválido ("a") → "Informe seu nome, com pelo menos 2 letras". O campo descarta dígitos enquanto a pessoa digita: "3232" vira vazio e mostra "Informe seu nome"; a mensagem "Use só letras no nome." não aparece mais.
- [ ] `AG-13` WhatsApp: "faltam N dígitos" ao digitar; DDD inválido → "DDD inválido"; 11 dígitos sem 9 → "Celular com 11 dígitos começa com 9 depois do DDD"; válido → "número válido".
- [ ] `AG-14` Confirmar com campo inválido → "Confira seu nome e WhatsApp acima." e foco no campo.
- [ ] `AG-15` Com sinal ligado (`PN-NEG-20`) → aviso "Para garantir o horário, {nome} pede um sinal de R$ X (30% do valor) por Pix…".
- [ ] `AG-16` ⚠ "Confirmar às HH:MM" → tela "pedido enviado".

**Passo 3 — pedido enviado**
- [ ] `AG-17` Resumo (hoje/amanhã/daqui a N dias, data, hora–fim, serviço, profissional) e linha de valor ("pago no local", etc.).
- [ ] `AG-18` Sem sinal: passos "Horário guardado" → "{nome} confirma pelo seu WhatsApp".
- [ ] `AG-19` Com sinal: QR do Pix, "Copiar código Pix" ("Código copiado"), "Ver o código", contagem "faltam N min para pagar", "Enviar comprovante".
- [ ] `AG-20` Recado do dono aparece (se configurado em `PN-NEG-09`).
- [ ] `AG-21` "Mandar o resumo no WhatsApp", "como chegar" (mapa, Google Maps, Waze, Copiar endereço), "precisa desmarcar ou mudar?".
- [ ] `AG-22` "Salvar na agenda": celular baixa `agendamento.ics`; "Google Agenda" abre link.
- [ ] `AG-23` "Fazer outro agendamento" recarrega.
- [ ] `AG-24` Na agenda do painel (`PN-AG`) o horário aparece "Aguardando confirmação".
- [ ] `AG-25` Contato lembrado: novo agendamento mostra cartão com "não sou eu".

**Regras e erros**
- [ ] `AG-26` Idempotência: confirmar, recarregar e confirmar de novo → mesmo agendamento, sem duplicar.
- [ ] `AG-27` Dois navegadores no mesmo horário → o segundo vê "Esse horário acabou de ser ocupado. Escolha outro." e volta à grade.
- [ ] `AG-28` Limite: 4º horário futuro com o mesmo telefone no mesmo negócio → "Você já tem 3 horários marcados…".
- [ ] `AG-29` Agenda online desligada → página "Serviços e preços" com "Falar no WhatsApp".
- [ ] `AG-30` Negócio sem serviço agendável → "agenda online ainda fechada".
- [ ] `AG-31` Slug inexistente → 404 ("Erro 404 · Página não encontrada…").
- [ ] `AG-32` Push: aparelho com avisos ligados (`PN-CASCA-08`) recebe "Novo agendamento · nome · serviço · quando".
- [ ] `AG-33` ⚠ Negócio com WhatsApp conectado: salão recebe no próprio número "Responda CONFIRMADO {código}… ou RECUSAR {código}"; cliente recebe recibo "Recebemos seu pedido…" (ou o recado).

### 1.5 Proposta, pagamento, remoção
- [ ] `PROP-01` `/proposta/{slug}?t={token}` (gerar em `GAV-VENDA-10`) → "Agenda online para o {nome}", incluídos, valores, validade, rodapé com CNPJ.
- [ ] `PROP-02` Token errado → 404.
- [ ] `PROP-03` "Baixar PDF" abre impressão; `&pdf=1` abre sozinho; impressão sem botões.
- [ ] `PROP-04` Proposta vencida → texto em vermelho "Esta proposta era válida até…".
- [ ] `PAG-01` `/pagar/{id}?t=` de cobrança aberta (gerar em `GAV-COB-01`) → valor, vencimento dia 10, QR, "Copiar código Pix", "Enviar comprovante", txid.
- [ ] `PAG-02` Cobrança paga → "Pagamento recebido…"; cancelada → "Esta cobrança foi cancelada…"; vencida → "em atraso — pode pagar por aqui mesmo".
- [ ] `PAG-03` Token errado → 404.
- [ ] `REM-01` ⚠ Site de proposta de teste → "Pedir remoção" → "Remover a página de {nome}?" → só com clique tira do ar; "Página removida".
- [ ] `REM-02` Site publicado / de cadastro / em negociação → "Não dá para remover por aqui".
- [ ] `REM-03` Assinatura inválida → "Não dá para remover por aqui".

### 1.6 Ajuda e APIs públicas
- [ ] `AJ-01` `/ajuda` (sem login) → seções e "Voltar ao painel"; anônimo clicando vai a `/login`.
- [ ] `AJ-02` `/ajuda/vendas` → seções do manual do vendedor (sem "Gerador de sites").
- [ ] `API-01` `/api/versao` → `{"commit": "..."}` igual ao deploy.
- [ ] `API-02` `/api/vitrine`, `/api/catalogo`, `/api/catalogo?q=barbearia`, `/api/marketing` → JSON.
- [ ] `API-03` `/api/desativados` e `/api/dominios` sem cabeçalho `x-ruphus` → 404.
- [ ] `API-04` `/api/cron/lembretes` sem segredo → 401.
- [ ] `API-05` `/api/webhooks/atendys` sem assinatura → 401.
- [ ] `API-06` `/admin/qr?url=https://barbearia-force.ruphus.site` → SVG; URL de fora → 400.

---

## 2. Conta

### 2.1 Login `/login`
- [ ] `LOG-01` E-mail/senha corretos → vai para `/painel` (ou `/admin` se admin, ou o negócio único).
- [ ] `LOG-02` Senha errada → "E-mail ou senha incorretos."; e-mail incompleto → "E-mail incompleto: confira o @…".
- [ ] `LOG-03` Caps Lock ligado → "Caps Lock está ligado."; botão mostrar/ocultar senha.
- [ ] `LOG-04` Google → popup; fechar popup não mostra erro; popup bloqueado → "O navegador bloqueou a janela do Google…".
- [ ] `LOG-05` ⚠ "Criar conta" (`?criar=1`): nome, e-mail, senha com checklist "8 caracteres ou mais / uma letra / um número"; e-mail já usado → "Este e-mail já tem conta…"; sucesso manda e-mail de verificação.
- [ ] `LOG-06` ⚠ "Esqueci a senha" vazio → "Escreva seu e-mail…"; preenchido → "Se houver conta com esse e-mail, enviamos um link…".
- [ ] `LOG-07` `?next=//evil.com` → ignora e vai ao padrão; `?next=/barbearia-force` → volta lá.
- [ ] `LOG-08` `?expirou=5` → faixa "Sua sessão foi encerrada depois de 5 minutos sem uso…".
- [ ] `LOG-09` Logado e abrindo `/login` → redireciona; `?trocar=1` → permite trocar de conta.
- [ ] `LOG-10` 📱 Desktop mostra fundo com sites e "+18 mil sites"; celular sem fundo.

### 2.2 Links de e-mail `/conta`
- [ ] `CONTA-01` Link sem `mode`/`oobCode` → "Link inválido".
- [ ] `CONTA-02` Verificação de e-mail → só confirma ao clicar "Confirmar e-mail" → "E-mail confirmado."
- [ ] `CONTA-03` Redefinir senha → "Para a conta {email}.", senha nova (mín. 6) → "Senha trocada…"; link usado/vencido → mensagem própria.

### 2.3 `/painel`
- [ ] `PAINEL-01` Conta com 1 negócio → vai direto para a agenda do negócio.
- [ ] `PAINEL-02` Conta com 2+ negócios → "Meus negócios" com papel (Dono/Admin/Equipe) e "Abrir painel".
- [ ] `PAINEL-03` Admin da plataforma → vai para `/admin`.
- [ ] `PAINEL-04` Falha de rede → "Não foi possível carregar os seus negócios." + "Tentar de novo" (não mostra o cadastro).
- [ ] `PAINEL-05` Sessão encerrada pelo admin (`GAV-CLI-08`) → sai da conta e vai ao login.
- [ ] `PAINEL-06` ⚠ Conta nova sem negócio → "Seu primeiro negócio": nome, endereço (slug sugerido; "Verificando…" → "Disponível" / "Esse endereço já está em uso"; reservado como `admin` → "Esse endereço é reservado"; `a--b` → "Não use dois hífens seguidos"), ramo, WhatsApp (DDD), cidade, UF (preenchida pelo DDD), bairro.
- [ ] `PAINEL-07` Sem aceitar termos → "Para continuar, aceite os Termos de Contratação."
- [ ] `PAINEL-08` ⚠ "Criar negócio" → cria site, serviços do ramo, um profissional, entrada no funil (origem Cadastro, com UTM); e-mail de aceite dos termos; abre o painel.
- [ ] `PAINEL-09` Segundo negócio com cota 1 → "Sua conta inclui 1 negócio…" + "Falar no WhatsApp".

### 2.4 Convite `/convite`
- [ ] `CONV-01` Sem token → "O link do convite está incompleto…".
- [ ] `CONV-02` Deslogado → login e volta ao convite.
- [ ] `CONV-03` Convite de equipe (gerar em `PN-PROF-10`) com a conta certa e e-mail confirmado → entra direto no negócio como Equipe.
- [ ] `CONV-04` Conta com outro e-mail → "Este convite é só para {email}…"; e-mail não confirmado → "Confirme o e-mail…".
- [ ] `CONV-05` Reusar o mesmo link → "Este convite já foi usado…"; link revogado → "Este link foi cancelado…"; vencido (7 dias) → "Convite inválido ou vencido…".
- [ ] `CONV-06` ⚠ Convite de dono/admin (gerar em `GAV-CLI-03`) → tela "Painel do {nome}" com termos → "Aceitar e entrar".
- [ ] `CONV-07` Profissional já tem acesso → "Este profissional já tem um acesso ao painel…".

### 2.5 Sessão, PWA e erros
- [ ] `SES-01` Logout por inatividade: /admin engrenagem → 1 min (`ADM-03`); ficar parado no painel → vai a `/login?expirou=1`. Voltar para 0 depois.
- [ ] `SES-02` "Sair" no menu da conta → `/login`; push deste aparelho cancelado.
- [ ] `PWA-01` Chrome Android/desktop: faixa "Instale o painel no celular" → "Instalar" instala; "Agora não" some por 30 dias e a opção fica em Meu negócio → Seus links.
- [ ] `PWA-02` iPhone Safari: faixa com instrução "Compartilhar → Adicionar à Tela de Início".
- [ ] `PWA-03` Modo avião com o painel já aberto → faixa "Sem conexão. Você está vendo o que ficou salvo…"; tela nunca aberta → `offline.html`.
- [ ] `PWA-04` Após um deploy, aba aberta → faixa "Há uma versão nova do painel no ar." (ou recarrega sozinha em segundo plano).
- [ ] `PWA-05` Modo escuro: trocar o tema do sistema → painel acompanha.
- [ ] `ERR-01` URL inexistente → página 404 em português; erro inesperado → "Algo deu errado nesta tela" com "Tentar de novo".

---

## 3. Painel do dono (`/{slug}`) — usar a demo `barbearia-force`

### 3.1 Casca
- [ ] `PN-CASCA-01` Menu: Agenda, Serviços, Profissionais, Clientes, Caixa (se ligado pelo admin), Meu negócio; 📱 barra inferior com rótulos curtos.
- [ ] `PN-CASCA-02` Slug inválido → 404; não membro → "Você não tem acesso a este negócio."
- [ ] `PN-CASCA-03` "Divulgar link": copiar ("Copiado ✓"), "Enviar no WhatsApp", "Compartilhar" (celular), "Abrir página".
- [ ] `PN-CASCA-04` Menu da conta: e-mail, Ajuda, Avisos de agendamento, Sair; "Meus negócios" só com 2+; "Voltar ao admin" para admin.
- [ ] `PN-CASCA-05` Faixa "Seu WhatsApp desconectou…" com "Reconectar" (só gestor, só se já conectou e caiu, fora de Meu negócio).
- [ ] `PN-CASCA-06` Sem internet → faixa do monitor com nova tentativa.
- [ ] `PN-CASCA-07` Faixa "Receba um aviso a cada novo agendamento" (quando a de instalar não está) → "Agora não" some 30 dias.
- [ ] `PN-CASCA-08` "Avisos de agendamento" → permitir notificações → "ligados"; agendar pelo link (`AG-16`) → notificação chega; clicar abre a agenda. Desligar → "desligados".

### 3.2 Agenda
- [ ] `PN-AG-01` Semana: ‹ › mudam 7 dias; campo de data; "Hoje" desabilitado em hoje; faixa com contagem por dia.
- [ ] `PN-AG-02` Cartões Horários / Confirmados / Aguardando / Previsto batem com a lista.
- [ ] `PN-AG-03` Filtro por profissional (chips "Todos" + nomes com contagem); vazio → "Nenhum horário para este profissional neste dia."
- [ ] `PN-AG-04` Linha "Agora · HH:MM" em hoje, antes do próximo horário.
- [ ] `PN-AG-05` Etiquetas: Aguardando confirmação, Confirmado, Cancelado (riscado), Faltou, Recorrente, Sinal pendente/pago, Recebido.
- [ ] `PN-AG-06` "Confirmar pelo WhatsApp" (horário futuro aguardando) → status Confirmado e abre wa.me com "Olá, {nome}! Seu horário… está confirmado…". ⚠ Com SMS ligado no admin, sai SMS de confirmação.
- [ ] `PN-AG-07` "Remarcar" → data (até +180 dias), horários livres do mesmo profissional, "Remarcar para HH:MM" → volta "Aguardando", faixa verde com "Avisar pelo WhatsApp", agenda pula para a data.
- [ ] `PN-AG-08` Remarcar para horário que acabou de ser ocupado → "Esse horário não está livre. Escolha outro."
- [ ] `PN-AG-09` ⋯ → "Faltou" (só depois do início) → confirmação → Faltou.
- [ ] `PN-AG-10` ⋯ → "Cancelar horário" → diálogo com "Avisar o cliente pelo WhatsApp" marcado → "Sim, cancelar" → Cancelado e wa.me com texto de cancelamento; desmarcado → sem wa.me.
- [ ] `PN-AG-11` ⋯ → "Histórico" → lista com autor e data (Agendado online, Confirmado, Remarcado de X para Y, Cancelado…).
- [ ] `PN-AG-12` Horário com sinal pendente → "Sinal recebido" → "O sinal de R$X caiu na sua conta?" → Confirmado + sinal pago (+ lançamento no Caixa se ligado).
- [ ] `PN-AG-13` Com Caixa: ⋯ → "Recebido" em horário passado → folha de baixa (`PN-CX-04`).
- [ ] `PN-AG-14` Negócio sem profissional → bloco "Falta pouco para a agenda abrir" com os 3 passos.

### 3.3 Serviços
- [ ] `PN-SV-01` 🔒 Demo: "Adicionar serviço" → "Sem permissão para isso…". (Em negócio de teste: criar funciona e o formulário limpa.)
- [ ] `PN-SV-02` Validações: nome vazio/repetido ("Já existe um serviço com este nome"), duração < 5 ("A duração mínima é de 5 minutos") e > 480, preço inválido, máx. R$ 99.999,99.
- [ ] `PN-SV-03` Preço: Fixo / A partir de / Não informar (campo desabilitado) → aparece certo na lista e no `/agendar`.
- [ ] `PN-SV-04` Editar preço e duração (liberado na demo) → salva; renomear na demo → negado.
- [ ] `PN-SV-05` Chave "Mostrar no link" → some/volta no `/agendar`; serviço sem ninguém → "Fora do link até alguém fazer".
- [ ] `PN-SV-06` 🔒 Excluir na demo → negado; em teste → "Excluir “X”?" → some do link, agendamentos antigos ficam.

### 3.4 Profissionais
- [ ] `PN-PROF-01` 🔒 Demo: "Adicionar profissional" → "Na demonstração, os dados do negócio, … e a equipe ficam como estão…".
- [ ] `PN-PROF-02` Editar serviços e horários (liberado na demo) → "Repetir o horário de segunda…" funciona; fim antes do início → "O fim do expediente precisa ser depois do início".
- [ ] `PN-PROF-03` Sem serviço marcado → "Escolha pelo menos um serviço".
- [ ] `PN-PROF-04` Comissão (só com Caixa): "abc" → "Comissão inválida…"; 40 → salva.
- [ ] `PN-PROF-05` ⋯ "Tirar do link" → etiqueta "Fora do link", some do `/agendar`; "Voltar para o link" desfaz.
- [ ] `PN-PROF-06` Limite da equipe (padrão 5): com 5 cadastrados → formulário vira "Seu plano inclui 5 profissionais…".
- [ ] `PN-PROF-07` Excluir (em teste) → some do link, perde acesso ao painel, convites pendentes revogados.
- [ ] `PN-PROF-10` "Dar acesso ao painel" → e-mail → "Gerar link" → URL `/convite?c=…`, "Copiar mensagem", "Enviar no WhatsApp". E-mail inválido → "E-mail inválido."
- [ ] `PN-PROF-11` Após aceite (`CONV-03`) → "Entra no painel com {email}" + "Tirar acesso" → confirmação → a conta perde o acesso.

### 3.5 Clientes
- [ ] `PN-CL-01` Lista: busca por nome (sem acento) e por telefone; "Nenhum cliente encontrado."
- [ ] `PN-CL-02` Filtro "Sem vir há" 30/60/90 dias, 6 meses, 1 ano → texto do recorte; "Copiar telefones" → "Telefones copiados ✓"; clientes com "sem campanha" ficam fora.
- [ ] `PN-CL-03` Ordenação por coluna (clicar inverte); 📱 select "Ordenar por"; paginação 10/25/50/100.
- [ ] `PN-CL-04` Ficha: cabeçalho, cartões (Agendamentos, Próximos, Atendidos, Faltas, Cancelados, Total gasto).
- [ ] `PN-CL-05` "corrigir" nome → "3232" recusado ("Use só letras…"); nome válido → salva e muda nos horários futuros.
- [ ] `PN-CL-06` Nascimento: "31/02/2000" → "Essa data não existe"; futura → "A data não pode ser no futuro"; e-mail incompleto → erro; válido → "Salvo." e idade.
- [ ] `PN-CL-07` Etiquetas: adicionar (Enter), máx. 8 e 24 caracteres, repetida ignorada, "×" remove.
- [ ] `PN-CL-08` "Não receber campanhas" marca/desmarca.
- [ ] `PN-CL-09` Anotação (máx. 600) → aparece com data e autor; "apagar" só para gestor.
- [ ] `PN-CL-10` Excluir cliente com horário marcado → "Este cliente tem horário marcado. Cancele antes de excluir."; com plano ativo → "Encerre o plano recorrente antes de excluir."
- [ ] `PN-CL-11` Novo plano recorrente (da lista ou da ficha): serviços (até 5), "Com quem" (com "Qualquer um"), primeiro dia ("N livres" / "sem vaga" / "fechado"), horário (12 + "Ver todos"), semanas 1–52 → resumo com valor "até N atendimentos · R$" → "Criar plano" → "Plano recorrente criado" com datas criadas, puladas e as que foram com outro profissional.
- [ ] `PN-CL-12` Plano na ficha: "toda X às HH:MM", "Encerrar plano" → "Os agendamentos futuros… serão cancelados" → cancelados (sem aviso ao cliente).

### 3.6 Caixa (precisa estar ligado pelo admin — `GAV-CLI-06`)
- [ ] `PN-CX-01` Sem Caixa ligado → "O Caixa não está ativo para este negócio…".
- [ ] `PN-CX-02` Navegar meses; cartões Entrou / Saiu / Sobrou.
- [ ] `PN-CX-03` "+ Entrada" / "− Saída": valor (3500 = R$ 35,00), categoria, forma (lembrada), data, descrição → "Entrada de R$X lançada."; R$ 0,35 → aviso de valor baixo e pede segundo toque.
- [ ] `PN-CX-04` "A receber da agenda" → "Recebi" → baixa ("Recebido: R$X."), horário vira Confirmado e marca "Recebido" na agenda; com sinal pago → "(com sinal de R$X)".
- [ ] `PN-CX-05` "Não veio" → "Falta registrada."
- [ ] `PN-CX-06` Pix: forma Pix + chave cadastrada → "Mostrar QR do Pix" e "Copiar código Pix"; sem chave → orientação para cadastrar.
- [ ] `PN-CX-07` Tocar num lançamento → "Corrigir lançamento"; apagar → confirmação conforme o tipo.
- [ ] `PN-CX-08` Estornar entrada (total/parcial) → aparece "Estornado"; acima do recebido → "O estorno vai até R$X…"; segunda vez → recusado.
- [ ] `PN-CX-09` Contas fixas: adicionar (nome, valor, dia 1–31), "Paguei" no mês, "Tirar"; 31 contas → "No máximo 30 contas fixas."
- [ ] `PN-CX-10` Comissões: % por profissional, totais, "Pagar" → "Paga"; nome abre histórico de 12 meses.
- [ ] `PN-CX-11` "Exportar planilha" → `caixa-{slug}-{AAAA-MM}.csv` abre no Excel com acentos.
- [ ] `PN-CX-12` "Resumo do mês": por forma, por profissional, por categoria.

### 3.7 Meu negócio
- [ ] `PN-NEG-01` 🔒 Demo: salvar Dados → mensagem da demonstração. (Em teste: "Salvo. O site já mostra as mudanças." e site/bio/agendar atualizam.)
- [ ] `PN-NEG-02` Validações: nome < 2, WhatsApp sem DDD, cidade vazia, UF; erro leva o foco ao campo.
- [ ] `PN-NEG-03` Sair com alteração não salva → "Sair sem salvar?"; recarregar → navegador pergunta; 📱 barra "Alterações não salvas".
- [ ] `PN-NEG-04` Seus links: Site, Bio, Agenda com "Copiar"; prévia do `og.jpg`; site em prévia → "Publicar meu site" (wa.me).
- [ ] `PN-NEG-08` 🔒 Demo: "Receber agendamentos pelo link" → recusa. (Em teste: desligar → bio e `/agendar` levam ao WhatsApp; ligar volta.)
- [ ] `PN-NEG-09` 🔒 Demo: recado → recusa. (Em teste: máx. 300; aparece na tela de pedido enviado.)
- [ ] `PN-NEG-10` WhatsApp — termo: só com o checkbox → "Aceitar e continuar".
- [ ] `PN-NEG-11` 🔒 Demo: "Conectar" → "A demonstração não conecta WhatsApp…".
- [ ] `PN-NEG-12` ⚠ Negócio de teste com número seu: Conectar → QR → ler no celular → "conectado"; etiqueta de status muda.
- [ ] `PN-NEG-13` ⚠ Teste de envio: "Para" com DDD + mensagem → "Enviado pelo seu WhatsApp."; vazio → botão desabilitado.
- [ ] `PN-NEG-14` ⚠ Lembretes: ligar, escolher horas → salva; confirmar um horário seu dentro da janela → lembrete chega (cron de 10 min; nada entre 22h e 7h30).
- [ ] `PN-NEG-15` ⚠ Comando no WhatsApp do salão: agendar pelo link, responder "CONFIRMADO {código}" → horário Confirmado e cliente recebe confirmação; "RECUSAR {código}" → Cancelado e cliente avisado.
- [ ] `PN-NEG-16` ⚠ Desconectar → confirmação → "não conectado"; deslogar o aparelho pelo celular → faixa "Seu WhatsApp desconectou" e push ao dono (até 1 h pela vigia).
- [ ] `PN-NEG-17` Último aviso que não saiu → faixa com data e motivo.
- [ ] `PN-NEG-18` 🔒 Demo: Pix → recusa. (Em teste: chave inválida → "Chave inválida…"; válida → "Salvo como {tipo}…"; remover → desliga o sinal.)
- [ ] `PN-NEG-20` 🔒 Demo: Sinal → recusa. (Em teste: sem Pix → orientação; % > 100 → erro; prazo 15 min–24 h; salvar → `/agendar` pede sinal.)
- [ ] `PN-NEG-21` ⚠ Sinal não pago no prazo → cron cancela o horário (histórico "Sinal não pago no prazo").

---

## 4. Conta da equipe (papel "member" preso a um profissional)

Pré: convite aceito (`CONV-03`) para o profissional A, numa conta sua.
- [ ] `EQ-01` Menu sem Caixa e sem Meu negócio; pela URL → mensagens de bloqueio.
- [ ] `EQ-02` Agenda abre filtrada no profissional A; "Todos" mostra tudo.
- [ ] `EQ-03` Horários de A: Confirmar, Remarcar, Faltou, Cancelar aparecem e funcionam.
- [ ] `EQ-04` Horários de B: sem Confirmar, Remarcar, Faltou, Cancelar (só Histórico).
- [ ] `EQ-05` Sem "Sinal recebido" nem "Recebido".
- [ ] `EQ-06` Serviços e Profissionais só leitura (sem formulário, sem ⋯, sem acesso).
- [ ] `EQ-07` Novo plano: "Com quem" só com A, sem "Qualquer um"; cria normalmente.
- [ ] `EQ-08` Ficha: "Encerrar plano" só nos planos de A (nunca nos "Qualquer um").
- [ ] `EQ-09` Clientes: etiquetas, "sem campanha" e anotar funcionam; apagar anotação, nascimento/e-mail e excluir cliente não aparecem; "corrigir" nome → "Só o dono ou um administrador…".
- [ ] `EQ-10` Avisos de agendamento funcionam no aparelho dele.
- [ ] `EQ-11` Dono tira o acesso (`PN-PROF-11`) → a conta da equipe perde o painel na próxima ação.

---

## 5. Admin da plataforma (`/admin`, conta `admin@ruphus.app`)

### 5.1 Entrada e engrenagem
- [ ] `ADM-01` Sem login → `/login?next=/admin`; conta comum → "Área restrita · {email} não administra a plataforma."
- [ ] `ADM-02` Abas: Lista, Funil, Clientes, Cobrança (selo de atrasadas), Coleta, Ajustes + menu Demonstração. **Sem aba Gerador.** 📱 barra inferior com 6 ícones.
- [ ] `ADM-03` Engrenagem: "Quem assina" (vazio → erro; sem assinatura → faixa amarela e mensagens prontas bloqueadas); "Sair sozinho depois de parado" 0–720; Pixel da Meta (só dígitos 10–20); Manual do vendedor; Sair.
- [ ] `ADM-04` Rodapé mostra `vX.Y.Z · commit` igual ao `/api/versao`.
- [ ] `ADM-05` Tecla `/` foca a busca.

### 5.2 Lista
- [ ] `LIS-01` Visões com contador: Atrasados, Para hoje, Falei hoje, Em destaque, Todos, Sem cliente dentro, Em negociação, Fora do ar.
- [ ] `LIS-02` Alertas (Sem próximo passo, Parado há 7+ dias, Fechou e não entrou, Destaque vence hoje) → clicar filtra.
- [ ] `LIS-03` Busca por nome, slug, cidade, telefone (sem acento).
- [ ] `LIS-04` Filtros (Estado, Cidade, Nicho, Funil, Compromisso, Módulos) com pílulas ✕ e "Limpar filtros"; chip que zera fica tracejado; trocar UF limpa cidade.
- [ ] `LIS-05` Ordens (relevância, compromisso, último contato, nota, avaliações, nome); destaque sempre no topo.
- [ ] `LIS-06` "Mostrar mais" (40 por vez); "mostrando X de Y".
- [ ] `LIS-07` Lista vazia → sugestões "Tirar {cidade} → N".
- [ ] `LIS-08` "Convidar" (acessos ≤ 1) → copia link; sem e-mail do dono → "Cadastre o e-mail do dono na aba Venda…".
- [ ] `LIS-09` Lote (desktop XL): selecionar → "Gerar convites" baixa CSV; "Marcar oferta/negociando" pula fechados e perdidos.

### 5.3 Gaveta do negócio (usar negócio de teste ou a demo)
- [ ] `GAV-01` Abrir por "Abrir" → cabeçalho, abas; Esc fecha; a aba escolhida vale para o próximo.
- [ ] `GAV-02` Menu ⋯: Painel do negócio, Ver o site, Agendamento.
- [ ] `GAV-03` ⚠ "Tirar o site do ar" → em ~90 s `SITE-08`; "Colocar o site no ar" desfaz.

**Venda**
- [ ] `GAV-VENDA-01` O combinado: "O que fazer" e "Quando" salvam; selo atrasada/para hoje.
- [ ] `GAV-VENDA-02` Etapa Novo/Oferta/Negociando salva direto.
- [ ] `GAV-VENDA-03` ⚠ "Fechou" → modal: mensalidade obrigatória; "Gerar a cobrança da entrada" (cria cobrança), "Enviar boas-vindas" (wa.me), "Incluir o convite" → aviso com o que foi feito.
- [ ] `GAV-VENDA-04` "Perdeu" → motivo obrigatório ("Escolha um motivo."), detalhe, "Voltar a procurar em".
- [ ] `GAV-VENDA-05` Contato do dono: WhatsApp 10/11 dígitos, e-mail; "+ Adicionar outro WhatsApp" até 10.
- [ ] `GAV-VENDA-06` Como chegou (origens; Indicação pede quem indicou); Destaque Hoje/3/7 dias/Tirar.
- [ ] `GAV-VENDA-07` Mensagens prontas: modelos, texto editável, "Abrir no WhatsApp" (wa.me + registra contato), "Copiar".
- [ ] `GAV-VENDA-10` Proposta: "Gerar link" → Copiar, Enviar no WhatsApp, Ver como o dono vê, Baixar PDF, Refazer (invalida o anterior); Entrada/Mensalidade aceitam "59,90".
- [ ] `GAV-VENDA-11` ⚠ "Enviar por e-mail" (e-mail seu) → confirmação → chega; evento na linha do tempo.
- [ ] `GAV-VENDA-12` Objeções: "Copiar resposta"; Últimos acontecimentos + nota.

**Ficha / Histórico**
- [ ] `GAV-FICHA-01` Links (Maps, Instagram, Google, site, WhatsApp) e dados; serviços.
- [ ] `GAV-HIST-01` Linha do tempo com filtros; nota de 1–600 caracteres.

**Cliente**
- [ ] `GAV-CLI-01` Fechado → Implantação (4 passos) com "Lembrar" (wa.me) e Saúde (Saudável/Atenção/Em risco), barras de 4 semanas.
- [ ] `GAV-CLI-03` Convite do dono: "Convidar {email}" → Copiar, ⚠ Enviar por e-mail, WhatsApp, Gerar outro.
- [ ] `GAV-CLI-04` Limite de profissionais − / + (1–50) → reflete em `PN-PROF-06`.
- [ ] `GAV-CLI-05` Negócios nesta conta − / + (1–50) → reflete em `PAINEL-09`.
- [ ] `GAV-CLI-06` Caixa: ligar → confirmação → aparece no painel do negócio; valor somado à mensalidade.
- [ ] `GAV-CLI-07` Quem tem acesso: papéis (Dono, Ruphus, Cliente, Equipe).
- [ ] `GAV-CLI-08` ⚠ "Encerrar sessões" (numa conta sua) → a pessoa é deslogada na próxima ação.
- [ ] `GAV-CLI-09` ⚠ "Remover" acesso de equipe → perde o painel; dono não removível.
- [ ] `GAV-CLI-10` Divulgar: miniatura, QR, copiar Site/Bio/Agendamento, "Enviar tudo pelo WhatsApp".

**Site**
- [ ] `GAV-SITE-01` Situação (Publicado/Proposta), `og.jpg`, Ver o site, Bio.
- [ ] `GAV-SITE-02` Modelo: "Prévia" não grava; ⚠ "Aplicar" → confirmação → site e bio mudam.
- [ ] `GAV-SITE-03` Dados: "Revisar mudanças" lista antes → depois; nada mudou → "Nada mudou…"; ⚠ "Publicar mudanças" → "Publicado…".
- [ ] `GAV-SITE-04` Visual: fotos (JPG/PNG/WebP ≤ 12 MB; HEIC/arquivo grande → erro), cores, fonte, textos com contador, prévia celular/computador; selo "Rascunho não publicado".
- [ ] `GAV-SITE-05` Visual com IA (custa crédito): pedido → sugestões com checkbox → "Aplicar na prévia" / "Descartar"; sem chave → orientação.
- [ ] `GAV-SITE-06` ⚠ "Publicar visual" → confirmação → site muda.
- [ ] `GAV-SITE-07` Domínio próprio: site não publicado → "Disponível depois que o site for publicado"; `x.ruphus.site` → "Endereço inválido…"; ⚠ ligar/verificar/desligar só com domínio de teste.

**WhatsApp / SMS / Cobrança da gaveta**
- [ ] `GAV-WA-01` 🔒 Demo: Conectar → recusa. ⚠ Em teste: Conectar → QR → conectado; "Permitir que o dono gerencie"; WhatsApp do dono (número incompleto → erro).
- [ ] `GAV-SMS-01` SMS: sem chave Comtele → aviso; ligar com as duas opções desmarcadas → "nenhum SMS sai". ⚠ Ligar gasta crédito via cron.
- [ ] `GAV-COB-01` ⚠ "Cobrar entrada" / "Cobrar mês atual" (negócio de teste com valor) → "Cobrança … pronta."; repetir não duplica.
- [ ] `GAV-COB-02` Copiar link → `PAG-01`; WhatsApp → wa.me com Pix.
- [ ] `GAV-COB-03` ⚠ "Marcar paga" (valor e data) → "Baixa registrada."; baixa da **entrada publica o site** (`SITE-04`); valor menor → recusado.
- [ ] `GAV-COB-04` ⚠ "Cancelar" (sem confirmação!) → "Cobrança cancelada."; paga → "Cobrança paga não se cancela."

### 5.4 Funil
- [ ] `FUN-01` Períodos; números (Receita, Em negociação, Vendas, Taxa, Tempo até fechar); "Ações atrasadas" leva à Lista.
- [ ] `FUN-02` Colunas com "Mostrar mais 6"; Perdido com motivos.
- [ ] `FUN-03` Arrastar (desktop): para Fechado → modal de venda; para Perdido → modal de motivo; outras salvam.
- [ ] `FUN-04` 📱 Abas por etapa; tocar abre a gaveta.
- [ ] `FUN-05` Quadros: origem, anúncios (`utm_campaign`), motivos de perda.

### 5.5 Clientes (carteira)
- [ ] `CART-01` Cartões (ativos, implantados X de N, agendamentos 30d, em risco) e tabela ordenada por saúde; 📱 cartões.

### 5.6 Cobrança (plataforma)
- [ ] `COB-01` "Cobranças em atraso N · R$"; "Nada em atraso." quando zero.
- [ ] `COB-02` "Cobrar o mês de todos" desabilitado ("Desativado por enquanto").
- [ ] `COB-03` Por atrasada: WhatsApp, Copiar link; ⚠ "Tirar o site do ar" (sem confirmação).
- [ ] `COB-04` Chave Pix da Ruphus: campos obrigatórios; ⚠ salvar muda o QR de todas as cobranças abertas — só conferir, não trocar.

### 5.7 Coleta
- [ ] `COL-01` Faixa do worker ("Worker no ar…", "Nenhum worker no ar…"); lista atualiza sozinha.
- [ ] `COL-02` Nova coleta: estado → cidades (capital no topo, "já temos N"), máx. 50, Sortear, bairros só com 1 cidade (máx. 80), termos (máx. 20).
- [ ] `COL-03` Validações: nenhuma cidade, 51 cidades, bairros com várias cidades, termo de 1 letra.
- [ ] `COL-04` ⚠ "Pôr na fila" (cidade pequena) → "N cidade(s) entrou na fila"; repetir → "já estava na fila".
- [ ] `COL-05` ⚠ Ligar worker → aparece no ar; acompanhar etapas, %, ritmo; "Cancelar" para em ~20 s; "Recolocar na fila".
- [ ] `COL-06` Pronta → "Ver prévia dos sites" (novos/atualizações/pulados), "Tirar" lead, "Desfazer".
- [ ] `COL-07` ⚠ "Gerar N sites" → confirmação → "Gerando: X de Y" → "N sites no ar." (cria sites e funil — só com coleta de teste).
- [ ] `COL-08` Excluir coleta (confirmação conforme estado); ativa → "Cancele a coleta antes de excluir…".
- [ ] `COL-09` ⚠ Desligar worker → confirmação.

### 5.8 Ajustes (integrações)
- [ ] `AJU-01` Cada serviço com selo ✓ Válida / ✗ Com problema / Não configurada e o motivo; "Verificar de novo".
- [ ] `AJU-02` Origem: "Cadastrada aqui" / "Vem do .env do servidor" / "Opcional · não configurado"; segredo mascarado `••••1234`.
- [ ] `AJU-03` Salvar chave com espaço → "A chave não pode ter espaço…"; Gmail/alerta inválido → "Confira o e-mail."; Remover → confirmação.
- [ ] `AJU-04` ⚠ Testar e-mail (seu e-mail) com Automático, Só Resend, Só Gmail → "Enviado para X…"; conferir remetente e "responder para" `contato@ruphus.site`.
- [ ] `AJU-05` ⚠ Testar alerta → chega no e-mail de alertas.
- [ ] `AJU-06` ⚠ Testar SMS (seu celular, gasta 1 crédito) → "Enviado…"; fixo → "Fixo não recebe SMS…".
- [ ] `AJU-07` Bloco "Preço por mensagem (cobrado do negócio)": sem nada salvo mostra 0,05 / 0,00 / 0,12. Mudar para 0,07 / 0,01 / 0,20 → "Preços salvos…"; recarregar mantém. Valor negativo ou texto → botão desabilitado.
- [ ] `AJU-08` Depois do `AJU-07`, um envio no negócio de teste (lembrete ou confirmação) grava `tenants/{slug}/envios/{id}` com `precoCents` novo, destino mascarado `(DD) •••••-1234` e sem o texto; `tenants/{slug}/consumo/{AAAA-MM}` soma `total` e `custoCents` (conferir no console do Firestore). Voltar os preços ao padrão.

### 5.9 Demonstração
- [ ] `DEMO-01` Links Site, Bio, Agendamento, Painel do dono.
- [ ] `DEMO-02` Acesso: e-mail e senha com Copiar; "Volta ao padrão sozinha toda madrugada, às 3h…".
- [ ] `DEMO-03` ⚠ "Restaurar padrão" → confirmação → "Restaurada: N agendamentos de exemplo e senha nova."; quem estava na demo é deslogado; senha nova funciona.

---

## 6. Automações (conferir por efeito, sem rodar à mão em produção)

- [ ] `AUTO-01` Cron de lembretes (a cada 10 min): horário seu confirmado no negócio de teste com lembretes ligados → lembrete chega X horas antes; nada entre 22h e 7h30 (vai às 7h30).
- [ ] `AUTO-02` Sinal vencido: agendamento com sinal não pago → após o prazo, Cancelado com histórico "Sinal não pago no prazo".
- [ ] `AUTO-03` ⚠ SMS (com SMS ligado no negócio de teste): confirmação e lembrete chegam; falha → e-mail de alerta (máx. 1 a cada 6 h).
- [ ] `AUTO-05` Consumo: WhatsApp entregue/lido no celular → o envio em `tenants/{slug}/envios` passa a `entregue`/`lido` (webhook); número inválido → `falhou` com o erro e `custoCents` 0, e o mês desconta o valor. SMS fica `enviado` (a Comtele não devolve entrega).
- [ ] `AUTO-04` Vigia de conexões (de hora em hora): deslogar o WhatsApp do negócio de teste pelo celular → em até 1 h: faixa "Seu WhatsApp desconectou" e push ao dono.
- [ ] `AUTO-05` Webhook de status: reconectar → faixa some e "último aviso" é limpo.
- [ ] `AUTO-06` Cron da demo (03:00): no dia seguinte, senha da demo mudou e dados voltaram ao exemplo.
- [ ] `AUTO-07` Falha de lembrete → `lastNotifyError` aparece na gaveta e em Meu negócio; e-mail de alerta ao admin.
- [ ] `AUTO-08` Vigia da VPS (`deploy/vigia.sh`): app derrubado → reinicia em até ~4 min (só conferir log `ruphus-vigia`).

---

## 7. Regressão rápida pós-deploy (15 min)

- [ ] `REG-01` `/api/versao` = commit do deploy; rodapé do /admin igual.
- [ ] `REG-02` `/`, `/login`, `/painel`, `/agendar/barbearia-force`, `/bio/barbearia-force`, `barbearia-force.ruphus.site` → 200.
- [ ] `REG-03` Login demo → agenda abre; trocar de semana; abrir Serviços, Profissionais, Clientes, Caixa, Meu negócio sem erro no console.
- [ ] `REG-04` Agendar pelo link na demo (número seu) → aparece na agenda; remarcar; cancelar.
- [ ] `REG-05` Login admin → Lista carrega; abrir uma gaveta; Ajustes com selos ✓.
- [ ] `REG-06` Se mudou regras do Firestore: publicadas a partir de um checkout em `main` (`released rules`).
- [ ] `REG-07` Restaurar a demo ao final.

---

## Registro da rodada

| Data | Commit | Quem | Itens com falha (código + resumo) |
|---|---|---|---|
| | | | |
