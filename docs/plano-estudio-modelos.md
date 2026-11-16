# Estúdio de modelos no /admin: plano de implementação

Mockup aprovado como referência visual: https://claude.ai/artifact/XmZS5xvf1PsmeoR8byipn3 (Estúdio). Layouts de bio: https://claude.ai/artifact/CDiwyYJu1HLVy41DSjknxR.

## Objetivo

Uma aba **Modelos** no `/admin` para ver, ajustar, criar, comparar e aplicar modelos de **site** e de **bio**, sem deploy para cada mudança. Inclui:
- grade e editor com prévia em celular, tablet, notebook e monitor;
- casos de teste e comparação lado a lado;
- checagem automática;
- rascunho → publicar, com histórico e restaurar;
- padrão por ramo;
- aplicar em lote com desfazer;
- os layouts novos de bio.

**Regra fixa: cliente ativo nunca muda sozinho.** Publicar, trocar padrão ou aplicar em lote só mexe em negócios de prospecção. O cliente fica na versão que tinha até o admin atualizar pela gaveta dele.

## Como está hoje (pontos de partida)

| O quê | Onde |
|---|---|
| Modelos editoriais (60), em código | `src/lib/site-editorial.ts`: `ESTILOS` :219, `TEMPLATES` :252, `MODELOS` :296, `visualEditorial` :344, `Personal` :91 |
| Modelos "claro" (37), em código | `src/lib/site-claro.ts`: `modelosClaro` :73, `visualClaro` :96 |
| Escolha do negócio | `tenants/{slug}.gerado.escolha = {kit, cor, modelo?}`. **kit e cor são posições em array**: reordenar muda todo mundo |
| Personalização por negócio | `gerado.personal` (fotos, cores, fonte, textos), gaveta `src/app/admin/visual-gaveta.tsx` |
| Render do site | `src/app/s/[slug]/index.html/route.ts` (force-dynamic) → `lerSite` (`src/lib/gerador.server.ts:304`) → `renderEditorial`/`renderClaro`, a cada pedido |
| Bio | `src/app/bio/[tenant]/page.tsx` lê a **cópia** `site.color`/`site.photo` (:71-72), gravada por `definirModelo`/`definirVisual` |
| Ações do admin | `src/app/admin/actions.ts`: `siteDoNegocio` :760, `comBase` :847, `previewVisual` :855, `definirVisual` :874, `previewModelo` :941, `definirModelo` :956 |
| Autorização | `src/lib/admin-guard.ts`: `adminAction` :46, `requireAdmin` :24 |
| Config com Zod e fallback | modelo a copiar: `config/ia-roteamento` em `src/lib/ia-roteador.server.ts:222-240` |
| Admin | `src/app/admin/page.tsx` (2.838 linhas): `tela` :178, botões :1111, nav celular ~:1977, render :1634 |
| Cliente | CRM `estagio === "fechado"` (`src/lib/crm.ts:283` `virouFechado`, :522) ou `gerado.origem === "cadastro"` |

## Decisões de arquitetura

**D1. Os layouts continuam em código; o resto vai para o Firestore.**
- Layout é código: estrutura da página, editorial, claro e os layouts de bio.
- Kit, paleta, fonte, nome, liga/desliga, padrão e combinações novas ficam no Firestore.
- Os 97 modelos atuais viram "embutidos". O banco guarda só o que mudou neles.

**D2. Definição de modelo (`DefModelo`, Zod).**
- Campos: `{ id, tipo: "site"|"bio", sub, layout, kit: "/assets/beleza/salao-1", paleta: {ink,acc,deep,tint}, fonte?, nome, ativo }`.
- **Kit e paleta por valor, não por posição.** Isso acaba com a fragilidade dos índices.

**D3. Coleções.**
- `modelos/{id}`: `{ publicado: DefModelo, versao: n, rascunho?: DefModelo, atualizadoEm }`.
- `modelos/{id}/versoes/{n}`: foto imutável de cada publicação, usada no histórico e no restaurar.
- `config/modelos`: `{ padroes: { site: {sub: id}, bio: {sub: id} }, testes: [] }`.
- `lotes/{id}`: `{ modelo, filtros, antes: [{slug, anterior}], feitoEm, desfeitoEm? }`. Vale para desfazer por 7 dias.

**D4. O negócio aponta para o modelo.**
- Site: `gerado.modelo = { id, versao: number|null }`. Bio: `gerado.bio = { id, versao: number|null }`.
- `versao: null` segue sempre a versão publicada (prospecção).
- Número fixo = **congelado** (cliente).
- Negócio sem o campo cai no caminho atual (`gerado.escolha` / hash), sem quebrar nada.

**D5. Ordem de resolução** (função pura `resolverModelo`):
1. `gerado.personal`;
2. modelo do negócio, na versão gravada ou na publicada; a escolha manual da gaveta antiga (`gerado.escolha.modelo`, sem `gerado.modelo`) também conta como do negócio: segue a publicada e nunca recebe o padrão (na bio, que não tem escolha, fica a de sempre);
3. padrão do ramo em `config/modelos`;
4. escolha atual por `gerado.escolha` ou hash do slug.

**D6. Congelamento.** Quando o negócio vira cliente (`virouFechado` em `crm.ts:283`, ou cadastro do dono), grava a versão publicada atual em `gerado.modelo.versao` e em `gerado.bio.versao`. O script da F7 congela os clientes que já existem.

**D7. Cache.**
- O site é dinâmico. O catálogo é lido do Firestore com cache, invalidado na publicação.
- **Antes de codar, ler `node_modules/next/dist/docs`** sobre `use cache`, `cacheTag` e `revalidateTag` no Next 16 (regra do AGENTS.md).
- Alternativa, se a API não servir: cache em memória de 60 s, com carimbo `config/modelos.atualizadoEm`.

**D8. Cópias da bio.** Depois de publicar ou aplicar em lote, recalcular `site.color` e `site.photo` dos negócios afetados (lotes de 400) e chamar `renovarSite` (`src/lib/renovar-site.server.ts:15`).

**D9. Métricas e teste A/B (fase opcional).**
- Um sinal anônimo `/api/ev` registra slug, modelo, evento e variante, sem dado pessoal.
- Os eventos somam em `metricas/{modelo}_{aaaammdd}` com `FieldValue.increment`.
- O sorteio da variante acontece quando o site de prospecção é criado.

## Regras para quem implementa (Haiku)

1. Faça uma tarefa por vez. Ao terminar, rode o aceite e registre uma linha em "Registro".
2. Não mexa em arquivos fora da lista da tarefa. Não instale dependências sem o Opus aprovar. Não rode `git push`, deploy, scripts contra produção nem `--no-verify`.
3. Leia antes de escrever: rode `graphify query` e reuse os helpers citados. Next 16: leia `node_modules/next/dist/docs` antes de qualquer API do Next.
4. Se um teste falhar duas vezes, pare e escreva `BLOQUEIO:` no Registro.
5. **Não faça commit.** O commit é do Opus, depois do gate de cada fase.
6. **Nenhum site existente pode mudar de aparência até a F7.** O teste de regressão da F3 é obrigatório.

## Fase 0: preparação (Opus + dono)
- [x] F0.1 Branch `feat/estudio-modelos` a partir de `main`, depois de a fila de espera e o subnicho sobrancelha estarem integrados.
- [x] F0.2 🙋 (assumido: bio Atual+Clara+Galeria+Agenda; cliente = fechado, cadastro, convite aceito ou site publicado (revisto em 15/11/2026, Q1 da revisão); F9 depois) Decisões do dono:
  - (a) quais layouts de bio entram primeiro (sugestão: Atual, Clara, Galeria e Agenda);
  - (b) cliente = `fechado` ou cadastro? (sugestão: os dois);
  - (c) a fase de métricas entra agora ou depois?
