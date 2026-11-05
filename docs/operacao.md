# Operação

O que fazer quando precisa fazer. Cada procedimento diz o comando, o efeito e
como conferir que deu certo.

> O porquê das coisas está no [manual técnico](./manual-tecnico.md). Aqui é só
> a mão na massa.

---

## Publicar uma mudança

1. Branch, commit, PR.
2. Espere o CI **do commit final** — não o de um commit anterior do PR.
3. `gh pr merge <n> --squash --delete-branch`.
4. Publicar na VPS: `git switch --detach origin/main && bash scripts/deploy-vps.sh`.
5. Conferir: o rodapé do `/admin` mostra o commit novo.

## Publicar regras do Firestore ou do Storage

Sempre **depois** do código, nunca antes: regra nova contra código velho quebra
o que está no ar.

```bash
npx firebase deploy --only firestore:rules,storage
```

Confira a saída: precisa dizer `released rules` para cada arquivo publicado.

## Subir versão

1. `package.json` → `version`.
2. Uma entrada no `CHANGELOG.md`, do ponto de vista de quem usa.
3. Build e publique. O rodapé do `/admin` mostra `vX.Y.Z · commit`.

---

## Tirar um site do ar (e devolver)

No `/admin`, abra o negócio → menu **"…"** → **Tirar o site do ar**. Ou, na aba
Cobrança, no item da cobrança vencida.

- Efeito: endereço, agendamento e minisite param de responder em até ~90 s. O
  visitante vê a página "Este site está fora do ar".
- Nada é apagado: dados, agenda e clientes continuam.
- Devolver: o mesmo caminho, agora **Colocar o site no ar**.

## Dar acesso a alguém

1. `/admin` → abra o negócio → aba **Cliente** → **Convidar**.
2. Mande o link. Ele vale **7 dias** e serve **uma vez**.
3. Quem abrir entra com a conta dele e vira admin **daquele** negócio.

"Copiar link" de novo **não** gera outro token; "Gerar outro" gera.

## Tirar acesso

- **Remover** (aba Cliente): apaga o vínculo. Efeito imediato na próxima ação.
- **Encerrar sessões**: invalida os tokens já emitidos daquela conta, sem
  esperar expirar. Use quando um acesso vazar.
- O `owner` não pode ser removido.

## Promover alguém a admin da plataforma

```bash
npm run admin -- add <uid|email>
npm run admin -- list
npm run admin -- remove <uid|email>
```

Roda com a credencial de serviço, fora do app. `config/admin` não é gravável
por nenhuma regra.

## Mudar os limites de um cliente

Tudo no `/admin`, aba Cliente da gaveta:

- **Profissionais no plano** — padrão 5, até 50.
- **Negócios nesta conta** — padrão 1, até 50.

---

## Cobrança

### Gerar

Gaveta → aba **Cobrança** → **Cobrar entrada** ou **Cobrar mês atual**. O valor
vem do bloco de preço; sem valor cadastrado, não gera.

### Receber

O Pix cai na conta da Ruphus e **não** há confirmação automática. O cliente
manda o comprovante; você usa **Marcar paga**, informando valor e data.

### Cancelar

**Cancelar** libera a competência: dá para gerar outra cobrança do mesmo mês.
Cobrança cancelada não recebe baixa.

### Trocar a chave Pix

Aba **Cobrança** do topo → **Chave Pix da Ruphus**. Vale para toda cobrança
aberta a partir dali — as já geradas mantêm o código antigo.

---

## Quando algo quebra

### O admin da plataforma cai no `/painel`

O Admin SDK não está conseguindo ler `config/admin`. Quase sempre é credencial:
confira `GOOGLE_APPLICATION_CREDENTIALS` no `.env.local` (local) ou
`FIREBASE_SERVICE_ACCOUNT` (no `.env.local` da VPS).

### Erro estranho dentro de `node_modules`

Lockfile e `node_modules` fora de sincronia. `npm ci` resolve. Acontece depois
de `npm audit fix` desfeito sem reinstalar.

### O site de um cliente sumiu

