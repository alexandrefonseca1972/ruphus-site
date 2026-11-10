# Plano de correção — painel, Caixa e sessão

Base: `origin/main` em 6b966a11. Todos os trechos "atual" foram conferidos nesse commit.
Testes ficam na raiz do repo (`*.test.mts`), não em `src/`.
Antes de cada PR: `npm run typecheck` e `npm run lint` precisam passar.

Regras para quem executa:
- Copie os trechos novos exatamente. Não reescreva comentários que não estão no trecho.
- Se o "trecho atual" não for encontrado igual, PARE e avise. Não adapte.
- Não mude nada fora dos arquivos listados no item.

---

## ALTOS

### A3 — Comissão na tela ignora sinal pago 2+ meses antes
Arquivo(s): `src/app/[tenant]/caixa/page.tsx:96-100` e `:149-151`; referência `src/lib/financeiro.server.ts:358-364`

Por quê: o servidor (`pagar`) soma as entradas com `mes == mes` E com `mesComissao == mes`. A tela lê só `mes in [desde, mes, ate]`. Um sinal pago 2+ meses antes do atendimento tem `mes` antigo e `mesComissao` deste mês: fica fora da tela, o valor da tela nunca bate e o servidor recusa com "Feche e abra de novo".

Escolha: segunda consulta na tela (`where("mesComissao", "==", mes)`) unida por id. Não muda contrato de action nenhuma. `firestore.rules:143-147` libera a leitura de `lancamentos` para dono/admin com o Caixa ligado sem olhar o formato da consulta; igualdade num campo só usa índice automático. Não mexer em `firestore.rules` nem em `firestore.indexes.json`.

Os lançamentos a mais entram só em `comAnterior` (o que a tela usa para saber o que já foi recebido, nomes, comissão e recibo). `lancamentos` continua filtrando `l.mes === mes`, então Entrou/Saiu/lista do mês não mudam.

Trecho atual (linhas 95-100):
```tsx
  // as consultas só sobem com o Caixa ligado: desligado, a regra negaria a leitura
  const [comAnteriorLido, erroLeitura] = useCollection(ligado ? tenant.id : "", "lancamentos", Lancamento, [where("mes", "in", [...new Set([desde, mes, ate])])], `${desde}/${mes}/${ate}`);
  // leitura com erro chega vazia: tratada como "carregando", senão a tela daria R$ 0, tudo a
  // receber de novo e todas as contas em aberto como se fosse verdade
  const comAnterior = erroLeitura ? null : comAnteriorLido;
  const lancamentos = comAnterior && comAnterior.filter((l) => l.mes === mes);
```

Trecho novo (substitui as linhas 95-100 inteiras; já inclui o `descartados` do M4 — se o M4 ainda não foi feito, faça o M4 antes, no mesmo PR):
```tsx
  // as consultas só sobem com o Caixa ligado: desligado, a regra negaria a leitura
  const [comAnteriorLido, erroLeitura, foraDoMes] = useCollection(ligado ? tenant.id : "", "lancamentos", Lancamento, [where("mes", "in", [...new Set([desde, mes, ate])])], `${desde}/${mes}/${ate}`);
  // o sinal pago 2+ meses antes do atendimento conta na comissão do mês em que o atendimento foi
  // recebido (mesComissao). O servidor soma por aqui também: sem esta leitura, a tela pagava menos
  // e o "Pagar" era recusado
  const [daComissaoLido, erroComissao, foraDaComissao] = useCollection(ligado ? tenant.id : "", "lancamentos", Lancamento, [where("mesComissao", "==", mes)], `comissao/${mes}`);
  // leitura com erro chega vazia: tratada como "carregando", senão a tela daria R$ 0, tudo a
  // receber de novo e todas as contas em aberto como se fosse verdade
  const comAnterior =
    erroLeitura || erroComissao || !comAnteriorLido || !daComissaoLido ? null : [...new Map([...comAnteriorLido, ...daComissaoLido].map((l) => [l.id, l])).values()];
  const descartados = foraDoMes + foraDaComissao;
  const lancamentos = comAnterior && comAnterior.filter((l) => l.mes === mes);
```

Trecho atual (linhas 149-151):
```tsx
  // pelo mês da comissão: o sinal só depois de o atendimento ser recebido, no mês do recebimento.
  // ponytail: sinal pago 2+ meses antes do recebimento fica fora da tela (o servidor conta certo)
  const daComissao = (comAnterior ?? []).filter((l) => mesDaComissao(l) === mes);
```

Trecho novo:
```tsx
  // pelo mês da comissão: o sinal só depois de o atendimento ser recebido, no mês do recebimento
  const daComissao = (comAnterior ?? []).filter((l) => mesDaComissao(l) === mes);
```

Outros pontos a tocar: nenhum (o alerta de `descartados` está no M4).

Teste: a tela não tem teste automatizado. O lado do servidor já é coberto em `financeiro.test.mts` (linhas 337-350, sinal do Rui). Rodar `npm run test:financeiro` para garantir que nada quebrou. Verificação manual (dev local com emulador ou negócio de teste, Caixa ligado):
1. Crie um agendamento com sinal pago, com o lançamento `sn-<id>` no Caixa com `data`/`mes` de 2 meses atrás (ex.: hoje 2026-11 → mes "2026-09"), profissional com % de comissão.
2. Dê baixa no atendimento este mês pelo "Fechar o dia" (o servidor grava `mesComissao: "2026-11"` no `sn-`).
3. No Caixa de novembro, "faturou" do profissional inclui o sinal; tocar em "Pagar" e confirmar grava sem o erro "Feche e abra de novo".

Critério de pronto: no cenário acima o valor de "Pagar" da tela é igual ao que o servidor calcula e o pagamento é aceito. Entrou/Saiu/Sobrou do mês não mudam (o sinal antigo não aparece na lista do mês). O comentário `ponytail: sinal pago 2+ meses antes…` não existe mais.

---

### A4 — Inatividade contada por aba, logout global
Arquivo(s): `src/lib/sessao.ts:42-70` (o arquivo inteiro é reescrito junto com M1 e M2); `src/lib/limites.ts` (função pura nova)

Por quê: cada aba conta o próprio "último toque". Quem trabalha na aba da agenda é deslogado pela aba do Caixa esquecida aberta, porque `signOut` vale para o navegador inteiro.

Decisão de desenho: o último toque vai para `localStorage` numa chave única (`sessao:ultimoToque`). Não precisa ser por uid: o Firebase Auth tem um usuário só por navegador, toda aba é do mesmo usuário, e uma chave fixa evita o caso "ainda não sei o uid" na montagem. A aba sai só quando `max(toque desta aba, toque guardado)` venceu. O evento `storage` faz a outra aba reconferir na hora (some o aviso dela quando alguém toca noutra aba).

Passo 1 — `src/lib/limites.ts`: acrescente no FIM do arquivo (depois do bloco de `DIAS_CONVITE`):
```ts

/** O aviso do logout automático aparece este tanto antes do fim. */
export const AVISO_SESSAO_MS = 60_000;

/** Em que ponto está quem está parado há `parado` ms, com logout em `minutos` (0 desliga).
 *  Com prazo de 1 minuto não há aviso: ele cobriria a sessão inteira. */
export function faseDaSessao(parado: number, minutos: number): "ativa" | "aviso" | "sair" {
  const limite = minutos * 60_000;
  if (!minutos || parado < limite - AVISO_SESSAO_MS) return "ativa";
  if (parado >= limite) return "sair";
  return minutos >= 2 ? "aviso" : "ativa";
}
```

