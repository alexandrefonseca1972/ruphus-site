import { Atencao, Capa, Indice, Lista, P, Passos, Rodape, Secao, Termo } from "./conteudo";

// Manual de quem atende: o dono do negócio e a equipe dele. Escrito na ordem em
// que as dúvidas aparecem, não na ordem do menu.

export default function ManualDoUsuario() {
  return (
    <>
      <Capa
        titulo="Como usar o seu painel"
        linha="Sua agenda online em um lugar só: o que os clientes podem marcar, quem atende, e o que fazer quando o dia começa. Leva dez minutos para deixar tudo pronto."
      />

      <Indice
        itens={[
          ["comecar", "Começar"],
          ["agenda", "A agenda do dia"],
          ["servicos", "Serviços"],
          ["profissionais", "Profissionais"],
          ["clientes", "Clientes"],
          ["planos", "Planos recorrentes"],
          ["divulgar", "Divulgar o link"],
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
          Os números do dia — horários, confirmados, aguardando e o previsto em reais — contam só o que está de pé.
        </P>
        <P>
          Uma linha marca <Termo>agora</Termo> e desce sozinha durante o dia. Por isso um horário que acabou de passar
          perde o botão de confirmar e ganha a opção de registrar falta, sem você recarregar nada.
        </P>
        <Lista
          itens={[
            <>
              <Termo>Confirmar pelo WhatsApp</Termo> grava a confirmação e só então abre a conversa com a mensagem
              pronta. Se a gravação falhar, nada é enviado — você nunca avisa um cliente de algo que não aconteceu.
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
              <Termo>Histórico</Termo>, no menu de cada linha, conta tudo o que aconteceu com aquele horário e quem fez
              cada coisa.
            </>,
          ]}
        />
      </Secao>

      <Secao id="servicos" titulo="Serviços">
        <P>
          Cada serviço tem nome, duração e preço. O preço aparece para o cliente antes de ele marcar, e entra no
          previsto do dia. O nome repetido é barrado: dois “Corte” confundem quem escolhe.
        </P>
        <P>
          O cliente pode escolher mais de um serviço na mesma marcação. Nesse caso, duração e preço são
          <Termo> somados</Termo>, e o horário reservado é o total.
        </P>
        <Lista
          itens={[
            <>
              O interruptor <Termo>No link / Oculto</Termo> tira o serviço do link sem apagar nada. Use quando parar de
              oferecer por um tempo.
            </>,
            <>
              <Termo>Excluir</Termo> some com o serviço da lista. Os agendamentos já feitos continuam na agenda, com o
              nome e o preço da época.
            </>,
            <>Abaixo de cada serviço aparece quem o faz. Se disser “Ninguém faz ainda”, ele não tem como ser marcado.</>,
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
              <Termo>Tirar do link</Termo> pausa a pessoa: ela some do agendamento, e a agenda que já existe continua.
            </>,
            <>
              <Termo>Excluir</Termo> tira de vez — e é o que libera vaga no limite do plano.
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
              Na ficha ficam as <Termo>etiquetas</Termo> (até 8) e as <Termo>anotações</Termo> — alergias, preferências,
              o que foi combinado. Cada anotação guarda quem escreveu e quando.
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
          O plano marca o mesmo dia e horário toda semana, pelo número de semanas que você escolher (até 52). Serve para
          quem vem sempre — a manicure de toda sexta às 15h.
        </P>
        <Lista
          itens={[
            <>Datas já ocupadas são puladas, e o resumo diz quais foram.</>,
            <>Cada horário do plano aparece na agenda com o selo “Recorrente”.</>,
            <>
              <Termo>Encerrar o plano</Termo> cancela os horários futuros dele; os passados ficam no histórico.
            </>,
            <>O cliente não é avisado automaticamente ao criar ou encerrar um plano — combine com ele.</>,
          ]}
        />
      </Secao>

      <Secao id="divulgar" titulo="Divulgar o link">
        <P>
          O botão <Termo>Divulgar link</Termo>, no topo do painel, tem o endereço do seu agendamento pronto para copiar,
          mandar no WhatsApp ou compartilhar. Ele funciona em qualquer celular, sem o cliente instalar nada.
        </P>
        <Lista
          itens={[
            <>Na bio do Instagram: é o link que transforma seguidor em horário marcado.</>,
            <>No status do WhatsApp e na mensagem de ausência.</>,
            <>Para cada cliente que pedir horário na conversa: mande o link em vez de responder um a um.</>,
          ]}
        />
      </Secao>

      <Secao id="acesso" titulo="Quem pode o quê">
        <P>Três papéis, do mais alto ao mais baixo:</P>
        <Lista
          itens={[
            <>
              <Termo>Dono</Termo> — criou o negócio. Não pode ser removido.
            </>,
            <>
              <Termo>Admin</Termo> — entrou pelo convite. Faz tudo o que o dono faz no dia a dia.
            </>,
            <>
              <Termo>Equipe</Termo> — atende: agenda, serviços, profissionais, clientes e anotações. Não renomeia nem
              exclui cliente.
            </>,
          ]}
        />
        <P>
          O acesso é pessoal: cada pessoa entra com a conta dela, e o que ela faz fica registrado com o nome dela. Para
          dar ou tirar acesso, fale com a Ruphus.
        </P>
      </Secao>

      <Secao id="duvidas" titulo="Dúvidas frequentes">
        <P>
          <Termo>O cliente marcou um horário que eu não tinha.</Termo> Confira o horário do profissional naquele dia da
          semana e se o serviço está com a duração certa. O sistema só oferece o que cabe na grade.
        </P>
        <P>
          <Termo>Quero fechar um dia inteiro.</Termo> Desmarque o dia no horário de cada profissional. Horários já
          marcados continuam — cancele um a um, avisando os clientes.
        </P>
        <P>
          <Termo>A sessão foi encerrada sozinha.</Termo> Por segurança, o acesso pode sair depois de um tempo parado —
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
