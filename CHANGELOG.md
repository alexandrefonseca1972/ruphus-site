# Mudanças

O que entrou em cada versão, do ponto de vista de quem usa. Cada linha aponta
o PR, onde está o porquê.

## Não publicado

- Plano do negócio no /admin (gaveta, aba Cobrança, "O que o plano inclui"): Caixa e agendamento vêm ligados para todos, e o suporte desliga por negócio. Caixa desligado: some do painel, Recebido/Recibo saem da agenda e o servidor recusa lançamentos novos (o histórico fica). Agendamento desligado (cliente que quer só o site): o agendamento online fecha (site e bio levam à lista de preços e ao WhatsApp, e o dono não consegue religar), o painel fica só com Serviços e Meu negócio (sem Agenda, Equipe, Clientes, Caixa, Consumo, avisos de agendamento, WhatsApp, Pix e sinal) e nenhum lembrete sai. Nada é apagado: religar devolve tudo. O filtro "Caixa ligado" da lista passa a contar só quem tem o Caixa no plano.
- Mensagens pré-pagas: mensagem cancelada no atendys antes de sair (por exemplo, presa no horário de silêncio e cancelada) volta ao saldo do negócio e aparece como não enviada. Antes o aviso de cancelamento era ignorado e a mensagem seguia cobrada.
- SMS por negócio configurável no /admin (gaveta, SMS para os clientes): "Sempre, junto com o WhatsApp" (como era) ou "Só quando o WhatsApp não puder avisar". No modo reserva o SMS de confirmação e de lembrete só sai para cliente sem aceite de WhatsApp, negócio fora do canal oficial (ou pausado pela Ruphus), ou quando o aviso pelo WhatsApp falha de vez — aí na hora da falha. Evita pagar o mesmo aviso duas vezes.
- Agenda no celular: o "…" fica no canto do horário (sozinho numa linha deixava um vão no cartão) e a linha de botões some quando não há botão. Remarcar: data por extenso embaixo do campo, "Ver dia seguinte" quando não há horário livre, botão só com horário e alvos de toque maiores.
- WhatsApp (QA de 10/11 em produção): a frase do último aviso que não saiu não termina mais com dois pontos ("painel.."); horários de confirmação do dono e da última falha aparecem no horário de Brasília, também para quem usa o painel em outro fuso.
- WhatsApp oficial com o wa.me de reserva: no canal oficial, "Confirmar pelo WhatsApp" e "Cancelar horário" avisam o cliente que aceitou o WhatsApp pela API, sem abrir aba e sem esperar o envio ("Avisando o cliente pelo WhatsApp…"; no pré-pago custa como os outros avisos). Sem saldo, a faixa oferece "Avisar pelo WhatsApp". Aviso automático ao cliente que não chegou (recibo, confirmação, cancelamento, lembrete; recusa da Meta, sem saldo, número inválido, SAIR) deixa o horário com "Aviso não chegou" e "Enviar pelo WhatsApp" na agenda, em tempo real; um aviso posterior que sai tira o selo, e ele some 3 dias depois. Cliente que pediu SAIR aparece com o motivo, sem o botão. Erro passageiro (limite, serviço fora do ar) não marca. O push da falha abre a agenda. No agendamento online, se o negócio não recebe o pedido pelo WhatsApp automático, "Avise {negócio} pelo WhatsApp para confirmar" vira a ação principal. O Pix pelo WhatsApp da agenda e do Caixa abre a conversa com o cliente.
- Admin: desligar o canal oficial de um negócio pausa o WhatsApp dele de verdade: salvar o WhatsApp no painel do dono não religa mais (Meu negócio mostra "WhatsApp pausado pela Ruphus"); só ligar de novo no /admin tira a pausa.
- WhatsApp só pela API oficial: todos os avisos (pedido ao dono, recibo, confirmação, cancelamento e lembrete ao cliente) saem pelo número da Ruphus, no canal oficial. Saem o número próprio do salão pareado por QR (com a faixa "Seu WhatsApp desconectou", a vigia de conexões e o envio de Pix e de aviso ao cliente por ele: a agenda e o Caixa abrem o WhatsApp do aparelho) e a Central de conversas (`/{slug}/conversas`). Fora do canal oficial nenhum WhatsApp sai, só o push de novo agendamento. Na gaveta do /admin, a aba WhatsApp mostra o canal oficial: ligar/desligar, o WhatsApp do dono, se ele confirmou ("Sou eu"), trocar o número e reenviar a confirmação.
- Mensagens pré-pagas: a confirmação do WhatsApp do dono ("Sou eu") não custa mais ao negócio e sai mesmo sem saldo, como o aviso de saldo baixo: são mensagens da Ruphus sobre a plataforma. No Consumo ela aparece como "Confirmação do seu WhatsApp".
- Consumo (QA de 10/11 em produção): a previsão do saldo não promete mais "203 meses" ou "6090 dias" com um único dia de consumo (acima de 3 meses diz "mais de 3 meses"; a faixa só mostra os dias até 30); "1 entregue · 1 lida" e "1 falhou" no singular; falha com o código técnico vira "recusada pelo WhatsApp", "número sem WhatsApp" e afins; o CSV leva data e hora completas; o gráfico por dia é legível no celular e abre no dia de hoje, com o eixo em números inteiros; o caminho das mensagens tem texto de tamanho normal no celular; as abas cabem na tela do celular; "Saldo de mensagens" no lugar do rótulo repetido; "Consumo em" quando não há cobrança; "Por tipo" vazio diz que não há mensagens.
- Recarga: a barra mostra quanto resta do saldo depois do último crédito (antes dava "152% do último crédito"); "indicado para o seu mês" só aparece com consumo para basear a conta; o Pix gerado entra na lista de "aguardando confirmação" na hora.
- Admin: o saldo de mensagens da gaveta se atualiza logo depois da baixa de uma recarga.
- Mensagem ao cliente bloqueada por falta de saldo não aparece mais como erro no log do servidor (o dono vê no Consumo).
- Mensagens pré-pagas: cada WhatsApp e SMS que a Ruphus envia em nome do negócio fica registrado com o preço do momento (WhatsApp R$ 0,05 por aviso, resposta a quem escreveu grátis, SMS R$ 0,12) e, no pré-pago, sai do saldo do negócio. Falha devolve o valor; mensagem parada na cota não cobra. Negócio novo ganha R$ 10,00 de boas-vindas; negócio que já existia segue sem desconto até receber um crédito. Sem saldo, os avisos aos clientes param e o pedido ao dono e o lembrete do dia continuam (#316).
- Painel do dono: tela Consumo (`/{slug}/consumo`) com o saldo, as mensagens do mês, a entrega e a leitura do WhatsApp, o caminho das mensagens, o custo por canal, quando os clientes leem, o gráfico por dia e as abas Por tipo, Todas as mensagens (filtros, busca e CSV) e Extrato.
- Painel do dono: recarga por Pix em `/{slug}/consumo/recarga`, com os pacotes do admin, valor livre a partir de R$ 10,00, QR e copia e cola na tela; o mesmo valor ainda em aberto devolve o mesmo Pix. O saldo entra quando a Ruphus confirma o pagamento, com recibo por e-mail.
- Painel do dono: faixa no topo quando o saldo de mensagens fica baixo ou acaba, com "Recarregar". Aviso também por push, e-mail e WhatsApp do dono (uma vez por recarga).
- Admin: na gaveta do negócio (aba Cobrança), o saldo e a previsão, cobrar ou não cobrar só aquele negócio, preço próprio, crédito ou débito manual com motivo e o extrato. Em Ajustes, os preços, os pacotes e a regra sem saldo, mais o "Saldo por negócio".
- Admin: recarga paga cujo crédito falhar depois da baixa avisa por e-mail e na tela (antes ficava paga sem saldo); recarga em aberto não marca o cliente como cobrança atrasada.
- WhatsApp: cliente que respondeu SAIR e depois marca de novo o aceite num agendamento volta a receber as mensagens. Antes o novo aceite era recusado e nada chegava. Mensagens de agendamentos anteriores ao SAIR continuam sem sair.
- Webhook do atendys: só a assinatura v2 (com horário) é aceita. Aviso só com a assinatura antiga é recusado, e um aviso capturado não pode ser reenviado depois de 5 minutos.
- WhatsApp do negócio: comando do dono com erro de digitação ("CONCFIRMADO", "confimado") ou só com o código do agendamento recebe "Não entendi. Para confirmar, responda CONFIRMADO <código>; para recusar, RECUSAR <código>." Antes era ignorado em silêncio, e o dono achava que tinha confirmado.
- WhatsApp do negócio: mensagem que o atendys marcou como falha e depois confirmou como enviada não mostra mais o código de erro antigo.
- Webhook do atendys: passa a aceitar a assinatura v2 (com horário, recusada depois de 5 minutos), que impede reenviar um aviso capturado. A assinatura atual continua valendo até o atendys mandar só a v2.
- WhatsApp do negócio: CONFIRMADO/RECUSAR do dono voltam a funcionar em número de conta antiga (registrado no WhatsApp sem o 9º dígito). Desde 08/11 o atendys manda o telefone sempre com o 9 e o ruphus.site comparava com o número gravado sem ele: o comando era ignorado em silêncio. Telefones de celular passam a ser tratados sempre com o 9, como no atendys.
- Agendamento sem o aceite do WhatsApp: a tela não promete mais "confirma pelo seu WhatsApp"; diz "confirma o horário com você". Sem o aceite, nada sai pelo WhatsApp automático.
- Sites no modelo editorial: o bloco "Tabela de preços" não diz mais "Valores sob consulta / o estabelecimento não publica a tabela" (a agenda online e a bio mostram os preços); leva à agenda com "Ver valores e horários →".
- Admin: as abas Clientes e Cobrança não mostram mais a barra de visões da Lista com todos os contadores em 0 (Todos, Atrasados, Em negociação). Os contadores só existem na Lista e no Funil.
- Agendamento online: WhatsApp com DDD que não existe (20, 10, 23…) passa a ser recusado com "DDD inválido", na tela e no servidor. Antes só o DDD começando com 0 era barrado.
- Histórico do horário: "Sinal recebido" aparece como "Sinal recebido, confirmado por …". Antes saía "Confirmado pelo WhatsApp", sem ter passado pelo WhatsApp.
- Agendamento com sinal: o evento do Google Agenda diz "sinal de R$ X por Pix, o resto no local", como a tela. Antes dizia "pago no local".
- Demonstração: a restauração da madrugada não cria mais um "Negócio criado" por dia na linha do tempo do admin (a entrada do dono da demo mantém a data original).
- Etiquetas do cliente: "vip" e "VIP" são a mesma etiqueta; a repetida não entra e o campo limpa.
- Funil: o cartão "Em negociação" passa a "Em aberto" (oferta enviada + negociando), para não confundir com a visão "Em negociação" da Lista (só negociando); "Taxa de ganho" diz o período dos fechados e perdidos.
- Painel do dono: quem abre um link do painel sem estar logado (aviso de agendamento, favorito) volta para essa tela depois de entrar, como já acontecia no admin.
- WhatsApp do negócio: sai o "Teste rápido" do painel (Meu negócio). Cada teste gastava uma mensagem da cota diária do número, que é a mesma dos lembretes e avisos aos clientes.
- Mensagens do WhatsApp aguardando decisão: ao abrir a agenda, cada uma é conferida no WhatsApp do negócio (atendys); só fica a que ele ainda segura. Vencida, de conta reconectada ou desconhecida sai da lista.
- Mensagens do WhatsApp aguardando decisão: as vencidas saem do painel. O WhatsApp do negócio (atendys) só guarda a mensagem parada por 24 horas; depois disso "Enviar agora" e "Manter agendada" eram recusados e o painel mostrava o erro em vermelho. Agora a validade fica registrada junto com a mensagem, a lista só mostra as que ainda servem e, se o atendys recusar por vencimento, a mensagem sai da lista com o aviso "Esta mensagem não pode mais ser enviada".
- Modelo "Salão infantil" (3 variações) para salões de beleza: fotos de criança no salão, cores alegres (coral, turquesa, amarelo-sol), rótulo "Salão infantil" e frases e serviços padrão de criança (corte infantil, primeiro corte, tranças). Fotos e cores só entram pelo modelo: o sorteio dos outros salões não muda.
- Modelo editorial (beleza, fitness, automotivo): a segunda linha do nome no topo (em itálico, na cor do modelo) fica legível sobre a foto. Paletas de marrom, vinho, verde e azul escuros clareiam só ali até contraste 3,5:1 ("Estrelas" no Barbeiro das Estrelas, "Moura" na Podóloga Alessandra Moura). O modelo claro passa à mesma régua.
- Modelo claro (aulas, saúde, pet): o destaque do título, o selo e as estrelas do topo ficam legíveis sobre a foto. As paletas de azul e verde-petróleo escuros (idiomas, cursos, pet shop) clareiam só no topo até contraste 3:1; o resto da página segue com a cor da paleta.
- Ramo lido do nome mais certeiro: "Bárbara", "Barbie" e "Cunha" não viram barbearia/unhas, "Absoluta" não vira luta, "Encanto/Recanto" não vira música, "Personalizada" não vira academia, "Pétalas/Petit" não vira pet shop, "Status" não vira tatuagem, "Oficina da Beleza" não vira oficina, "Auto Estética" é lava-jato, martelinho de ouro é oficina. Com categoria genérica de clínica, vale a especialidade do nome ("Clínica … Estética Avançada" é estética, não clínica médica). scripts/corrigir-ramos.mts corrigiu 298 sites de prospecção que estavam no ramo errado (255 clínicas de estética no modelo de clínica médica, 15 estéticas automotivas, 13 cursos, entre outros).
- Gaveta do Site: o seletor de modelo ocupa a linha inteira e "Prévia" e "Aplicar modelo" dividem a de baixo; antes o "Aplicar modelo" passava da borda da gaveta.
- Troca de modelo de verdade na hora: o site e a imagem do link (prévia do WhatsApp) passam a ser montados a cada visita. Com o cache, o revalidatePath do Next 16 não derrubava a página guardada e o site seguia com o modelo velho por até um minuto (a imagem, até uma hora).
- Imagem do link com cache curto (um minuto na Cloudflare): sem cabeçalho, a Cloudflare guardava o .jpg por horas.
- Prévia do WhatsApp dos 645 sites convertidos da fábrica: sai do modelo do site, não mais da imagem antiga da fábrica que tinha ficado no Storage.
- Painel no celular: a opção de instalar não some mais depois do "Agora não". Em Meu negócio ela fica fixa; quando o navegador não oferece o botão de instalar, explica o caminho pelo menu (⋮ → Instalar app ou Adicionar à tela inicial).
- Avisos de agendamento: ficam fixos em Meu negócio, para ligar ou desligar depois do "Agora não". Bloqueados no navegador, a tela diz como liberar; no iPhone sem o painel instalado, diz que é preciso instalar.

- Troca de modelo (e qualquer edição do site pelo admin ou pelo painel): o site, a imagem do link e a bio mostram a mudança na primeira visita. Antes, a primeira visita depois de "Aplicar modelo" ainda recebia a página antiga (o cache do Next 16 serve a cópia velha enquanto monta a nova); agora o servidor faz essa visita logo depois de gravar. "Ver o site" e "Bio" na gaveta abrem a versão nova direto.

- Gaveta do Site: "Aplicar modelo" pede a confirmação ali mesmo, embaixo do botão ("Trocar o modelo de … para …?"), em vez do diálogo solto que não aparecia e deixava o clique sem efeito; o botão da prévia vira "Prévia" e não quebra em três linhas.
- Nome comprido (o do Google com cidade e marcas): título do topo menor, nome do cabeçalho cortado com "…" (uma linha no computador, duas no celular) e o selo do ramo não fica mais embaixo do cabeçalho.

- Fotos sem máscara nas consultas: nova capa de clínica médica (médico sem máscara conversando com a paciente) e novas fotos de veterinária (duas capas e uma da página); a capa da mesa de exame da veterinária também foi trocada, com o veterinário fora do texto.

- Sites gerados (todos os modelos): "Agendar online" vira o botão da marca Ruphus — branco, com o R e o ponto amarelo pulsando no canto, e "Escolha em até 30 segundos"; igual em todos os sites, qualquer que seja a paleta. Seta fixa no canto esquerdo para voltar ao topo, que aparece depois de rolar. Itens do menu com ícones padronizados (os mesmos nos dois modelos).
- WhatsApp sem repetição: sai o "Falar no WhatsApp" do topo da página e o botão de WhatsApp do cabeçalho; fica o botão flutuante (e o do menu no celular, no modelo claro).
- Celular: a página não fica mais larga que a tela em aparelho de 320px (mapa e "Traçar rota" do modelo editorial); a tabela de valores do modelo claro vira cartões em vez de rolar de lado; "Ver serviços" não fica mais embaixo do WhatsApp flutuante.
- Capas novas da dança-3 e da podologia-3; a podologia-3 passa ao verde-água (o destaque em petróleo sumia sobre a foto).

- Modelos de site: fitness (academia, pilates, lutas, dança) e automotivo (oficina, estética automotiva, pneus) ganham 3 modelos por ramo na gaveta do Site, com um terceiro conjunto de fotos novo para cada um; a foto de capa da academia-2 foi trocada. Aulas ganham mais um modelo por ramo (nova foto de capa). A lista de modelos da gaveta mostra só os do nicho do negócio: oficina não recebe mais modelo com foto de salão.
- Nicho: "Day spa" passa a ser estética, e os sites convertidos da fábrica passam a gravar o nicho junto com o ramo (scripts/migrar-nicho.mts completa os que ficaram sem).

- WhatsApp do negócio com cota do dia (atendys): mensagem parada (awaiting_manual) não aparece mais como enviada. Na agenda e no Pix, o dono vê "A cota diária foi atingida. Envie agora pelo WhatsApp ou mantenha a mensagem agendada." — "Enviar agora" abre o WhatsApp só depois que o atendys confirma a ação manual; "Manter agendada" mostra a hora em que sai, no fuso do negócio. Mensagem na fila mostra a hora de saída em vez de "enviada".
- Envios sem ninguém olhando (lembrete, aviso de agendamento, robô de confirmação) parados na cota voltam sozinhos à fila quando ainda saem antes do horário; senão aparecem na agenda em "mensagens do WhatsApp aguardando decisão". O status das mensagens paradas chega pelo webhook (assinatura conferida pelo negócio da mensagem).

- Agenda: depois de "Recebi", o aviso sempre traz "Recibo"; se a lista ainda não mostrou o recebimento, o recibo lê direto do banco. Escuta do banco que cai (erro passageiro) tenta de novo até 3 vezes e deixa o erro no console, em vez de congelar a tela até recarregar.

- Recibo por e-mail pela plataforma: "Enviar" manda o recibo no formato do cupom, de contato@ruphus.site com o nome do negócio, sem abrir o app de e-mail do aparelho. O servidor monta o recibo do banco.
- Recibo: o sinal pago hoje para um horário que ainda não foi atendido não entra mais no recibo da visita de hoje (o total saía somado a mais).

- Vale: o profissional com % de comissão aparece em Comissões mesmo antes de faturar no mês, para receber vale no dia 1; o aviso de e-mail vazio fala do profissional (não do cliente); o recibo diz "pagos em dinheiro".

- Caixa: "Lançamentos do mês" ganhou Tudo / Entradas / Saídas, com o total de cada lado. Contas fixas, compras, comissões e vales ficam em Saídas, longe dos atendimentos.

- Vale para o profissional: em Comissões, "Vale" paga parte da comissão em qualquer dia, mesmo com o mês já pago. Sai do Caixa como saída de hoje e é descontado sozinho do próximo pagamento de comissão (o que passar dele fica para o seguinte). A confirmação vai sempre por e-mail ao profissional; o recibo para ele assinar é opcional, logo depois de registrar.

- Fuso do negócio: no cadastro e em "Meu negócio", "Definir fuso automaticamente pela UF" vem marcado e usa o fuso do estado (todos os 27 com fuso próprio, como Belém para PA e AP). Desmarcado, o dono escolhe outro fuso do Brasil, para quem atende de uma central noutra região. O fuso vale para o "já passou" do link de agendamento, os lembretes e o SMS.

- Aviso no topo da agenda some sozinho: o só de texto em 6 segundos; o que tem botão (Avisar pelo WhatsApp, Recibo) em 20 segundos. "Fechar" continua fechando na hora.

- Privacidade dos valores: um olho ao lado do título da Agenda, do Caixa e de Clientes esconde os valores em dinheiro ("R$ ••••") para atender com o cliente do lado. A escolha fica neste aparelho e vale para as três telas.

- Recibo pela agenda: depois de "Recebido", o aviso no topo traz o botão "Recibo" (imprimir, WhatsApp ou e-mail, o mesmo do Caixa), e o menu de cada horário já recebido ganha "Recibo".

- Pix do atendimento pelo WhatsApp do negócio: com o WhatsApp conectado, "Enviar por WhatsApp" no QR do Pix manda o código direto ao número do cliente do horário. Sem conexão, ou se não sair, abre o WhatsApp do aparelho como antes.

- Agendar pelo link: o dono escolhe em "Meu negócio" quantos serviços (até 10; padrão 5) e quanto tempo somado (até 8 h; padrão 4 h) o cliente marca de uma vez. Na página, o serviço que passaria do limite fica apagado e diz por quê, com o contador "3 de 5 escolhidos"; o servidor recusa a reserva que passa. Um serviço sozinho mais longo que o limite continua valendo. Pelo painel não há limite.

- Aviso ao cliente pelo WhatsApp do negócio: o painel diz só qual aviso é (confirmado, cancelado, remarcado) e o servidor monta o texto a partir do horário, recusando aviso que não bate com o estado (ex.: "confirmado" de um horário cancelado) ou de horário que já passou. Sem conexão no meio do envio, o painel não afirma que a mensagem não saiu: pede para conferir antes de mandar de novo. Na demonstração, vai direto ao WhatsApp do aparelho.

- Convite da equipe: o link aparece na hora; o e-mail sai depois da resposta, sem esperar o provedor. E-mail e mensagem de WhatsApp usam o mesmo texto.

- Página não encontrada nos sites dos negócios: com o nome, as cores e a fonte do próprio site, e os botões "Ir para o início do site" e "Agendar horário".

- Agenda do painel no celular: a faixa da semana volta a mostrar "livre" ou o número de horários de cada dia ("4 hor.").

- Agendar pelo link, no celular, em 3 toques: o serviço já mostra os 3 horários mais cedo logo abaixo dele; "com quem", "outro dia" (semana com setas, número de vagas embaixo de cada dia, horários em Manhã/Tarde/Noite) e a confirmação abrem em folhas por cima da página. Novos casos: horário pego por outra pessoa enquanto confirmava (aviso e os 3 próximos livres, um toque para pegar), semana sem vaga (semana seguinte, qualquer profissional ou pedir encaixe no WhatsApp), "repetir o último" para quem já agendou neste aparelho, e pílula "Ver horários" quando a lista de serviços é longa. O Pix do sinal ganha um relógio discreto (mm:ss) que fica âmbar nos últimos 5 minutos.

- Landing: seção "Pelo Brasil", com o mapa dos sites prontos por estado (dica com o número, os 8 estados com mais sites e o total). Os números vêm do catálogo ao vivo (`/api/catalogo` passa a trazer `ufs`), relido a cada 6 h: site novo entra no mapa sozinho.

- Landing: os sites da busca e da grade "Alguns deles" abrem numa aba nova; a landing fica aberta para o visitante voltar e contratar. Comparativo refeito: ícones consistentes (tem · depende · não tem) com nota curta, linha "Quanto custa" e, no celular, um cartão por recurso em vez de rolar para o lado.

- Landing mais comercial: manchete pelo resultado ("Agenda cheia, menos falta"), preço e "sem taxa por agendamento" já no topo, selos de garantia junto da busca, nova seção com as três dores do dia a dia e o que muda, calculadora de quanto a falta custa por mês, comparativo com WhatsApp/caderno e app de agendamento comum, foco em beleza no lugar de "PMEs" e "fábrica", e duas perguntas novas (taxa por agendamento e tipos de negócio).

- /painel: a lista de negócios da conta vem do servidor, não do cache do Firestore no navegador. Com várias abas abertas o cache às vezes recusava ("Erro: failed-precondition") e a tela parava em "Não foi possível carregar os seus negócios"; o /painel também deixa de baixar o Firestore.

- Equipe na agenda: quem entrou pelo convite de um profissional continua vendo a agenda toda, mas só confirma, remarca, cancela ou marca falta nos horários dele, e só cria ou encerra plano recorrente na própria agenda (sem "Qualquer um"). Os botões dos horários dos outros somem, e o servidor e as regras recusam. Quem gere segue mexendo em tudo.

- WhatsApp que cai sem o aviso do atendys chegar: de hora em hora o servidor confere toda conexão que consta como conectada; a que caiu ganha a faixa no painel e o aviso no celular do dono, mesmo sem lembretes ligados nem agendamento novo.

- Admin: a aba Gerador saiu (os leads novos vêm da Coleta). Planilha, só por `npm run gerar:sites`.

- Plano recorrente: dia aberto sem vaga aparece como "sem vaga", não "fechado"; apagar o número de semanas para digitar outro não vira "1" no meio; no celular, os primeiros 12 horários e "Ver todos"; o resumo mostra o valor ("até 12 atendimentos · R$ 420,00"); com "Qualquer um", a semana em que o profissional do primeiro dia está ocupado vai para outro livre no mesmo horário, em vez de ser pulada (a tela de confirmação diz quais).

- Ajustes: campo opcional vazio (Gmail de reserva, endereço de contato, e-mail de alertas) aparece como "Opcional · não configurado", em cinza, não como erro; no teste de e-mail, o canal fica numa linha própria e o destinatário ganha espaço.

- Admin, gaveta do site → Visual: Tinta e Destaque lado a lado e a fonte dos títulos numa linha inteira embaixo. Em tela grande a gaveta punha três colunas espremidas e o seletor de fonte passava da borda.

- Ajustes do /admin: cada serviço mostra se a chave está **válida**, **com problema** (e por quê: recusada, sem saldo, domínio não verificado…) ou **não configurada**, conferido ao vivo sem enviar nada nem gastar crédito (saldo da Comtele, domínios do Resend, login do Gmail, atendys, Anthropic), com "Verificar de novo". Novos testes de envio: e-mail, escolhendo o canal (automático, só Resend, só Gmail), e alerta. Novo ajuste "Endereço de contato" (ex.: contato@ruphus.site): é o "responder para" dos e-mails e o remetente do Gmail de reserva (o endereço precisa estar em "Enviar e-mail como" na conta do Gmail).

- Equipe sem o WhatsApp pessoal do dono: o número que recebe os avisos de agendamento sai do documento do negócio (que a equipe lê pelo navegador) e vai para a área que só o servidor lê; o dono e o admin continuam vendo e editando. Rode `npm run mover:segredos-whatsapp -- --aplicar` uma vez para mover os que já estão gravados.

- Segurança (revisão de isolamento entre negócios — nenhuma falha entre negócios encontrada): na demonstração, cuja senha é compartilhada, os dados do negócio, o Pix, o sinal e o recado não mudam mais (aparecem no site público e virariam isca de golpe até a restauração); a conta da demo é restaurada pelo uid guardado, e trocar o e-mail dela não a deixa viva com outra senha; "encerrar sessões" do admin da plataforma passa a valer também nas regras do Firestore, na hora.

- WhatsApp desconectado não passa mais calado: faixa "Seu WhatsApp desconectou" no topo de todo o painel (para quem gere), com o botão Reconectar; aviso no celular do dono na hora em que a conexão cai; em Meu negócio → WhatsApp, o último aviso ou lembrete que não saiu (antes só o /admin via) e o texto "A conexão caiu" junto do QR. Reconectar limpa a falha antiga.

- WhatsApp (atendys), revisão da integração:
  - A demonstração não conecta WhatsApp e nenhum envio sai dela (recibo, lembrete, confirmação, teste), mesmo com conexão esquecida no documento: ela é aberta a qualquer pessoa e os clientes de exemplo têm números de verdade.
  - Opt-in honesto: o teste rápido do dono não registra consentimento (sem opt-in, a tela diz que o número não autorizou); o recibo do agendamento online registra que o número foi digitado no link do negócio; os demais envios, que o cliente tem horário no negócio.
  - Erros do atendys viram frases claras (número inválido, sem WhatsApp, sem autorização, desconectado, muitas mensagens); o corpo cru da resposta fica só no log do servidor.
  - Webhook: assinatura sem formato de HMAC é recusada antes de ler o banco; status de conexão reentregue fora de ordem não desfaz um mais novo.
  - Recuperar a credencial revoga as chaves antigas emitidas pela Ruphus; reconectar busca o tenant pelo id em vez de baixar a lista inteira; o nome da instância vem da resposta do atendys.
  - Código do agendamento no "CONFIRMADO AB12" cresce quando dois agendamentos começam com as mesmas 4 letras.

- Caixa: os avisos de apagar recebimento e de "Não veio" usam o nome novo da lista ("A receber da agenda") no lugar de "fechamento do dia".

- Caixa: lançamento sem cliente nem descrição não repete a categoria ("Atendimento" em cima e "Atendimento · Pix" embaixo); embaixo fica só a forma de pagamento.

- Caixa: no celular, o "Sobrou" ocupa a linha de cima, maior, e Entrou/Saiu dividem a de baixo (três cartões estreitos partiam "R$ 12.345,00" no meio); no computador, os botões + Entrada / − Saída ficam do tamanho do texto; "Fechar o dia" virou "A receber da agenda" (a lista inclui dias anteriores); o texto de mês vazio não quebra mais entre o "−" e "Saída".

- Detalhes do QA: no agendamento, depois de tocar em Confirmar, o WhatsApp incompleto ("faltam N dígitos") fica marcado como inválido também para leitor de tela; em Serviços, a chave de um serviço que ninguém faz fica apagada e se chama "Mostrar … no link" (antes dizia "aparece no link" sem aparecer); com a agenda desligada, a aba do /agendar se chama "Serviços e preços" em vez de "Agendar online".

- Demonstração: a restauração diária desconecta o WhatsApp (despareia no atendys e limpa a conexão, mantendo o aceite do termo). Antes ela apagava só a credencial, e o painel mostrava "conectado" com o teste de envio dizendo "ainda não está conectado". A demo é compartilhada: um número conectado nela mandaria mensagem em nome de quem conectou.

- Agendamento online desligável: em Meu negócio, a parte "Agendamento online" ganhou a chave "Receber agendamentos pelo link". Desligada, a bio troca "Agendar online" por "Falar no WhatsApp" (e os serviços levam ao WhatsApp), e o link de agendamento, que o site ainda aponta, mostra a lista de preços com o botão do WhatsApp em vez da grade. A reserva pela API também é recusada. Para quem só quer mostrar serviços e preços.

- Meu negócio: o WhatsApp saiu da lateral e entrou na coluna principal (Dados, Recado, WhatsApp, Pix, Sinal); a lateral ficou só com a prévia e os links, fixa ao rolar. Com o WhatsApp conectado, a lateral passava da coluna de Dados e sobrava um vão em branco. Atalho "WhatsApp" no topo, no celular.

- Teste rápido do WhatsApp no painel: número sem o 55 (como todo mundo digita) ganha o DDI antes de enviar.

- WhatsApp (atendys): nenhum envio saía — o atendys exige o cabeçalho `instance` no envio e `evidence` no opt-in, e o cliente não mandava nenhum dos dois (400 em todo aviso, recibo, lembrete e resposta). Corrigido; o teste `npm run test:atendys` agora simula o contrato real e cobre o webhook. Também: o webhook aceita `message.status` com 200 (antes 400, e o atendys repetia 5 vezes cada um) e a entrega repetida da mesma mensagem recebida deixa de dar erro 500.

- Bio: o horário do dia e o "aberto agora" vêm da equipe toda (abre com o primeiro, fecha com o último). Antes valia só o primeiro profissional cadastrado, e a demo dizia "09h — 18h" com gente atendendo até 19h. Os "horários livres" da bio também passam a considerar qualquer profissional.

- Link errado dentro do site do negócio (ex.: `negocio.ruphus.site/pagina-que-nao-existe`) abre a página "Página não encontrada" com caminho de volta para o início do site, no lugar do texto solto "Arquivo não encontrado".

- Pet shop: a foto do topo do primeiro modelo era de um balcão no exterior; agora é uma tutora brasileira com o cão (`br-tutora-pit`). Vale para todo site de pet shop que usa esse modelo.

- Clientes de exemplo dos modelos claros: `npm run exemplos:nichos -- --aplicar` cria (ou atualiza) um site por ramo de pet, saúde e cursos (`exemplo-petshop`, `exemplo-vet`, `exemplo-odonto`, `exemplo-fisio`, `exemplo-psico`, `exemplo-nutri`, `exemplo-clinica`, `exemplo-cursos`), em Macapá, com telefones de teste e fora do funil, como a demonstração.

- Modelos e seção Visual também para pet, saúde e aulas: na aba Site, o seletor de modelo (foto do topo + paleta, um por foto do ramo) e a seção Visual (fotos próprias, cores, fonte, textos e chat com IA) passam a valer no modelo claro. Tinta e destaque viram as cores principal e de realce do site; o Sobre próprio ganha uma seção; o topo, a galeria, a bio e a imagem do WhatsApp usam as fotos enviadas. Sites já no ar não mudam nada até o admin publicar.

- Ramo novo em Aulas e cursos: **Cursos profissionalizantes** (informática, beleza, gastronomia, elétrica, costura…), com kit de fotos próprio, textos, FAQ e serviços padrão. "Escola de cabeleireiro" e "curso de manicure" caem nele, não no salão.

- Sinal fixo maior que o preço do serviço: a página dizia "sinal de R$ 15,00 (R$ 20,00)" e "o resto é pago no local" sem sobrar nada. Agora o valor fixo não aparece entre parênteses e, quando o sinal cobre o serviço todo, a tela diz isso. O botão "Enviar comprovante" ganhou margem interna (o texto encostava na borda).

- Depois de agendar, a tela diz "pedido enviado" e mostra o caminho em três passos: horário guardado, o que falta agora (o salão confirmar pelo WhatsApp, ou pagar o sinal por Pix até o prazo) e o horário confirmado. Antes o ✓ verde de "horário reservado" parecia confirmação, e com sinal o "aguardando o sinal" convivia com o "vai te chamar para confirmar".

- Abuso e manutenção: o limite de agendamentos por aparelho conta o IPv6 pelo /64 (trocar o fim do endereço não abre mais um limite novo, e com ele o disparo de recibos pelo WhatsApp do salão). Histórico e notas só levam o e-mail de quem o confirmou, nas regras do Firestore e no painel. O CI passa a rodar o `tsc` (erro de tipo só aparecia no build da VPS). `shadcn` e tipos saem das dependências de produção.

- Visual do site pelo /admin: na aba Site de um site do gerador (modelo editorial) há a seção **Visual**: fotos próprias do negócio por posição (topo, três da galeria e a faixa da bio), enviadas do celular ou do computador e redimensionadas no servidor; tinta e destaque com seletor de cor; fonte dos títulos; frase do topo, Sobre e título da galeria. Tudo fica num rascunho com pré-visualização e só entra no site, na bio e na imagem do WhatsApp em "Publicar visual". Reenviar a planilha, editar os dados ou trocar o ramo não apaga a personalização. Com a chave da Anthropic em Ajustes, um chat na mesma seção propõe cores, fonte e textos a partir do pedido e das fotos; o admin marca o que entra e vê a prévia antes de publicar.

- Sites da fábrica acabaram: os 11 que restavam no Storage foram ao modelo do gerador (650 ao todo, com o HTML original guardado em `fabrica-backup/`). "Selagem", "progressiva" e "alisamento" contam como salão, "harmonização" como estética.


- UX: endereço que não existe dá 404 de verdade, com página em português (antes `/qualquer-coisa` respondia 200 e o Next mostrava erros em inglês); erro numa tela oferece "tentar de novo". Depois de reservar, o foco vai para o dia reservado. Só o painel segue o modo escuro do sistema (agendar e admin ficavam com fundo e campos escuros por baixo). O app instalado ganha service worker novo a cada versão e já na primeira abertura. A faixa "Sem conexão" não cobre mais as abas no celular. Gaveta do /admin fecha no Esc e não deixa o fundo rolar; sair do /admin cancela os avisos e limpa o cache. Totais do Caixa cabem em 320 px, confirmações longas rolam, mensagens de erro sem inglês, e menos movimento para quem pediu isso no sistema. Serviço sem profissional aparece como "fora do link" no painel. Avisar o cliente ao cancelar abre o WhatsApp em aba nova sem tirar o painel da tela. Desmarcar o único serviço no agendamento volta ao começo.

- Desempenho: a agenda pública lê o catálogo uma vez e os agendamentos da semana numa consulta (eram dezenas de transações a cada troca de serviço). No AC e no AM os horários da noite não somem mais (o "hoje" é o do negócio). Fotos e arquivos compartilhados dos sites saem em stream e ficam um dia em cache; o "fora do ar" dos arquivos é lido uma vez por minuto. O proxy busca as listas no próprio servidor e atualiza em segundo plano. O índice do /admin monta quando o servidor sobe. Lembretes por WhatsApp e SMS vão de 5 negócios em 5.

- Segurança: toda resposta sai com HSTS, `nosniff`, `X-Frame-Options: SAMEORIGIN` e `Referrer-Policy` (o /admin e o painel não abrem mais dentro de site alheio). Site da fábrica aberto direto em `www.ruphus.site/s/…` vai para o subdomínio dele, fora da origem do login. "Pedir remoção" tem teto de 20 por dia na plataforma, e o catálogo público só conta quem saiu do ar se está na vitrine da landing. A faixa "Sem conexão" não fica mais presa no iPhone com iOS 15, e a trava de agendamentos não desliga mais em produção.

- Mensagens prontas do /admin não põem mais "o" antes do nome de quem assina (saía "Aqui é o Fernanda").

- Campo "Ramo" (aba Site do /admin, Meu negócio e cadastro no painel) não alarga mais a tela no celular: o nome mais longo da lista empurrava o formulário 30 px para fora.

- Agendamento público não mostra mais serviço que ninguém da equipe faz (o cliente escolhia e via todos os dias "fechado"). No /admin, mudar a etapa de um negócio sem CRM ainda deixava um erro no console e não atualizava a linha do tempo.

- /admin no celular: a linha de filtros alargava a página, e a gaveta do negócio saía da tela (o × e a borda direita cortados). A barra de ações fica no pé da gaveta mesmo com pouco conteúdo, e a miniatura do site usa a imagem de compartilhamento quando não há captura.

- Histórico do negócio no /admin: notas, mudanças de estágio e mensagens mostram "por Ruphus" em vez do e-mail da conta de admin, que aparecia embaixo do destinatário e parecia ser ele.

## 0.16.0 — 02/11/2026 — SMS completo, atendys mais robusto e agendamento mais leve

- QR do WhatsApp volta a aparecer (no /admin e no painel do dono): a imagem vinha com o prefixo `data:` e era prefixada de novo. Abas da gaveta do negócio com ícone em cima do nome. O termo de risco do WhatsApp fica só para o dono, no painel dele; a gaveta do admin mostra se foi aceito.

- Gaveta do negócio no /admin: a barra de ações (WhatsApp, Anotar) encosta na borda de baixo, sem o conteúdo aparecendo por baixo dela; as 7 abas cabem na gaveta no computador, e no celular um esmaecido na borda avisa que há mais abas, com a aba tocada rolando para a vista.

- WhatsApp (atendys) mais robusto: reconectar não troca mais o segredo dos webhooks (antes, uma falha na gravação deixava o negócio sem receber mensagens nem CONFIRMADO); lembrete do WhatsApp que falha aparece na gaveta do negócio e vira e-mail para o admin; a integração ganhou testes. Restos do nome antigo (wtsfy) trocados por atendys.

- SMS configurável por negócio no /admin: ligar a confirmação e o lembrete separadamente e escolher quantas horas antes vai o lembrete (1 a 24 h). Sem escolha, segue como antes: os dois ligados, lembrete 2 h antes.

- SMS que falha não chega mais como erro a ninguém: o admin recebe um e-mail com o agendamento e o motivo (no máximo um a cada 6 h, contando as repetições). Ajustes ganha **E-mail para alertas do sistema**; sem ele, o aviso vai para a conta do Gmail.

- Teste de SMS nos Ajustes com máscara de celular, aviso em tempo real (sem DDD, DDD inválido, fixo) e botão liberado só com número válido.

- Fontes e scripts não baixam mais duas vezes na primeira visita (~125 KB a menos), e a aba aberta antes de uma publicação volta a recarregar sozinha: o id do deploy passa a valer também no servidor em execução, não só no build.

- Agendamento mais leve no celular: o zod e o gerador de QR do Pix saíram do JS que todo cliente baixa (de 666 KB para 532 KB sem compressão); ao escolher o primeiro serviço, a faixa de dias rola para a tela quando está abaixo da dobra; e os campos de nome e WhatsApp passam a 16 px, sem o zoom do Safari no iPhone.

- Ajustes ganha **Testar envio** no SMS: depois de cadastrar a chave da Comtele, manda um SMS de teste para um celular e mostra a resposta da Comtele (chave errada, sem crédito) na hora.

- Agendamento no celular: com sinal Pix, a tela não promete mais "sem pagar nada agora" nem "horário reservado" antes do pagamento (mostra "aguardando o sinal"); o preço fica em linha própria no resumo de baixo; o calendário separa dia fechado de dia sem vagas; rótulos de 9 px passam a 11 px; e o nome do serviço não é mais espremido letra a letra quando o preço é "a partir de".

## 0.15.0 — 02/11/2026 — Ajustes no admin e produção só na VPS

- A Vercel saiu do código: sem `vercel.json`, domínio próprio só pelo modo VPS (DNS no IP da VPS, certificado pelo Caddy), e a documentação de deploy aponta para `scripts/deploy-vps.sh`.

- Admin ganha a tela **Ajustes**: as chaves do SMS (Comtele), do e-mail (Resend e Gmail) e do WhatsApp (atendys) são cadastradas ali e valem na hora, sem mexer no `.env` nem reiniciar. O `.env` segue valendo para o que não for cadastrado.

- Termos e Privacidade seguem a identidade visual da Ruphus, com fontes locais e navegação responsiva. A versão contratual já publicada permanece intacta.

- Inicial com tipografia mais legível, exemplos em grade responsiva, foco visível em fundos escuros, leitura sem JavaScript e metadados de SEO revisados.

- A inicial mostra exemplos de equipe, Caixa, comissões e contas fixas, com indicação dos módulos adicionais.

- A inicial apresenta site, agenda e gestão, distingue recursos incluídos de adicionais e esclarece domínio, ativação e manutenção conforme os Termos.

## 0.14.0 — WhatsApp na plataforma atendys

### Contrato
- **Termos de Contratação** publicados em `/termos`, e cada versão em endereço
  fixo (`/termos/1.0`) que não muda depois de publicado. Quem cadastra um negócio
  e quem abre o convite de dono vê o resumo das cláusulas essenciais e marca "Li e
  aceito" antes de seguir; o servidor recusa sem o aceite e grava em `aceites/` a
  versão, a data, o e-mail, o IP e o navegador. Logo depois sai um e-mail de
  confirmação com o link da versão aceita. O convite da equipe não pede aceite.
- A proposta (página e e-mail) aponta para os Termos, e "Manutenção incluída"
  passa a dizer que vale nos limites deles.
- Sede da Ruphus agora em Ananindeua/PA (também na página de privacidade).

### Infraestrutura
- **O WhatsApp do negócio mudou de gateway**: em vez do protótipo próprio, cada
  negócio é um tenant na plataforma **atendys** (instância por cliente, filas,
  opt-in LGPD e webhooks assinados por tenant). Conectar pelo painel (do dono ou
  do /admin) provisiona o tenant e a instância sozinho — não há mais passo manual.
- **Webhook novo em `/api/webhooks/atendys`**, com assinatura HMAC por negócio;
  a rota antiga `/api/webhooks/wtsfy` responde 410 (gateway desativado) (#170).
- Conexões feitas no protólogo antigo aparecem como desconectadas: reconectar
  provisiona tudo de novo na plataforma nova.

## 0.13.0 — 31/10/2026

### Pix do salão (novo)
- **Chave Pix do salão** em Meu negócio, e **QR com o valor no Caixa** na hora de receber: o cliente paga no balcão ou recebe o código pelo WhatsApp. O dinheiro cai direto na conta do salão (#160).
- **Sinal no agendamento online** (#160): o salão escolhe % ou valor fixo e o prazo. Quem agenda vê o QR do sinal; o horário fica segurado, o salão toca "Sinal recebido" (confirma o horário e lança no Caixa), e sem pagamento no prazo o horário é liberado sozinho. Ao receber o atendimento, o Caixa já desconta o sinal.

### Infraestrutura
- **O Ruphus saiu da Vercel para a VPS própria**, atrás da Cloudflare: o app roda com systemd e Caddy, e os crons (lembretes, demo) ficam no crontab do servidor. A publicação passa a ser `./scripts/deploy-vps.sh` (#158).
- **Domínio próprio do cliente** (#157): no /admin, a Ruphus liga www.salaodocliente.com.br ao site; o cliente aponta o DNS, e o site, a agenda e a bio passam a abrir nesse endereço, com o antigo {slug}.ruphus.site redirecionando para lá. Funciona na VPS (DNS direto no IP, certificado emitido pelo Caddy) e na Vercel.

### Caixa (novo)
- **Caixa do negócio**, ligado por cliente pelo admin da plataforma (#126, #130, #131): entradas e saídas do mês, só para quem gere o negócio. O valor do Caixa é acertado por cliente no CRM e somado à mensalidade (#132).
- **Contas do mês, comissão por profissional e planilha para o contador** (#133). O % de comissão também pode ser definido no cadastro do profissional (#136).
- **Fechar o dia**: os atendimentos que já começaram aparecem para dar baixa; o relógio anda sozinho, sem recarregar (#139). "Recebi" também confirma o atendimento que aguardava confirmação (#142).
- **Estornar** um recebimento, com aviso e confirmação, e acompanhamento das comissões por profissional, com histórico (#141). Profissional sem % fica fora da lista e do total (#143).
- Ajustes para o celular: modal no centro no computador, valor grande e Enter para lançar (#134), linhas sem espremer o nome (#135, #138), "Fechar o dia" com os 3 mais recentes e o total das comissões numa linha (#145). Correções do QA em produção (#137).

### Equipe e dono
- **Login da equipe** (#153, #155): em Profissionais, o dono dá acesso ao painel para cada profissional por um link preso ao e-mail dele. O funcionário vê a agenda (aberta na dele), os clientes, os serviços e a equipe, sem Caixa, sem Meu negócio e sem poder editar preço, serviços ou equipe. Tirar o acesso ou excluir o profissional cancela os links dele.
- **O cliente vira dono do negócio** ao aceitar o convite (#153). Se a Ruphus tirar o cliente, o negócio volta para ela, sem a equipe dele, e nenhum link antigo o traz de volta.
- **O convite sai de noreply@ruphus.site**, num e-mail com layout próprio (#153, #154).

### Landing e login
- **"Criar minha conta" virou "Quero o meu site"**, pelo WhatsApp: o cliente entra pela venda e pelo convite (#147).
- **Vitrine com sites do padrão atual**: o telefone, a busca vazia, a faixa de nomes e a tela de login mostram os sites do gerador, de beleza, sem a faixa de proposta na prévia (#148–#152). As fotos voltaram a aparecer na prévia. Quem sai do ar sai da vitrine.
- **Menu da conta**: o admin da plataforma vê "Voltar ao admin" em vez de "Meus negócios" (#146).

### Sites gerados
- **Kits de beleza**: bronze, cílios e depilação com legendas conferidas (#124), e os modelos Depilação 1, 2 e 3 no seletor (#140).

### Segurança e revisão
- O negócio só é criado e alterado pelo servidor; correções de XSS no telefone, no WhatsApp e nos lembretes (#125); cobrança, redirect, sessões, site fora do ar e CSV (#127); gestor cria profissional, push só de navegador, slugs reservados (#129).
- O limite de agendamentos é somado entre negócios, e o gerador aceita celular com e sem o 9 (#128).

## 0.12.0 — 18/10/2026

### Proposta por e-mail
- **O botão "Enviar por e-mail" manda a proposta direto** da conta da Ruphus, para o e-mail do dono cadastrado na aba Venda. Antes, abria o aplicativo de e-mail do computador com o texto pronto. Pede confirmação antes de enviar e só registra o contato na linha do tempo quando o envio dá certo.
- O e-mail sai em formato de proposta, com os valores em destaque e um botão para abrir a página. Traz os mesmos valores e o mesmo prazo da página, e o link é o mesmo que vai pelo WhatsApp. A versão em texto puro vai junto para quem não exibe HTML.
- **Convite de acesso também sai por e-mail**: o botão "Enviar por e-mail" na aba Cliente manda o link para o dono, da conta da Ruphus. O link continua preso ao endereço do dono, e sem e-mail cadastrado não sai convite.

## 0.11.0 — 17/10/2026

### Sites gerados
- **Podologia tem nicho próprio**: fotos de atendimento nos pés, paletas clínicas e serviços do ramo (unha encravada, calosidade, pé diabético) no lugar de limpeza de pele e sobrancelha. Os 138 sites já no ar foram levados para o nicho novo.
- **Kit de fotos de depilação** para estética: entra só quando escolhido para o site, fora do sorteio por região, e não muda as fotos dos outros sites de estética.

### CRM
- **Mensagens revisadas** (#121): textos curtos, nota do Google quando existe e saída "PARE" no primeiro contato. "Primeiro contato" some para quem já foi contatado, e a "Proposta" leva o link com prazo de 7 dias.

### Gerador
- **Planilhas de prospecção no banco local**: cada linha das listagens fica na tabela `planilhas` do dblocal, com a situação que a conferência daria, em vez de arquivos .xlsx soltos em docs/.

## 0.10.0 — 11/10/2026

### Sites gerados
- **Sites vizinhos não repetem a mesma cara** (#120): o kit de fotos e a paleta são escolhidos pelo que está menos usado no estado e no nicho. Sites já no ar mantêm o visual atual.
- **Textos variados em sites novos**: título da galeria, passos do atendimento e tabela de preços mudam de um site para outro, e a ordem de cartões e perguntas do FAQ também. Sites antigos mantêm o texto que já tinham.
- **Modelo claro com fonte nova**: títulos em Bricolage Grotesque e texto em Figtree.

### Gerador
- **Planilhas de levantamento** com "Nome do negócio", "Cidade/UF" e "Nicho / Segmento" passam a ser lidas. "Não identificado" conta como dado faltando.
- **Sem telefone, com rede social**: o negócio fica de fora do site (o site precisa de WhatsApp), mas aparece na conferência para contato pela rede.

## Em avaliação

### Admin no celular
- **O /admin cabe no celular** (#99): Lista, Funil, Clientes, Cobrança e
  Gerador numa barra fixa embaixo (no topo passavam da tela); as visões numa
  faixa que rola, com filtro e ordem na linha de baixo; os filtros numa folha
  que sobe de baixo, com "Ver N"; e o Funil mostra uma etapa por vez, com
  seletor, em vez de cinco colunas que rolavam para o lado.

### Agenda: "qualquer um" de verdade e menos tropeços
- **"Qualquer profissional" fica com quem está livre** (#102): se o oferecido
  foi tomado, a reserva vai para outro da equipe no mesmo horário.
- **Sem "Muita gente agendando" falso** em picos do mesmo serviço.
- **Telefone validado no servidor** como na tela.
- **Tela de sucesso sempre aparece**, com o nome de quem vai atender.
- **Erro ao carregar horários** com "Tentar de novo"; data fora do intervalo não
  esvazia a faixa de dias.
- **Enter confirma**, a página sobe ao trocar de etapa, botões de 44 px, quadro
  de desmarcar só quando há como, e o aviso do limite fala do negócio, não do
  "salão".

### Admin: o WhatsApp do dono vale para todo envio
- **Outros WhatsApp do negócio** (#103): sócio, gerente… no cartão "Contato do
  dono", cada um com o botão de abrir a conversa. Proposta e cobrança seguem
  com o dono.
- **Convite do painel, "Enviar tudo" e "Falar com o dono" vão para o dono**:
  iam para o telefone do site mesmo com o WhatsApp dele cadastrado.

### Agenda no fuso do negócio
- **Amazonas, Roraima e demais estados fora do horário de Brasília** (#101): os
  horários de hoje não somem mais uma hora antes, e o "Salvar na agenda" põe a
  hora certa no celular do cliente. O painel e as mensagens continuam mostrando
  a hora local de sempre.

### Agenda: fora do ar é fora do ar, e confirmar é seguro
- **Negócio tirado do ar não recebe agendamento por nenhum endereço** (#100):
  antes, www.ruphus.site/agendar/… (o link que o painel divulga) seguia
  aberto e reservando.
- **Confirmar de novo não duplica nem dá "ocupado"**: a mesma pessoa, no mesmo
  horário e profissional, recebe a reserva que já existe.
- **Rede caindo ou servidor ocupado mantêm a escolha** na tela de confirmação,
  com o aviso, em vez de devolver à grade.

### Agenda: "Confirmar" não trava mais no celular
- **O botão de confirmar sempre responde** (#98): contato guardado de outra vez
  que não vale mais vai para o formulário, com o erro à vista, em vez de
  esconder o formulário com o botão desligado; o toque leva ao campo que falta;
  e se a confirmação não responder em 20 s, a pessoa é avisada para tentar de
  novo.

### Manual do vendedor em dia
- **Manual do vendedor revisado** (#97): gaveta com abas e o cartão
  Levantamento, busca e filtros (estado, cidade, nicho), o Funil, a
  Demonstração, o Gerador, a baixa da entrada que publica o site e o Pixel da
  Meta; corrigido o motivo de perda "o negócio fechou".

### Admin: filtro por estado
- **"Estado" nos filtros da lista e do funil** (#96), com a contagem de cada UF;
  a lista de cidades passa a mostrar só as do estado escolhido.

### Formulário do site: sem data passada
- **"Dia de preferência" e "Data" a partir de hoje** (#95) no formulário que
  manda o pedido pelo WhatsApp: nos dois modelos do gerador e nos 366 sites da
  fábrica. Data passada não envia; o navegador avisa.

### Demonstração sempre em dia
- **A demonstração volta ao padrão sozinha toda madrugada** (#94), às 3h de
  Brasília: datas de exemplo a partir do dia, teste da véspera apagado e senha
  nova (o menu "Demonstração" mostra a do dia).

### Demonstração pronta para mostrar e restaurar
- **Menu "Demonstração" no admin** (#93): site, bio, agendamento e painel da
  conta de exemplo, e o acesso de dono (`demo@ruphus.site` + senha) para o
  vendedor passar ao cliente testar.
- **Dados de exemplo**: 6 serviços (fixo, "a partir de" e sem preço), 3
  profissionais, 10 clientes com etiquetas e ficha, 23 agendamentos do último mês
  e da próxima semana (atendidos, falta, cancelado), 3 clientes sumidos e um
  plano recorrente — sempre a partir do dia em que se restaura.
- **"Restaurar padrão"**: depois do teste, apaga o que o cliente fez (agenda,
  clientes, serviços, equipe, convidados), volta aos dados de exemplo e troca a
  senha — quem testou deixa de entrar.

### Admin: atalho para a demonstração
- **"Demonstração ↗" no menu do admin** (#92), depois de Gerador: abre em outra
  aba o painel da conta de demonstração (`barbearia-force`), a que se usa para
  mostrar o produto.

### Meu negócio: erros na hora e UF da lista
- **Os campos do negócio avisam ao sair deles** (#91), e não só ao salvar — em
  Meu negócio, no cadastro e na aba Site do admin. UF vira lista com os 27
  estados, vem do DDD do WhatsApp, e o servidor recusa UF que não existe.
- **Meu negócio:** Salvar só acende com alteração, "Alterações não salvas" ao
  lado, aviso do navegador ao sair sem salvar, e endereço, Instagram e horário
  juntos em "Na página e na bio".

### Gerador: planilha de Rondônia sem editar à mão
- **Colunas "Nome da Empresa", "Nicho/Categoria" e "Avaliação Google"** (#90)
  passam a ser lidas, e a nota que o Excel transformou em data ("4.9" virou
  04/09) volta a ser 4,9.

### Funil: coluna "Novo" enxuta
- **"Novo" mostra 6 negócios, os mais relevantes** (#89), na ordem escolhida em
  "Ordem" (e não mais em ordem alfabética), com quem tem data combinada no topo.
  "Mostrar mais" cresce de 6 em 6, e "Ver os N novos na Lista" abre a fila
  inteira com filtros e busca.

### Clientes: ordenar e paginar
- **Lista de clientes com ordem e páginas** (#88): clicar no título da coluna
  (cliente, última visita, visitas, gasto 12m) ordena, e de novo inverte; no
  celular, um seletor faz o mesmo. Páginas de 10, 25, 50 ou 100, com anterior e
  próxima, no lugar do "Carregar mais".

### Preço "a partir de" ou sem preço
- **Cada serviço escolhe como o preço aparece** (#87): fixo, "a partir de" ou
  não informar. A agenda, a bio, os pacotes e a imagem do link seguem a escolha;
  com um serviço "a partir de" ou sem preço, a soma também vira "a partir de", e
  sem preço nenhum o valor fica "a combinar". Serviços antigos continuam fixos.

### Ficha do cliente com nascimento e e-mail
- **O dono registra data de nascimento e e-mail** (#83) na ficha do cliente:
  máscara DD/MM/AAAA e e-mail sem espaço e em minúsculas, erro no campo em tempo
  real (data que não existe, no futuro, e-mail incompleto) e a idade ao lado. Só
  dono e administradores gravam, e pelo servidor, que confere de novo.

### Nome de gente, não número
- **Agenda e cadastro com a mesma regra de nome** (#82): o campo só aceita
  letras (com acento), espaço, apóstrofo, hífen e ponto, e pede 2 letras. O
  servidor confere igual: "3232323232" não passa mais como nome de quem agenda.
  Renomear o cliente na ficha segue a mesma regra (#86).

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
- **Nota aproximada vale** (#80): "~4.4" ou "aprox. 120" viram 4,4 e 120. Os 106
  sites do Piauí estão todos com nota e avaliações (planilha reenviada).
- **UF sem coluna UF** (#78): a do DDD mais comum da planilha. Os 106 sites do
  Piauí, que estavam sem UF, ganharam "PI".

### Depois de agendar: agenda do celular e como chegar
- **Como chegar** (#75): mapa, endereço (ou bairro e cidade, quando a casa não
  cadastrou a rua) e botões de Google Maps, Waze e copiar o endereço.
- **Salvar na agenda** (#75, #76): arquivo de agenda com lembrete 2 horas antes,
  ou o Google Agenda — discreto no rodapé (#76): a ação da tela é falar com o
  negócio, pelo nome dele ("Falar com Barbearia Force no WhatsApp").
- **O nome no topo leva ao negócio** (#81): no computador, ao site; no celular,
  à bio. Sem site próprio, à bio nos dois.
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