Passo 2 — `src/lib/sessao.ts`: substitua o arquivo INTEIRO por:
```ts
"use client";

import { signOut } from "firebase/auth";
import { useCallback, useEffect, useRef, useState } from "react";
import { auth } from "@/lib/firebase";
import { faseDaSessao, MINUTOS_MAX } from "@/lib/limites";

export { MINUTOS_MAX };

/** Logout automático depois de X minutos parado, com X definido pelo admin da
 *  plataforma em config/sessao. 0 (o padrão) desliga.
 *
 *  A conta é por relógio, não por setTimeout: aba em segundo plano tem o timer
 *  estrangulado pelo navegador, e o computador que dorme não dispara nada.
 *
 *  O último toque é um só para todas as abas (localStorage): o signOut vale para o
 *  navegador inteiro, e a aba do Caixa esquecida aberta não pode deslogar quem
 *  está trabalhando na aba da agenda. */

/** Sai da conta e apaga do aparelho os dados que o painel guardou para funcionar
 *  sem internet. O Firestore é carregado só aqui, e só se a página já o usava:
 *  o login e o admin não o baixam. Termina recarregando em /login: o Firestore encerrado
 *  não volta, e navegar sem recarregar (router) deixava o painel seguinte quebrado com
 *  "The client has already been terminated".
 *
 *  O destino vem daqui, e não dos listeners de sessão: o signOut também os acorda, e o
 *  router.replace deles perde para esta recarga.
 *
 *  manterPush: o logout por inatividade não cancela os avisos de agendamento — a pessoa
 *  não escolheu sair, só ficou parada. Só o "Sair" de quem escolheu sair cancela. */
export async function sair(destino = "/login", { manterPush = false } = {}) {
  if (!manterPush) {
    // aparelho compartilhado: quem entrar depois não recebe os avisos deste negócio
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      await (await reg?.pushManager.getSubscription())?.unsubscribe();
    } catch {
      // sem service worker ou sem push: nada inscrito
    }
  }
  await signOut(auth).catch(() => {});
  try {
    const { limparCacheLocal } = await import("@/lib/firebase-db");
    await limparCacheLocal();
  } catch {
    // sem IndexedDB (aba anônima antiga): não havia cache para apagar
  }
  window.location.replace(destino);
}

const EVENTOS = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
const OLHADA = 15_000;
/** O último toque de todas as abas. Chave fixa: o Firebase Auth tem um usuário por navegador. */
const CHAVE = "sessao:ultimoToque";
/** Gravar a cada rolagem seria escrever no disco o tempo todo; 5 s não mudam um prazo de minutos. */
const GRAVAR_A_CADA = 5_000;
/** Diálogo aberto é alguém no meio de uma tarefa (lendo, preenchendo): não está parado. */
const DIALOGO = "dialog[open], [role=dialog], [role=alertdialog]";

const lerToque = () => {
  try {
    return Number(localStorage.getItem(CHAVE)) || 0;
  } catch {
    return 0; // sem localStorage (bloqueado): vale o relógio desta aba
  }
};
const gravarToque = (t: number) => {
  try {
    localStorage.setItem(CHAVE, String(t));
  } catch {
    // sem localStorage: vale o relógio desta aba
  }
};

/** Conta o tempo parado (somando as abas) e sai sozinho. Devolve [avisando, continuar]:
 *  quem chama mostra o <AvisoSessao> um minuto antes. */
export function useAutoLogout(minutos: number) {
  const [avisando, setAvisando] = useState(false);
  const marcarRef = useRef(() => {});

  useEffect(() => {
    if (!minutos) return;
    let ultimo = Date.now();
    let gravado = 0;
    const marcar = () => {
      ultimo = Date.now();
      if (ultimo - gravado >= GRAVAR_A_CADA) gravarToque((gravado = ultimo));
    };
    marcarRef.current = marcar;
    const conferir = async () => {
      if (!auth.currentUser) return;
      if (document.querySelector(DIALOGO)) return marcar();
      const fase = faseDaSessao(Date.now() - Math.max(ultimo, lerToque()), minutos);
      setAvisando(fase === "aviso");
      if (fase !== "sair") return;
      // o motivo e a tela vão na URL: o login avisa por que saiu e volta para cá depois
      await sair(`/login?expirou=${minutos}&next=${encodeURIComponent(location.pathname)}`, { manterPush: true });
    };
    // outra aba tocou: o aviso desta some na hora, sem esperar a próxima olhada
    const daOutraAba = (e: StorageEvent) => {
      if (e.key === CHAVE) void conferir();
    };
    marcar(); // abrir a tela conta como atividade
    // capture: "scroll" não borbulha, e aqui quem rola é a gaveta e as listas,
    // não o documento — sem isto, ler uma lista longa era ficar "parado"
    for (const e of EVENTOS) addEventListener(e, marcar, { passive: true, capture: true });
    // voltar para a aba conta como atividade, mas confere antes: pode ter dormido
    addEventListener("visibilitychange", conferir);
    addEventListener("storage", daOutraAba);
    const id = setInterval(conferir, OLHADA);
    return () => {
      for (const e of EVENTOS) removeEventListener(e, marcar, { capture: true });
      removeEventListener("visibilitychange", conferir);
      removeEventListener("storage", daOutraAba);
      clearInterval(id);
      marcarRef.current = () => {};
    };
  }, [minutos]);

  const continuar = useCallback(() => {
    marcarRef.current();
    setAvisando(false);
  }, []);
  // logout desligado no meio do aviso: o aviso some junto
  return [avisando && !!minutos, continuar] as const;
}
```

Outros pontos a tocar: os dois chamadores de `useAutoLogout` passam a usar o retorno — ver M1 (`src/app/[tenant]/painel-layout.tsx:49` e `src/app/admin/page.tsx:124`).

Teste: criar `sessao.test.mts` na raiz:
```ts
// Logout automático: em que fase está quem ficou parado (src/lib/limites.ts)
import assert from "node:assert/strict";
import { faseDaSessao } from "@/lib/limites";

const MIN = 60_000;
assert.equal(faseDaSessao(10 ** 9, 0), "ativa", "0 desliga");
assert.equal(faseDaSessao(4 * MIN - 1, 5), "ativa");
assert.equal(faseDaSessao(4 * MIN, 5), "aviso", "um minuto antes do fim");
assert.equal(faseDaSessao(5 * MIN - 1, 5), "aviso");
assert.equal(faseDaSessao(5 * MIN, 5), "sair");
assert.equal(faseDaSessao(30_000, 1), "ativa", "prazo de 1 min: sem aviso");
assert.equal(faseDaSessao(MIN, 1), "sair");
console.log("sessao ok");
```
Em `package.json`, dentro de `"scripts"`, logo depois da linha `"test:recibo": "tsx recibo.test.mts",` acrescente:
```json
    "test:sessao": "tsx sessao.test.mts",
```
Comando: `npm run test:sessao`.

