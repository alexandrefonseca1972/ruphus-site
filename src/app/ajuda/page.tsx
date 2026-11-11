import { Atencao, Capa, Indice, Lista, P, Passos, Rodape, Secao, Termo } from "./conteudo";

// Manual de quem atende: o dono do negócio e a equipe dele. Escrito na ordem em
// que as dúvidas aparecem, não na ordem do menu. Mudou uma tela? Mude aqui junto.

export default function ManualDoUsuario() {
  return (
    <>
      <Capa
        titulo="Como usar o seu painel"
        linha="Sua agenda online em um lugar só: o que os clientes podem marcar, quem atende, o que entrou no caixa e o que fazer quando o dia começa. Leva dez minutos para deixar tudo pronto."
      />

      <Indice
        itens={[
          ["comecar", "Começar"],
          ["agenda", "Agenda do dia"],
          ["servicos", "Serviços"],
          ["profissionais", "Profissionais"],
          ["clientes", "Clientes"],
          ["planos", "Planos recorrentes"],
          ["negocio", "Meu negócio"],
          ["sinal", "Sinal no agendamento"],
          ["caixa", "Caixa"],
          ["recibo", "Recibo"],
          ["divulgar", "Divulgar o link"],
          ["celular", "Celular e avisos"],
          ["conta", "Sua conta"],
          ["acesso", "Quem pode o quê"],
          ["duvidas", "Dúvidas frequentes"],
        ]}
      />

      <Secao id="comecar" titulo="Começar: três passos">
        <P>
          A sua agenda só abre depois que o sistema sabe <Termo>o que</Termo> você faz e <Termo>quem</Termo> atende. São
          três passos, na ordem:
        </P>
        <Passos
          itens={[
            <>
              <Termo>Cadastre os serviços</Termo>, com duração e preço. A duração é o que reserva o espaço na agenda: um
              corte de 30 minutos ocupa 30 minutos.
            </>,
            <>
              <Termo>Cadastre quem atende</Termo>, marcando os serviços que cada pessoa faz e o horário de cada dia da
              semana. Sem profissional, não existe horário livre para oferecer.
            </>,
            <>
              <Termo>Divulgue o seu link</Termo> na bio do Instagram e no status do WhatsApp. É por ele que o cliente
              marca sozinho.
            </>,
          ]}
        />
        <Atencao>
          Enquanto faltar um desses passos, o link existe mas não tem horário para oferecer. A própria agenda mostra a
          lista do que falta.
        </Atencao>
      </Secao>

      <Secao id="agenda" titulo="A agenda do dia">
        <P>
          A tela abre no dia de hoje. A faixa de cima anda de semana em semana, e cada dia mostra quantos horários tem.
          Os números do dia (horários, confirmados, aguardando e o previsto em reais) contam só o que está de pé.
        </P>
        <P>
          Uma linha marca <Termo>agora</Termo> e desce sozinha durante o dia. Por isso um horário que acabou de passar
          perde o botão de confirmar e ganha a opção de registrar falta, sem você recarregar nada.
        </P>
        <Lista
          itens={[
            <>
              <Termo>Confirmar pelo WhatsApp</Termo> grava a confirmação e só então manda a mensagem ao cliente: pelo
              WhatsApp do negócio, se estiver conectado, ou abrindo a conversa no seu WhatsApp. Se a gravação falhar, nada é enviado: você nunca avisa um cliente de algo que não aconteceu.
            </>,
            <>
              <Termo>Remarcar</Termo> mostra os horários livres da nova data. O horário antigo fica livre na hora, e o
              agendamento volta para “aguardando confirmação”, porque o combinado mudou.
            </>,
            <>
              <Termo>Cancelar</Termo> pergunta antes e já oferece avisar o cliente pelo WhatsApp, com a mensagem pronta
              e o link para ele marcar outro horário.
            </>,
            <>
              <Termo>Faltou</Termo> fica no histórico do cliente e não volta atrás pelo painel. Registre só quando tiver
              certeza.
            </>,
            <>
              <Termo>Sinal recebido</Termo> aparece no horário que pediu sinal: toque quando o Pix cair na sua conta. O
              horário fica confirmado (veja <a href="#sinal" className="underline underline-offset-2">Sinal no agendamento</a>).
            </>,
            <>
              <Termo>Histórico</Termo>, no menu de cada linha, conta tudo o que aconteceu com aquele horário e quem fez
              cada coisa.
            </>,
          ]}
        />
        <Atencao>
          Atendimento já recebido no Caixa não pode ser remarcado, cancelado nem virar falta: o dinheiro dele já está
          lançado. Para mudar, apague antes o recebimento no Caixa.
        </Atencao>
      </Secao>

      <Secao id="servicos" titulo="Serviços">
        <P>
          Cada serviço tem nome, duração e preço. O preço pode ser <Termo>fixo</Termo>, <Termo>a partir de</Termo> (para
          o que varia, como alisamento) ou <Termo>não informado</Termo>. Ele aparece para o cliente antes de marcar e
          entra no previsto do dia. Nome repetido é barrado: dois “Corte” confundem quem escolhe.
        </P>
        <P>
          O cliente pode escolher mais de um serviço na mesma marcação. Nesse caso, duração e preço são
          <Termo> somados</Termo>, e o horário reservado é o total.
        </P>
        <Lista
          itens={[
            <>
              O interruptor de cada serviço diz se ele vai para o link. <Termo>No link</Termo>: o cliente vê e marca.{" "}
              <Termo>Oculto</Termo>: tirado por você, sem apagar nada.
            </>,
            <>
              <Termo>Fora do link até alguém fazer</Termo>: o interruptor está ligado, mas nenhum profissional ativo faz
              esse serviço. Sem ninguém para atender, ele não aparece. Marque o serviço no cadastro de quem faz e ele
              entra no link.
            </>,
            <>
              Para achar rápido: <Termo>busca</Termo> pelo nome (sem precisar de acento), filtros{" "}
              <Termo>No link · Fora do link · Ninguém faz · Ocultos</Termo>, <Termo>Quem faz</Termo> para ver os serviços
              de uma pessoa. Para ordenar, toque no título da coluna (nome, duração, preço ou agendados); tocar de novo
              inverte. No celular, use <Termo>Ordenar por</Termo>. Escolha quantos aparecem por página.
            </>,
            <>
              <Termo>Excluir</Termo> some com o serviço da lista. Os agendamentos já feitos continuam na agenda, com o
              nome e o preço da época.
            </>,
          ]}
        />
      </Secao>

      <Secao id="profissionais" titulo="Profissionais">
        <P>
          Cada pessoa tem os serviços que realiza e o horário de cada dia da semana. Desmarcar um dia é folga. Existe um
          atalho para repetir o horário de segunda nos outros dias marcados.
        </P>
        <P>
          O horário livre nasce dessa grade: o sistema encaixa o serviço de 15 em 15 minutos, e só oferece o horário em
          que o serviço <Termo>cabe inteiro</Termo> antes do fim do expediente. É por isso que um serviço longo some
          sozinho no fim do dia.
        </P>
        <Lista
          itens={[
            <>
              <Termo>Comissão (%)</Termo> fica no cadastro de cada pessoa quando o Caixa está ativo. Aceita decimais, como
              12,5. Vale para o que ela atende pela agenda (veja Caixa).
            </>,
            <>
              <Termo>Dar acesso ao painel</Termo> manda um convite para o e-mail da pessoa, válido por 7 dias. Ela entra
              com a conta dela e vê só os horários dela. <Termo>Tirar acesso</Termo> desfaz na hora.
            </>,
            <>
              <Termo>Tirar do link</Termo> pausa a pessoa: ela some do agendamento, e a agenda que já existe continua.
            </>,
            <>
              <Termo>Excluir</Termo> tira de vez, e é o que libera vaga no limite do plano.
            </>,
            <>
              Busca pelo nome e filtros <Termo>No link · Fora do link · Com acesso · Sem acesso</Termo>, além de{" "}
              <Termo>Faz</Termo> para ver quem faz um serviço.
            </>,
            <>
              Seu plano inclui <Termo>5 profissionais</Termo>. Para abrir mais vagas, fale com a Ruphus.
            </>,
          ]}
        />
      </Secao>

      <Secao id="clientes" titulo="Clientes">
        <P>
          O cliente entra na lista sozinho, a partir do primeiro agendamento. Ele é identificado pelo WhatsApp, então o
          mesmo número é sempre a mesma pessoa.
        </P>
        <Lista
          itens={[
            <>
              Na ficha ficam o <Termo>nascimento</Termo> e o <Termo>e-mail</Termo> (o e-mail já vem preenchido no
              recibo), as <Termo>etiquetas</Termo> (até 8) e as <Termo>anotações</Termo>: alergias, preferências, o que
              foi combinado. Cada anotação guarda quem escreveu e quando.
            </>,
            <>
              Busca por nome ou telefone e quantos por página. Toque no título da coluna para ordenar por nome, última
              visita, visitas ou gasto (no celular, em <Termo>Ordenar por</Termo>).
            </>,
            <>
              O filtro <Termo>Sem vir há</Termo> monta a lista de quem sumiu. Quem tem horário marcado não entra: ele já
              está voltando.
            </>,
            <>
              <Termo>Copiar telefones</Termo> leva a lista para uma transmissão do WhatsApp. Quem estiver marcado como
              “não receber campanhas” fica de fora.
            </>,
            <>
              <Termo>Corrigir</Termo> o nome também acerta os horários futuros; o histórico guarda o nome da época.
            </>,
          ]}
        />
        <Atencao>
          Para excluir um cliente é preciso não haver horário marcado nem plano ativo. Cancele ou encerre antes. O que
          já foi atendido continua no histórico.
        </Atencao>
      </Secao>

      <Secao id="planos" titulo="Planos recorrentes">
        <P>
          O plano marca o mesmo horário toda semana, pelo número de semanas que você escolher (até 52). Serve para quem
          vem sempre: a manicure de toda sexta às 15h.
        </P>
        <Lista
          itens={[
            <>
              Escolha o <Termo>primeiro dia</Termo> e o horário. Em <Termo>Repetir toda</Termo>, o dia da semana do plano
              segue o primeiro dia, mas pode ser outro: começa no sábado e, daí em diante, toda terça.
            </>,
            <>
              Sem profissional escolhido, a semana em que a pessoa preferida estiver ocupada vai para quem estiver livre
              no mesmo horário, em vez de ficar de fora.
            </>,
            <>
              O <Termo>e-mail</Termo> do cliente é opcional; informado, vai para a ficha dele.
            </>,
            <>Datas já ocupadas são puladas, e o resumo diz quais foram.</>,
            <>Cada horário do plano aparece na agenda com o selo “Recorrente”.</>,
            <>
              <Termo>Encerrar o plano</Termo> cancela os horários futuros dele; os passados ficam no histórico.
            </>,
            <>O cliente não é avisado automaticamente ao criar ou encerrar um plano: combine com ele.</>,
          ]}
        />
      </Secao>

      <Secao id="negocio" titulo="Meu negócio">
        <P>Tudo o que aparece no seu site, na bio e no agendamento, num lugar só. Os atalhos do topo levam a cada parte.</P>
        <Lista
          itens={[
            <>
              <Termo>Dados</Termo>: nome, área e ramo, WhatsApp, cidade, endereço, Instagram e horário de funcionamento.
              O que muda aqui muda no site e na bio.
            </>,
            <>
              <Termo>Seus links</Termo>: o site, a bio para o Instagram e a agenda online, cada um com{" "}
              <Termo>Copiar</Termo> e <Termo>QR code</Termo>. O QR pode ser copiado como imagem ou baixado para imprimir
              no balcão, no espelho ou no cartão.
            </>,
            <>
              <Termo>Site como prévia</Termo>: o site já abre e recebe agendamentos, mas mostra uma faixa de “ainda não
              publicado” e fica fora do Google até você publicar.
            </>,
            <>
              <Termo>Agendamento online</Termo>: liga ou desliga a marcação pelo link (desligado, o link mostra serviços
              e preços com o WhatsApp). O <Termo>recado</Termo> aparece para o cliente na confirmação, como “chegue 10
              minutos antes”.
            </>,
            <>
              <Termo>Avisos pelo WhatsApp</Termo>: os avisos aos clientes e os pedidos de agendamento saem pelo número
              oficial da Ruphus, com o nome do seu negócio. Salve <Termo>Seu WhatsApp</Termo> (um celular com DDD): é
              nele que chegam os pedidos, e você confirma ou recusa pelos botões da mensagem. Ao salvar, mandamos uma
              mensagem para esse número: toque em <Termo>Sou eu</Termo> para confirmar que é seu. Os{" "}
              <Termo>lembretes automáticos</Termo> saem quantas horas antes você escolher.
            </>,
            <>
              <Termo>Pix para receber</Termo>: a sua chave (CPF, CNPJ, e-mail, celular ou aleatória), o nome como está
              no banco e a cidade. Com ela, o Caixa mostra o QR do Pix com o valor, e o agendamento pode pedir sinal.
            </>,
          ]}
        />
      </Secao>

      <Secao id="sinal" titulo="Sinal no agendamento">
        <P>
          Com a chave Pix cadastrada, você pode pedir que quem agenda pelo link pague uma parte por Pix para garantir o
          horário: um <Termo>percentual</Termo> do serviço ou um <Termo>valor fixo</Termo>, e o prazo para pagar (de 15
          minutos a 24 horas).
        </P>
        <Passos
          itens={[
            <>O cliente agenda e vê o QR e o código do Pix com o valor do sinal.</>,
            <>Quando o dinheiro cair na sua conta, toque em <Termo>Sinal recebido</Termo> na agenda: o horário fica confirmado.</>,
            <>Sem o sinal no prazo, o horário é liberado sozinho para outra pessoa.</>,
            <>No dia, o Caixa já cobra só o restante: o sinal pago sai do valor.</>,
          ]}
        />
        <Atencao>
          Confira sempre no app do banco antes de marcar “Sinal recebido”: o Pix cai direto na sua conta, e a Ruphus não
          vê o pagamento. Tirar a chave Pix desliga o sinal.
        </Atencao>
      </Secao>

      <Secao id="caixa" titulo="Caixa">
        <P>
          O Caixa responde três perguntas do mês: <Termo>quanto entrou</Termo>, <Termo>quanto saiu</Termo> e{" "}
          <Termo>quanto sobrou</Termo>. Ele aparece no menu quando a Ruphus ativa o módulo para o seu negócio, e só o
          dono e os administradores veem: quem só atende não vê dinheiro.
        </P>
        <Lista
          itens={[
            <>
              <Termo>A receber da agenda</Termo>: os atendimentos que já passaram aparecem com o valor da agenda (já sem
              o sinal pago). Serviço sem preço aparece como “a combinar”: você digita o valor ao receber. Toque em{" "}
              <Termo>Recebi</Termo>, escolha Pix, dinheiro ou cartão, e a entrada está lançada. Se a pessoa não veio,{" "}
              <Termo>Não veio</Termo> registra a falta.
            </>,
            <>
              <Termo>+ Entrada</Termo> e <Termo>− Saída</Termo> lançam o resto: venda de produto, aluguel, conta de luz,
              compra de material. No Pix, <Termo>Mostrar QR do Pix</Termo> gera o QR com o valor para o cliente pagar
              na hora.
            </>,
            <>
              Digite o valor só com números, com os centavos: 3500 vira R$ 35,00. Valor abaixo de R$ 1 pede confirmação.
            </>,
            <>
              Errou? Toque no lançamento para <Termo>corrigir</Termo> ou <Termo>apagar</Termo>. <Termo>Estornar</Termo>{" "}
              devolve ao cliente, no todo ou em parte, uma vez por entrada.
            </>,
            <>
              <Termo>Contas do mês</Termo>: cadastre uma vez em <Termo>Contas fixas</Termo> o aluguel, a internet e o
              que se repete. Todo mês elas aparecem para pagar; <Termo>Paguei</Termo> lança a saída. <Termo>Editar</Termo>{" "}
              muda o valor sem perder o que já foi pago, e <Termo>Tirar</Termo> vale do próximo mês em diante.
            </>,
            <>
              <Termo>Comissões</Termo>: o percentual de cada profissional (no cadastro dele ou aqui) vezes o que ele
              recebeu pela agenda no mês. <Termo>Pagar</Termo> lança a saída com o valor calculado. Toque no nome para
              ver os meses anteriores.
            </>,
            <>
              <Termo>Exportar planilha</Termo> baixa os lançamentos do mês para o contador; abre no Excel.
            </>,
          ]}
        />
        <P>Como a comissão se ajusta sozinha:</P>
        <Lista
          itens={[
            <>
              O <Termo>sinal</Termo> só conta para a comissão quando o atendimento é recebido. Se o cliente faltar ou
              cancelar, o sinal fica com o salão e não gera comissão.
            </>,
            <>
              Estorno, correção ou exclusão de um recebimento de um mês com a comissão já paga viram desconto (ou
              crédito) no próximo pagamento do profissional, pelo mesmo percentual com que o mês foi pago.
            </>,
            <>
              Crédito a devolver aparece na lista mesmo sem atendimento no mês, para acertar com quem saiu da equipe.
            </>,
          ]}
        />
      </Secao>

      <Secao id="recibo" titulo="Recibo">
        <P>
          Depois de <Termo>Recebi</Termo>, o aviso do Caixa oferece o <Termo>Recibo</Termo>. Ele também está dentro de
          qualquer entrada. O recibo tem o formato de um cupom: os serviços da visita, como foi pago (o sinal Pix do
          agendamento e o restante no balcão, com a forma de cada um), o total e o valor por extenso.
        </P>
        <Lista
          itens={[
            <>
              <Termo>Imprimir</Termo>: sai só o cupom, numa folha comum ou em impressora de bobina de 80{"\u00a0"}mm.
            </>,
            <>
              <Termo>WhatsApp</Termo>: abre a conversa com o cliente com o recibo escrito. Entrada sem cliente abre o
              WhatsApp para você escolher o contato.
            </>,
            <>
              <Termo>E-mail</Termo>: abre o seu app de e-mail com o recibo pronto, saindo do seu endereço. O e-mail da
              ficha do cliente já vem preenchido.
            </>,
            <>Os recebimentos do mesmo cliente no mesmo dia saem num recibo só.</>,
          ]}
        />
        <Atencao>O recibo comprova o pagamento, mas não é documento fiscal.</Atencao>
      </Secao>

      <Secao id="divulgar" titulo="Divulgar o link">
        <P>
          O botão <Termo>Divulgar link</Termo>, no topo do painel, tem o endereço do seu agendamento pronto para copiar,
          mandar no WhatsApp, compartilhar e abrir o <Termo>QR code</Termo>. Ele funciona em qualquer celular, sem o
          cliente instalar nada.
        </P>
        <Lista
          itens={[
            <>Na bio do Instagram: é o link que transforma seguidor em horário marcado.</>,
            <>No status do WhatsApp e na mensagem de ausência.</>,
            <>Para cada cliente que pedir horário na conversa: mande o link em vez de responder um a um.</>,
            <>Impresso no balcão: o QR leva direto à agenda online.</>,
          ]}
        />
      </Secao>

      <Secao id="celular" titulo="Celular e avisos">
        <Lista
          itens={[
            <>
              <Termo>Instale o painel no celular</Termo>: ele abre direto da tela inicial, em tela cheia, e a agenda
              funciona mesmo com sinal fraco. No Android, toque em <Termo>Instalar</Termo> no convite do painel. No
              iPhone, no Safari, toque em <Termo>Compartilhar</Termo> e depois em <Termo>Adicionar à Tela de Início</Termo>.
              O convite só aparece no celular e no tablet.
            </>,
            <>
              <Termo>Avisos de agendamento</Termo>: ligue para receber um aviso no aparelho a cada novo agendamento. Cada
              pessoa liga no próprio aparelho, pelo convite do painel ou pelo menu da sua conta. Com o painel aberto, a aba
              também mostra a quantidade de novos agendamentos no título, até você voltar a ela ou abrir a agenda.
            </>,
          ]}
        />
      </Secao>

      <Secao id="conta" titulo="Sua conta">
        <P>No círculo com a sua inicial, no canto de cima:</P>
        <Lista
          itens={[
            <>
              <Termo>Contrato aceito</Termo>: a versão dos Termos de Contratação que você aceitou e a data. O texto
              daquela versão fica guardado e não muda.
            </>,
            <>
              <Termo>Termos de uso</Termo> e <Termo>Política de privacidade</Termo>: as versões atuais.
            </>,
            <>
              <Termo>Meus negócios</Termo>, quando você tem mais de um, e <Termo>Ajuda</Termo>, esta página.
            </>,
            <>
              <Termo>Sair</Termo> pede confirmação antes. Para voltar, é só entrar de novo com o seu e-mail.
            </>,
          ]}
        />
      </Secao>

      <Secao id="acesso" titulo="Quem pode o quê">
        <P>Três papéis, do mais alto ao mais baixo:</P>
        <Lista
          itens={[
            <>
              <Termo>Dono</Termo>: criou o negócio. Não pode ser removido.
            </>,
            <>
              <Termo>Admin</Termo>: entrou pelo convite da Ruphus. Faz tudo o que o dono faz no dia a dia.
            </>,
            <>
              <Termo>Equipe</Termo>: entra pelo <Termo>Dar acesso ao painel</Termo> e vê e mexe só nos horários dela.
              Consulta serviços e clientes, escreve anotações, mas não muda preços, não vê o Caixa e não renomeia nem
              exclui cliente.
            </>,
          ]}
        />
        <P>
          O acesso é pessoal: cada pessoa entra com a conta dela, e o que ela faz fica registrado com o nome dela.
        </P>
      </Secao>

      <Secao id="duvidas" titulo="Dúvidas frequentes">
        <P>
          <Termo>O cliente marcou um horário que eu não tinha.</Termo> Confira o horário do profissional naquele dia da
          semana e se o serviço está com a duração certa. O sistema só oferece o que cabe na grade.
        </P>
        <P>
          <Termo>Um serviço não aparece no link.</Termo> Veja se ele está “Fora do link até alguém fazer”: marque o
          serviço no cadastro de quem faz. Se estiver “Oculto”, ligue o interruptor.
        </P>
        <P>
          <Termo>Não acho o campo de comissão.</Termo> Ele aparece no cadastro do profissional quando o Caixa está ativo
          no seu negócio. Fale com a Ruphus para ativar.
        </P>
        <P>
          <Termo>Quero fechar um dia inteiro.</Termo> Desmarque o dia no horário de cada profissional. Horários já
          marcados continuam: cancele um a um, avisando os clientes.
        </P>
        <P>
          <Termo>Não consigo remarcar um atendimento.</Termo> Se ele já foi recebido no Caixa, apague o recebimento
          antes; depois remarque e receba de novo.
        </P>
        <P>
          <Termo>A sessão foi encerrada sozinha.</Termo> Por segurança, o acesso pode sair depois de um tempo parado,
          principalmente no computador do balcão. É só entrar de novo.
        </P>
        <P>
          <Termo>Meu site saiu do ar.</Termo> Isso acontece quando a mensalidade fica em atraso. Fale com a Ruphus: o
          endereço volta assim que resolver, e nada do seu conteúdo se perde.
        </P>
        <P>
          <Termo>Preciso de mais profissionais.</Termo> O plano inclui 5. Fale com a Ruphus para liberar mais vagas.
        </P>
      </Secao>

      <Rodape outro="/painel" rotulo="Ir para o painel" />
    </>
  );
}