- [x] F0.3 Cache (Next 16.4.4, sem `cacheComponents`): `unstable_cache(lerDoBanco, ["catalogo-modelos"], { tags: ["modelos"], revalidate: 3600 })` e, ao publicar, `revalidateTag("modelos", { expire: 0 })` na Server Action. Funciona na rota `force-dynamic` do site e na bio. Scripts fora de requisição leem direto do banco (o cache exige contexto de requisição). Cache é por processo: conferir na F8 se a VPS roda uma instância só. **Conferido na F8:** um processo só (`deploy/ruphus-site.service`: um `next start -p 3001`, sem cluster nem pm2; o Caddy aponta para ele). O worker `ruphus-coleta` é outro processo, mas não lê o catálogo.
- [ ] F0.4 Checklist HTML `docs/plano-estudio-modelos.html`.

## Fase 1: domínio puro (sem Firestore, sem UI) · ~3 h
- [x] F1.1 `src/lib/modelos/tipos.ts`: Zod de `DefModelo`, `RefModelo` e `ConfigModelos`, e tipos `Formato` e `Caso`.
- [x] F1.2 `src/lib/modelos/embutidos.ts`: converte `MODELOS` (site-editorial), `modelosClaro` (site-claro) e os layouts de bio em `DefModelo[]`, com kit e paleta **por valor**. Ids estáveis iguais aos de hoje (`salao-1`, `odonto-2`…).
- [x] F1.3 `src/lib/modelos/resolver.ts`: `resolverModelo(tenant, catalogo, config)` na ordem do D5; `ehClienteAtivo(tenant, crm)`.
- [x] F1.4 `src/lib/modelos/checagem.ts`: contraste WCAG, peso estimado por layout, mínimo de fotos (Galeria e Stories), nome longo e "sem avaliações". Devolve `{nivel, titulo, texto}[]`.
- [x] F1.5 `modelos.test.mts` na raiz e script `test:modelos` no `package.json`. Testa:
  - os 97 embutidos validam no Zod;
  - os ids são únicos;
  - o resolver segue a ordem do D5;
  - cliente fica com a versão congelada;
  - contraste de `#E58F9C` sobre branco < 3, e de `#0E6E68` ≥ 4,5.
- **Aceite:** `npm run test:modelos` e `npx tsc --noEmit`.
- [x] **Gate F1:** revisão de código (Opus) ok em 15/11. 95 embutidos (54 editoriais no código, não 60).
  - Nota para F2/F5: `publicar` congela antes, na versão atual, todo cliente que aponta para o modelo com `versao: null` (cliente sem número ainda segue a publicada até a F7).

## Fase 2: persistência · ~4 h
- [x] F2.1 `src/lib/modelos/repo.server.ts`. Funções:
  - `lerCatalogo()`: embutidos + banco, com o cache do D7;
  - `salvarRascunho(id, def)`;
  - `publicar(ids)`: transação que faz `versao+1`, grava `versoes/{n}` e limpa o rascunho;
  - `descartar(ids)`;
  - `criar(def)` e `duplicar(id)`;
  - `ligar(id, ativo)` e `definirPadrao(tipo, sub, id)`;
  - `restaurar(id, n)`: copia a versão para o rascunho;
  - `historico(id)`.
- [x] F2.2 `firestore.rules`: `modelos`, `lotes` e `metricas` só pelo servidor. Caso novo em `rules.test.mjs`.
- [x] F2.3 `modelos-banco.test.mts` no emulador (padrão de `test:gerador-banco`), script `test:modelos-banco`. Testa:
  - publicar cria a versão;
  - rascunho não aparece no catálogo publicado;
  - restaurar volta os campos;
  - duas publicações concorrentes não perdem versão.
- **Aceite:** `npm run test:modelos-banco` e `npm run test:rules`.
- [x] **Gate F2:** revisão (Opus) ok em 15/11; testes de banco e regras verdes. Segurança das ações fica no gate da F5. Conferir na produção a consulta de congelamento (dois filtros de igualdade).

## Fase 3: render pelo modelo, sem mudar nada visível · ~4 h
- [x] F3.1 `visualEditorial` e `visualClaro` aceitam uma `DefModelo` resolvida (kit e paleta por valor), além do caminho por índice de hoje.
- [x] F3.2 `lerSite` (`gerador.server.ts:304`) chama `resolverModelo` e passa a definição ao render.
- [x] F3.3 **Teste de regressão:**
  - script `scripts/regressao-modelos.mts` renderiza os 97 modelos com dados fixos e grava o hash do HTML **antes** da F3;
  - o mesmo script compara **depois**;
  - diferença = falha;
  - entra no `test:gerador`.
- **Aceite:** `npm run test:gerador` com 0 diferenças, e `npx tsc --noEmit`.
- [x] **Gate F3:** revisão (Opus) ok em 15/11. Baseline conferida contra o código antigo (stash): 170 casos, 0 diferenças, antes e depois. 91 embutidos de site equivalentes por valor e por índice.

## Fase 4: layouts de bio · ~6 h (4 layouts) + ~1,5 h por layout extra
- [x] F4.1 Dividir `src/app/bio/[tenant]/page.tsx` em:
  - `carregar.ts` (o `carregar` de hoje, mais as fotos da galeria, lidas de `gerado.personal.fotos` ou do kit);
  - `partes.tsx` (Atalhos, Horários com abas de dia, Serviços, Onde e quando, Barra fixa);
  - `layouts/atual.tsx` (o de hoje, **idêntico**).
- [x] F4.2 `layouts/clara.tsx`, `layouts/galeria.tsx` e `layouts/agenda.tsx`, seguindo os mockups. Fontes por `next/font`. Galeria e Stories com menos de 3 fotos caem na Clara.
- [x] F4.6 Prévia da bio para o admin: `assinarPreviaBio({slug, def, caso})` em `src/lib/modelos/previa-bio.server.ts` (token assinado, 10 min) e rota `/bio/[tenant]/previa?t=` que renderiza o layout do def sem gravar nada.
- [x] F4.3 A página escolhe o layout por `resolverModelo` (`gerado.bio`, depois o padrão do ramo, depois `atual`).
- [x] F4.4 `bio.test.mts`: cada layout renderiza com serviço com e sem preço, sem nota e sem agenda. O layout `atual` não muda (snapshot).
- [x] F4.5 (depois) Cartaz, Vidro (painel sólido em `prefers-reduced-transparency` e em Android simples), Painel, Noturno e Stories (animação desligada em `prefers-reduced-motion`).
- **Aceite:** `npm run test:bio`, mais prints em 390px e 1280px de cada layout com os dados de `sobrancelhas-design-alameda-jardins` no dev local.
- [ ] **Gate F4:** revisão (Opus) e conferência visual do dono.

## Fase 5: ações do admin · ~4 h
- [x] F5.1 `src/app/admin/modelos-actions.ts` (`"use server"`, tudo com `adminAction`). Ações:
  - `listarModelos(tipo)`;
  - `previaModelo(def, slug, caso)`: reusa `comBase` (`actions.ts:847`) e o padrão de `previewModelo` (:941);
  - `salvarRascunho`, `publicar` e `descartar`. O `publicar` devolve `{prospeccao, clientes}` por modelo;
  - `criar`, `duplicar`, `ligar` e `definirPadrao`;
  - `contarLote(filtros)` e `aplicarLote(filtros, incluirClientes)`. Lotes de 400. Grava `lotes/{id}` com o estado anterior;
  - `desfazerLote(id)`, por até 7 dias;
  - `historico` e `restaurar`;
  - `checar(def)`, que chama `checagem.ts`.