Verificação manual (logout configurado em 2 min no /admin, config/sessao):
1. Abra o painel em duas abas; fique tocando só na aba A por 3 min. A aba B não pode deslogar.
2. Pare de tocar nas duas: depois de ~1 min o aviso aparece nas duas; toque "Continuar" na A: o aviso da B some em segundos.
3. Pare de novo sem tocar: as duas vão para `/login?expirou=2…`.

Critério de pronto: `npm run test:sessao` passa; o cenário 1 não desloga; o cenário 3 desloga; DevTools > Application > Local Storage mostra `sessao:ultimoToque` mudando com toques.

---

## MÉDIOS

### M1 — Aviso antes do logout automático e adiamento com diálogo aberto
Arquivo(s): `src/lib/sessao.ts:53-57` (já resolvido no código do A4: `faseDaSessao`, `DIALOGO`, retorno `[avisando, continuar]`); novo `src/components/aviso-sessao.tsx`; `src/app/[tenant]/painel-layout.tsx:49` e `:109`; `src/app/admin/page.tsx:124` e `:734`

Por quê: o logout cai sem aviso no meio de um formulário. Agora aparece "Sua sessão vai encerrar em 1 min" com "Continuar", e enquanto houver diálogo aberto o tempo não corre.

Componente usado: `Button` de `src/components/ui/button.tsx`. NÃO usar `AlertDialog` (`src/components/ui/alert-dialog.tsx`): ele renderiza `role="alertdialog"`, e um diálogo aberto adia o logout — o aviso se adiaria para sempre. Por isso o aviso é uma faixa fixa com `role="alert"`.

Passo 1 — criar `src/components/aviso-sessao.tsx`:
```tsx
"use client";

import { Button } from "@/components/ui/button";

/** "Sua sessão vai encerrar": faixa, não diálogo, de propósito — diálogo aberto adia o logout
 *  automático (src/lib/sessao.ts), e o próprio aviso se adiaria para sempre. */
export function AvisoSessao({ aberto, onContinuar }: { aberto: boolean; onContinuar: () => void }) {
  if (!aberto) return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-md flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-lg sm:bottom-6 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
    >
      <p>Sua sessão vai encerrar em 1 min por falta de uso.</p>
      <Button className="h-10 px-4" onClick={onContinuar}>Continuar</Button>
    </div>
  );
}
```

Passo 2 — `src/app/[tenant]/painel-layout.tsx`.
Trecho atual (linha 49):
```tsx
  useAutoLogout(useMinutosInativo());   // sai sozinho depois de X minutos parado, se o admin ligou
```
Trecho novo:
```tsx
  // sai sozinho depois de X minutos parado, se o admin ligou; avisa um minuto antes
  const [avisoSessao, continuarSessao] = useAutoLogout(useMinutosInativo());
```
Trecho atual (linhas 108-109):
```tsx
        <MonitorConexao />
        <AvisoNovoAgendamento />
```
Trecho novo:
```tsx
        <MonitorConexao />
        <AvisoNovoAgendamento />
        <AvisoSessao aberto={avisoSessao} onContinuar={continuarSessao} />
```
E acrescente o import logo depois da linha `import { MonitorConexao } from "@/components/monitor-conexao";`:
```tsx
import { AvisoSessao } from "@/components/aviso-sessao";
```

Passo 3 — `src/app/admin/page.tsx`.
Trecho atual (linha 124):
```tsx
  useAutoLogout(minutosInativo);
```
Trecho novo:
```tsx
  const [avisoSessao, continuarSessao] = useAutoLogout(minutosInativo);
```
Trecho atual (linhas 733-735):
```tsx
  return (
    <>
      {/* Navegação, busca e ajustes. Filtro e ordem ficam com as visões, abaixo. */}
```
Trecho novo:
```tsx
  return (
    <>
      <AvisoSessao aberto={avisoSessao} onContinuar={continuarSessao} />
      {/* Navegação, busca e ajustes. Filtro e ordem ficam com as visões, abaixo. */}
```
E acrescente o import logo depois da linha `import { MINUTOS_MAX, sair, useAutoLogout } from "@/lib/sessao";` (linha 46):
```tsx
import { AvisoSessao } from "@/components/aviso-sessao";
```

Outros pontos a tocar: nenhum.

Teste: `npm run test:sessao` (do A4) cobre o momento do aviso. Verificação manual (logout em 2 min):
1. Parado 1 min: a faixa aparece; "Continuar" some com ela e o prazo recomeça.
2. Abra "+ Entrada" no Caixa (folha/diálogo) e espere 3 min sem tocar: não desloga nem avisa.
3. Feche a folha e espere: aviso e depois logout normais.

Critério de pronto: os 3 passos acima se comportam assim no painel e no /admin; `npm run typecheck` passa.

---

### M2 — Logout automático cancela o push
Arquivo(s): `src/lib/sessao.ts:24-31` (resolvido no código do A4: parâmetro `{ manterPush }`)

Por quê: quem saiu por inatividade deixava de receber o aviso de agendamento novo sem ter escolhido isso.

Chamadores de `sair` (grep `sair(` em `src`), conferidos:
- `src/lib/sessao.ts` (dentro de `useAutoLogout`) — automático: passa `{ manterPush: true }` (já no código do A4).
- `src/app/[tenant]/account-menu.tsx:79` — `onConfirm={() => sair()}` — "Sair" manual: NÃO MUDAR (cancela o push).
- `src/app/admin/page.tsx:686` e `:923` — `void sair()` — "Sair" manual do admin: NÃO MUDAR.
- `src/app/painel/page.tsx:72` — `return void sair();` — sessão encerrada pelo admin da plataforma: NÃO MUDAR (cancela o push; a pessoa foi tirada).

Trecho atual / novo: ver o arquivo inteiro no A4.

Outros pontos a tocar: nenhum.

Teste: sem teste automatizado (service worker). Manual:
1. Ligue "Avisos de agendamento" no menu da conta.
2. Deixe o logout automático vencer; entre de novo: o menu mostra "Avisos de agendamento: ligados".
3. Use "Sair" manual e entre de novo: mostra "desligados".

Critério de pronto: os passos 2 e 3 dão o resultado descrito.

### M3 — txid do Pix igual para meses diferentes
Arquivo(s): `src/lib/pix.ts:69-73`
Fora deste plano: ver plano agendamento, item B4. Não mexer em `pix.ts` aqui.

---

### M4 — Lançamento fora do esquema some calado no Caixa
Arquivo(s): `src/lib/use-collection.ts:21`, `:33-46`, `:57-58`; `src/app/[tenant]/caixa/page.tsx` (alerta)

Por quê: um lançamento que não passa no zod sai das somas sem nenhum aviso; o dono vê totais errados como se fossem verdade.

Trecho atual (use-collection.ts linha 21):
```ts
  const [result, setResult] = useState<{ for: string; items: Item[]; error?: string } | null>(null);
```
Trecho novo:
```ts
  const [result, setResult] = useState<{ for: string; items: Item[]; error?: string; descartados: number } | null>(null);
```

