# Plano: personalizar site editorial e /bio pelo /admin, com assistente de IA

## Contexto

Hoje o admin edita só dados do negócio (nome, ramo, WhatsApp, endereço, horário, nota) e troca o "modelo" (par kit de fotos + paleta) com prévia. Não existe foto própria, cor livre, fonte, texto próprio, upload pelo navegador nem IA. Todos os 15.631 sites já são do gerador (conversão concluída em 03/11), então o site é montado do Firestore e qualquer campo novo aparece sem deploy.

Decisões do usuário: IA em chat na gaveta que devolve mudanças estruturadas, gera textos e sugere paleta/fonte a partir das fotos; fotos por upload do admin (banco Pexels como fallback); escopo = modelo editorial (beleza, fitness, automotivo) + /bio; modelo claro fica igual. Só admin da plataforma.

Fatos do código: `visualEditorial` (`src/lib/site-editorial.ts:260`) decide paleta `[ink,acc,deep,tint]`, kit e fonte (sorteada por hash do slug, `FONTES` `:64`); `renderEditorial` injeta `:root{--ink…--serif}` (`:326`) e fotos `..${kit}/hero.jpg`, `ga1..3` (`:343,:370`); `registrosDoSite` (`src/lib/gerador.server.ts:56`) regrava `site.color/photo` a cada planilha; `/bio` lê `site.color` e `site.photo` e serve `/s/{slug}{foto}` do Storage (`src/app/bio/[tenant]/page.tsx:202`); `sites/{slug}/**` já é servido pela rota `[...arquivo]`; segredos de serviço ficam em `INTEGRACOES` (`src/lib/integracoes.server.ts:13`), editáveis em Ajustes; `sharp` só existe como dependência transitiva; server actions têm teto de 1 MB; nenhum teste cobre modelo/prévia.

Precedência: `personal` > `modelo` > `escolha` > sorteio do slug.

## 1. Dados: `gerado.personal`

Zod em `src/lib/site-editorial.ts`, ao lado de `FONTES`:

```ts
const HEX = z.string().regex(/^#[0-9a-f]{6}$/i).transform((h) => h.toLowerCase());
const FOTO = z.string().regex(/^fotos\/(hero|ga1|ga2|ga3|bio)\.jpg$/);
export const NOMES_FONTE = FONTES.map(([n]) => n) as [string, ...string[]];
export const Personal = z.object({
  fotos: z.object({ hero: FOTO, ga1: FOTO, ga2: FOTO, ga3: FOTO, bio: FOTO }).partial(),
  cores: z.object({ ink: HEX, acc: HEX, deep: HEX, tint: HEX }).partial(),
  fonte: z.enum(NOMES_FONTE),
  textos: z.object({ frase: z.string().trim().max(160), sobre: z.string().trim().max(600), galeria: z.string().trim().max(60) }).partial(),
}).partial().strict();
```

- Foto é "própria ou do kit": nome fixo por slot (`fotos/hero.jpg`), sobrescrito a cada upload; sem listagem nem órfãos.
- `deep`/`tint` derivados de `acc` por helper puro `paletaDe(acc)` (escurece 25% / mistura 88% branco). UI e IA escolhem só `ink` e `acc`.
- Fonte: enum dos 4 pares existentes. `ponytail:` Google Font livre fica para depois; o og.jpg já busca por nome.
- Textos: `frase` (sub do hero `:349` e `.sobre-big` `:363` quando não há `sobre`), `sobre`, `galeria` (h2 `:369`).

Consumo:
- `DadosSite` (`src/lib/gerador.ts:447`) ganha `personal?: Personal`; `lerSite` (`gerador.server.ts:279,310`) lê `gerado.personal`.
- `visualEditorial(slug, sub, escolha, personal?)`: aplica cores, fonte e fotos; devolve também `fotos` resolvidas e `fotoBio`.
- Helper puro `srcFoto(slug, ref)`: `/assets/…` → `/s/assets/…`; `fotos/x.jpg` → `/s/{slug}/fotos/x.jpg` (absoluto funciona no www, no subdomínio e na prévia com `<base>`; `src/proxy.ts:96`).
- `renderEditorial`: fotos por `srcFoto`; legenda "Imagem ilustrativa" (`:370`) e rodapé (`:447`) só nos slots ainda do banco; `texto` (`:281`) = `personal.textos.frase ?? texto`.
- `capaEditorial` (`:271`): foto própria devolve `/{slug}/fotos/hero.jpg` (o og monta `${BASE}/s${capa.foto}`, `og.jpg/route.tsx:45`).
- `/bio`: nada muda; `site.photo = "/fotos/bio.jpg"` (ou hero) cai no ramo `/s/{slug}{foto}`; `site.color = acc` final.