- [x] F5.2 Filtros do lote: ramo, cidade, etapa do CRM, "só sem escolha manual" e "incluir clientes". Este último exige uma segunda confirmação explícita, com o parâmetro `confirmouClientes: true`.
- [x] F5.3 Testes no emulador:
  - o lote não toca em cliente sem `confirmouClientes`;
  - desfazer devolve o modelo anterior;
  - publicar não muda cliente congelado.
- **Aceite:** `npm run test:modelos-banco` e `npm run test:admin`.
- [ ] **Gate F5:** revisão (Opus) e `security-reviewer`.

## Fase 6: a tela do Estúdio · ~8 h
- [x] F6.1 `page.tsx`: `tela` ganha `"modelos"` (:178), com botão (:1111), nav do celular (~:1977) e render (:1634).
- [x] F6.2 `src/app/admin/modelos/estudio.tsx`: casca de 3 colunas (árvore, tela, inspetor) e barra com Grade/Editor, caminho, rascunho, Aplicar em lote, Descartar e Publicar. No celular, árvore vira `<select>` e o inspetor fica embaixo.
- [x] F6.3 `modelos/arvore.tsx`: Bio/Site, busca, família › ramo › modelo, com pontos de ligado, rascunho e padrão.
- [x] F6.4 `modelos/tela.tsx`: componente `Moldura` com Celular 390, Tablet 820, Notebook 1280, Monitor 1920 e Todos. Ajusta à largura com `ResizeObserver`. Tem também o seletor de negócio, o seletor de caso (nome longo, sem avaliações, 1 foto, 1 serviço, sem preço), o comparar com outro modelo e a faixa de vizinhos.
- [x] F6.5 `modelos/inspetor.tsx`, com as abas:
  - **Ajustes:** nome, ligado, padrão, layout, fonte, kit e cor;
  - **Checar:** lista da `checagem` com o número de alertas;
  - **Números:** vazio com "medição começa na F9" até lá;
  - **Uso:** prospecção × clientes congelados e a lista;
  - **Histórico:** "Restaurar esta versão".
- [x] F6.6 `modelos/grade.tsx`, `modelos/publicar-dialogo.tsx` (resumo "N mudam · M ficam congelados" e lista de alterações) e `modelos/lote-dialogo.tsx` (contagem antes, segunda confirmação para clientes, desfazer).
- [x] F6.7 Reusar `confirmar()` (`src/components/confirmar.tsx:89`), os botões `BOTAO_CLARO`/`BOTAO_ESCURO` (`site-gaveta.tsx:19-20`) e o iframe de `PreviaModelo` (`site-gaveta.tsx:57`).
- **Aceite:**
  - `npx tsc --noEmit` e `npm run lint`;
  - roteiro manual no dev local: criar combinação, ver nos 5 formatos, comparar, checar, publicar, restaurar, lote com desfazer;
  - prints em 1440px e 390px.
- [ ] **Gate F6:** revisão (Opus), conferência visual do dono e `oh-my-claudecode:verifier`.

## Fase 7: clientes congelados e gaveta do negócio · ~4 h
- [x] F7.1 `crm.ts:283` (`virouFechado`): congela `gerado.modelo` e `gerado.bio` na versão publicada. Mesmo comportamento no cadastro do dono.
- [x] F7.2 Gaveta do negócio (`site-gaveta.tsx`):
  - a lista de modelos vem do catálogo ativo;
  - cliente vê "versão de dd/mm · há versão nova", com prévia e o botão "Atualizar";
  - a escolha grava `gerado.modelo = {id, versao}`.
- [x] F7.3 `scripts/migrar-modelos.mts`, com simulação por padrão e `--aplicar` com backup em `dblocal/`:
  - congela os clientes atuais;
  - converte `gerado.escolha` com `modelo` em `gerado.modelo` (versão 1);
  - quem não tem escolha continua no padrão.
- **Aceite:**
  - teste no emulador: virar `fechado` congela;
  - simulação contra produção, que só lê, conferida pelo dono.
- [ ] **Gate F7:** revisão (Opus).

## Fase 8: cópias da bio e cache · ~2 h
- [x] F8.1 Depois de `publicar` ou `aplicarLote`, recalcular `site.color`/`site.photo` dos afetados que não são clientes e chamar `renovarSite`.
- [x] F8.2 Invalidar o cache do catálogo na publicação (API do D7).
- **Aceite:** publicar no dev local e ver site e bio mudarem sem reiniciar o servidor.
- [ ] **Gate F8:** revisão (Opus).

## Fase 9 (opcional): números e teste A/B · ~6 h
- [ ] F9.1 `/api/ev`:
  - aceita POST com `{slug, modelo, evento: visita|agendar|whatsapp, variante?}`;
  - limite por IP e sem dado pessoal;
  - ignora a prévia de link do WhatsApp (user-agent).
- [ ] F9.2 Disparo no site (`public/s/assets/site-ui.js`) e na bio, com `navigator.sendBeacon`.
- [ ] F9.3 Soma diária em `metricas/{modelo}_{dia}` e aba Números com dados reais.
- [ ] F9.4 Teste A/B:
  - `config/modelos.testes`;
  - sorteio por hash do slug na criação do site de prospecção;
  - resultado depois de 14 dias, registrado no histórico.
- **Aceite:** teste de unidade do sorteio (50/50 em 1.000 slugs, ±5%) e evento chegando no dev local.
- [ ] **Gate F9:** revisão (Opus) e `security-reviewer`.

## Fase 10: acabamento · ~2 h
- [ ] F10.1 Ajuda no `/ajuda` ("Como usar o Estúdio") e linha no changelog.
- [ ] F10.2 Acessibilidade: foco visível, botões de 44 px e `aria-pressed` nas alternâncias.
- [ ] F10.3 🙋 Merge e deploy (`scripts/deploy-vps.sh`), depois `migrar-modelos.mts --aplicar` (dono).

## Estimativa

| Fase | Horas |
|---|---|
| F1 domínio | 3 |
| F2 persistência | 4 |
| F3 render sem mudança visível | 4 |
| F4 bio (4 layouts) | 6 |
| F5 ações | 4 |
| F6 tela do Estúdio | 8 |
| F7 clientes congelados e gaveta | 4 |
| F8 cópias e cache | 2 |
| F10 acabamento | 2 |
| **Total sem F9 e sem os 5 layouts extras** | **≈ 37 h** |
| F9 números e A/B | +6 |
| 5 layouts de bio extras | +7,5 |

**Custo de produção:**
- Leituras do Firestore: o catálogo com cache dá cerca de 0 leitura a mais por visita; sem o cache seriam 1 ou 2.
- Banda: só Galeria e Stories carregam 3 fotos.
- VPS: nenhuma mudança.

## Riscos e como cada um é contido