Trecho atual (use-collection.ts linhas 33-46):
```ts
      (snap) =>
        setResult({
          for: current,
          items: snap.docs.flatMap((d) => {
            const r = schema.safeParse(d.data({ serverTimestamps: "estimate" }));
            // documento fora do formato some da lista: pelo menos fica no console para achar
            if (!r.success) console.warn(`[${name}] ${d.id} fora do formato:`, r.error.issues[0]);
            return r.success ? [{ ...(r.data as object), id: d.id } as Item] : [];
          }),
        }),
      (err) => {
        console.error(`[${name}] escuta caiu (tentativa ${tentativa + 1})`, err);
        setResult({ for: current, items: [], error: errorMessage(err) });
```
Trecho novo:
```ts
      (snap) => {
        // documento fora do formato some da lista: fica no console e na contagem, para a tela avisar
        let descartados = 0;
        const items = snap.docs.flatMap((d) => {
          const r = schema.safeParse(d.data({ serverTimestamps: "estimate" }));
          if (!r.success) {
            descartados++;
            console.warn(`[${name}] ${d.id} fora do formato:`, r.error.issues[0]);
          }
          return r.success ? [{ ...(r.data as object), id: d.id } as Item] : [];
        });
        setResult({ for: current, items, descartados });
      },
      (err) => {
        console.error(`[${name}] escuta caiu (tentativa ${tentativa + 1})`, err);
        setResult({ for: current, items: [], error: errorMessage(err), descartados: 0 });
```

Trecho atual (use-collection.ts linhas 57-58):
```ts
  const mine = result?.for === current ? result : null;
  return [mine ? mine.items : null, mine?.error ?? ""] as const;
```
Trecho novo:
```ts
  const mine = result?.for === current ? result : null;
  // terceiro: quantos documentos ficaram fora por não passarem no schema
  return [mine ? mine.items : null, mine?.error ?? "", mine?.descartados ?? 0] as const;
```

E troque o comentário da linha 9:
Trecho atual:
```ts
/** Coleção do tenant em tempo real; documentos fora do schema são ignorados.
```
Trecho novo:
```ts
/** Coleção do tenant em tempo real; documentos fora do schema são ignorados e contados (terceiro item).
```

Caixa — `src/app/[tenant]/caixa/page.tsx`: a variável `descartados` já foi criada no A3. Mostre o alerta logo depois do `</PageTitle>`.
Trecho atual (linhas 213-215):
```tsx
      </PageTitle>

      {/* No celular, três cartões de ~115 px partiam "R$ 12.345,00" no meio: o Sobrou (o que o
```
Trecho novo:
```tsx
      </PageTitle>

      {descartados > 0 && (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {descartados === 1 ? "1 lançamento não pôde ser lido e ficou fora das contas." : `${descartados} lançamentos não puderam ser lidos e ficaram fora das contas.`} Os totais podem estar errados. Fale com a Ruphus.
        </p>
      )}

      {/* No celular, três cartões de ~115 px partiam "R$ 12.345,00" no meio: o Sobrou (o que o
```

Outros pontos a tocar: nenhum. Os outros ~40 chamadores de `useCollection` desestruturam só dois itens (`const [a, b] = …`); o terceiro é ignorado sem mudança (conferido: não há uso sem desestruturar).

Teste: sem teste automatizado de hook. `npm run typecheck`. Manual:
1. No emulador/negócio de teste, grave à mão em `tenants/<t>/lancamentos/teste-ruim` um doc com `mes` do mês atual e `valorCents: "abc"` (string).
2. Abra o Caixa: aparece "1 lançamento não pôde ser lido…".
3. Apague o doc: o alerta some.

Critério de pronto: o alerta aparece com 1+ doc inválido e some sem eles; typecheck passa.

---

### M5 — Qualquer falha vira "Você não tem acesso"
Arquivo(s): `src/app/[tenant]/painel-layout.tsx:45-46`, `:72-74`, `:81`, `:83-89`

Por quê: rede caída ou erro de leitura aparecia como "sem acesso", e a pessoa achava que perdeu o negócio. Só `permission-denied` (código do FirebaseError) é falta de acesso; o resto ganha "Tentar de novo".

Trecho atual (linhas 44-46):
```tsx
  // Resultado guardado com o slug: ao trocar de espaço nunca mostra o anterior
  const [loaded, setLoaded] = useState<{ slug: string; value: TenantCtx | "denied" } | null>(null);
  const state = loaded?.slug === slug ? loaded.value : "loading";
```
Trecho novo:
```tsx
  // Resultado guardado com o slug: ao trocar de espaço nunca mostra o anterior
  const [loaded, setLoaded] = useState<{ slug: string; value: TenantCtx | "denied" | "erro" } | null>(null);
  const state = loaded?.slug === slug ? loaded.value : "loading";
  // "Tentar de novo" refaz as leituras
  const [tentativa, setTentativa] = useState(0);
```

Trecho atual (linhas 56 e 72-74):
```tsx
      let value: TenantCtx | "denied";
```
```tsx
      } catch {
        value = "denied";
      }
```
Trecho novo (troque cada um):
```tsx
      let value: TenantCtx | "denied" | "erro";
```
```tsx
      } catch (e) {
        // só a recusa das regras é "sem acesso"; rede caída ou dado estranho pede outra tentativa
        if ((e as { code?: string } | null)?.code === "permission-denied") value = "denied";
        else {
          console.error("[painel] não abriu o negócio", e);
          value = "erro";
        }
      }
```

Trecho atual (linha 81):
```tsx
  }, [slug, router]);
```
Trecho novo:
```tsx
  }, [slug, router, tentativa]);
```

Trecho atual (linhas 83-89):
```tsx
  if (state === "loading") return <p role="status" className="p-8">Carregando…</p>;
  if (state === "denied")
    return (
      <p role="alert" className="p-8">
        Você não tem acesso a este negócio. <Link href="/painel" className="underline underline-offset-4">Voltar aos seus negócios</Link>
      </p>
    );
```
Trecho novo:
```tsx
  if (state === "loading") return <p role="status" className="p-8">Carregando…</p>;
  if (state === "denied")
    return (
      <p role="alert" className="p-8">
        Você não tem acesso a este negócio. <Link href="/painel" className="underline underline-offset-4">Voltar aos seus negócios</Link>
      </p>
    );
  if (state === "erro")
    return (
      <div role="alert" className="grid gap-3 p-8">
        <p>Não foi possível abrir este negócio. Confira a internet e tente de novo.</p>
        <Button className="h-11 w-fit px-4" onClick={() => (setLoaded(null), setTentativa((t) => t + 1))}>Tentar de novo</Button>
      </div>
    );
```
Acrescente o import logo depois da linha `import { MonitorConexao } from "@/components/monitor-conexao";`:
```tsx
import { Button } from "@/components/ui/button";
```

Outros pontos a tocar: nenhum. (Atenção: o M1 também acrescenta um import na mesma posição; mantenha os dois.)

Teste: sem teste automatizado. Manual:
1. Com o painel fechado, DevTools > Network > Offline, abra `/<slug>` sem cache (aba anônima já logada não serve; use "Clear site data" e entre, depois fique offline e recarregue): aparece "Não foi possível abrir… Tentar de novo".
2. Volte online e toque "Tentar de novo": o painel abre.
3. Entre com uma conta que não é membro de `/<slug>`: aparece "Você não tem acesso a este negócio".