Proteção contra planilha e troca de ramo:
- `registrosDoSite` recebe `o.personal` e passa a `visualEditorial` (`:63`); o merge de `gerado` (`:87`) não apaga `personal`.
- `gerarNoBanco` (`:137`) inclui `gerado.personal` no `select` e repassa em `:248`.
- `salvarNegocio` (`negocios.server.ts:182`) passa `personal: t.get("gerado.personal")`; troca de ramo reseta `escolha` mas mantém `personal`.
- `definirModelo` (`actions.ts:714`) passa `personal` ao `visualEditorial`.

## 2. Upload de fotos

Route handler (actions têm teto de 1 MB; foto de celular tem 3-8 MB): `src/app/api/admin/foto/route.ts`.
- `POST` multipart com `Authorization: Bearer <idToken>` → `requireAdmin`; campos `slug`, `slot` (`hero|ga1|ga2|ga3|bio`), `arquivo`. Zod: `slugValido`, enum do slot, ≤ 12 MB, `image/jpeg|png|webp`. Tenant precisa existir e ser editorial.
- Processamento em `src/lib/foto.server.ts` (`processarFoto(slug, slot, buffer)`, testável): `sharp(buffer).rotate()`; hero `resize({width:1600, withoutEnlargement:true})`, ga `1200`, bio `resize(1040, 448, {fit:"cover"})`; `.jpeg({quality:82, mozjpeg:true})`; grava em `adminBucket().file(objetoDoSite(slug, ["fotos", `${slot}.jpg`]))` (`site-arquivo.ts:15` já recusa nomes estranhos; nunca `index.html`/`og.jpg`).
- `DELETE` JSON `{slug, slot}` apaga o objeto. Upload não revalida: a foto só entra quando `personal.fotos[slot]` é gravado.
- `package.json`: `sharp@0.35.4` explícito (já instalado como transitiva).
- `scripts/site.mts publicar` (`:67-81`) apaga do bucket o que não está na pasta: guarda de uma linha ignorando `fotos/`.
- HEIC: `accept="image/jpeg,image/png,image/webp"` (iOS converte); mensagem clara se vier `image/heic`.

## 3. Admin: seção "Visual"

Arquivo novo `src/app/admin/visual-gaveta.tsx` (client). `site-gaveta.tsx` exporta `PreviaModelo` (`:55`) e renderiza `<VisualDoSite slug token modelo personal temIA />` dentro da seção do modelo (`:219-269`), só no editorial. Rascunho `Personal` em `useState`; nada grava até "Publicar visual".
- Fotos: 5 slots com miniatura (`/s/{slug}/fotos/{slot}.jpg?v=` ou a do kit), `<input type="file" accept=…>`, "Usar foto do modelo" (DELETE + tira do rascunho). Barra "Enviando…" por slot.
- Cores: `<input type="color">` para Tinta (`ink`) e Destaque (`acc`); "Voltar à paleta do modelo".
- Fonte: `<select>` com `NOMES_FONTE` + "Do modelo".
- Textos: textarea frase (160), sobre (600), input galeria (60), com contador.
- "Pré-visualizar": `previewModelo(token, slug, modelo, rascunho)` → `PreviaModelo`. "Publicar visual": `confirmar()` → `definirVisual`; depois `setVersao` para a og.jpg recarregar.
- Chat (só com `temIA`; sem chave, dica "Cadastre ANTHROPIC_API_KEY em Ajustes"): textarea + Enviar → `conversarVisual(token, slug, rascunho, pedido, historico)`. Mostra `resposta` e `mudancas` como lista com checkbox por chave folha; "Aplicar na prévia" faz merge das marcadas no rascunho e abre a prévia. Histórico só em estado, últimas 10 mensagens.

## 4. IA: `src/lib/ia.server.ts`

