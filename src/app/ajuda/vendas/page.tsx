import { Atencao, Capa, Indice, Lista, P, Passos, Rodape, Secao, Termo } from "../conteudo";

// Manual de quem vende: o painel /admin, do primeiro contato à implantação.

export default function ManualDoVendedor() {
  return (
    <>
      <Capa
        titulo="Como vender pelo painel"
        linha="O /admin é a sua mesa de trabalho: a lista de quem procurar, o funil, as mensagens prontas e a cobrança. Este manual segue a ordem do dia, do primeiro contato ao cliente implantado."
      />

      <Indice
        itens={[
          ["dia", "Começo do dia"],
          ["gaveta", "A gaveta do negócio"],
          ["mensagens", "As mensagens"],
          ["fechar", "Fechar e perder"],
          ["implantacao", "Implantação e saúde"],
          ["cobranca", "Cobrança"],
          ["ajustes", "Ajustes e limites"],
        ]}
      />

      <Secao id="dia" titulo="Começo do dia">
        <P>
          Abra o painel na <Termo>Lista</Termo> e trabalhe as visões da esquerda para a direita. Elas são recortes
          prontos dos mesmos filtros:
        </P>
        <Lista
          itens={[
            <>
              <Termo>Atrasados</Termo> — você combinou algo para uma data que já passou. É a primeira fila do dia.
            </>,
            <>
              <Termo>Para hoje</Termo> — o que você mesmo agendou para hoje.
            </>,
            <>
              <Termo>Falei hoje</Termo> — quem já recebeu mensagem hoje, na ordem em que você falou. Serve para saber
              onde parou.
            </>,
            <>
              <Termo>Em destaque</Termo> — o que você fixou no topo por alguns dias.
            </>,
          ]}
        />
        <P>
          Acima da lista aparecem os <Termo>alertas</Termo>, que são conta feita sobre o que já está na tela. Cada um
          filtra a lista com um toque:
        </P>
        <Lista
          itens={[
            <>
              <Termo>Sem próximo passo</Termo> — negociação viva e nada combinado. É o erro que mais custa venda:
              marque o que fazer e quando.
            </>,
            <>
              <Termo>Parado há 7+ dias</Termo> — negociação sem contato há mais de uma semana. Retome ou feche como
              perdido; fila cheia de negócio morto atrapalha.
            </>,
            <>
              <Termo>Fechou e não entrou</Termo> — vendeu há mais de uma semana e o dono nunca acessou o painel. É aqui
              que nasce cancelamento.
            </>,
            <>
              <Termo>Destaque vence hoje</Termo> — amanhã sai do topo.
            </>,
          ]}
        />
      </Secao>

      <Secao id="gaveta" titulo="A gaveta do negócio">
        <P>
          Clicar em <Termo>Abrir</Termo> mostra o negócio inteiro, na ordem do trabalho:
        </P>
        <Passos
          itens={[
            <>
              <Termo>O combinado</Termo> — o que fazer e quando. É esse campo que alimenta “Atrasados” e “Para hoje”.
              Toda conversa termina com um próximo passo combinado.
            </>,
            <>
              <Termo>Etapa</Termo> — Novo, Oferta enviada, Negociando. Ao lado, separados, os desfechos: Fechou e
              Perdeu, que perguntam antes de gravar.
            </>,
            <>
              <Termo>Quem decide</Termo> — nome e WhatsApp do dono. Sem esse número, mensagem e cobrança vão para a
              recepção, e a recepção não decide.
            </>,
            <>
              <Termo>Mensagem</Termo> — os cinco modelos e o texto pronto.
            </>,
          ]}
        />
        <P>
          No rodapé, a barra fixa com <Termo>Abrir no WhatsApp</Termo> e <Termo>Anotar</Termo>. No menu “…” do topo
          ficam os atalhos (painel, site, agendamento) e a opção de tirar o site do ar. Preço, origem, destaque e as
          respostas de objeção ficam recolhidos — um clique quando precisar.
        </P>
        <P>
          <Termo>Manter em destaque</Termo> por 1, 3 ou 7 dias põe o negócio no topo de qualquer ordenação e vence
          sozinho. Use para o que você prometeu resolver nesta semana.
        </P>
      </Secao>

      <Secao id="mensagens" titulo="As mensagens">
        <P>
          São cinco modelos, com o momento certo escrito em cada um. A cadência é curta de propósito: no WhatsApp,
          insistir demais gera denúncia e derruba o número.
        </P>
        <Lista
          itens={[
            <>
              <Termo>Primeiro contato</Termo> — dia 0, em horário comercial. Sem link e sem preço: o objetivo é só a
              resposta.
            </>,
            <>
              <Termo>Lembrete</Termo> — 2 a 3 dias depois, com ângulo novo. Nunca “passando para saber se viu”.
            </>,
            <>
              <Termo>Última tentativa</Termo> — 10 dias depois. Porta aberta, sem cobrança. Sem resposta, pare por aqui.
            </>,
            <>
              <Termo>Proposta</Termo> — só depois do sim. É aqui que entram o link e os valores.
            </>,
            <>
              <Termo>Boas-vindas</Termo> — ao fechar, com os três passos da implantação.
            </>,
          ]}
        />
        <P>
          O texto é editável antes de enviar. Abrir no WhatsApp registra o envio na linha do tempo e marca o negócio em
          “Falei hoje”. Em <Termo>Se ele responder isso</Termo> estão as respostas para as objeções mais comuns.
        </P>
        <Atencao>
          As mensagens só saem depois que alguém assina, nos Ajustes. É o nome de uma pessoa que faz o cliente
          responder — “aqui é da Ruphus” não é ninguém.
        </Atencao>
      </Secao>

      <Secao id="fechar" titulo="Fechar e perder">
        <P>
          <Termo>Fechou</Termo> abre uma confirmação que faz três coisas de uma vez, e você escolhe quais: gera a
          cobrança da entrada, abre as boas-vindas no WhatsApp e inclui o convite do painel. Entrada em branco é venda
          sem entrada; a mensalidade é obrigatória.
        </P>
        <P>
          <Termo>Perdeu</Termo> exige o motivo — preço, já tem site ou agenda, sem interesse agora, não respondeu,
          fechou com outro, outro. É esse campo que alimenta o relatório “Por que perdemos”. Dá para marcar uma data
          para voltar a procurar: o negócio reaparece em “Para hoje” naquele dia.
        </P>
      </Secao>

      <Secao id="implantacao" titulo="Implantação e saúde">
        <P>
          Vender é metade. A implantação tem quatro passos, e a aba <Termo>Cliente</Termo> mostra quais faltam, com um
          botão para lembrar o dono pelo WhatsApp:
        </P>
        <Passos
          itens={[
            <>O dono aceitou o convite e entrou no painel.</>,
            <>Os serviços estão cadastrados.</>,
            <>Os profissionais estão cadastrados, com horários.</>,
            <>Chegou o primeiro agendamento pelo link.</>,
          ]}
        />
        <P>A partir daí, a tela <Termo>Clientes</Termo> classifica a saúde de cada um:</P>
        <Lista
          itens={[
            <>
              <Termo>Em risco</Termo> — cobrança atrasada, ou 21 dias sem nenhum agendamento.
            </>,
            <>
              <Termo>Atenção</Termo> — implantação incompleta, ou cobrança vencendo em até 5 dias.
            </>,
            <>
              <Termo>Saudável</Termo> — implantado, agendando e em dia.
            </>,
          ]}
        />
        <P>A lista vem do mais em risco para o mais saudável: é a ordem de quem ligar primeiro.</P>
      </Secao>

      <Secao id="cobranca" titulo="Cobrança">
        <P>
          O Pix é gerado pelo próprio sistema, com a chave da Ruphus. Cada cobrança vira um link que o dono abre no
          celular, com QR e copia e cola. O vencimento é sempre dia 10.
        </P>
        <Lista
          itens={[
            <>
              Na gaveta, aba Cobrança: <Termo>Cobrar entrada</Termo> e <Termo>Cobrar mês atual</Termo>. O valor vem do
              bloco de preço — sem valor cadastrado, não gera.
            </>,
            <>
              A aba <Termo>Cobrança</Termo> do topo reúne tudo o que está vencido, com botão para cobrar no WhatsApp e
              para tirar o site do ar.
            </>,
            <>
              <Termo>Marcar paga</Termo> pede o valor recebido e a data. A confirmação não é automática: é o comprovante
              que chega no WhatsApp que fecha a conta.
            </>,
            <>Cobrança cancelada libera o mês para gerar outra.</>,
          ]}
        />
      </Secao>

      <Secao id="ajustes" titulo="Ajustes e limites">
        <P>Na engrenagem do topo ficam as configurações que valem para toda a plataforma:</P>
        <Lista
          itens={[
            <>
              <Termo>Quem assina as mensagens</Termo> — o nome que aparece em toda mensagem pronta.
            </>,
            <>
              <Termo>Sair sozinho depois de parado</Termo> — minutos até encerrar a sessão; 0 desliga. Vale também para
              o painel dos clientes.
            </>,
          ]}
        />
        <P>Por negócio, na aba Cliente da gaveta:</P>
        <Lista
          itens={[
            <>
              <Termo>Convite do dono</Termo> — o link vale 7 dias e serve uma vez só. Copiar de novo não gera outro
              link; “Gerar outro” gera.
            </>,
            <>
              <Termo>Profissionais no plano</Termo> — 5 por padrão, ajustável.
            </>,
            <>
              <Termo>Negócios nesta conta</Termo> — 1 por padrão, ajustável.
            </>,
            <>
              <Termo>Encerrar sessões</Termo> — derruba os acessos abertos daquela conta. Use quando um acesso vazar.
            </>,
          ]}
        />
        <Atencao>
          Tirar o site do ar é a última cartada da cobrança: o endereço, o agendamento e o minisite param de responder
          para os clientes do negócio em poucos minutos. Reversível pelo mesmo caminho.
        </Atencao>
      </Secao>

      <Rodape outro="/admin" rotulo="Ir para o admin" />
    </>
  );
}