Critério de pronto: os três casos mostram a mensagem certa; typecheck passa.

---

### M6 — "Total gasto" soma o preço de tabela da agenda
Arquivo(s): `src/app/[tenant]/clientes/[customer]/page.tsx:13-14`, `:67-69`, `:141`; referência `src/lib/clientes.ts:47`

Por quê: "Total gasto" soma `priceCents` dos agendamentos atendidos — preço de tabela, não o que o cliente pagou. Com o Caixa ligado dá para somar o que entrou de fato: as entradas com `customerKey` do cliente (`ag-`, `sn-`) menos os estornos (`es-`, que carregam o mesmo `customerKey` — `financeiro.server.ts:201`). Isso é pequeno (uma consulta), então vai inteiro, sem fase 2.

Trecho atual (linha 14):
```tsx
import { useCollection } from "@/lib/use-collection";
```
Trecho novo:
```tsx
import { useCollection } from "@/lib/use-collection";
import { Lancamento } from "@/lib/financeiro";
```

Trecho atual (linhas 67-69):
```tsx
  const [appointments] = useCollection(tenant.id, "appointments", Appointment, [where("customerKey", "==", key), orderBy("start", "desc")], key);
  const [plans] = useCollection(tenant.id, "plans", Plan, [where("customerKey", "==", key)], key);
  const [notas] = useCollection(tenant.id, `customers/${key}/notas`, Nota, [orderBy("quando", "desc")], key);
```
Trecho novo:
```tsx
  const [appointments] = useCollection(tenant.id, "appointments", Appointment, [where("customerKey", "==", key), orderBy("start", "desc")], key);
  const [plans] = useCollection(tenant.id, "plans", Plan, [where("customerKey", "==", key)], key);
  const [notas] = useCollection(tenant.id, `customers/${key}/notas`, Nota, [orderBy("quando", "desc")], key);
  // com o Caixa: o que o cliente pagou de verdade. Só quem gere lê o Caixa (regra do banco)
  const comCaixa = tenant.podeGerir && tenant.modulos?.financeiro === true;
  const [pagos, erroPagos] = useCollection(comCaixa && key ? tenant.id : "", "lancamentos", Lancamento, [where("customerKey", "==", key)], key);
```

Trecho atual (linha 141):
```tsx
    { label: "Total gasto", value: formatBRL(attended.reduce((sum, a) => sum + a.priceCents, 0)) },
```
Trecho novo:
```tsx
    // com o Caixa, o recebido menos o estornado; sem ele, só o preço de tabela da agenda
    comCaixa
      ? { label: "Total pago", value: pagos && !erroPagos ? formatBRL(pagos.reduce((t, l) => t + (l.tipo === "entrada" ? l.valorCents : l.estornoDe ? -l.valorCents : 0), 0)) : "…" }
      : { label: "Valor de tabela", value: formatBRL(attended.reduce((sum, a) => sum + a.priceCents, 0)) },
```

Outros pontos a tocar: nenhum neste PR. Fora do escopo (anotar, não fazer): a lista `src/app/[tenant]/clientes/page.tsx:47,220,284,287` mostra "Gasto 12m" com a mesma soma de tabela (`resumoPorCliente`, `clientes.ts:47`); `clientes.test.mts:91` afirma `gastoCents`. Não alterar `clientes.ts`.

Teste: `npm run test:clientes` (não deve mudar nada). Manual:
1. Negócio sem Caixa: o cartão diz "Valor de tabela" com a soma de antes.
2. Negócio com Caixa, cliente com uma baixa de R$ 100 e um estorno de R$ 30: o cartão diz "Total pago R$ 70,00".
3. Entrando como profissional (member) no mesmo negócio: aparece "Valor de tabela" (sem erro de permissão no console).

Critério de pronto: os três casos acima; nenhum `permission-denied` no console para member.

---

### M7 — Histórico de comissões ignora vales
Arquivo(s): `src/app/[tenant]/comissoes-historico.tsx:7`, `:23-37`, `:76-79`; referência `src/app/[tenant]/caixa/page.tsx:424` (o "Pago" do Caixa soma `cm-` + vales `vl-`)

Por quê: o Caixa conta vale como comissão paga; o histórico não, e os dois números divergem. O desconto do pagamento (`descontoCents`) inclui vales, então o rótulo vira "de vale e estorno".

Trecho atual (linha 7):
```tsx
import { Lancamento, mesDaComissao } from "@/lib/financeiro";
```
Trecho novo:
```tsx
import { ehVale, Lancamento, mesDaComissao } from "@/lib/financeiro";
```

Trecho atual (linhas 23-37):
```tsx
  const meses = new Map<string, { faturou: number; pago?: number; abatido: number; estornado: number }>();
  for (const l of itens ?? []) {
    // a entrada conta no mês da comissão; sinal de atendimento não recebido não conta
    const mesDaLinha = l.tipo === "entrada" ? mesDaComissao(l) : l.mes;
    if (!mesDaLinha) continue;
    const m = meses.get(mesDaLinha) ?? { faturou: 0, abatido: 0, estornado: 0 };
    if (l.tipo === "entrada") m.faturou += l.valorCents;
    else if (l.id.startsWith("cm-")) {
      m.pago = l.valorCents;
      m.abatido = l.descontoCents ?? 0;
    } else if (l.estornoDe) m.estornado += l.valorCents;
    meses.set(mesDaLinha, m);
  }
  const linhas = [...meses].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12);
  const totalPago = linhas.reduce((t, [, m]) => t + (m.pago ?? 0), 0);
```
Trecho novo:
```tsx
  const meses = new Map<string, { faturou: number; pago?: number; vale: number; abatido: number; estornado: number }>();
  for (const l of itens ?? []) {
    // a entrada conta no mês da comissão; sinal de atendimento não recebido não conta
    const mesDaLinha = l.tipo === "entrada" ? mesDaComissao(l) : l.mes;
    if (!mesDaLinha) continue;
    const m = meses.get(mesDaLinha) ?? { faturou: 0, vale: 0, abatido: 0, estornado: 0 };
    if (l.tipo === "entrada") m.faturou += l.valorCents;
    else if (l.id.startsWith("cm-")) {
      m.pago = l.valorCents;
      m.abatido = l.descontoCents ?? 0;
    }
    // vale: comissão adiantada, já saiu do caixa — conta como pago, como no Caixa
    else if (ehVale(l.id)) m.vale += l.valorCents;
    else if (l.estornoDe) m.estornado += l.valorCents;
    meses.set(mesDaLinha, m);
  }
  const linhas = [...meses].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12);
  const totalPago = linhas.reduce((t, [, m]) => t + (m.pago ?? 0) + m.vale, 0);
```