```ts
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
export const RespostaIA = z.object({ resposta: z.string().max(600), mudancas: Personal });
```
- `montarPedido({dados, personalAtual, fotos, pedido, historico})` (pura, exportada): `client.beta.messages.create` com `model: "claude-opus-5-5"`, `max_tokens: 4000`, `output_config: { effort: "medium", format: { type: "json_schema", schema: z.toJSONSchema(RespostaIA) } }`, `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`; sem `thinking`, sem `tool_choice`, sem prefill. `system` estável com `cache_control: {type:"ephemeral"}`: papel (assistente visual de sites de salão/barbearia/estética), pt-BR curto sem emoji, só devolve em `mudancas` o que foi pedido, hex de 6 dígitos com contraste, `fonte` só entre os 4 nomes, textos na voz do produto (direto, segunda pessoa, sem preço, sem promessa médica, sem superlativo), `fotos` nunca alterado pela IA, ao sugerir paleta pelas fotos explicar em uma frase. Mensagem: JSON com nome, sub, cidade, serviços, personal e paleta atuais + fotos próprias como `{type:"image", source:{type:"base64", media_type:"image/jpeg"}}` (miniaturas 512 px feitas no servidor com sharp) + histórico + pedido.
- `sugerirVisual(args)`: `new Anthropic({ apiKey: await integracao("ANTHROPIC_API_KEY") })`; chave vazia → `ErroPrevisto("Cadastre a chave da Anthropic em Ajustes.")`.
- `lerResposta(msg)` (pura): `stop_reason === "refusal"` → `ErroPrevisto`; `max_tokens` → "Resposta cortada"; concatena blocos `text`, `JSON.parse`, `RespostaIA.safeParse`; falha → `ErroPrevisto("A IA respondeu fora do formato.")`.
- Erros do SDK: `Anthropic.AuthenticationError`, `RateLimitError`, `APIConnectionError` → mensagens em pt-BR; o resto sobe e `adminAction` responde "Não foi possível concluir agora".
- `INTEGRACOES`: `ANTHROPIC_API_KEY: { grupo: "IA (Anthropic)", rotulo: "Chave da API", secreta: true }`. Ajustes já renderiza por grupo.

## 5. Actions (`src/app/admin/actions.ts`)

- `siteDoNegocio` (`:652`): + `personal`, `temIA: !!(await integracao("ANTHROPIC_API_KEY"))`.
- `previewModelo(slug, id, rascunho?)` (`:686`): `personal = rascunho == null ? dados.personal : Personal.parse(rascunho)`.
- `definirVisual(slug, rascunho)` nova: `slugValido`, tenant editorial, `Personal.parse`; `t.update({ "gerado.personal": personal ou FieldValue.delete() se vazio, "site.color": visual.cor, "site.photo": visual.fotoBio })`; `renovarEnderecos(slug)` (`:623`).
- `conversarVisual(slug, rascunho, pedido, historico)` nova: zod em `pedido` (≤ 600) e `historico` (≤ 10 pares); lê `lerSite`, miniaturas, `sugerirVisual`.
- `definirModelo` (`:704`): passa `personal`.

## 6. Testes

- `gerador.test.mts`: `Personal` aceita `#B5732F` (vira minúscula) e recusa `#bbb`, `red`, `fotos/../x.jpg`, fonte fora do enum, chave desconhecida; `visualEditorial` com `personal.cores.acc` e `fonte` mantém `ink` do modelo e deriva `deep/tint`; `renderEditorial` com foto própria contém `/s/{slug}/fotos/hero.jpg`, `--acc:#112233`, sem "Imagem ilustrativa" nos slots próprios, frase no hero e no `.sobre-big`; `capaEditorial` devolve `/{slug}/fotos/hero.jpg`.
- `gerador-banco.test.mts` (emulador): `gerado.personal` sobrevive a `salvarNegocio` e a `gerarNoBanco` (`atualizar`), `site.photo === "/fotos/hero.jpg"`, `site.color` = acc; `processarFoto` grava `sites/{slug}/fotos/hero.jpg` no emulador de Storage com JPEG mínimo.
- `ia.test.mts` novo (`tsx --conditions=react-server`, sem rede): `montarPedido` tem `output_config.format`, não tem `tool_choice` nem `thinking`, `system` com `cache_control`; `lerResposta` válida devolve `mudancas`; `refusal` e JSON fora do schema lançam `ErroPrevisto`. Entrar em `package.json` e `.github/workflows/testes.yml`.

## 7. Passos (um PR cada)

1. Dados e render: `site-editorial.ts`, `gerador.ts`, `gerador.server.ts`, `negocios.server.ts`, `actions.ts` (definirModelo), `gerador.test.mts`, `gerador-banco.test.mts`.
2. Upload: `package.json` (sharp), `src/lib/foto.server.ts`, `src/app/api/admin/foto/route.ts`, `scripts/site.mts`, `gerador-banco.test.mts`.
3. Controles, prévia e publicação: `visual-gaveta.tsx` (novo), `site-gaveta.tsx`, `actions.ts` (siteDoNegocio, previewModelo, definirVisual).
4. Chat com IA: `package.json` (`@anthropic-ai/sdk`), `integracoes.server.ts`, `ia.server.ts`, `actions.ts` (conversarVisual), `visual-gaveta.tsx`, `ia.test.mts`, workflow.
5. Docs: `README.md`, `CHANGELOG.md`, `docs/operacao.md` (chave em Ajustes; `publicar` não apaga `fotos/`).