1. Ele está fora do ar de propósito? (`/admin`, etiqueta "fora do ar")
2. `curl -sI https://<slug>.ruphus.site/` — 404 com a página "indisponível"
   significa lista de desativados; 404 seco significa que o site não está
   publicado no Storage (nem é do gerador).
3. Publicaram algo errado? `npm run site -- restaurar <slug>` lista as
   publicações e `restaurar <slug> <momento> --aplicar` volta o site inteiro ao
   que estava no ar (o bucket guarda até 5 versões de cada arquivo por 90 dias;
   o que foi apagado também volta).
4. Confira com `npm run site -- baixar <slug> /tmp/x`. Se não estiver, publique
   de novo (`npm run site -- publicar <slug> <pasta> --aplicar`, ou
   `npm run sync:sites` para a fábrica inteira) — **a menos que seja um site
   do gerador** (da Coleta ou de `npm run gerar:sites`): esses não têm pasta, são montados do
   Firestore. Se um deles some, confira se o tenant ainda tem o campo `gerado`.

### Um cliente se cadastrou sozinho

Ele já tem site, agenda (serviços do ramo e uma equipe) e ficha no funil com a
origem "Cadastro no site". Os dados do negócio (WhatsApp, endereço, Instagram,
horário) ele mesmo edita na aba "Meu negócio". O site dele não traz a faixa de
proposta.

### Gerar sites a partir de uma planilha

A aba Gerador saiu do `/admin` (os leads novos vêm da Coleta). Planilha, só pela
linha de comando: `npm run gerar:sites -- planilha.xlsx` mostra o que vai
acontecer com cada linha; com `--aplicar` grava. Todas as abas com cabeçalho são lidas (levas de um mesmo
levantamento); aba de notas é pulada.

O telefone identifica o negócio: se ele já tem site da fábrica ou conta, a linha
fica de fora; se já tem site gerado, é atualizado — agenda e funil não são
mexidos. Nicho fora dos modelos (pet, beleza, tatuagem, saúde, aulas, fitness e automotivo) sai com o motivo na lista.
Telefone de cliente que se cadastrou sozinho também fica de fora: o site é dele.
Telefone com cara de inventado (99999-9999, 98811-2233, 91234-5678) fica de fora:
confira o número no Google e corrija a linha.

### Publicar um site (tirar a faixa de proposta)

Todo site gerado — da planilha ou do cadastro — é proposta até a entrada ser paga:
faixa no topo e fora do Google. Dar baixa na **entrada** (gaveta → Cobrança →
"Marcar como paga") publica o site na hora: a faixa sai e ele passa a ser
indexado. A mensalidade não publica nada. A aba **Site** da gaveta mostra se o
site está publicado.

### Montar ou completar o site de um negócio

Gaveta do negócio → aba **Site**. Serve sobretudo para quem se cadastrou sozinho:
o site dele sai só com nome, ramo, WhatsApp e cidade. Complete bairro, endereço,
horário e a nota do Google; "Revisar mudanças" mostra campo a campo o que muda,
e só grava em "Publicar mudanças". Conta antiga sem site ganha o site ao escolher
o ramo. O site do cadastro continua sem a faixa de proposta; serviços, equipe e
agenda não mudam. Em site da fábrica mudam só os dados da bio e do agendamento.

### Personalizar o visual de um site (fotos, cores, fonte, textos, IA)

Gaveta do negócio → aba **Site** → seção **Visual** (todo site do gerador: no modelo
editorial, de beleza, fitness e automotivo, e no claro, de pet, saúde e aulas). No
claro, "tinta" é a cor principal (botões e selo) e "destaque" a de realce; o Sobre
próprio ganha uma seção. Cinco posições de foto (topo, galeria 1 a 3
e a faixa da bio): "Enviar" abre a galeria ou a câmera no celular; JPG, PNG ou WebP
até 12 MB, o servidor endireita e redimensiona e grava em `sites/{slug}/fotos/`. "✕"
volta à foto do modelo. Tinta e destaque pelos seletores de cor, fonte dos títulos no
seletor, frase do topo, Sobre e título da galeria nos campos. Nada entra no site até
"Publicar visual": "Pré-visualizar" mostra o rascunho com os dados reais. Publicar
grava `gerado.personal` e troca a cor e a foto da bio; o site, a bio e a imagem do
WhatsApp saem do cache na hora. Reenviar a planilha, editar os dados ou trocar o ramo
não apaga a personalização; trocar o modelo mantém as fotos e as cores próprias.