Trecho atual (linhas 76-79):
```tsx
                      <td className="px-3 py-2.5 text-right">
                        {m.pago === undefined ? <span className="text-muted-foreground">não paga</span> : brl(m.pago)}
                        {m.abatido > 0 && <span className="block text-[13px] text-muted-foreground">− {brl(m.abatido)} de estorno</span>}
```
Trecho novo:
```tsx
                      <td className="px-3 py-2.5 text-right">
                        {m.pago === undefined && !m.vale ? <span className="text-muted-foreground">não paga</span> : brl((m.pago ?? 0) + m.vale)}
                        {m.vale > 0 && <span className="block text-[13px] text-muted-foreground">{brl(m.vale)} em vale{m.pago === undefined ? " · resto não pago" : ""}</span>}
                        {m.abatido > 0 && <span className="block text-[13px] text-muted-foreground">− {brl(m.abatido)} de vale e estorno</span>}
```
(A linha seguinte, `m.abatido < 0 … de estorno desfeito`, fica igual.)

Outros pontos a tocar: nenhum.

Teste: sem teste de tela. `npm run test:financeiro` (garante que nada do servidor mudou). Manual:
1. Profissional com R$ 50 de vale no mês e comissão do mês paga: no histórico, a coluna "Comissão paga" do mês = valor do pagamento + R$ 50, igual ao "Pago" do cartão de Comissões do Caixa.
2. Mês com vale e comissão ainda não paga: mostra o valor do vale e "R$ 50,00 em vale · resto não pago".
3. O total do rodapé soma os vales.

Critério de pronto: para o mesmo mês e profissional, "Comissão paga" do histórico = "Pago" do Caixa daquele profissional.

---

## BAIXOS

### B1 — Editar pagamento de comissão aceita qualquer valor
Arquivo(s): `src/lib/financeiro.server.ts:52-53`; `src/app/[tenant]/lancamento-folha.tsx:63-64`

Por quê: o valor do `cm-` é a conta do mês conferida em `pagar`; editar deixava trocar por qualquer número e o mês ficava quitado com valor errado. Só forma e descrição mudam; para outro valor, apaga e paga de novo (o `excluir` já devolve o desconto, `financeiro.server.ts:145`).

Trecho atual (financeiro.server.ts linhas 52-53):
```ts
    // R$ 0 só no pagamento de comissão que já era R$ 0 (todo abatido por estorno): corrige forma e descrição
    if (!l.valorCents && !(id.startsWith("cm-") && Number(atual.get("descontoCents")) > 0 && Number(atual.get("valorCents")) === 0)) throw new UserError("Informe o valor.");
```
Trecho novo:
```ts
    // comissão paga: o valor é a conta do mês (pagar confere); aqui só forma e descrição. Inclui o R$ 0 todo abatido
    if (id.startsWith("cm-") && l.valorCents !== Number(atual.get("valorCents"))) throw new UserError("O valor de uma comissão paga não muda. Para corrigir, apague o pagamento e pague de novo.");
    if (!l.valorCents && !id.startsWith("cm-")) throw new UserError("Informe o valor.");
```
(A linha 88, `tx.update(ref, { ...l, … })`, fica igual: o valor gravado é o mesmo que já estava.)

Trecho atual (lancamento-folha.tsx linhas 63-64):
```tsx
  // comissão: o servidor só aceita o valor que a conta dá; para mudar, muda o % ou os recebimentos
  const comissao = folha.modo === "pagar" && folha.pagamento.tipo === "comissao";
```
Trecho novo:
```tsx
  // comissão: o servidor só aceita o valor que a conta dá; para mudar, muda o % ou os recebimentos.
  // Já paga, o valor fica travado também: corrige só forma e descrição
  const comissao = (folha.modo === "pagar" && folha.pagamento.tipo === "comissao") || (folha.modo === "editar" && folha.lancamento.id.startsWith("cm-"));
```

Outros pontos a tocar: nenhum.

Teste: em `financeiro.test.mts`, logo depois da linha 143 (`await assert.rejects(pagar(db, "salao", { tipo: "comissao", alvoId: "bia", mes: mesBia, valorCents: 1680, forma: "pix" }, quem), /já foi paga/);`), acrescente:
```ts
// comissão paga: editar não troca o valor (só forma e descrição); o mesmo valor passa
await assert.rejects(editar(db, "salao", idDoPagamento("comissao", "bia", mesBia), { tipo: "saida", valorCents: 9999, data: hoje, categoria: "Comissão/salário", forma: "pix" }, quem), /não muda/);
await editar(db, "salao", idDoPagamento("comissao", "bia", mesBia), { tipo: "saida", valorCents: 1680, data: hoje, categoria: "Comissão/salário", forma: "pix", descricao: "Comissão Bia (pix)" }, quem);
assert.equal((await db.doc(`tenants/salao/lancamentos/${idDoPagamento("comissao", "bia", mesBia)}`).get()).get("forma"), "pix");
```
O teste existente da linha 208 (editar o `cm-` de R$ 0 para trocar a forma) deve continuar passando.
Comando: `npm run test:financeiro`.

Critério de pronto: `test:financeiro` passa com as 3 linhas novas; na tela, editar um "Comissão …" mostra o valor somente leitura.

---

### B2 — Aviso de agendamento novo dispara com o que já existia (cache)
Arquivo(s): `src/app/[tenant]/aviso-novo-agendamento.tsx:102-108`

Por quê: com cache persistente, a primeira leitura vem do aparelho; a segunda (do servidor) traz como "added" agendamentos que só faltavam no cache, e o painel toca o som por eles. A primeira leitura que vale é a primeira do servidor.

Trecho atual (linhas 102-108):
```tsx
    return onSnapshot(
      query(collection(db, "tenants", tenant.id, "appointments"), where("createdAt", ">=", desde), orderBy("createdAt")),
      (snap) => {
        if (primeira) {
          primeira = false;
          return;
        }
```
Trecho novo:
```tsx
    return onSnapshot(
      query(collection(db, "tenants", tenant.id, "appointments"), where("createdAt", ">=", desde), orderBy("createdAt")),
      // com os metadados: dá para saber quando a leitura já veio do servidor
      { includeMetadataChanges: true },
      (snap) => {
        // o cache do aparelho chega antes: o que só o servidor tinha viraria "novo" e tocaria o som
        if (snap.metadata.fromCache) return;
        if (primeira) {
          primeira = false;
          return;
        }
```

Outros pontos a tocar: nenhum (o filtro `c.type === "added"` da linha 111 já ignora mudanças só de metadados).

Teste: sem teste automatizado. Manual:
1. Abra o painel, feche a aba; pelo site público, crie 1 agendamento.
2. Reabra o painel: NÃO toca som nem mostra aviso para esse agendamento.
3. Com o painel aberto, crie outro pelo site público: toca e mostra o aviso.

Critério de pronto: passos 2 e 3 como descrito.

---

### B3 — Chave duplicada no resumo do mês
Arquivo(s): `src/app/[tenant]/caixa/page.tsx:545-546`

Por quê: `porProfissional` agrupa por `staffId` mas a lista usa o nome como `key`; duas profissionais "Ana" dão chave repetida e o React mistura as linhas.

Trecho atual:
```tsx
        linhas.map(([nome, valor]) => (
          <div key={nome} className="grid gap-1">
```
Trecho novo:
```tsx
        // por posição: o nome se repete (duas "Ana" na equipe) e a lista não muda de ordem na tela
        linhas.map(([nome, valor], i) => (
          <div key={i} className="grid gap-1">
```

