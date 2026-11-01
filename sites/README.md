# Sites personalizados

Páginas individuais publicadas no Storage pelo fluxo existente. Seguem a composição editorial existente em `src/lib/site-editorial.ts` e o CSS compartilhado `public/s/assets/gerado/beleza.css`: abertura com fotografia de fundo, nome em destaque, faixa de serviços e seções do modelo. O modelo compartilhado e a agenda do aplicativo não foram alterados.

- `mais-depil`: depilação a laser e avaliação.
- `belissima-flor-depil`: depilação e estética, conforme apresentação pública em https://www.belissimaflordepil.com.br/ (consultada em 22/10/2026). A agenda ainda tem somente limpeza de pele e avaliação estética; depilação direciona ao WhatsApp, sem criar preços ou serviços no banco.

Valores e duração são consultados em `/agendar`, sem duplicação nesta página. As imagens são ilustrativas e estão identificadas na página; não retratam os estabelecimentos. Fotos reais, áreas atendidas, protocolos, equipe e condições comerciais precisam de confirmação do negócio. A abertura da Belíssima usa `public/s/assets/beleza/depilacao-1/hero.jpg` e a galeria usa o mesmo kit de depilação (créditos em `public/s/assets/beleza/creditos.json`); a da Mais Depil é uma imagem gerada de depilação a laser (ferramenta nativa ImageGen).

O HTML personalizado responde antes do gerador. Alterações futuras de nome, contato ou lista de serviços no painel devem ser refletidas aqui e republicadas. A agenda continua lendo seu cadastro normalmente. Não mover estes arquivos para `public/s`: isso faria o arquivo do deploy responder antes das versões e restaurações do Storage.

Para publicar, primeiro simule e confira os arquivos:

```sh
npm run site -- publicar mais-depil sites/mais-depil
npm run site -- publicar belissima-flor-depil sites/belissima-flor-depil
```

Após conferir, repita com `--aplicar`. Para voltar ao modelo gerado, remova apenas os arquivos personalizados desse slug no Storage; a rota existente volta a renderizar o cadastro.


## Imagem ilustrativa da Mais Depil

Prompt: fotografia editorial vertical de uma profissional com luvas aplicando um equipamento de depilação a laser sem marca na parte inferior da perna de uma mulher adulta, em maca limpa, luz natural suave e tons neutros com lilás discreto. Apenas mãos, equipamento e pernas; sem rosto, nudez, texto, logotipo, cera ou feixe luminoso visível. Não representa o estabelecimento real.


## Mansão Spa Pink

Referência: https://www.instagram.com/mansao.spapink/ (bio, destaques e posts públicos consultados em 22/10/2026). O perfil informa bronzeamento, camuflagem de estrias e cicatrizes, cursos, Arniqueiras e WhatsApp (61) 99183-7491.

- https://www.instagram.com/mansao.spapink/reel/DeuEGKARk-0/: anúncio de 20/10/2026 da nova unidade em Arniqueiras, em obras, com previsão de inauguração a partir de 27/10. Endereço completo não confirmado: a página pede confirmação no WhatsApp e não mostra o mapa antigo.
- https://www.instagram.com/mansao.spapink/p/DeAHJaJGI3Y/ e https://www.instagram.com/mansao.spapink/reel/DeUPjF4RYVK/: imagens da unidade anterior no Lago Sul, identificadas como históricas na galeria. Miniaturas públicas foram copiadas para arquivos WebP locais para não depender de URLs temporárias do Instagram.
- `hero-bronze.webp`: imagem ilustrativa do banco já existente (`public/s/assets/beleza/bronze-1/hero.jpg`, Pexels; créditos no diretório de beleza). A paleta rosa segue o perfil e seus destaques; o layout usa o modelo editorial do projeto.
- Consulta e formulário vão ao WhatsApp confirmado na bio. Não foram criados serviços, preços ou horários no banco. O link externo agendar.mansaospapink.com.br exibido na bio não resolveu DNS no momento da consulta, por isso não foi colocado no fluxo.

Publicação: `npm run site -- publicar mansao-spa-pink sites/mansao-spa-pink` (simulação), seguido de `--aplicar` após conferir.

## Studio Lilian Galvão

Referências consultadas em 22/10/2026: https://www.instagram.com/galvaomanicure/, a agenda https://app.senseapp.com.br/agendar/studioliliangalvao (link da bio) e a ficha do Google do Studio Lilian Galvão.

O gerador tratava o endereço como salão de cabelo (corte, escova, coloração e hidratação). O perfil é de manicure no Riacho Fundo II: especialista em cutilagem, com mais de dez anos segundo o texto da agenda. A profissional listada é Lilian Galvão. WhatsApp (61) 99654-2147, o mesmo da ficha do Google.

- Serviços, durações e valores saem da agenda Sense, sem criar nada no banco. A agenda escreve "Manuntecao F1"; a página mostra "Manutenção F1". O pacote de unhas (2 h, R$ 190) não descreve o que inclui.
- Endereço: Google mostra QN 8C, Riacho Fundo II, Brasília/DF, CEP 71808-303. O botão de localização da agenda abre a busca "Qn 8c conj 3 lote 25 loja 3". Em 22/10/2026 a ficha estava fechada e indicava abertura na sexta às 8h; a semana inteira não estava expandida.
- Nota 5,0 e 15 avaliações vêm do Google. Três frases da ficha entram na página com o nome de quem avaliou.
- Capa e galeria são imagens ilustrativas dos serviços (manicure, esmaltação em gel, pedicure e spa dos pés), em substituição às miniaturas pequenas do Instagram. Os trabalhos reais continuam no perfil, ligado na página.
- O horário oficial aponta para a agenda Sense. O formulário só monta mensagem de WhatsApp. `/agendar` do aplicativo continua com os serviços antigos de cabelo e não foi ligado nesta página, para não abrir uma segunda agenda.

Publicação: `npm run site -- publicar studio-lilian-galvao sites/studio-lilian-galvao` (simulação), seguido de `--aplicar` após conferir.