Com `ANTHROPIC_API_KEY` cadastrada em Ajustes, a seção ganha "Conversar com a IA":
escreva o pedido ("sugira uma paleta a partir das fotos e reescreva o Sobre"), a IA
responde em até três frases e lista as mudanças (cores, fonte, textos; fotos nunca);
marque o que entra e "Aplicar na prévia" leva ao rascunho. Cada pedido é uma chamada
ao modelo `claude-opus-5-5` com as fotos próprias reduzidas a 512 px. Sem a chave, a
seção mostra a dica e esconde o chat. Plano e decisões em
`docs/plano-personalizacao-site.md`.

`npm run site -- publicar <slug> <pasta>` sincroniza a pasta com `sites/{slug}/` mas
não apaga `fotos/`. Não publique um `index.html` num site do gerador: ele passa a
responder no lugar do gerador.

### Ninguém consegue agendar em um negócio

Confira, nessa ordem: existe serviço **ativo**? existe profissional **ativo**?
esse profissional faz o serviço? tem horário naquele dia da semana? O motor só
oferece o horário em que o serviço cabe inteiro no expediente.

### "Muita gente agendando ao mesmo tempo"

É a proteção de concorrência falando. Normal em pico; se persistir sem volume,
verifique se algum script está escrevendo na agenda em laço.

### CI vermelho na `main`

Aconteceu quando um PR foi mesclado com base na execução de um commit anterior.
Conserte na frente: branch, correção, PR, CI verde **no commit final**, merge.

---

## Mudar os Termos de Contratação

Versão publicada não muda: quem aceitou leu aquele texto, e o e-mail de
confirmação aponta para `/termos/{versão}`.

1. Edite `docs/contrato-prestacao-servico.md` e suba a versão no topo.
2. Suba `CONTRATO_VERSAO` em `src/lib/contrato.ts` para o mesmo número. Se o
   resumo mudou, atualize `RESUMO_CONTRATO` no mesmo arquivo.
3. `npm run termos` gera `public/termos/{versão}/` e atualiza `/termos`. O script
   recusa campo `[[...]]` pendente, versão diferente entre o contrato e o código,
   e texto novo numa versão já publicada.
4. Mudança que afete direitos do cliente só vale com novo aceite (cláusula 15.3).
   **O painel ainda não pede o aceite de novo a quem já é cliente**: faça isso
   antes de publicar a versão 1.1.
5. Quem aceitou: coleção `aceites` no Firestore (só pelo console ou Admin SDK).

## Rotinas com script

Todo script que grava tem modo de simulação — rode sem `--aplicar` primeiro.

```bash
npm run membros            # preenche e-mail e nome nos acessos antigos
npm run gerar:sites -- planilha.xlsx   # gera sites da planilha (--aplicar grava)
npm run exemplos:nichos -- --aplicar   # sites de exemplo de pet, saúde e cursos (exemplo-*), fora do funil
npm run import:sites       # importa sites e cria os negócios
npm run seed:agenda        # cria serviços e equipe a partir do site
npm run vitrine            # atualiza a vitrine da landing
npm run sync:sites         # publica ../sites no Storage (e copia assets/ para public/s)
npm run site -- publicar <slug> <pasta>   # site da fábrica no ar sem deploy (--aplicar grava)
npm run site -- baixar <slug> <pasta>     # baixa o site publicado para editar
npm run site -- restaurar <slug> [momento]   # lista as publicações / volta o site a uma delas (--aplicar grava)
npm run convite -- <slug>  # link de convite pela linha de comando (exige donoEmail no CRM)
```

---

© 2026 Ruphus. Todos os direitos reservados.