Outros pontos a tocar: nenhum.

Teste: `npm run lint` e `npm run typecheck`. Manual: com dois profissionais de mesmo nome e recebimentos no mês, abra "Resumo do mês": sem aviso "Encountered two children with the same key" no console.

Critério de pronto: sem o aviso de chave duplicada no console.

---

### B4 — Botão "corrigir" nome aparece para a equipe
Arquivo(s): `src/app/[tenant]/clientes/[customer]/page.tsx:177-183`

Por quê: o servidor já recusa (`renameCustomer` chama `exigeDono`, `booking.server.ts:125`); o profissional tocava e recebia erro. Só esconder o botão.

Trecho atual (linhas 176-183):
```tsx
              {/* O nome vem do que a pessoa digitou ao agendar e ficava assim para sempre */}
              <button
                type="button"
                onClick={() => setRenaming(true)}
                className="inline-flex min-h-10 items-center px-1 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                corrigir
              </button>
```
Trecho novo:
```tsx
              {/* O nome vem do que a pessoa digitou ao agendar e ficava assim para sempre.
                  Só quem gere: o servidor recusa a equipe (renomeia todos os horários futuros) */}
              {tenant.podeGerir && (
                <button
                  type="button"
                  onClick={() => setRenaming(true)}
                  className="inline-flex min-h-10 items-center px-1 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  corrigir
                </button>
              )}
```

Outros pontos a tocar: nenhum. Não mexer em `renameCustomerAction` nem em `renameCustomer`.

Teste: manual — como member, a ficha do cliente não mostra "corrigir"; como dono, mostra e funciona.

Critério de pronto: o botão só aparece com `tenant.podeGerir`.

---

### B5 — Data da anotação no fuso do aparelho
Arquivo(s): `src/app/[tenant]/clientes/[customer]/page.tsx:297`

Por quê: `toLocaleDateString` sem `timeZone` usa o fuso do aparelho; anotação feita às 22h em Belém aparece no dia seguinte num aparelho em outro fuso. A página já calcula `fuso = fusoDe(tenant.site)` (linha 61, cai em `TIMEZONE` de `src/lib/datetime.ts:2` quando o site não tem fuso) e usa nas outras datas (linha 377). Usar o mesmo `fuso`, não `TIMEZONE` direto.

Trecho atual:
```tsx
                  {n.quando ? n.quando.toDate().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "agora"}
```
Trecho novo:
```tsx
                  {n.quando ? n.quando.toDate().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: fuso }) : "agora"}
```

Outros pontos a tocar: nenhum.

Teste: manual — mude o fuso do sistema para Tóquio, recarregue a ficha: a data da anotação continua a do Brasil.

Critério de pronto: a data não muda ao trocar o fuso do aparelho.

---

### B6 — Texto do convite vencido
Arquivo(s): `src/app/login/page.tsx:138`; constante em `src/lib/limites.ts` (`DIAS_CONVITE = 7`)

Por quê: o texto manda pedir "à Ruphus" e escreve 7 fixo; o convite pode ser do dono (equipe) e o prazo mora em `DIAS_CONVITE`.

Trecho atual:
```tsx
          setError("Este convite não vale mais. Peça outro à Ruphus — eles valem 7 dias.");
```
Trecho novo:
```tsx
          setError(`Este convite não vale mais. Peça um link novo a quem enviou — cada link vale ${DIAS_CONVITE} dias.`);
```
Acrescente o import logo depois da linha `import { guardarUtm } from "@/lib/anuncios";` (linha 24):
```tsx
import { DIAS_CONVITE } from "@/lib/limites";
```
(`limites.ts` não importa nada: seguro no cliente.)

Outros pontos a tocar: nenhum.

Teste: `npm run typecheck`. Manual: abra `/login?next=/convite?c=xxx` com token inválido: aparece o texto novo com "7 dias".

Critério de pronto: o texto novo aparece; nenhum "7" fixo no texto.

---

### B7 — Valor por extenso acima de R$ 1 milhão
Arquivo(s): `src/lib/recibo.ts:21-39`

Por quê: `inteiro` só vai até 999.999: R$ 1.000.000 virava "mil mil reais". (Um lançamento vai até R$ 99.999,99, mas o recibo soma vários.)

Trecho atual (linhas 21-39):
```ts
/** 0 a 999.999 por extenso: "mil e duzentos", "dois mil, trezentos e dez". */
function inteiro(n: number): string {
  const mil = Math.floor(n / 1000);
  const resto = n % 1000;
  if (!mil) return ate999(resto);
  const milhar = mil === 1 ? "mil" : `${ate999(mil)} mil`;
  if (!resto) return milhar;
  // "e" quando o resto é redondo ou menor que cem (mil e cem, mil e vinte); senão, vírgula
  return `${milhar}${resto < 100 || resto % 100 === 0 ? " e " : ", "}${ate999(resto)}`;
}

/** R$ por extenso, como num recibo: 12345 → "cento e vinte e três reais e quarenta e cinco centavos". */
export function valorPorExtenso(cents: number): string {
  const reais = Math.floor(cents / 100);
  const centavos = cents % 100;
  const r = reais ? `${inteiro(reais)} ${reais === 1 ? "real" : "reais"}` : "";
  const c = centavos ? `${ate999(centavos)} ${centavos === 1 ? "centavo" : "centavos"}` : "";
  return [r, c].filter(Boolean).join(" e ") || "zero real";
}
```
Trecho novo:
```ts
/** 0 a 999.999 por extenso: "mil e duzentos", "dois mil, trezentos e dez". */
function ateMilhar(n: number): string {
  const mil = Math.floor(n / 1000);
  const resto = n % 1000;
  if (!mil) return ate999(resto);
  const milhar = mil === 1 ? "mil" : `${ate999(mil)} mil`;
  if (!resto) return milhar;
  // "e" quando o resto é redondo ou menor que cem (mil e cem, mil e vinte); senão, vírgula
  return `${milhar}${resto < 100 || resto % 100 === 0 ? " e " : ", "}${ate999(resto)}`;
}

/** 0 a 999.999.999 por extenso: "um milhão e duzentos mil", "dois milhões, trezentos mil e dez". */
function inteiro(n: number): string {
  const mi = Math.floor(n / 1_000_000);
  const resto = n % 1_000_000;
  if (!mi) return ateMilhar(resto);
  const milhao = mi === 1 ? "um milhão" : `${ateMilhar(mi)} milhões`;
  if (!resto) return milhao;
  // "e" quando o resto é um grupo só, redondo ou menor que cem (milhão e cem, milhão e duzentos mil)
  const grupo = resto < 1000 ? resto : resto % 1000 === 0 ? resto / 1000 : 0;
  return `${milhao}${grupo && (grupo < 100 || grupo % 100 === 0) ? " e " : ", "}${ateMilhar(resto)}`;
}

/** R$ por extenso, como num recibo: 12345 → "cento e vinte e três reais e quarenta e cinco centavos". */
export function valorPorExtenso(cents: number): string {
  const reais = Math.floor(cents / 100);
  const centavos = cents % 100;
  // milhão redondo leva "de": "um milhão de reais"
  const de = reais >= 1_000_000 && reais % 1_000_000 === 0 ? " de" : "";
  const r = reais ? `${inteiro(reais)}${de} ${reais === 1 ? "real" : "reais"}` : "";
  const c = centavos ? `${ate999(centavos)} ${centavos === 1 ? "centavo" : "centavos"}` : "";
  return [r, c].filter(Boolean).join(" e ") || "zero real";
}
```