## 8. Riscos

- `scripts/site.mts publicar` apaga extras do bucket: guarda para `fotos/` no passo 2; sites gerados não passam por `publicar`.
- og.jpg: `renovarEnderecos` cobre; o og lê a foto por HTTP em `BASE`, no dev o servidor precisa estar no ar.
- Cache de arquivo: nome fixo + 5 min no navegador; admin vê com `?v=`, visitante em até 5 min.
- EXIF: `.rotate()` obrigatório. HEIC não decodifica: `accept` sem HEIC.
- Contraste: bio já clareia cor clara (`page.tsx:118-124`); no site o admin vê na prévia.
- `refusal`/JSON fora do schema nunca aplicam nada. Chave ausente esconde o chat.
- Custo: 1 chamada por turno, `effort: "medium"`, miniaturas 512 px, system em cache, histórico de 10, sem persistência.

## Fluxo de git (duas sessões em paralelo)

Estado em 03/11: a outra sessão trabalha nas correções da análise em worktrees próprios: `fase1-seguranca` e `fase2-performance` já mergeadas (#215, #216, `origin/main` = `add89fb1`); `fase3-ux` em andamento (38 arquivos não commitados em `../ruphus-f3`, nenhum dos arquivos deste plano); `fase4-abuso-manutencao` toca `package.json`, `package-lock.json`, `.github/workflows/testes.yml`, `CHANGELOG.md`, `booking.server.ts`. Este diretório está em HEAD solto sobre `origin/main` com duas mudanças soltas: `src/lib/gerador.ts` (ramos selagem/harmonização) e `scripts/converter-fabrica.mts`.

Regras:
1. **Nunca tocar nos worktrees da outra sessão** (`../ruphus-f1..f4`, `../ruphus-lp2`, `../ruphus-vps-wt`), nem nas branches `fase*`. Nada de `force-push`, `reset --hard`, `stash` fora do próprio worktree.
2. **Primeiro PR, pequeno:** commitar as duas mudanças soltas em `fabrica-convertida` (a partir de `origin/main`), abrir PR, mergear. Sem isso as branches novas partem de bases diferentes.
3. **Worktree próprio desta sessão:** `git worktree add ../ruphus-visual -b visual/1-dados origin/main`. Cada passo do plano é uma branch `visual/N-…` criada de `origin/main` atualizado, no mesmo worktree, depois do merge do passo anterior.
4. **Antes de cada PR:** `git fetch origin && git rebase origin/main`, rodar `npm run lint`, `npx tsc --noEmit` e os testes do passo. PR via `gh pr create`; merge só com CI verde (`testes.yml`).
5. **Conflitos previstos** e como resolver: `package.json`/`package-lock.json`/`testes.yml`/`CHANGELOG.md` com `fase4` (passos 2, 4 e 5): manter as duas entradas; rebasear o que terminar depois. `src/app/admin/actions.ts` já incorporou `fase1`. Se `fase3` ou `fase4` entrarem antes, rebase resolve; se entrarem depois, a outra sessão rebaseia (padrão dela nos PRs #215/#216).
6. **Ao fim de cada passo:** conferir que `origin/main` contém tanto o PR deste plano quanto os PRs `fase*` mergeados até então (`git log --oneline origin/main | head`), e que nenhum worktree da outra sessão foi alterado (`git -C ../ruphus-f3 status --short` igual ao de antes).
7. Commits com a atribuição da sessão; mensagens em pt-BR no padrão do repositório.

## Verificação

1. `npm run test:gerador`, `npm run test:gerador-banco`, `npm run test:ia` (novo), `npm run lint`, `npx tsc --noEmit`.
2. `npm run dev`; no /admin abrir a gaveta de um site editorial (ex.: `ivone-camargo`): subir foto do topo pelo celular (retrato, confirmar orientação), trocar Destaque, fonte e frase, pré-visualizar, publicar; abrir `{slug}.ruphus.site`, `/bio/{slug}` e `/s/{slug}/og.jpg` e conferir foto, cor e fonte.
3. Cadastrar `ANTHROPIC_API_KEY` em Ajustes; no chat pedir "sugira uma paleta a partir das fotos e reescreva o Sobre"; aplicar na prévia, publicar; conferir custo em `usage` no log.
4. Reimportar a planilha do mesmo telefone (`gerarSites`) e conferir que `gerado.personal`, `site.photo` e `site.color` continuam.
5. `npm run site -- publicar <slug> <pasta>` num slug com fotos próprias: `fotos/` não é apagado.
