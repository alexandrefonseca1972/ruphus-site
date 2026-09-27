import { Atencao, Capa, Indice, Lista, P, Passos, Rodape, Secao, Termo } from "../conteudo";

// Manual de quem vende: o painel /admin, do primeiro contato à implantação.

export default function ManualDoVendedor() {
  return (
    <>
      <Capa
        titulo="Como vender pelo painel"
        linha="O /admin é a sua mesa de trabalho: a lista de quem procurar, o funil, as mensagens prontas, a demonstração e a cobrança. Este manual segue a ordem do dia, do primeiro contato ao cliente implantado."
      />

      <Indice
        itens={[
          ["dia", "Começo do dia"],
          ["encontrar", "Encontrar quem procurar"],
          ["funil", "O funil"],
          ["gaveta", "A gaveta do negócio"],
          ["mensagens", "As mensagens e a proposta"],
          ["demonstracao", "A demonstração"],
          ["fechar", "Fechar e perder"],
          ["implantacao", "Implantação e saúde"],
          ["cobranca", "Cobrança"],
          ["gerador", "Gerador de sites"],
          ["ajustes", "Ajustes e limites"],
        ]}
      />

      <Secao id="dia" titulo="Começo do dia">
        <P>
          Abra o painel na <Termo>Lista</Termo> e trabalhe as visões da esquerda para a direita. As quatro primeiras são
          a sua fila do dia:
        </P>
        <Lista
          itens={[
            <>
              <Termo>Atrasados</Termo> — você combinou algo para uma data que já passou. É a primeira fila do dia.
            </>,
            <>
              <Termo>Para hoje</Termo> — o que ficou combinado para hoje. Quem se cadastra sozinho no site também cai
              aqui, com o passo “Dar boas-vindas” já marcado para o dia.
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
          Depois delas, as visões de consulta: <Termo>Todos</Termo>, <Termo>Sem cliente dentro</Termo> (o dono ainda
          não entrou no painel), <Termo>Em negociação</Termo> e <Termo>Fora do ar</Termo>.
        </P>
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

      <Secao id="encontrar" titulo="Encontrar quem procurar">
        <P>
          A busca do topo (atalho: tecla <Termo>/</Termo>) acha por nome, endereço do site, cidade ou telefone. Para
          montar uma fila de prospecção, use os <Termo>Filtros</Termo>:
        </P>
        <Lista
          itens={[
            <>
              <Termo>Estado</Termo> e <Termo>Cidade</Termo> — com um estado escolhido, a lista de cidades mostra só as
              dele. Cada opção traz quantos negócios tem.
            </>,
            <>
              <Termo>Nicho</Termo> — barbearia, salão, pet shop, estética…
            </>,
            <>
              <Termo>Funil</Termo> e <Termo>Compromisso</Termo> — em que etapa está a conversa e se o combinado está
              atrasado, é hoje ou está em dia.
            </>,
          ]}
        />
        <P>
          A <Termo>Ordem</Termo> padrão é <Termo>Mais relevantes</Termo>: nota do Google pesada pelo número de
          avaliações. É a melhor fila para prospectar — quem é bem avaliado e tem muito cliente sente mais a falta de
          uma agenda online. Os negócios em destaque ficam sempre no topo, em qualquer ordem. Filtros e ordem valem
          também para o Funil.
        </P>
      </Secao>

      <Secao id="funil" titulo="O funil">
        <P>
          O <Termo>Funil</Termo> mostra os mesmos negócios da lista em colunas: Novo, Oferta enviada, Negociando,
          Fechado e Perdido. Arrastar um cartão muda a etapa; soltar em Fechado ou Perdido pergunta antes de gravar,
          como na gaveta.
        </P>
        <Lista
          itens={[
            <>
              <Termo>Novo</Termo> guarda a base inteira — mais de mil negócios. A coluna mostra só os 6 primeiros, na
              ordem da lista (mais relevantes, com quem tem data combinada antes). “Mostrar mais” soma de 6 em 6; “Ver os
              N novos na Lista” abre a fila completa, com filtros.
            </>,
            <>
              Em cima, os números do <Termo>período</Termo> (este mês, 30 ou 90 dias, desde o início): receita
              fechada, em negociação, vendas, taxa de ganho, tempo até fechar e ações atrasadas, além da conversão de
              uma etapa para a outra.
            </>,
            <>
              Embaixo, <Termo>De onde vêm os clientes</Termo> (origem de cada contato), <Termo>Anúncios</Termo> (cada
              campanha e quantos negócios criou e fechou) e <Termo>Por que perdemos</Termo>.
            </>,
          ]}
        />
      </Secao>

      <Secao id="gaveta" titulo="A gaveta do negócio">
        <P>
          Clicar num negócio abre a gaveta. No topo, o nome, o endereço do site, a cidade e o ramo, a etapa e o prazo
          do combinado. Logo abaixo, cinco abas: <Termo>Venda</Termo>, <Termo>Histórico</Termo>,{" "}
          <Termo>Cliente</Termo>, <Termo>Site</Termo> e <Termo>Cobrança</Termo>.
        </P>
        <P>A aba Venda é a do dia a dia, na ordem do trabalho:</P>
        <Passos
          itens={[
            <>
              <Termo>O combinado</Termo> — o que fazer e quando. É esse campo que alimenta “Atrasados” e “Para hoje”.
              Toda conversa termina com um próximo passo combinado.
            </>,
            <>
              <Termo>Levantamento</Termo> — nos negócios que vieram de planilha, o score e a abordagem sugerida pela
              pesquisa. Leia antes do primeiro contato.
            </>,
            <>
              <Termo>Etapa</Termo> — Novo, Oferta enviada, Negociando. Ao lado, separados, os desfechos: Fechou e
              Perdeu, que perguntam antes de gravar.
            </>,
            <>
              <Termo>Contato do dono</Termo> — quem decide: nome, papel (dona, sócio…), WhatsApp e e-mail. Sem o número,
              mensagem e cobrança vão para a recepção, e a recepção não decide. Sem o e-mail, o convite do painel não
              sai.
            </>,
            <>
              <Termo>Mensagem</Termo> — os cinco modelos e o texto pronto.
            </>,
          ]}
        />
        <P>
          Recolhidos, a um clique: <Termo>Como chegou</Termo> (a origem, e o anúncio, se veio de um),{" "}
          <Termo>Destaque</Termo>, a <Termo>Proposta</Termo> com os valores e as respostas de objeção. No fim, as
          últimas anotações; a linha do tempo inteira fica na aba Histórico.
        </P>
        <P>
          No rodapé, a barra fixa com <Termo>Abrir no WhatsApp</Termo> e <Termo>Anotar</Termo>. No menu “…” do topo
          ficam os atalhos (painel do negócio, site, agendamento) e a opção de tirar o site do ar.
        </P>
        <P>
          <Termo>Manter em destaque</Termo> por 1, 3 ou 7 dias põe o negócio no topo de qualquer ordenação e vence
          sozinho. Use para o que você prometeu resolver nesta semana.
        </P>
        <P>
          A aba <Termo>Site</Termo> monta ou completa o site do negócio: bairro, endereço, horário e a nota do Google,
          que só o admin informa. Ela mostra a prévia do que muda antes de publicar.
        </P>
      </Secao>

      <Secao id="mensagens" titulo="As mensagens e a proposta">
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
              <Termo>Boas-vindas</Termo> — ao fechar, com os passos da implantação.
            </>,
          ]}
        />
        <P>
          O texto é editável antes de enviar. Abrir no WhatsApp registra o envio na linha do tempo e marca o negócio em
          “Falei hoje”. Em <Termo>Se ele responder isso</Termo> estão as respostas para as objeções mais comuns.
        </P>
        <P>
          <Termo>A proposta tem página própria.</Termo> No bloco Proposta da gaveta, “Gerar link da proposta” cria um
          endereço que mostra o que está incluído, os valores combinados e o botão “Quero começar”. O mesmo link vai
          pelo WhatsApp e pelo e-mail, e o dono lê no celular. Vale 7 dias; “Refazer” invalida o anterior.
        </P>
        <P>
          <Termo>Quem prefere anexo tem PDF.</Termo> “Baixar PDF”, ao lado de “Ver como o dono vê”, abre a proposta já
          na caixa de impressão: salve como PDF e anexe no e-mail ou no WhatsApp. É a mesma proposta do link impressa,
          com o WhatsApp da Ruphus no rodapé — então o arquivo funciona sozinho, se for repassado adiante.
        </P>
        <Atencao>
          As mensagens só saem depois que alguém assina, nos Ajustes. É o nome de uma pessoa que faz o cliente
          responder — “aqui é da Ruphus” não é ninguém.
        </Atencao>
      </Secao>

      <Secao id="demonstracao" titulo="A demonstração">
        <P>
          O menu <Termo>Demonstração</Termo>, no topo do admin, abre a conta de exemplo — a Barbearia Force — para
          mostrar o produto funcionando: site, bio, agendamento e painel do dono, cada um num link.
        </P>
        <Passos
          itens={[
            <>
              Na conversa, mostre o <Termo>site</Termo> e o <Termo>agendamento</Termo> no celular do cliente: ele marca
              um horário de verdade e vê como chega.
            </>,
            <>
              Para ele testar o painel sozinho, passe o <Termo>acesso de dono</Termo> do menu (e-mail e senha, com
              botão de copiar). Ele entra em ruphus.site/login e pode mexer em tudo: agenda, serviços, equipe,
              clientes.
            </>,
            <>
              Depois do teste, <Termo>Restaurar padrão</Termo> apaga o que ele fez, volta aos dados de exemplo e troca a
              senha — quem testou deixa de entrar.
            </>,
          ]}
        />
        <P>
          Os dados de exemplo são montados a partir do dia em que se restaura: atendimentos do último mês, faltas,
          cancelamentos, a agenda da próxima semana, clientes “sumidos” e um plano recorrente. A demonstração também
          volta ao padrão sozinha toda madrugada, às 3h.
        </P>
        <Atencao>
          A senha muda a cada restauração, inclusive a da madrugada. Copie sempre a do dia no menu antes de passar ao
          cliente. O WhatsApp da demonstração, (96) 99999-0000, é de teste e não chama ninguém.
        </Atencao>
      </Secao>

      <Secao id="fechar" titulo="Fechar e perder">
        <P>
          <Termo>Fechou</Termo> abre uma confirmação que faz três coisas de uma vez, e você escolhe quais: gera a
          cobrança da entrada, abre as boas-vindas no WhatsApp e inclui o convite do painel. Entrada em branco é venda
          sem entrada; a mensalidade é obrigatória. Sem o e-mail do dono cadastrado, o convite não sai — e o aviso no
          fim diz isso, para as boas-vindas não irem sem o acesso sem ninguém notar.
        </P>
        <P>
          <Termo>Perdeu</Termo> exige o motivo — preço, já tem site ou agenda, sem interesse agora, não respondeu, o
          negócio fechou, outro. É esse campo que alimenta o relatório “Por que perdemos”. Dá para marcar uma data para
          voltar a procurar: o negócio reaparece em “Para hoje” naquele dia.
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
        <P>A partir daí, a tela <Termo>Clientes</Termo> do topo classifica a saúde de cada um:</P>
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
          O Pix é gerado pelo próprio sistema, com a chave da Ruphus cadastrada na tela Cobrança. Cada cobrança vira um
          link que o dono abre no celular, com QR e copia e cola. O vencimento é sempre dia 10.
        </P>
        <Lista
          itens={[
            <>
              Na gaveta, aba Cobrança: <Termo>Cobrar entrada</Termo> e <Termo>Cobrar mês atual</Termo>. O valor vem do
              bloco Proposta — sem valor cadastrado, não gera.
            </>,
            <>
              A tela <Termo>Cobrança</Termo> do topo reúne tudo o que está vencido, com botão para cobrar no WhatsApp e
              para tirar o site do ar.
            </>,
            <>
              <Termo>Marcar paga</Termo> pede o valor recebido e a data. A confirmação não é automática: é o comprovante
              que chega no WhatsApp que fecha a conta.
            </>,
            <>
              <Termo>Dar baixa na entrada publica o site.</Termo> Até lá, o site é uma proposta: abre e recebe
              agendamentos, mas com a faixa “ainda não publicado” e fora do Google.
            </>,
            <>Cobrança cancelada libera o mês para gerar outra.</>,
          ]}
        />
      </Secao>

      <Secao id="gerador" titulo="Gerador de sites">
        <P>
          O <Termo>Gerador</Termo> transforma uma planilha de leads (.xlsx) em sites prontos para prospectar, cada um
          com agenda online e já na lista como Novo.
        </P>
        <Passos
          itens={[
            <>
              Suba a planilha. O gerador reconhece os nomes de coluna mais comuns do levantamento — nome (ou “Nome da
              Empresa”), telefone/WhatsApp, categoria ou nicho, endereço, bairro, cidade, UF, nota, avaliações,
              Instagram, horário, score e abordagem.
            </>,
            <>
              Confira a <Termo>prévia</Termo>: o que vai ser criado, atualizado ou pulado, e as linhas que ficam de
              fora, com o motivo.
            </>,
            <>
              Aplique. Os sites entram no ar como proposta, e o score e a abordagem viram o cartão Levantamento da
              gaveta.
            </>,
          ]}
        />
        <Lista
          itens={[
            <>
              <Termo>Sem telefone, não entra.</Termo> Sem contato não há proposta nem agendamento. Telefone fixo entra,
              com aviso: o botão de WhatsApp do site não vai funcionar.
            </>,
            <>
              <Termo>O telefone identifica o negócio.</Termo> Subir a mesma planilha de novo atualiza os sites, não
              duplica. Quem já tem site da fábrica ou é cliente do cadastro fica de fora.
            </>,
            <>O gerador faz sites de beleza e de pet; outros ramos ficam de fora na leitura.</>,
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
            <>
              <Termo>Pixel da Meta</Termo> — o ID do Pixel dos anúncios. A landing e o cadastro passam a medir visitas e
              cadastros para as campanhas.
            </>,
          ]}
        />
        <P>Por negócio, na aba Cliente da gaveta:</P>
        <Lista
          itens={[
            <>
              <Termo>Convite do dono</Termo> — o link vale 7 dias, serve uma vez só e abre <b>só com o e-mail do dono</b>,
              depois de ele confirmar o endereço. Por isso o botão só aparece com o e-mail preenchido na aba Venda: é
              ele que impede que um link repassado vire acesso de outra pessoa. Copiar de novo não gera outro link;
              “Gerar outro” gera.
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