Outros pontos a tocar: nenhum.

Teste: em `recibo.test.mts`, dentro do array `casos`, logo depois da linha `[2101, "vinte e um reais e um centavo"],`, acrescente:
```ts
  [100000000, "um milhão de reais"],
  [200000000, "dois milhões de reais"],
  [120000000, "um milhão e duzentos mil reais"],
  [125000000, "um milhão, duzentos e cinquenta mil reais"],
  [100000500, "um milhão e cinco reais"],
  [100100000, "um milhão e mil reais"],
  [123456789, "um milhão, duzentos e trinta e quatro mil, quinhentos e sessenta e sete reais e oitenta e nove centavos"],
```
Comando: `npm run test:recibo`. Os casos antigos (até 99.999,99) devem continuar passando sem mudança.

Critério de pronto: `npm run test:recibo` passa com os 7 casos novos.

---

### B8 — Profissional abrindo o convite de dono "entra" calado
Arquivo(s): `src/lib/convite.ts:177-181`

Por quê: quem já é membro com `role: "member"` e abre um convite de dono/admin recebe sucesso (`null`) e nada muda; a pessoa acha que virou dona. Recusar com motivo, sem gravar aceite e sem queimar o link.

Trecho atual:
```ts
    // dois convites abertos ao mesmo tempo: o segundo não rebaixa quem o primeiro fez dono
    if (ja.exists) {
      gravarAceite();
      return null;
    }
```
Trecho novo:
```ts
    // profissional da equipe abrindo o convite do dono: o convite não muda o papel de ninguém, e
    // "entrou" calado deixava a pessoa achando que virou dona. Recusa sem queimar o link
    if (ja.exists && ja.get("role") === "member") return "Você já entra neste negócio como profissional da equipe. Para ter acesso de dono, peça a quem enviou o convite para tirar seu acesso da equipe antes.";
    // dois convites abertos ao mesmo tempo: o segundo não rebaixa quem o primeiro fez dono
    if (ja.exists) {
      gravarAceite();
      return null;
    }
```

Outros pontos a tocar: nenhum. O retorno string já é tratado como recusa por `src/app/convite/actions.ts:34` (mesmo caminho de `CANCELADO`/`USADO`).

Teste: em `convite.test.mts`, logo depois da linha `assert.equal((await db.doc("tenants/proprio/members/fulana").get()).get("role"), "owner");` (linha 132), acrescente:
```ts
// profissional da equipe abrindo o convite do dono: recusa com motivo, nada muda, o link segue valendo
await db.doc("tenants/proprio/members/prof").set({ uid: "prof", role: "member", staffId: "x" });
const doDono = aceite("proprio");
assert.match(String(await assumirNegocio(db, doDono, "prof", {})), /profissional da equipe/);
assert.equal((await db.doc("tenants/proprio/members/prof").get()).get("role"), "member", "o papel não muda");
assert.equal((await db.doc(`convitesUsados/${doDono.jti}`).get()).exists, false, "recusado não queima o link");
```
Comando: `npm run test:convite`.

Critério de pronto: `npm run test:convite` passa; os asserts antigos de "segundo aceite não rebaixa o dono" (linhas 120-121) continuam passando.

---

## Ordem e agrupamento em PRs

Cada PR sai de `origin/main` atualizado. Rodar sempre também `npm run typecheck` e `npm run lint`.

1. PR 1 — branch `fix/caixa-comissao-tela`
   Título: "Caixa: comissão com sinal antigo, aviso de lançamento ilegível, vale no histórico e valor da comissão travado"
   Itens, nesta ordem: M4 → A3 → M7 → B1 → B3.
   Testes: `npm run test:financeiro` e `npm run test:painel`.

2. PR 2 — branch `fix/sessao-entre-abas`
   Título: "Sessão: inatividade somada entre abas, aviso antes de sair e push mantido no logout automático"
   Itens: A4 → M1 → M2 (são um arquivo só, `sessao.ts`, reescrito uma vez).
   Testes: `npm run test:sessao` (novo) e verificação manual do A4/M1/M2.

3. PR 3 — branch `fix/painel-acesso-e-clientes`
   Título: "Painel: erro de rede não vira 'sem acesso', total pago do cliente e ajustes na ficha"
   Itens: M5 → M6 → B4 → B5 → B2.
   Testes: `npm run test:clientes`, `npm run test:painel`.
   Atenção: M5 e M1 (PR 2) mexem em `painel-layout.tsx` na mesma região de imports; quem fizer o segundo PR faz rebase e mantém os dois imports.

4. PR 4 — branch `fix/convite-e-recibo`
   Título: "Convite: recusa clara para profissional e texto do convite vencido; recibo por extenso acima de R$ 1 milhão"
   Itens: B8 → B6 → B7.
   Testes: `npm run test:convite`, `npm run test:recibo`.

M3 fica no plano de agendamento (B4 de lá).

## Riscos e o que NÃO fazer

- Não alterar ids de lançamentos (`ag-`, `sn-`, `cm-`, `vl-`, `es-`, `fx-`, `mn-`) nem as funções `idDaBaixa`, `idDoPagamento`, `idDoEstorno`: a idempotência do Caixa depende deles.
- Não mexer em `firestore.rules` nem em `firestore.indexes.json`. Nenhum item precisa. Se mexer por engano, rode `npm run test:rules` e desfaça.
- Não mudar `pagar`, `comissoesDoMes` nem `mesDaComissao`: o A3 corrige só a leitura da tela.
- A3: não use `where("mes","in",…)` com `mesComissao` na mesma consulta (o Firestore não junta `in` com outra desigualdade/OR assim); são duas consultas separadas, unidas por id.
- M1: o aviso de sessão NÃO pode ser `Dialog`/`AlertDialog` nem ter `role="dialog"`/`role="alertdialog"` — ele adiaria o próprio logout.
- M2: com o push mantido, um aparelho compartilhado deslogado por inatividade continua recebendo avisos do negócio até alguém tocar "Sair". Foi a escolha pedida; o "Sair" manual continua cancelando.
- M4: não trocar o retorno de `useCollection` para objeto; só acrescentar o terceiro item da tupla (os ~40 chamadores dependem das duas primeiras posições).
- M6: não alterar `src/lib/clientes.ts` nem a lista de clientes neste plano (a lista "Gasto 12m" continua somando tabela — anotado como pendência).
- B1: não remover o teste da linha 208 de `financeiro.test.mts` (R$ 0 todo abatido ainda se corrige).
- B4: não mudar `renameCustomerAction`/`renameCustomer` — o servidor já exige dono.
- Não fazer commit do bloco que o `next dev` reescreve em `AGENTS.md` como mudança deste trabalho; se aparecer no diff, deixe como está (ver AGENTS.md).
