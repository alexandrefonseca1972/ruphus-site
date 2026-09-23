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
4. O merge na `main` dispara o deploy da Vercel.
5. Conferir: `curl -s https://www.ruphus.site/painel | grep -o 'dpl_[A-Za-z0-9]*'`
   deve mostrar um id novo, e o rodapé do `/admin` a versão nova.

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
`FIREBASE_SERVICE_ACCOUNT` (Vercel).

> `vercel link` e `vercel env pull` **reescrevem o `.env.local`** e levam essa
> linha junto. Se acabou de rodar um deles, é isso.

### Erro estranho dentro de `node_modules`

Lockfile e `node_modules` fora de sincronia. `npm ci` resolve. Acontece depois
de `npm audit fix` desfeito sem reinstalar.

### O site de um cliente sumiu

1. Ele está fora do ar de propósito? (`/admin`, etiqueta "fora do ar")
2. `curl -sI https://<slug>.ruphus.site/` — 404 com a página "indisponível"
   significa lista de desativados; 404 seco significa pasta ausente em
   `public/s/<slug>`.
3. Pasta ausente: `npm run sync:sites` e publique.

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

## Rotinas com script

Todo script que grava tem modo de simulação — rode sem `--aplicar` primeiro.

```bash
npm run membros            # preenche e-mail e nome nos acessos antigos
npm run import:sites       # importa sites e cria os negócios
npm run seed:agenda        # cria serviços e equipe a partir do site
npm run vitrine            # atualiza a vitrine da landing
npm run sync:sites         # copia ../sites para public/s
npm run convite -- <slug>  # gera um link de convite pela linha de comando
```

---

© 2026 Ruphus. Todos os direitos reservados.