| Risco | Contenção |
|---|---|
| Algum site mudar de aparência ao trocar índice por valor | Teste de regressão com hash dos 97 modelos (F3.3) |
| Cliente mudar sem querer | Congelamento (D6), segunda confirmação no lote (F5.2), testes no emulador (F5.3) |
| Leitura extra no Firestore a cada visita | Cache do catálogo (D7) |
| API de cache do Next 16 diferente do esperado | F0.3 lê a doc antes; alternativa em memória |
| Lote grande falhar no meio | Lotes de 400, registro em `lotes/{id}`, desfazer idempotente |
| Bio com poucas fotos ficar feia | Volta para a Clara (F4.2) e alerta na Checagem |
| Publicações concorrentes | Transação com `versao+1` (F2.1) |
| Mudar `SUBS` ou `NOMES_FONTE` no código deixar modelo gravado fora do esquema | Leitura tolerante no catálogo (fonte some, ramo fica como texto, com log); antes de tirar um ramo ou fonte do código, conferir os modelos do banco que usam (`modelos/*` com `publicado.sub`/`publicado.fonte`) |

## Registro
<!-- uma linha por tarefa: data · tarefa · arquivos · resultado do aceite -->
2026-11-15 · F1.1 · src/lib/modelos/tipos.ts · DefModelo/RefModelo/ConfigModelos (Zod), Formato, Caso, LAYOUTS_BIO; kit claro = foto do topo sem extensão (/assets/{pasta}/{topo}), paleta claro = {ink: --accent, acc: --gold, deep: --text, tint: --bg} do tema claro · ok
2026-11-15 · F1.2 · src/lib/modelos/embutidos.ts · 54 editoriais + 37 claros + 4 bios (bio-atual/clara/galeria/agenda) = 95; o "60 + 37 = 97" do plano não bate com o código (MODELOS tem 54) · ok
2026-11-15 · F1.3 · src/lib/modelos/resolver.ts · negócio (versão congelada ou publicada) > padrão do ramo (só prospecção; bio aceita "todos") > legado · ok
2026-11-15 · F1.4 · src/lib/modelos/checagem.ts · contraste WCAG (acc no editorial/bio, ink no claro), fotos, peso estimado, vidro, fontes, nome longo, sem avaliações · ok
2026-11-15 · F1.5 · modelos.test.mts, package.json (test:modelos) · npm run test:modelos ok; npx tsc --noEmit ok (depois de `npx next typegen` no worktree novo); npm run test:gerador ok · ok
2026-11-15 · F2.1 · src/lib/modelos/repo.server.ts · embutido não vai ao banco de saída (vale como versão 1); o doc nasce na 1ª mudança com versoes/1 = embutido; versoes/{n} = {n, def, publicadoEm, por?, nota?}; rascunho apagado (FieldValue.delete), não null; catálogo inclui `versoes` (para o cliente congelado) e é cacheado na forma crua (Map não passa pelo JSON do unstable_cache); `lerConfigCache` com a mesma tag; publicar congela clientes (versao null → versão atual) antes da transação, fora dela (lotes de 400); criar = publicado + ativo:false na versão 1; ligar = versão nova imediata com nota "ligado"/"desligado" (o rascunho aberto acompanha o ativo), sem congelar ninguém (ativo não muda aparência); duplicar = id `{id}-{base36 do relógio}` · ok
2026-11-15 · F2.2 · firestore.rules, rules.test.mjs · modelos/** (inclui versoes), lotes e metricas com `allow read, write: if false`; config/modelos já nega por falta de match · npm run test:rules ok
2026-11-15 · F2.3 · modelos-banco.test.mts, package.json (test:modelos-banco) · concorrência testada com publicar + ligar juntos (dois publicar no mesmo id: o segundo fica sem rascunho e falha, de propósito) · npm run test:modelos-banco ok; npm run test:modelos ok; npx tsc --noEmit ok
2026-11-15 · F3.3 · scripts/regressao-modelos.mts, scripts/regressao-modelos.base.json, package.json (test:gerador) · base gravada ANTES de mexer no render: 170 casos (54 editoriais pela escolha, 37 claros pela escolha da gaveta, 75 pelo hash = 3 slugs × 25 ramos, 4 com personal), 170 hashes distintos; dados fixos, sem relógio · regressão 0 diferenças antes e depois da F3.1/F3.2
2026-11-15 · F3.1 · src/lib/site-editorial.ts, src/lib/site-claro.ts, src/lib/gerador.ts (DadosSite.def), src/app/s/[slug]/[...arquivo]/route.ts · `def?` opcional (5º argumento) em visualEditorial/visualClaro, passado por render/capa/404; editorial: kit/paleta/fonte da def, rótulo e frases do embutido de mesmo id (salão infantil); claro: a def volta para índices do ramo (topo cujo caminho é o kit; 1ª paleta com mesmo --accent e --gold, então o tema escuro é o do código); paleta sem par entra como cor própria (ink → --accent, acc → --gold, nos dois temas), deep/tint ignorados no claro; personal continua por cima · teste novo em modelos.test.mts: os 91 embutidos de site renderizam o MESMO HTML por def e por escolha (com e sem personal; def vence escolha gravada) · ok
2026-11-15 · F3.2 · src/lib/gerador.server.ts, modelos-banco.test.mts · lerSite → defDoSite: config pelo cache (fora de requisição, leitura direta); catálogo só quando há gerado.modelo ou padrão do ramo; crm/{slug} só sem gerado.modelo, com padrão e origem ≠ cadastro; origem legado = caminho de hoje; def de outra família de layout (bio, claro em ramo editorial) é ignorada; erro na leitura = caminho de hoje (log); repo.server importado tarde (import()) porque @/lib/admin abre o app padrão e o gerador-banco.test abre o seu antes · npm run test:gerador (regressão 0), test:modelos, test:modelos-banco (com lerSite), test:gerador-banco, npx tsc --noEmit · ok
2026-11-15 · F5.1 · src/app/admin/modelos-actions.ts · tudo por adminAction e Zod (slug por SLUG_SITE: o slugValido de actions.ts não pode ser exportado de um "use server"; comBase copiado pelo mesmo motivo); as que gravam chamam revalidateTag(TAG_MODELOS, { expire: 0 }) depois de dar certo; `por` = e-mail verificado ou uid; listarModelos conta o uso por agregação count() (prospeccao = versao null, clientes = congelados, legado = gerado.escolha.modelo, só site); previaModelo site = lerSite + {def} + caso (longo/semnota/umserv; poucas e semprec não mudam o site) e recusa layout de outra família; bio = /bio/{slug}/previa?t= (assinarPreviaBio da F4); checar = checagem.ts + negócios do ramo com foto própria parcial (< 3 de ga1..ga3) quando o layout é galeria/stories · ok
2026-11-15 · F5.2 · src/lib/modelos/lote.server.ts · FiltrosLote {tipo, modeloId, sub?, uf?, cidade?, estagio?, soSemEscolhaManual?} (strict); modelo precisa existir, ser do tipo e estar ligado; site só pega ramos da mesma família de layout; CRM sem doc = "novo"; manual = gerado.modelo/bio ou gerado.escolha.modelo; lotes/{id} gravado ANTES dos negócios; antes > 2000 vai em lotes/{id}/partes/{n}; cliente só com incluirClientes e confirmouClientes === true, congelado na versão atual; desfazer em até 7 dias, pula tenant apagado e quem já saiu do modelo do lote, segunda chamada não faz nada · ok
2026-11-15 · F5.3 · modelos-lote.test.mts, package.json (test:modelos-lote, Firestore + Auth, RUPHUS_E2E=1) · sucesso das ações que gravam não é testado pela casca (revalidateTag exige requisição); a lógica é testada direto no lote.server/repo e a casca na recusa (não-admin, Zod, segunda confirmação) e nas leituras (o teste põe CRON_SECRET, que a assinatura da prévia da bio exige) · npm run test:modelos-lote ok; test:modelos-banco ok; test:modelos ok; test:admin ok; npx tsc --noEmit ok; eslint ok
2026-11-15 · F4.1 · src/app/bio/[tenant]/{page,carregar.ts,partes.tsx,layouts/atual.tsx,layouts/index.tsx}, src/lib/gerador.server.ts (só `export` em defDoSite) · carregar igual ao de antes + `categoria` (site.category), `fotos` (galeria do site: visualEditorial/visualClaro com a def do site via defDoSite, então gerado.personal.fotos ga1..3 vence o kit; claro sem própria = galeriaClaro do slug) e `layout`; snapshot do page.tsx antigo capturado ANTES da divisão (bio-atual.snap.json, 3 casos, relógio fixo) e a `atual` sai byte a byte igual · ok
2026-11-15 · F4.2 · layouts/{clara,galeria,agenda}.tsx · CSS com escopo (.bc/.bg/.ba) copiado do mockup, fontes por next/font em cada arquivo; cor = site.color (a mesma regra de contraste da atual), a paleta da def de bio NÃO pinta a bio (é amostra do Estúdio); sem preço = "na avaliação" como no mockup (a atual segue sem nada); Galeria com < 3 fotos vira Clara; abas de dia sem JS (abasCss) e toque no horário abre /agendar?servico&data&hora · ok
2026-11-15 · F4.6 · src/lib/modelos/previa-bio.server.ts, src/app/bio/[tenant]/{previa/page.tsx,casos.ts} · token = base64url(JSON {slug,def,caso,exp}) + "." + HMAC-SHA256 (chave `previa-bio:${CRON_SECRET}`), 10 min, def validada no Zod e só tipo bio; `lerPreviaBio(token, slug?)` (o 2º argumento confere o negócio); sem CRON_SECRET assinar lança e ler devolve null; rota só lê, noindex · ok
2026-11-15 · F4.3 · carregar.ts `layoutDaBio` · mesma regra do defDoSite: config pelo cache, catálogo só com gerado.bio ou padrão do ramo/todos, crm só sem gerado.bio e origem ≠ cadastro; def que não é de bio, layout sem código (cartaz…) ou erro = atual · ok
2026-11-15 · F4.4 · bio.test.mts, bio-previa.test.mts, package.json (test:bio roda os dois; o do token com --conditions=react-server por causa do server-only) · atual = snapshot; clara/galeria/agenda com e sem preço, sem nota, sem agenda, mínimo; token ida e volta, adulterado, vencido, outro slug, outra chave · npm run test:bio, test:modelos, test:gerador (0 diferenças), npx tsc --noEmit, npx eslint src/app/bio · ok
2026-11-15 · F4 conferência visual · BLOQUEIO parcial: o dev do worktree não sobe com o Firestore de produção (node_modules é link para ../ruphus-site, o Turbopack recusa sem turbopack.root; e o .env.local aponta a credencial por caminho relativo, que não existe no worktree; usar a credencial do repo principal foi negado pela permissão). Prints feitos com render estático dos layouts e dados de exemplo da sobrancelhas-design-alameda-jardins (fotos reais do kit sobrancelha-1): falta o print com os dados reais pelo /bio/…/previa
2026-11-15 · F7.1 · src/lib/modelos/congelar.server.ts (novo), src/lib/crm.ts (salvarCrm), src/lib/negocios.server.ts (criarNegocio, salvarNegocio) · `refsCongeladas` (pura) + `congelarNegocio(db, slug, "fechou"|"cadastro")`: ref com versao null → versão publicada de agora; site sem ref com gerado.escolha.modelo → {id, versao 1} (= embutido, mesmo visual da escolha; a escolha fica gravada); sem ref nem escolha → padrão do ramo congelado na versão de agora, só se o negócio via o padrão (fechou e origem ≠ cadastro; no cadastro do dono, sim: nasce no padrão); senão fica no caminho de hoje (kit/cor ou hash do slug, que não muda); bio igual, sem escolha (padrão do ramo ou "todos"). Leitura direta (lerCatalogoDireto/lerConfig) e gravação em transação; idempotente; nunca lança (import tardio + catch, log). Chamado depois da transação do CRM quando virou "fechado" e depois da do cadastro. salvarNegocio: trocar de ramo apaga gerado.modelo (como já apagava a escolha) · ok
2026-11-15 · F7.2 · src/app/admin/actions.ts, src/app/admin/site-gaveta.tsx · siteDoNegocio: lista do catálogo (lerCatalogoDireto), só ligados da família (editorial = mesmo nicho, claro = mesmo ramo) mais o modelo em uso mesmo desligado ("(desligado)"); devolve `cliente` e `versao: {congelada, atual, data dd/mm}` quando o congelado é mais velho; doModelo (seção Visual) pela def resolvida. definirModelo: gerado.modelo = {id, versao: cliente ? atual : null} (null = padrão do sistema apaga a ref); gerado.escolha continua gravada para modelo embutido (registrosDoSite/planilha e "Meu negócio" ainda calculam a cor da bio por ela; criado no Estúdio apaga a escolha); site.color/photo pela def que o site vai usar (defDoSite). definirVisual e conversarVisual também passam a def. previewModelo pela def publicada do catálogo. Gaveta: "Versão de dd/mm · há versão nova" com "Prévia da nova" e "Atualizar" (confirmação; regrava o mesmo id, que para cliente fixa a versão atual) · ok
2026-11-15 · F7.3 · scripts/migrar-modelos.mts, congelar.server.ts (planoMigracao/aplicarMigracao) · simulação por padrão; --aplicar com backup em dblocal/backup-modelos-<ts>.json e lotes de 400; cliente (CRM fechado ou cadastro) congelado SEM o padrão (o resolver nunca aplicou padrão a cliente); escolha.modelo → {id, versao: cliente ? 1 : null} para todos; resto fica. Rodado no emulador (simula, aplica, simula de novo = 0) · BLOQUEIO: simulação contra produção não rodou: GOOGLE_APPLICATION_CREDENTIALS do .env.local é caminho relativo e o arquivo não existe no worktree (credencial não copiada, de propósito); rodar do repo principal ou com o caminho absoluto
2026-11-15 · F7 limpeza · src/lib/admin-html.ts (novo: comBase, slugValido), actions.ts e modelos-actions.ts importam (modelos-actions segue com o Zod `Slug` dentro dos esquemas, pela mensagem "Confira slug"); previa-bio.server.ts: sem CRON_SECRET lança ErroPrevisto("Prévia da bio indisponível: falta configurar CRON_SECRET.") · testes: modelos-lote.test.mts (virar fechado congela null e converte escolha, padrão, cadastro, idempotente, definirModelo prospecção/cliente/null, gaveta "há versão nova", migração simula × aplica × segunda rodada vazia), bio-previa.test.mts · npm run test:modelos, test:modelos-banco, test:modelos-lote, test:admin, test:gerador (170 casos, 0 diferenças), test:bio, test:crm, npx tsc --noEmit (só erros em src/app/admin/modelos/inspetor.tsx, da F6 em andamento), eslint dos arquivos tocados · ok
2026-11-15 · F6.1 · src/app/admin/page.tsx · `tela` ganha "modelos" (união, `ferramenta`, botão do topo, nav do celular em 8 colunas com ícone de grade, render `<Estudio idToken>`) · ok
2026-11-15 · F6.2 · src/app/admin/modelos/estudio.tsx, util.tsx · casca de 3 colunas (250px | tela | 310px) com altura da janela; barra Grade/Editor, caminho, "N modelos alterados · rascunho", Aplicar em lote (desligado sem o modelo ligado), Descartar (confirmar) e Publicar; abaixo de 980px a árvore vira select com Bio/Site e o inspetor desce. Rascunho: ajuste edita a cópia local (edicoes) e a prévia sai dela; salvarRascunho 600 ms depois do último ajuste (por modelo; a mudança se junta à pendente, então dois ajustes no mesmo instante não se apagam); Publicar/Descartar gravam o pendente antes; sair do Estúdio grava o pendente · ok
2026-11-15 · F6.3 · modelos/arvore.tsx · família (GRUPOS; "Geral" para bio "todos") › ramo › modelo, busca por nome/id, pontos ligado/desligado e rascunho, ★ padrão (com texto para leitor de tela) · ok
2026-11-15 · F6.4 · modelos/tela.tsx, modelos/negocios-actions.ts (novo, "use server", só lê, adminAction: até 8 negócios do ramo e até 20 que usam o modelo; bio sem negócio do ramo cai em salão) · Moldura com Celular 390×780, Tablet 820×1100, Notebook 1280×800, Monitor 1920×1080 e Todos lado a lado (partes 34/26/16/10%), escala por ResizeObserver; site = iframe srcDoc (sandbox allow-scripts), bio = iframe src da prévia assinada, renovada aos 9 min; prévia 250 ms depois da mudança; comparar só com a mesma família de layout (no Todos, comparar usa Notebook/Celular); vizinhos e grade usam miniatura estática (foto do kit + faixa da cor), não prévia real (seria uma Server Action por modelo, em fila) · ok
2026-11-15 · F6.5 · modelos/inspetor.tsx · Ajustes (nome; ligado e padrão valem na hora, como no servidor; layout do site travado na família do ramo, bio só com os 4 prontos; fonte NOMES_FONTE; kits e cores dos modelos do mesmo ramo e família, na bio os kits editoriais do ramo; nota de que a cor não pinta a bio), Checar (checar 600 ms depois, contador na aba), Números (vazio até a F9), Uso (prospecção × congelados, legado, lista), Histórico (Restaurar com confirmar) · ok
2026-11-15 · F6.6 · modelos/grade.tsx, publicar-dialogo.tsx, lote-dialogo.tsx, novo-dialogo.tsx · diálogos em <dialog> nativo (showModal; sem close() na limpeza do efeito, que no StrictMode disparava onClose e fechava o diálogo); Publicar: "N em prospecção mudam · M clientes ficam na versão atual" + o que mudou por modelo; Lote: ramo/etapa/cidade/UF/só sem escolha manual, contarLote 400 ms depois, incluir clientes pede a segunda confirmação (confirmouClientes: true), resultado com Desfazer; Novo/Duplicar nasce desligado · ok
2026-11-15 · F6.7 · reuso: confirmar() (Descartar, Restaurar), BOTAO_CLARO/BOTAO_ESCURO copiados de site-gaveta.tsx para util.tsx (importar prenderia o Estúdio à gaveta da F7), padrão de escala do PreviaModelo copiado na Moldura; botões de 44 px, foco visível, aria-pressed nas alternâncias, motion-reduce · npx tsc --noEmit ok; npx eslint src/app/admin/modelos src/app/admin/page.tsx ok; npm run test:admin ok; npm run test:modelos ok; npm run build ok
2026-11-15 · F6 roteiro manual · dev local com emuladores Firestore+Auth (demo-siteflow, RUPHUS_E2E=1, sem credencial de produção) e 6 negócios semeados: editar cor/kit/nome com prévia nos 5 formatos, comparar, checar, publicar (versão 2), restaurar a 1, lote incluindo cliente com segunda confirmação e Desfazer (4 trocados, 4 de volta), bio galeria nos 5 formatos pela prévia assinada, grade, criar combinação (desligada), celular em 390px · ok; prints em 1440 e 390 no scratchpad da sessão (f6/). Falta a conferência com dados de produção e a do dono (Gate F6)
2026-11-15 · F7 revisão (regra) · src/lib/modelos/resolver.ts (GeradoModelo.escolha), src/lib/gerador.server.ts (defDoSite), src/app/bio/[tenant]/carregar.ts, src/lib/modelos/repo.server.ts (congelarClientes), modelos.test.mts · escolha manual vence o padrão: gerado.escolha.modelo sem gerado.modelo = modelo do negócio na publicada (origem "negocio"); id fora do catálogo ou de outro tipo = legado; bio com escolha = a de sempre. CRM só é lido sem ref, sem escolha e com padrão. Para o cliente que só tem a escolha não mudar ao publicar, repo.publicar congela antes também quem tem gerado.escolha.modelo = id sem gerado.modelo (grava {id, versão de agora}) e conta a prospecção desse grupo · test:modelos ok; test:gerador 170 casos, 0 diferenças
2026-11-15 · F8.1 · src/lib/modelos/copias.server.ts (novo), src/lib/modelos/lote.server.ts (negociosDoLote), src/app/admin/modelos-actions.ts, src/lib/gerador.server.ts (visualDoSite exportado; registrosDoSite com `def`; gerarNoBanco lê catálogo e config uma vez e resolve a def de cada linha; defDoSite aceita `lido` e a escolha), src/lib/negocios.server.ts (salvarNegocio pela def; criarNegocio refaz a cópia quando o cadastro nasce num modelo), src/app/admin/actions.ts (visualSite trocado por visualDoSite; defDoTenant passa a escolha) · recalcularCopias(db, {modelos | sub | lote}): publicar = prospecção com ref null, com só a escolha, e do ramo cujo padrão é o modelo; padrão de site = prospecção do ramo sem ref nem escolha; lote/desfazer = os negócios do lote (inclui o cliente que o admin confirmou); modelo/padrão/lote de bio não mexem nas cópias (a bio não pinta pela def de bio). Grava só o que mudou, lotes de 400, catálogo direto (o cache ainda é o velho dentro da ação); falha vai para o log e não impede o invalidar. Sem renovarSite por negócio: a bio de site gerado lê config/modelos pelo cache com a tag "modelos", e o revalidateTag(…, { expire: 0 }) chamado depois das cópias derruba todas (próxima visita refaz, sem servir a velha); renovarSite aqueceria milhares por HTTP · teste no emulador (modelos-lote.test.mts): publicar, padrão, lote e desfazer mudam a cópia da prospecção e não a de 3 clientes · ok
2026-11-15 · F8.2 · src/app/admin/modelos-actions.ts · conferido: as 10 ações que gravam (salvarRascunho, publicar, descartar, criar, duplicar, ligar, definirPadrao, restaurar, aplicarLote, desfazerLote) chamam revalidateTag(TAG_MODELOS, { expire: 0 }); definirModelo/definirVisual gravam só o tenant (o site é dinâmico, a bio tem renovarSite), não precisam. previewModelo(null) ("Padrão do sistema") mostra o que o negócio veria sem escolha: defDoSite sem ref nem escolha (padrão do ramo na prospecção; cliente ou sem padrão = sorteio pelo slug). Produção = um processo Next (ver F0.3) · test:modelos, test:modelos-banco, test:modelos-lote, test:gerador-banco (emulador em portas alternativas: o da F6 ocupava 8085/9099), test:admin, test:gerador (170/0), test:bio, test:crm, npx tsc --noEmit, eslint dos arquivos tocados · ok
2026-11-15 · revisão Fable: H1 corrigido · src/lib/modelos/congelar.server.ts · refsCongeladas: cliente só com gerado.escolha.modelo congela na versão PUBLICADA de agora (a que o resolver mostrava), não na 1; vale para o CRM, o cadastro e planoMigracao · teste: barbearia-2 publicada até a v3, prospecção só com a escolha fecha → {id, versao 3}, mesma def no lerSite antes e depois; plano da migração idem
2026-11-15 · revisão Fable: H2 corrigido · repo.server.ts publicar (confere todos os rascunhos antes; ErroPrevisto "Sem rascunho para publicar: ids. Nada foi publicado."), modelos-actions.ts publicar (cópias + invalidar em finally, com todos os ids), estudio.tsx/publicar-dialogo.tsx (Publicar grava o pendente e manda só os ids com rascunho salvo e sem edição local diferente; os não salvos, como nome vazio, aparecem como "ficam de fora"; deu certo ou não, recarrega as listas e solta as edições locais desses ids) · teste no modelos-banco
2026-11-15 · revisão Fable: M1 corrigido · lote.server.ts · `antes` guarda `cliente` de cada negócio; desfazer lê o CRM (e convites) e pula quem é cliente agora e não era ao aplicar (`viraramClientes`, mostrado no diálogo); lote antigo sem `cliente` vale como prospecção · teste no modelos-lote
2026-11-15 · revisão Fable: M2 corrigido · lote-dialogo.tsx · a contagem guarda os filtros com que foi feita; filtro mexido = "Trocar N" desligado até contar de novo (estado com chave, sem setState no efeito)
2026-11-15 · revisão Fable: M3 corrigido · tipos.ts · kit = /^\/assets\/[a-z0-9][a-z0-9/_-]*$/ sem ".."; os 95 embutidos passam; def.nome não entra em HTML montado por texto (só no React do Estúdio e da gaveta, que escapa) · testes em modelos.test e modelos-banco
2026-11-15 · revisão Fable: M4 corrigido · repo.server.ts restaurar · o rascunho restaurado leva o `ativo` da publicada de agora · teste no modelos-banco
2026-11-15 · revisão Fable: M5 corrigido · modelos-actions.ts · salvarRascunho, descartar e restaurar não chamam revalidateTag (não mudam o que sai no ar); publicar, ligar, criar, duplicar, definirPadrao, aplicarLote e desfazerLote seguem invalidando
2026-11-15 · revisão Fable: M6 corrigido · tipos.ts (DefModeloLida), repo.server.ts valido, resolver.ts · leitura do banco: estrito; falhando, tolerante (fonte fora de NOMES_FONTE vira undefined, ramo fora de SUBS fica texto), com log; só dado quebrado sai do catálogo. Resolver loga ref congelada sem a foto da versão. Risco anotado em "Riscos" · teste no modelos-banco
2026-11-15 · revisão Fable: M7 corrigido · repo.server.ts salvarRascunho · recusa trocar editorial ↔ claro num modelo de site e trocar o ramo quando há uso (count de gerado.modelo.id / gerado.bio.id, mais gerado.escolha.modelo no site) · teste no modelos-banco
2026-11-15 · revisão Fable: M8 corrigido · modelos-actions.ts (listarModelos sem contagem; usoDoModelo(id) novo), inspetor.tsx (aba Uso conta ao abrir), publicar-dialogo.tsx (conta ao abrir), grade.tsx (sem "N negócios") · legado = escolha.modelo igual ao id E sem gerado.modelo (lê os docs da escolha só com o campo gerado.modelo e filtra: o Firestore não filtra campo ausente) · teste no modelos-lote
2026-11-15 · revisão Fable: M9 corrigido · modelos-actions.ts checar(def, negocio, fotos) + estudio.tsx · as fotos do ramo só são contadas com a aba Checar aberta, com cache em memória por ramo de 5 min · teste no modelos-lote
2026-11-15 · revisão Fable: L5 corrigido · actions.ts siteDoNegocio · "há versão nova" compara as defs sem `ativo`: versão que só ligou/desligou não conta
2026-11-15 · revisão Fable: L6 corrigido · repo.server.ts duplicar · base cortada para o id ficar em até 60 · teste no modelos-banco
2026-11-15 · revisão Fable: L7 corrigido · firestore.rules `lotes/{id=**}`, rules.test.mjs (lotes/l1/partes/0) · npm run test:rules ok (portas alternativas)
2026-11-15 · revisão Fable: L8 corrigido · lote.server.ts aplicarLote + modelos-actions + lote-dialogo · nada a trocar: sem doc em lotes, devolve {id: null, total: 0}, sem cópias nem invalidar; o diálogo mostra "Nada a trocar" · teste no modelos-lote
2026-11-15 · revisão Fable: L9 corrigido · estudio.tsx · erro ao carregar a lista é aviso na própria tela com "Tentar de novo"; salvar que falhou trava o Publicar até salvar; Descartar e Restaurar cancelam o ajuste pendente (não gravam antes)
2026-11-15 · revisão Fable: nichos ativos · tipos.ts NICHOS_ATIVOS = ["beleza", "saude"] e doNichoAtivo · listarModelos (servidor) só devolve modelos desses nichos (bio "todos" entra); lote (ramos da bio) e "Novo" também filtram; os embutidos de pet, aulas, fitness, automotivo e ótica seguem no código e valendo para quem os usa · teste no modelos-lote
2026-11-15 · revisão Fable: Q1 (decisão do dono) · resolver.ts ehClienteAtivo(gerado, estagio, conviteAceito) = fechado OU cadastro OU convite aceito (membro com viaConvite, o mesmo sinal do gerarNoBanco) OU gerado.publicadoEm; aplicado no resolver, defDoSite e layoutDaBio (CRM e convite só são lidos quando o padrão pode valer e o tenant não é cadastro nem publicado), repo.publicar (congelar), lote (classificar e desfazer), copias (excluir cliente), planoMigracao, siteDoNegocio/definirModelo. Convites do lote inteiro numa consulta collectionGroup("members").where("viaConvite") (repo.comConvite; índice de campo em firestore.indexes.json). congelarNegocio ganha "convite" (assumirNegocio, depois da transação) e "publicou" (publicarSite); o padrão só conta se, sem o sinal do evento, o negócio não era cliente · teste no modelos-lote: convite aceito e publicado não recebem padrão, não entram no lote sem confirmação, congelam ao publicar e na migração; congelarNegocio "convite" e publicarSite congelam no padrão · test:modelos, test:gerador (170/0), test:bio, test:admin, test:crm, test:rules, test:modelos-banco, test:modelos-lote, test:convite ok; npx tsc --noEmit ok; eslint ok
2026-11-15 · QA produção 15/11: celular · modelos/estudio.tsx, tela.tsx · abaixo de 980 px o caminho (h2) vai para uma linha só dele, em cima (order-first, w-full); o prefixo "Site › Família › Ramo ›" fica inteiro até 75% e só o nome do modelo é cortado com reticências; os botões quebram embaixo. Moldura: largura medida 0 cai na do pai ou da janela, mede de novo no ResizeObserver e no resize da janela; a tela tem no mínimo 90 px, então a escala nunca é 0 · conferido no dev com emuladores: 390 px mostra "Site › Beleza › Barbearia › Barbearia 1" e a prévia do celular (300×584, escala 0,73) depois de trocar de 1440 para 390 · ok
2026-11-15 · QA produção 15/11: Uso · modelos/inspetor.tsx, util.tsx (pl), lote-dialogo.tsx, publicar-dialogo.tsx, modelos-actions.ts (checar) · "1 negócio escolheu este modelo" / "N negócios escolheram este modelo" (ref + escolha antiga da gaveta), nota "Negócios que recebem este modelo pelo sorteio automático (sem escolha) não entram nesta conta."; singular/plural nos textos com número fixo (Uso, Publicar, Lote, Desfazer, aviso de poucas fotos) · ok
2026-11-15 · QA produção 15/11: bio em "todos" · lib/modelos/embutidos.ts · bio-clara, bio-galeria e bio-agenda passam de estetica/unhas/barbearia para "todos", como a bio-atual (o layout da bio não é de um ramo; a amostra de foto e cor segue a mesma). Nada dependia do ramo delas (testes, checagem de fotos, lote, padrões). Atenção: se produção já tiver doc modelos/bio-* gravado, o publicado do banco mantém o ramo antigo até alguém salvar · test:modelos, test:bio, test:gerador (170/0), test:modelos-lote ok
2026-11-15 · QA produção 15/11: formato da prévia · modelos/estudio.tsx · site abre em "Todos", bio no celular (mudarTipo troca o formato; criar um modelo de outro tipo também) · conferido no dev · ok
2026-11-15 · QA produção 15/11: apagar modelo · repo.server.ts apagar(id), modelos-actions.ts apagarModelo (adminAction + Zod + invalidar), inspetor.tsx ("Apagar modelo" em Ajustes só para não embutido), estudio.tsx (confirmar "Apagar o modelo X? Não dá para desfazer.", recarrega e seleciona o primeiro modelo) · recusa embutido (id em EMBUTIDOS ou doc com embutido), negócio apontando (gerado.modelo.id, gerado.bio.id, gerado.escolha.modelo) e padrão em config/modelos; apaga modelos/{id} com versoes (recursiveDelete). ponytail: conferir e apagar fora de transação · teste no modelos-banco (embutido com e sem doc, em uso pela escolha e pela bio, padrão, apagado com as 2 versões); conferido no dev (duplicar → apagar → volta ao Barbearia 1, coleção modelos vazia) · ok
2026-11-15 · QA produção 15/11: aceite · test:modelos, test:gerador (170/0), test:bio, test:admin, test:crm, test:rules, test:modelos-banco, test:modelos-lote (emulador em portas alternativas: 8085 ocupada por outro processo), npx tsc --noEmit, eslint dos arquivos tocados, npm run build · ok
2026-11-15 · revisão Fable 2: H1 corrigido · repo.server.ts apagar recusa modelo que um lote ainda desfazível (feitoEm < 7 dias, sem desfeitoEm) devolveria a alguém (`antes[].anterior.id`, no doc ou em lotes/{id}/partes; lote.server.ts loteDevolveria); lote.server.ts desfazerLote lê o catálogo direto e pula quem tinha um modelo que saiu do catálogo (`semModelo`, mostrado no diálogo): nunca grava ref para o nada · testes no modelos-banco (lote no doc, nas partes, desfeito e vencido) e no modelos-lote (semModelo)
2026-11-15 · revisão Fable 2: M1 corrigido · repo.server.ts apagar lê config/modelos direto (sem o lerConfig, que vira vazio ao falhar; erro de leitura recusa) e procura o id em qualquer chave de padroes.site/padroes.bio crus · teste no modelos-banco (config inválida para o lerConfig ainda recusa)
2026-11-15 · revisão Fable 2: M2 corrigido · apagar exige publicado.ativo === false ("Desligue o modelo antes de apagar."); inspetor.tsx deixa "Apagar modelo" desligado com o modelo ligado e a nota "Desligue o modelo para poder apagá-lo." · teste no modelos-banco
2026-11-15 · revisão Fable 2: M3 corrigido · inspetor.tsx: na bio, a chave "Padrão do ramo" virou o grupo "Padrão da bio para os ramos" (um checkbox por ramo dos NICHOS_ATIVOS e "Todos os outros ramos" = chave "todos"; marcar grava, desmarcar tira só se o ramo aponta para este modelo; ramo de outra bio mostra "hoje: <nome>" e marcar troca); o site segue com a chave pelo próprio ramo. util.tsx ehPadrao (bio = padrão em qualquer ramo) usado em arvore, grade e estudio; selo "Padrão da bio em N ramos". Servidor sem mudança: definirPadrao já aceita "todos" e todo ramo de SUBS, e só confere o tipo do modelo (bio "todos" vale para qualquer ramo) · teste no modelos-lote (dois ramos, listarModelos, resolver da bio no ramo, tirar um; pelo repo.definirPadrao, porque a ação chama revalidateTag, que exige requisição) · conferido no dev com emuladores (1440: marcar Barbearia, mover Odontologia de Bio galeria, marcar Todos, desmarcar Barbearia; estrela da Bio galeria some) · ok
2026-11-15 · revisão Fable 2: L1 corrigido · modelos-actions.ts checar: bio "todos" não diz "do ramo"; a contagem de fotos (que no "todos" lê todos os negócios) já só roda com a aba Checar aberta, com o cache de 5 min
2026-11-15 · revisão Fable 2: L3 corrigido · estudio.tsx: falha de salvar de um id que saiu das listas (modelo apagado) não trava o Publicar
2026-11-15 · revisão Fable 2: L4 corrigido · apagarModelo loga quem apagou e o id (console.info); apagar tira versoes antes e o doc por último (se cair no meio, o doc fica e apagar de novo termina)
2026-11-15 · revisão Fable 2: L5 corrigido · publicar-dialogo.tsx: singular/plural com pl() em "em prospecção já mostra(m)", no resumo, nas legendas dos números e por modelo (muda/mudam, congelado/congelados)
2026-11-15 · revisão Fable 2: aceite · test:modelos, test:gerador (170/0), test:bio, test:admin, test:crm, test:rules (cópia temporária em portas alternativas, apagada), test:modelos-banco, test:modelos-lote (portas alternativas), npx tsc --noEmit, eslint dos arquivos tocados, npm run build · ok
2026-11-16 · F4.5 · layouts/{cartaz,vidro,painel,noturno,stories}.tsx, layouts/index.tsx, carregar.ts (`saude` = SUBS[gerado.sub].nicho === "saude"), embutidos.ts (bio-cartaz/-vidro/-painel/-noturno/-stories, sub "todos"; amostra barbearia-2, sobrancelha-1, tatuador-1, cabeleireira-2, cilios-1), util.tsx BIO_PRONTOS = todos · CSS com escopo (.bz/.bv/.bp/.bn/.bs) do mockup, fonte por next/font em cada arquivo; cor = site.color com texto claro/escuro pela regra `claro()`; foto = 1ª da galeria do site, senão site.photo, sem nenhuma o bloco fica na cor (Noturno: inicial); Cartaz em saúde = #0E3B3A com destaque #7FD1C7 e "Atendimentos"; Vidro sólido em @supports sem backdrop-filter e em prefers-reduced-transparency; Noturno em saúde = "amanhecer" (.am), tons vizinhos da aurora por cor relativa oklch dentro de @supports (fixos do mockup sem suporte), aurora parada em reduced-motion; Painel sem nota/sem horário: o bloco que sobra ocupa a linha, "ver todos" com details próprio (grade de 2 colunas); Stories com < 3 fotos = Clara, troca de foto a cada 4 s só com CSS, reduced-motion = 1ª foto parada, destaques = Horários/Serviços (âncoras), Fotos (site), contatos (Como chegar vira "Endereço"), adesivo de próximo horário abre o 1º horário livre · npm run test:bio, test:modelos, test:gerador (176/0), npx tsc --noEmit, eslint · ok
2026-11-16 · F4.5 conferência visual · render estático (harness da F4 com as fontes novas) a 500 e 1280 px, sem dados reais pelo /bio/…/previa (mesmo bloqueio da F4) · falta a conferência do dono
