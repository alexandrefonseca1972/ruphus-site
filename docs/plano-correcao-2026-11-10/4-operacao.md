# Plano de correção: operação, segurança e admin/fábrica

Repo: `/Users/alexandrefonseca/products/ruphus-site`, base `origin/main` (6b966a11).
Executor: siga cada item ao pé da letra. Não invente mudança fora do "Trecho novo". Onde houver
"DECISÃO DO USUÁRIO", pare e pergunte antes de implementar aquele item.

Notas gerais conferidas no código (10/11/2026):
- As linhas citadas no pedido para `scripts/deploy-vps.sh` estavam deslocadas. As reais são:
  build na linha 29, troca de pasta na 30, restart na 31, `is-enabled` na 33, laço do health
  check nas 34–39. Os trechos abaixo usam o texto, não o número: procure pelo texto.
- Os 5 testes do L22 (`test:conversas`, `test:canal-oficial`, `test:recibo`, `test:mensagens`,
  `test:coleta`) foram rodados localmente em 10/11/2026: todos saíram com código 0.
- A7 e S3 estão no plano do WhatsApp; aqui só aparecem como referência.

---

## ALTOS

### A5 — Worker da coleta nunca reinicia no deploy
Arquivo(s): scripts/deploy-vps.sh:33
Por quê: o `ruphus-coleta` é ligado pelo admin com `systemctl start`, sem `enable` (veja
deploy/ruphus-coleta.service:5-7 e src/app/admin/coleta-actions.ts:60-95). `is-enabled` é sempre
falso, então o worker ligado segue rodando o código antigo, com o diretório de trabalho apontando
para a pasta que virou `app-prev`.

Reiniciar no meio de uma coleta é seguro (conferido):
- `KillSignal=SIGINT` (deploy/ruphus-coleta.service:27). O handler de SIGINT em scripts/coletar.mts:140-147
  apaga o sinal de vida, fecha o navegador e sai com 130. O pedido continua `coletando` com o mesmo `worker`.
- Ao voltar, `pegar()` (scripts/coletar.mts:99-109) pega primeiro o pedido `coletando` deste worker.
- `pastaDe(p)` usa o id do pedido (coletar.mts:30), e o motor guarda busca feita e fichas em arquivos
  nessa pasta (scripts/coleta-motor.mts:4 e :83). Ele retoma de onde parou.
- Se o SIGINT cair dentro de `gravarResultado`, a próxima volta apaga os leads e grava de novo (idempotente).

Trecho atual:
```bash
systemctl restart ruphus-site
# o worker roda o código da app: reinicia junto (a coleta em curso continua de onde parou)
if systemctl is-enabled --quiet ruphus-coleta 2>/dev/null; then systemctl restart ruphus-coleta; fi
```
Trecho novo: este trecho fica dentro do bloco REMOTO inteiro do O4. Aplique o O4, que já traz a
linha corrigida:
```bash
if systemctl is-active --quiet ruphus-coleta; then systemctl restart ruphus-coleta; fi
```
Outros pontos a tocar: nenhum.
Teste: `bash -n scripts/deploy-vps.sh` e `shellcheck scripts/deploy-vps.sh` (se não houver shellcheck,
`brew install shellcheck`). Não rode o script.
Critério de pronto: `grep -c "is-enabled" scripts/deploy-vps.sh` dá 0. `grep -c "is-active --quiet ruphus-coleta" scripts/deploy-vps.sh` dá 2 (deploy e rollback).

### A6 — Build na VPS sem teto de memória nem prioridade baixa
Arquivo(s): scripts/deploy-vps.sh:29
Por quê: o `next build` disputa os 3,8 GB e o único vCPU com o site no ar. Se a memória acaba, o
OOM killer pode matar o `next start` em vez do build. Com escopo do systemd, quem morre é o build.

Trecho atual:
```bash
chown -R ruphus:ruphus app-new
sudo -u ruphus env SHA="$SHA" bash -c 'cd app-new && npm ci --no-audit --no-fund --loglevel=error && GIT_COMMIT_SHA="$SHA" NEXT_TELEMETRY_DISABLED=1 npm run build'
rm -rf app-prev && mv app app-prev && mv app-new app
```
Trecho novo (a linha do meio vira duas: comentário + comando):
```bash
chown -R ruphus:ruphus app-new
# build com teto: se a memória acabar, morre o build, não o site no ar (MemoryMax do escopo);
# CPUWeight e nice deixam o site responder durante o build. NODE_OPTIONS só aqui: o next start
# segue com o 1280 do drop-in memoria.conf
systemd-run --scope --quiet -p MemoryMax=1800M -p CPUWeight=20 nice -n 19 sudo -u ruphus env SHA="$SHA" NODE_OPTIONS=--max-old-space-size=1536 bash -c 'cd app-new && npm ci --no-audit --no-fund --loglevel=error && GIT_COMMIT_SHA="$SHA" NEXT_TELEMETRY_DISABLED=1 npm run build'
rm -rf app-prev && mv app app-prev && mv app-new app
```
Outros pontos a tocar: nenhum.
Teste: `bash -n scripts/deploy-vps.sh` e `shellcheck scripts/deploy-vps.sh`. Validação na VPS só
com a revisão humana: no primeiro deploy, rode em outro terminal `ssh root@VPS 'systemd-cgls --no-pager | grep -A3 run-'`
durante o build. O `npm`/`node` precisam aparecer dentro de um `run-*.scope`. Se aparecerem fora
(o PAM do sudo moveu o processo), troque `sudo -u ruphus` por `runuser -u ruphus --` nessa linha.
Critério de pronto: a linha do build começa com `systemd-run --scope --quiet -p MemoryMax=1800M -p CPUWeight=20 nice -n 19`.
O arquivo passa em `bash -n`.

DECISÃO DO USUÁRIO: o teto de 1800M ainda não foi medido com este app. Se o primeiro build morrer
por memória (`journalctl -k | grep -i oom`), suba para 2200M. Não passe de 2200M, porque o site precisa de ~1,3 GB.

Fase 2 (não implementar agora): o build roda no GitHub Actions (ubuntu, mesmo Node 22). O
`.next` + `node_modules` (com o sharp de Linux) vão num tar por `scp`. A VPS só descompacta em
`app-new` e troca as pastas. O build sai de vez da máquina de produção.

---

## MÉDIOS — operação

### O1 — Cron dos lembretes falha calado
Arquivo(s): deploy/crontab.txt:4-5, src/app/api/cron/lembretes/route.ts:11-27, src/lib/alerta-admin.server.ts, src/instrumentation.ts (o arquivo novo inteiro está no O2)
Por quê: o crontab manda tudo para /dev/null, sem MAILTO nem log. Se o cron para (crontab apagado,
CRON_SECRET trocado), os lembretes param e ninguém fica sabendo.
Ponto de alerta escolhido: o `alertarAdmin` (e-mail, no máximo 1 a cada 6 h por chave), chamado a
cada 10 min por um `setInterval` no `register()` do instrumentation. O deploy/vigia.sh não serve:
ele só escreve no syslog e não avisa ninguém.

Trecho atual (deploy/crontab.txt):
```
*/10 * * * * . /opt/ruphus-site/cron.env && curl -fsS -m 120 -H "Authorization: Bearer $CRON_SECRET" http://localhost:3001/api/cron/lembretes >/dev/null
0 3 * * *    . /opt/ruphus-site/cron.env && curl -fsS -m 300 -H "Authorization: Bearer $CRON_SECRET" http://localhost:3001/api/cron/demo >/dev/null
```
Trecho novo (deploy/crontab.txt):
```
# Falha vai para o syslog: journalctl -t ruphus-cron. Cron parado de vez vira e-mail (src/instrumentation.ts)
*/10 * * * * . /opt/ruphus-site/cron.env && curl -fsS -m 120 -H "Authorization: Bearer $CRON_SECRET" http://localhost:3001/api/cron/lembretes >/dev/null || logger -t ruphus-cron "lembretes falhou"
0 3 * * *    . /opt/ruphus-site/cron.env && curl -fsS -m 300 -H "Authorization: Bearer $CRON_SECRET" http://localhost:3001/api/cron/demo >/dev/null || logger -t ruphus-cron "demo falhou"
```

Trecho atual (src/app/api/cron/lembretes/route.ts, fim da função):
```ts
  // uma vez por hora (o cron roda a cada 10 min): conexão que caiu sem o webhook chegar
  const conexoesCaidas = new Date().getMinutes() < 10 ? await vigiarConexoes(adminDb).catch((e) => (console.error("[cron] vigiar conexões", e), 0)) : null;
  return Response.json({ ok: true, sinaisVencidos, comandos, enviados, sms, conexoesCaidas });
}
```
Trecho novo: este trecho já inclui o F5. Aplique O1 e F5 juntos, no mesmo PR.
```ts
  const agora = new Date(); // TZ=America/Sao_Paulo no ruphus-site.service
  // uma vez por hora (o cron roda a cada 10 min): conexão que caiu sem o webhook chegar
  const conexoesCaidas = agora.getMinutes() < 10 ? await vigiarConexoes(adminDb).catch((e) => (console.error("[cron] vigiar conexões", e), 0)) : null;
  // uma vez por dia, de madrugada: domínio próprio cujo DNS saiu da VPS volta a pendente
  const dominiosRebaixados = agora.getHours() === 4 && agora.getMinutes() < 10 ? await reverificarDominios(adminDb).catch((e) => (console.error("[cron] reverificar domínios", e), 0)) : null;
  // o instrumentation confere esta marca a cada 10 min e avisa o admin se passar de 30 min
  await adminDb.doc("config/cron").set({ ultimaExecucao: FieldValue.serverTimestamp() }, { merge: true });
  return Response.json({ ok: true, sinaisVencidos, comandos, enviados, sms, conexoesCaidas, dominiosRebaixados });
}
```
E nos imports do topo do mesmo arquivo, acrescente:
```ts
import { FieldValue } from "firebase-admin/firestore";
import { reverificarDominios } from "@/lib/dominio.server";
```

Trecho atual (src/lib/alerta-admin.server.ts:2):
```ts
import { FieldValue, type Firestore } from "firebase-admin/firestore";
```
Trecho novo:
```ts
import { FieldValue, type Firestore, type Timestamp } from "firebase-admin/firestore";
```
E acrescente no FIM de src/lib/alerta-admin.server.ts:
```ts
/** O cron da VPS (deploy/crontab.txt) chama /api/cron/lembretes a cada 10 min, e a rota marca
 *  config/cron. Marca com mais de 30 min quer dizer que o cron parou (crontab apagado, CRON_SECRET
 *  trocado) e os lembretes pararam calados. Sem marca (antes do primeiro cron), não avisa. */
export async function vigiarCron(db: Firestore, { enviar = enviarEmail, agora = Date.now() }: Opcoes = {}) {
  const ultima = (await db.doc("config/cron").get()).get("ultimaExecucao") as Timestamp | undefined;
  if (!ultima || agora - ultima.toMillis() < 30 * 60_000) return false;
  const quando = ultima.toDate().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  return alertarAdmin(db, "cron-parado", "O cron dos lembretes parou", `A última execução de /api/cron/lembretes foi em ${quando}.\n\nNa VPS: crontab -u ruphus -l e journalctl -t ruphus-cron -n 20.`, { enviar, agora });
}
```
Outros pontos a tocar: o `register()` de src/instrumentation.ts chama `vigiarCron`. O arquivo inteiro está no O2.
Teste: em integracoes.test.mts (usa o emulador), dentro do mesmo bloco que testa `alertarAdmin`
(perto da linha 33, onde já existem `db`, `enviar` e `saidos`), acrescente antes do `}` que fecha o bloco:
```ts
  const { vigiarCron } = await import("@/lib/alerta-admin.server");
  const { Timestamp } = await import("firebase-admin/firestore");
  process.env.GMAIL_USER = "conta@ruphus.site";
  assert.equal(await vigiarCron(db, { enviar, agora: 0 }), false, "sem marca, não avisa");
  await db.doc("config/cron").set({ ultimaExecucao: Timestamp.fromMillis(1_000_000_000_000) });
  assert.equal(await vigiarCron(db, { enviar, agora: 1_000_000_000_000 + 10 * 60_000 }), false, "10 min: em dia");
  assert.equal(await vigiarCron(db, { enviar, agora: 1_000_000_000_000 + 40 * 60_000 }), true, "40 min: avisa");
  delete process.env.GMAIL_USER;
```
Rode `npm run test:integracoes`.
Critério de pronto: `npm run test:integracoes` e `npm run typecheck` passam. `curl` na rota de cron (com segredo, no dev)
grava `config/cron.ultimaExecucao`. O crontab tem `|| logger -t ruphus-cron` nas duas linhas.
Depois do merge, aplique na VPS (revisão humana): `crontab -u ruphus deploy/crontab.txt`.

### O2 — Erros do servidor só ficam no journal
Arquivo(s): src/instrumentation.ts:1-9
Por quê: erro em página, rota ou action só vai para o `journalctl` e ninguém lê. A doc do Next desta versão
(node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md, seção
`onRequestError`) dá a assinatura `(err: unknown, request: { path, method, headers }, context: { routerKind, routePath, routeType, renderSource, revalidateReason, renderType })`
e o tipo `Instrumentation.onRequestError` de `"next"`. A doc pede `await` nas tarefas assíncronas.
`alertarAdmin(db, chave, assunto, texto, opcoes?)` nunca lança e segura 6 h por chave.

Trecho atual (arquivo inteiro):
```ts
// Monta o índice do /admin assim que o servidor sobe, em segundo plano: eram ~11 s de espera
// na primeira tela depois de cada deploy. Só no servidor de produção (no build não há quem use).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production" || process.env.NEXT_PHASE === "phase-production-build") return;
  const [{ adminDb }, { indiceDoPainel }] = await Promise.all([import("@/lib/admin"), import("@/lib/painel-indice.server")]);
  indiceDoPainel(adminDb)
    .pronto()
    .catch((e) => console.error("[admin] índice no boot", e));
}
```
Trecho novo (arquivo inteiro; já inclui O1 e O5):
```ts
import type { Instrumentation } from "next";

// Só no servidor de produção: no build e no next dev não há cron nem quem avisar.
const producao = () => process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build";

// O índice do /admin não é mais montado no boot: ele monta na primeira consulta
// (painel-indice.server.ts), e um reinício sem ninguém no admin não segura ~120 MB.
export async function register() {
  if (!producao()) return;
  const [{ adminDb }, { vigiarCron }] = await Promise.all([import("@/lib/admin"), import("@/lib/alerta-admin.server")]);
  // o cron da VPS parou (crontab apagado, CRON_SECRET trocado): os lembretes param calados
  setInterval(() => void vigiarCron(adminDb).catch((e) => console.error("[cron] vigia", e)), 10 * 60_000).unref();
}

// Erro de servidor (página, rota, action, proxy) vira e-mail para o admin: no máximo um a cada 6 h
// por rota (alertarAdmin). O caminho vai sem a query, que pode levar token (convite, cobrança).
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (!producao()) return;
  const [{ adminDb }, { alertarAdmin }] = await Promise.all([import("@/lib/admin"), import("@/lib/alerta-admin.server")]);
  const mensagem = err instanceof Error ? err.message : String(err);
  const digest = typeof err === "object" && err !== null && "digest" in err ? ` · digest ${String(err.digest)}` : "";
  const caminho = request.path.split("?")[0];
  await alertarAdmin(
    adminDb,
    `erro-${context.routePath.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 100)}`,
    `Erro em ${context.routePath}`,
    `${request.method} ${caminho} (${context.routeType})${digest}\n\n${mensagem.slice(0, 1000)}\n\nDetalhes: journalctl -u ruphus-site -n 100`,
  );
};
```
Outros pontos a tocar: nenhum. O `alertarAdmin` já existe com essa assinatura em src/lib/alerta-admin.server.ts:17.
Teste: `npm run typecheck` e `npm run build` locais. Não há teste automatizado para o instrumentation.
Para validar à mão, rode no dev com `NODE_ENV=production npm run build && npm start` e uma `.env.local`
de teste. Force um erro numa rota e veja o e-mail ou `config/alertas` no emulador. Se não houver como, só typecheck e build.
Critério de pronto: `npm run typecheck` e `npm run build` passam. O arquivo exporta `register` e `onRequestError`.
Não existe mais `indiceDoPainel` em src/instrumentation.ts.

### O3 — 502 durante o restart do deploy
Arquivo(s): deploy/Caddyfile.ruphus:19-24 (o restart está em scripts/deploy-vps.sh:31)
Por quê: entre o stop e o `next start` aceitar conexão (~5–15 s), o Caddy devolve 502. Com
`lb_try_duration`, ele segura o pedido e tenta conectar de novo. O pedido não chegou ao app,
então repetir é seguro, inclusive para POST.

Trecho atual:
```
(ip-real) {
	@cloudflare remote_ip 173.245.48.0/20 ... (linha inteira igual)
	reverse_proxy @cloudflare localhost:3001 {
		header_up X-Real-IP {http.request.header.CF-Connecting-IP}
	}
	reverse_proxy localhost:3001 {
		header_up X-Real-IP {remote_host}
	}
}
```
Trecho novo (mantenha a linha `@cloudflare remote_ip …` exatamente como está; só os dois blocos `reverse_proxy` mudam):
```
(ip-real) {
	@cloudflare remote_ip 173.245.48.0/20 ... (linha inteira igual, não mexa)
	# no restart do deploy o app fica alguns segundos sem aceitar conexão: o Caddy espera e tenta de
	# novo em vez de devolver 502 (o pedido não chegou ao app, então repetir é seguro)
	reverse_proxy @cloudflare localhost:3001 {
		header_up X-Real-IP {http.request.header.CF-Connecting-IP}
		lb_try_duration 30s
		lb_try_interval 250ms
	}
	reverse_proxy localhost:3001 {
		header_up X-Real-IP {remote_host}
		lb_try_duration 30s
		lb_try_interval 250ms
	}
}
```
Outros pontos a tocar: nenhum. O `ask` do `on_demand_tls` não é reverse_proxy.
Teste: se houver caddy local, `caddy validate --config deploy/Caddyfile.ruphus --adapter caddyfile`.
Se não houver, só revisão. Na VPS (revisão humana): copiar o trecho para /etc/caddy/Caddyfile,
`caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy`.
Critério de pronto: os dois `reverse_proxy` têm `lb_try_duration 30s` e `lb_try_interval 250ms`. Nada mais mudou no arquivo.

### O4 — Health check falhou: rollback automático
Arquivo(s): scripts/deploy-vps.sh:21-40 (bloco REMOTO)
Por quê: hoje, se o app novo não responde, o script só imprime o erro e produção fica fora do ar até alguém agir.

Trecho atual (bloco REMOTO inteiro):
```bash
ssh "$VPS" SHA="$SHA" BASE="$BASE" bash -s <<'REMOTO'
set -euo pipefail
cd "$BASE"
cp app/.env.local app-new/.env.local
# o mesmo id no build e no `next start` (que relê o next.config): uma aba aberta antes da
# publicação recarrega sozinha na próxima navegação, e os assets não baixam duas vezes
echo "NEXT_DEPLOYMENT_ID=${SHA:0:12}" > app-new/.env.production
chown -R ruphus:ruphus app-new
sudo -u ruphus env SHA="$SHA" bash -c 'cd app-new && npm ci --no-audit --no-fund --loglevel=error && GIT_COMMIT_SHA="$SHA" NEXT_TELEMETRY_DISABLED=1 npm run build'
rm -rf app-prev && mv app app-prev && mv app-new app
systemctl restart ruphus-site
# o worker roda o código da app: reinicia junto (a coleta em curso continua de onde parou)
if systemctl is-enabled --quiet ruphus-coleta 2>/dev/null; then systemctl restart ruphus-coleta; fi
for i in $(seq 20); do
  curl -fsS -o /dev/null -H "Host: www.ruphus.site" http://localhost:3001/ && { echo "no ar: $(cut -c1-7 <<<"$SHA")"; exit 0; }
  sleep 2
done
echo "o app não respondeu; veja: journalctl -u ruphus-site -n 50" >&2
exit 1
REMOTO
```
Trecho novo (bloco REMOTO inteiro; já inclui A5 e A6):
```bash
ssh "$VPS" SHA="$SHA" BASE="$BASE" bash -s <<'REMOTO'
set -euo pipefail
cd "$BASE"
cp app/.env.local app-new/.env.local
# o mesmo id no build e no `next start` (que relê o next.config): uma aba aberta antes da
# publicação recarrega sozinha na próxima navegação, e os assets não baixam duas vezes
echo "NEXT_DEPLOYMENT_ID=${SHA:0:12}" > app-new/.env.production
chown -R ruphus:ruphus app-new
# build com teto: se a memória acabar, morre o build, não o site no ar (MemoryMax do escopo);
# CPUWeight e nice deixam o site responder durante o build. NODE_OPTIONS só aqui: o next start
# segue com o 1280 do drop-in memoria.conf
systemd-run --scope --quiet -p MemoryMax=1800M -p CPUWeight=20 nice -n 19 sudo -u ruphus env SHA="$SHA" NODE_OPTIONS=--max-old-space-size=1536 bash -c 'cd app-new && npm ci --no-audit --no-fund --loglevel=error && GIT_COMMIT_SHA="$SHA" NEXT_TELEMETRY_DISABLED=1 npm run build'
rm -rf app-prev && mv app app-prev && mv app-new app

# reinicia o site e o worker (o worker roda o código da app; a coleta em curso continua de onde
# parou). Só o worker ligado: ele não tem enable, o admin liga e desliga pela aba Coleta
reiniciar() {
  systemctl restart ruphus-site
  if systemctl is-active --quiet ruphus-coleta; then systemctl restart ruphus-coleta; fi
}
no_ar() {
  for _ in $(seq 20); do
    curl -fsS -o /dev/null -H "Host: www.ruphus.site" http://localhost:3001/ && return 0
    sleep 2
  done
  return 1
}

reiniciar
if no_ar; then echo "no ar: $(cut -c1-7 <<<"$SHA")"; exit 0; fi

# o novo não respondeu em 40 s: volta para o anterior e guarda o novo em app-ruim para investigar
echo "o app novo não respondeu; voltando para o anterior" >&2
journalctl -u ruphus-site -n 30 --no-pager >&2 || true
rm -rf app-ruim && mv app app-ruim && mv app-prev app
reiniciar
if no_ar; then echo "voltou para o anterior; o novo ficou em $BASE/app-ruim" >&2; exit 1; fi
echo "nem o anterior respondeu; veja: journalctl -u ruphus-site -n 50" >&2
exit 1
REMOTO
```
Também troque o comentário da linha 6 (fora do bloco):
Trecho atual:
```bash
# Voltar atrás: ssh root@VPS 'cd /opt/ruphus-site && mv app app-ruim && mv app-prev app && systemctl restart ruphus-site'
```
Trecho novo:
```bash
# Se o app novo não responder em 40 s, o script volta sozinho para o anterior (o novo fica em app-ruim).
# Voltar atrás à mão: ssh root@VPS 'cd /opt/ruphus-site && rm -rf app-ruim && mv app app-ruim && mv app-prev app && systemctl restart ruphus-site'
```
Outros pontos a tocar: nenhum. Depois do rollback não existe `app-prev`. No deploy seguinte o
`rm -rf app-prev` não falha (rm -f), e o `mv app app-prev` guarda o app bom.
Teste: `bash -n scripts/deploy-vps.sh` e `shellcheck scripts/deploy-vps.sh`. Para testar o REMOTO
sem a VPS, copie o conteúdo entre `<<'REMOTO'` e `REMOTO` para um arquivo no scratchpad. Troque
`systemctl`, `systemd-run`, `journalctl` e `curl` por funções falsas no topo do arquivo, por exemplo:
`systemctl(){ echo "systemctl $*"; }`, `systemd-run(){ echo build; }`, `journalctl(){ :; }` e
`curl(){ return 1; }`. Rode com `BASE=$(mktemp -d)`, depois de criar `$BASE/app/.env.local`, `$BASE/app-new` e `$BASE/app-prev`.
Confira que no fim `app` é o antigo e `app-ruim` é o novo. Com `curl(){ return 0; }`, confira que `app` é o novo.
Critério de pronto: `bash -n` passa. O teste com funções falsas mostra rollback quando o curl falha e "no ar" quando passa.
`grep -c "app-ruim" scripts/deploy-vps.sh` é maior que 2.

### O5 — Índice do admin montado no boot e mantido 12 h
Arquivo(s): src/instrumentation.ts:5-8, src/lib/painel-indice.server.ts:15
Por quê: cada deploy ou reinício monta o índice (~120 MB, ~30 mil leituras) mesmo sem ninguém no
/admin, e o `pronto()` do boot arma o timer de 12 h (painel-indice.server.ts:379-382).
Conferido: o índice já monta sozinho na primeira consulta (`pronto()`, linha 387). A rota
src/app/api/admin/painel/route.ts:6 passa `indiceDoPainel(adminDb)` e monta sob demanda.
`carteira` (src/app/admin/actions.ts:407) usa `montado()` e tem caminho sem índice. `atualizar()`
sem índice não faz nada. Nada depende da montagem no boot.
Menor mudança segura: tirar a montagem do boot. O instrumentation novo do O2 já faz isso.

Trecho atual: veja o O2 (as linhas 5-8 de src/instrumentation.ts).
Trecho novo: o arquivo inteiro do O2, que não chama mais `indiceDoPainel`.
Outros pontos a tocar: nenhum, se a decisão abaixo ficar no padrão.
Teste: `npm run test:painel-indice` (não muda nada; só confirma) e `npm run typecheck`.
Critério de pronto: `grep -rn "indiceDoPainel" src/instrumentation.ts` não acha nada. `npm run test:painel-indice` passa.

DECISÃO DO USUÁRIO: baixar também `OCIOSO_MS` de 12 h para 1 h (src/lib/painel-indice.server.ts:15:
`export const OCIOSO_MS = 12 * 3_600_000;` → `export const OCIOSO_MS = 3_600_000;`, e trocar o
comentário da linha 14 para `// uma hora sem consulta: remontar relê ~30 mil documentos (~11 s), e montado custa ~120 MB`)?
O custo é ~11 s de espera e ~30 mil leituras a cada volta ao /admin depois de 1 h parado.
Padrão: NÃO mudar (só tirar do boot).

### O6 — Site gerado: ordem gerador → Storage e foraDoAr em paralelo
Arquivo(s): src/app/s/[slug]/index.html/route.ts:8-32
Por quê: hoje são 3 leituras em série (crm, Storage e tenant) a cada visita. A ordem é Storage
primeiro, ao contrário do og.jpg. Desde a conversão da fábrica (scripts/converter-fabrica.mts:12-13 tira o
index.html do Storage), o caso comum é o site do gerador.

Trecho atual (linhas 1-32, arquivo inteiro):
```ts
import { adminDb } from "@/lib/admin";
import { foraDoAr } from "@/lib/booking.server";
import { lerSite } from "@/lib/gerador.server";
import { doStorage } from "@/lib/site-arquivo.server";
import { renderEditorial } from "@/lib/site-editorial";
import { ehClaro, renderClaro } from "@/lib/site-claro";

// O proxy reescreve {slug}.ruphus.site/ para /s/{slug}/index.html. Quando a pasta
// existe em public/s (os sites da fábrica), o arquivo responde antes desta rota.
// Sem pasta: primeiro o site da fábrica publicado no Storage, depois o do gerador,
// montado aqui com os dados do tenant.
...
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  // tirado do ar (cobrança): o proxy barra o subdomínio, e isto barra www.ruphus.site/s/{slug}
  if (/^[a-z0-9-]{1,63}$/.test(slug) && (await foraDoAr(adminDb, slug))) {
    return new Response("Página não encontrada", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const publicado = await doStorage(slug, ["index.html"]);
  if (publicado) return publicado;
  const dados = await lerSite(adminDb, slug);
  if (!dados) return new Response("Página não encontrada", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const html = ehClaro(dados.sub) ? renderClaro(dados) : renderEditorial(dados);
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
```
Trecho novo: troque os imports, o comentário das linhas 8-11 e a função GET. O bloco do
`export const dynamic` e o comentário dele (linhas 13-18) ficam iguais.
```ts
import { adminDb } from "@/lib/admin";
import { foraDoAr } from "@/lib/booking.server";
import { lerSite } from "@/lib/gerador.server";
import { SLUG_SITE } from "@/lib/site-arquivo";
import { doStorage } from "@/lib/site-arquivo.server";
import { renderEditorial } from "@/lib/site-editorial";
import { ehClaro, renderClaro } from "@/lib/site-claro";

// O proxy reescreve {slug}.ruphus.site/ para /s/{slug}/index.html. Quando a pasta
// existe em public/s (os sites da fábrica), o arquivo responde antes desta rota.
// Sem pasta: primeiro o site do gerador, montado aqui com os dados do tenant; depois o
// da fábrica publicado no Storage (a mesma ordem do og.jpg: converter-fabrica tira o
// index.html do Storage, então o gerador é o caso comum).
```
(as linhas 13-18 do `dynamic` ficam como estão)
```ts
const naoEncontrada = () => new Response("Página não encontrada", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  if (!SLUG_SITE.test(slug)) return naoEncontrada();
  // tirado do ar (cobrança) e os dados do site, juntos: o proxy barra o subdomínio, e isto
  // barra www.ruphus.site/s/{slug}
  const [fora, dados] = await Promise.all([foraDoAr(adminDb, slug), lerSite(adminDb, slug)]);
  if (fora) return naoEncontrada();
  if (dados) {
    const html = ehClaro(dados.sub) ? renderClaro(dados) : renderEditorial(dados);
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  return (await doStorage(slug, ["index.html"])) ?? naoEncontrada();
}
```
Outros pontos a tocar: nenhum. site-arquivo.test.mts testa só funções puras de src/lib/site-arquivo.ts
(objetoDoSite, faixa, tipoDe, cacheDe) e não importa a rota. Não muda.
Teste: `npm run test:site-arquivo` e `npm run typecheck`. À mão no dev: abrir `/s/<slug-de-site-gerado>/index.html`
(200, HTML do modelo), um slug inexistente (404) e `/s/A/index.html` (404).
Critério de pronto: typecheck passa. A função GET faz `Promise.all([foraDoAr…, lerSite…])` e chama `doStorage` só quando `dados` é null.

### O7 — og.jpg: slug sem validação, fetch sem timeout, sem foraDoAr
Arquivo(s): src/app/s/[slug]/og.jpg/route.tsx:1-74
Por quê: o slug não é validado antes de ir ao Firestore e ao Storage. Os dois `fetch` do Google Fonts
não têm timeout: se o Google demorar, a requisição fica presa. Cada prévia baixa as fontes de novo.
Site fora do ar ainda gera prévia.

Trecho atual: o arquivo inteiro (74 linhas), em especial:
```ts
async function fonte(familia: string, texto: string) {
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${familia.replace(/ /g, "+")}&text=${encodeURIComponent(texto)}`)).text();
  const url = /src: url\((.+?)\) format\('(?:opentype|truetype)'\)/.exec(css)?.[1];
  if (!url) throw new Error(`Fonte ${familia} não veio em TTF`);
  return (await fetch(url)).arrayBuffer();
}
...
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  // site do gerador: a imagem sai do modelo. O og.jpg guardado no Storage é o da fábrica,
  // que ficou lá depois da conversão e mostrava a foto velha no WhatsApp (645 sites)
  const d = await lerSite(adminDb, slug);
  if (!d) return (await doStorage(slug, ["og.jpg"])) ?? new Response("Imagem não encontrada", { status: 404 });
```
Trecho novo, troca 1 (imports, linhas 1-7):
```ts
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { adminDb } from "@/lib/admin";
import { foraDoAr } from "@/lib/booking.server";
import { lerSite } from "@/lib/gerador.server";
import { SLUG_SITE } from "@/lib/site-arquivo";
import { doStorage } from "@/lib/site-arquivo.server";
import { capaEditorial } from "@/lib/site-editorial";
import { capaClaro, ehClaro } from "@/lib/site-claro";
```
Troca 2 (a função `fonte`, linhas 20-26, inteira):
```ts
// A mesma fonte com o mesmo texto não é baixada de novo. Com teto: o texto muda por site, e o
// mapa não pode crescer sem fim (cada TTF recortado tem poucos KB).
// ponytail: limpa tudo ao bater o teto; LRU se o acerto ficar baixo
const fontes = new Map<string, Promise<ArrayBuffer>>();
const TETO_FONTES = 200;

/** A fonte em TTF, só com as letras do texto (o ImageResponse não lê woff2). */
function fonte(familia: string, texto: string) {
  const chave = `${familia}|${texto}`;
  const guardada = fontes.get(chave);
  if (guardada) return guardada;
  const baixando = (async () => {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${familia.replace(/ /g, "+")}&text=${encodeURIComponent(texto)}`, { signal: AbortSignal.timeout(5000) })).text();
    const url = /src: url\((.+?)\) format\('(?:opentype|truetype)'\)/.exec(css)?.[1];
    if (!url) throw new Error(`Fonte ${familia} não veio em TTF`);
    return (await fetch(url, { signal: AbortSignal.timeout(5000) })).arrayBuffer();
  })();
  if (fontes.size >= TETO_FONTES) fontes.clear();
  fontes.set(chave, baixando);
  // falha não fica guardada: a próxima prévia tenta de novo
  baixando.catch(() => fontes.delete(chave));
  return baixando;
}
```
Troca 3 (início do GET, linhas 35-40):
```ts
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  if (!SLUG_SITE.test(slug)) return new Response("Imagem não encontrada", { status: 404 });
  // site do gerador: a imagem sai do modelo. O og.jpg guardado no Storage é o da fábrica,
  // que ficou lá depois da conversão e mostrava a foto velha no WhatsApp (645 sites).
  // Fora do ar (cobrança): sem prévia, como o site
  const [fora, d] = await Promise.all([foraDoAr(adminDb, slug), lerSite(adminDb, slug)]);
  if (fora) return new Response("Imagem não encontrada", { status: 404 });
  if (!d) return (await doStorage(slug, ["og.jpg"])) ?? new Response("Imagem não encontrada", { status: 404 });
```
O resto do arquivo (BASE, capa, ImageResponse, sharp, Response) fica igual.
Outros pontos a tocar: nenhum. A foto do `<img>` quem baixa é o ImageResponse, sem timeout configurável; fica como está.
Teste: `npm run typecheck` e `npm run lint`. À mão no dev: `/s/<slug-gerado>/og.jpg` dá 200 image/jpeg,
e a segunda chamada é mais rápida (fonte do cache). `/s/A/og.jpg` dá 404.
Critério de pronto: os dois `fetch` têm `signal: AbortSignal.timeout(5000)`. Existe `fontes` com
teto 200. O GET valida `SLUG_SITE` e consulta `foraDoAr`.

### O8 — SMTP do Gmail sem timeout
Arquivo(s): src/lib/email.server.ts:66-71
Por quê: o padrão do nodemailer espera até 2 min para conectar e 10 min no socket. Um Gmail lento prende a action ou o `after()`.

Trecho atual:
```ts
  const transporte = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: usuario, pass: senha },
  });
```
Trecho novo:
```ts
  const transporte = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: usuario, pass: senha },
    // como o Resend (10 s): sem isto o padrão do nodemailer espera 2 min para conectar e 10 min no socket
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
```
Outros pontos a tocar: nenhum.
Teste: `npm run typecheck`, `npm run test:proposta-email`, `npm run test:convite-email`.
Critério de pronto: os 3 timeouts estão no `createTransport`, e typecheck e os dois testes passam.

---

## MÉDIOS — segurança

### S1 — Cadastro sem e-mail verificado e convites sem cota
Arquivo(s): src/app/painel/actions.ts:56-60, src/app/painel/page.tsx:288-298, src/app/[tenant]/actions.ts:129-150, src/lib/negocios.server.ts
Por quê: hoje qualquer um cria conta com e-mail alheio, cria negócio e dispara convites ilimitados. Os convites
saem de noreply@ruphus.site, o que queima a reputação do domínio.
`verifyFirebaseToken` (src/lib/verify-token.ts:25-29) só devolve `email` quando `email_verified === true`.
Sem verificação, devolve `emailPendente`.

Parte 1: cota diária (fazer sempre).
Acrescente no FIM de src/lib/negocios.server.ts (o arquivo já importa `FieldValue`, `Firestore` e `UserError`;
confira os imports no topo e só acrescente o que faltar). Função inteira:
```ts
/** Cota diária dos e-mails que um negócio dispara pela Ruphus (convite da equipe, recibo): sem
 *  ela, uma conta manda milhares de e-mails em nome de noreply@/contato@ruphus.site e queima o
 *  domínio. Conta por dia de São Paulo, numa transação, em tenants/{id}/limites (as regras não
 *  deixam o app ler nem gravar ali). Estoura com UserError, que a tela mostra. */
export async function gastarCota(db: Firestore, tenantId: string, tipo: "convites" | "recibos", teto: number) {
  const ref = db.doc(`tenants/${tenantId}/limites/${tipo}-${todayIn()}`);
  await db.runTransaction(async (tx) => {
    const usados = ((await tx.get(ref)).get("usados") as number | undefined) ?? 0;
    if (usados >= teto) throw new UserError(`Limite de ${teto} envios por dia atingido. Tente amanhã ou fale com a Ruphus.`);
    tx.set(ref, { usados: usados + 1, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
  });
}
```
e nos imports de src/lib/negocios.server.ts: `import { todayIn } from "@/lib/datetime";`. Se já houver import de
"@/lib/datetime", acrescente `todayIn` nele.

Onde chamar, em src/app/[tenant]/actions.ts. Trecho atual:
```ts
  async (data, user) => {
    await exigeGestor(data.tenantId, user.uid);
    const prof = await adminDb.doc(`tenants/${data.tenantId}/staff/${data.staffId}`).get();
    if (!prof.exists) throw new UserError("Esse profissional não existe mais.");
    const base = process.env.SITE_URL ?? "https://www.ruphus.site";
```
Trecho novo:
```ts
  async (data, user) => {
    await exigeGestor(data.tenantId, user.uid);
    const prof = await adminDb.doc(`tenants/${data.tenantId}/staff/${data.staffId}`).get();
    if (!prof.exists) throw new UserError("Esse profissional não existe mais.");
    // cada convite manda e-mail pela Ruphus: no máximo 20 por dia por negócio
    await gastarCota(adminDb, data.tenantId, "convites", 20);
    const base = process.env.SITE_URL ?? "https://www.ruphus.site";
```
e no import da linha 12: `import { criarProfissional, gastarCota, lerNegocio, salvarNegocio } from "@/lib/negocios.server";`

Parte 2: exigir e-mail verificado ao criar negócio. DECISÃO DO USUÁRIO: isso põe um passo a mais no
funil. Quem se cadastra por e-mail e senha (src/app/login/page.tsx:223-230) precisa clicar no link
antes de criar o negócio. Quem entra com Google já vem verificado. Padrão sugerido: implementar, como pedido na revisão.
Se aprovado:
src/app/painel/actions.ts, trecho atual:
```ts
    const user = await quem(idToken);
    const slug = await criarNegocio(adminDb, user, input, utm, await dadosDoAceite(user, "cadastro"));
```
Trecho novo:
```ts
    const user = await quem(idToken);
    // e-mail confirmado: sem isto, qualquer um cria conta com o e-mail alheio e um negócio que
    // dispara convites e recibos em nome da Ruphus
    if (!user.email) {
      throw new UserError(user.emailPendente
        ? `Confirme o e-mail ${user.emailPendente} pelo link que enviamos e toque em Criar de novo.`
        : "Entre com uma conta de e-mail confirmado para cadastrar o negócio.");
    }
    const slug = await criarNegocio(adminDb, user, input, utm, await dadosDoAceite(user, "cadastro"));
```
src/app/painel/page.tsx (já importa `auth` na linha 13). Trecho atual:
```ts
    setErro("");
    setBusy(true);
    // No servidor: é lá que o limite de negócios por conta é conferido
```
Trecho novo:
```ts
    setErro("");
    setBusy(true);
    // quem confirmou o e-mail em outra aba: o token só sabe depois de recarregar a conta e renovar
    const conta = auth.currentUser;
    if (conta && !conta.emailVerified) await conta.reload().then(() => conta.getIdToken(true)).catch(() => {});
    // No servidor: é lá que o limite de negócios por conta é conferido
```
Outros pontos a tocar: nenhum. booking.test.mts e gerador-banco.test.mts chamam `criarNegocio` direto (o lib),
não a action, e não mudam.
Teste: em booking.test.mts (emulador; o `db` existe na linha 74), acrescente perto dos testes de
`criarNegocio` (linha ~490):
```ts
{
  const { gastarCota } = await import("@/lib/negocios.server");
  for (let i = 0; i < 3; i++) await gastarCota(db, "cota-teste", "convites", 3);
  await assert.rejects(gastarCota(db, "cota-teste", "convites", 3), /Limite de 3/, "a 4ª no dia estoura");
  await gastarCota(db, "cota-teste", "recibos", 3); // outro tipo, outra conta
}
```
Rode `npm run test:booking` e `npm run typecheck`.
Critério de pronto: o teste novo passa. `convidarEquipeAction` chama `gastarCota(..., "convites", 20)` antes de
`criarConvite`. Se a parte 2 for aprovada, `criarNegocioAction` recusa conta sem `email`.

### S2 — Recibo por e-mail sem cota e com From do negócio
Arquivo(s): src/app/[tenant]/actions.ts:443-451
Por quê: o recibo sai de contato@ruphus.site com o nome que o dono escolheu, sem limite. Dá para
mandar spam ou phishing com o nome que quiser, saindo do domínio da Ruphus.
Como o From é montado: `pelaResend`/`peloGmail` usam `"${nomeDe(de)}" <contato@ruphus.site>`.
`nomeDe` (src/lib/email.server.ts:18) tira aspas, <>, \r\n e \\ e corta em 60. O único chamador com `de:` é este (conferido por grep).

Trecho atual:
```ts
  async (data, user) => {
    await exigeGestor(data.tenantId, user.uid);
    const r = await reciboDoBanco(adminDb, data.tenantId, data.ids);
    await enviarEmail({ para: data.email, de: r.emissor[0] || "Ruphus", assunto: `${r.titulo} · ${r.emissor[0] ?? ""}`, texto: textoDoRecibo(r), html: htmlDoRecibo(r) });
    return { ok: true as const };
  },
```
Trecho novo:
```ts
  async (data, user) => {
    await exigeGestor(data.tenantId, user.uid);
    const r = await reciboDoBanco(adminDb, data.tenantId, data.ids);
    // sai do domínio da Ruphus: no máximo 50 por dia por negócio, e o remetente diz que é "via Ruphus"
    // (48 + " via Ruphus" cabe nos 60 do nomeDe)
    await gastarCota(adminDb, data.tenantId, "recibos", 50);
    const de = r.emissor[0] ? `${r.emissor[0].slice(0, 48)} via Ruphus` : "Ruphus";
    await enviarEmail({ para: data.email, de, assunto: `${r.titulo} · ${r.emissor[0] ?? ""}`, texto: textoDoRecibo(r), html: htmlDoRecibo(r) });
    return { ok: true as const };
  },
```
Outros pontos a tocar: o import de `gastarCota` do S1 (a mesma linha 12).
Teste: `npm run test:recibo` e `npm run typecheck`. A cota já está testada no S1.
Critério de pronto: a action chama `gastarCota(adminDb, data.tenantId, "recibos", 50)`. O `de` termina em " via Ruphus" quando há emissor.

### S3 — decidirEnvioAction sem exigeGestor
Já está no plano do WhatsApp. Nada a fazer aqui.

---

## MÉDIOS — admin/fábrica

### F1 — Gerar "criar" com set+merge pode sobrescrever negócio criado no meio
Arquivo(s): src/lib/gerador.server.ts:245-260
Por quê: entre a prévia (que conferiu o endereço livre) e a gravação, outro processo pode criar o
tenant: um cadastro ou a outra aba da coleta. O `set(..., {merge:true})` mistura os dois. O `create` falha se o
documento existe. As escritas filhas (equipe, serviços, CRM) só podem sair depois de o tenant ter
entrado, senão iriam parar no negócio de outra pessoa.
Como o BulkWriter trata erro (comentário da linha 247): `close()` não rejeita; cada escrita rejeita a
própria promessa, e o `.catch` põe o slug em `falharam`. No fim, `falharam` vira ErroPrevisto.
`registrosDoSite` devolve o documento do tenant como primeiro item (linha 67-90).

Trecho atual:
```ts
  const writer = db.bulkWriter();
  // close() nunca rejeita: a falha de cada escrita só aparece na promessa dela
  const falharam = new Set<string>();
  for (const { slug, acao, lead } of saida) {
    if (acao === "pular") continue;
    for (const e of registrosDoSite(db, slug, lead, nichoDe(lead)!, { novo: acao === "criar", ownerId, origem: "prospeccao", escolha: escolhas.get(slug), personal: personais.get(slug) })) {
      writer.set(e.ref, e.dados, { merge: true }).catch((err) => {
        falharam.add(slug);
        console.error(`[gerador] escrita de ${slug} falhou`, err);
      });
    }
  }
  await writer.close();
  if (falharam.size) throw new ErroPrevisto(`Não consegui gravar tudo de ${[...falharam].join(", ")}. Confira esses sites antes de enviar de novo.`);
  return resposta;
```
Trecho novo:
```ts
  const writer = db.bulkWriter();
  // close() e flush() nunca rejeitam: a falha de cada escrita só aparece na promessa dela
  const falharam = new Set<string>();
  const falhou = (slug: string) => (err: unknown) => {
    falharam.add(slug);
    console.error(`[gerador] escrita de ${slug} falhou`, err);
  };
  const gravar = saida
    .filter((s) => s.acao !== "pular")
    .map((s) => ({ ...s, escritas: registrosDoSite(db, s.slug, s.lead, nichoDe(s.lead)!, { novo: s.acao === "criar", ownerId, origem: "prospeccao", escolha: escolhas.get(s.slug), personal: personais.get(s.slug) }) }));
  // 1º o documento do negócio (o primeiro de registrosDoSite). "criar" usa create, que falha se
  // alguém tomou o endereço depois da prévia (cadastro, outra aba): sem isto o merge misturava os dois
  for (const { slug, acao, escritas: [tenant] } of gravar) {
    (acao === "criar" ? writer.create(tenant.ref, tenant.dados) : writer.set(tenant.ref, tenant.dados, { merge: true })).catch(falhou(slug));
  }
  await writer.flush();
  // 2º equipe, serviços, CRM: só de quem o documento do negócio entrou
  for (const { slug, escritas } of gravar) {
    if (falharam.has(slug)) continue;
    for (const e of escritas.slice(1)) writer.set(e.ref, e.dados, { merge: true }).catch(falhou(slug));
  }
  await writer.close();
  if (falharam.size) throw new ErroPrevisto(`Não consegui gravar tudo de ${[...falharam].join(", ")}. Confira esses sites antes de enviar de novo.`);
  return resposta;
```
Outros pontos a tocar: nenhum.
Teste: em gerador-banco.test.mts (emulador; `db` na linha 11), depois do bloco da linha ~41 (`feito`), acrescente:
```ts
// endereço tomado entre a prévia e a gravação: "criar" não mistura com o negócio que chegou antes
{
  const lote1 = planilha(["Corrida Unica", "(91) 98888-7766", "Barbearia", "Belém", "PA", "", "", "", "", "", ""]);
  const [linha] = await gerarNoBanco(db, lote1, false, "a");
  await db.doc(`tenants/${linha.slug}`).set({ name: "Chegou antes" });
  await assert.rejects(gerarNoBanco(db, lote1, true, "a"), /Não consegui gravar tudo/);
  assert.equal((await db.doc(`tenants/${linha.slug}`).get()).get("name"), "Chegou antes", "não sobrescreve");
  assert.equal((await db.collection(`tenants/${linha.slug}/services`).get()).size, 0, "nem grava serviços nele");
}
```
(use a mesma função `planilha` que o arquivo já usa na linha 88; confira a ordem das colunas lá e copie o mesmo formato.)
Rode `npm run test:gerador-banco`.
Critério de pronto: o teste novo passa e os antigos continuam passando. Não há `writer.set(..., { merge: true })` para o tenant quando `acao === "criar"`.

### F2 — Foto enviada troca a do site antes de publicar
Arquivo(s): src/lib/foto.server.ts:36-92, src/app/api/admin/foto/route.ts:17, src/app/admin/actions.ts:741-748 e :768-805, src/app/admin/visual-gaveta.tsx:98, src/lib/site-arquivo.ts:52
Por quê: o upload grava direto em `sites/{slug}/fotos/{slot}.jpg`, o nome que o site publicado usa.
Em até 1 min (s-maxage) o site no ar mostra a foto nova, antes de alguém clicar em Publicar.
Correção: o upload grava em `fotos/rascunho-{slot}.jpg`, e `definirVisual` copia para o nome fixo.
A referência no rascunho (`fotos/{slot}.jpg`, validada por FOTO em src/lib/site-editorial.ts:89) não muda.

Trechos novos em src/lib/foto.server.ts:
Trecho atual (linhas 36-40):
```ts
const objeto = (slug: string, slot: Slot) => {
  const nome = objetoDoSite(slug, ["fotos", `${slot}.jpg`]);
  if (!nome) throw new ErroPrevisto("Negócio inválido.");
  return adminBucket().file(nome);
};
```
Trecho novo:
```ts
// rascunho: a foto enviada e ainda não publicada (fotos/rascunho-{posição}.jpg). O site no ar só
// lê o nome fixo, que o definirVisual preenche ao publicar
const objeto = (slug: string, slot: Slot, rascunho = false) => {
  const nome = objetoDoSite(slug, ["fotos", `${rascunho ? "rascunho-" : ""}${slot}.jpg`]);
  if (!nome) throw new ErroPrevisto("Negócio inválido.");
  return adminBucket().file(nome);
};
```
Trecho atual (linha 66):
```ts
  await objeto(slug, slot).save(jpeg, { contentType: "image/jpeg", resumable: false });
```
Trecho novo:
```ts
  await objeto(slug, slot, true).save(jpeg, { contentType: "image/jpeg", resumable: false });
```
Trecho atual (linhas 70-86, lerFoto, fotosFaltando, apagarFoto):
```ts
/** A foto própria gravada, ou null se a posição não tem arquivo. */
export async function lerFoto(slug: string, slot: Slot): Promise<Buffer | null> {
  const f = objeto(slug, slot);
  if (!(await f.exists())[0]) return null;
  return (await f.download())[0];
}

/** As posições do rascunho que apontam para um arquivo que não está no Storage. */
export async function fotosFaltando(slug: string, fotos: Partial<Record<Slot, string>> | undefined) {
  const slots = SLOTS.filter((s) => fotos?.[s]);
  const existem = await Promise.all(slots.map((s) => objeto(slug, s).exists().then(([e]) => e)));
  return slots.filter((_, i) => !existem[i]);
}

export async function apagarFoto(slug: string, slot: Slot) {
  await objeto(slug, slot).delete({ ignoreNotFound: true });
}
```
Trecho novo:
```ts
/** A foto própria da posição: a enviada e não publicada, senão a publicada; null se não há arquivo. */
export async function lerFoto(slug: string, slot: Slot): Promise<Buffer | null> {
  for (const f of [objeto(slug, slot, true), objeto(slug, slot)]) {
    if ((await f.exists())[0]) return (await f.download())[0];
  }
  return null;
}

const existe = async (slug: string, slot: Slot) => (await objeto(slug, slot, true).exists())[0] || (await objeto(slug, slot).exists())[0];

/** As posições do rascunho que apontam para um arquivo que não está no Storage (nem enviado, nem publicado). */
export async function fotosFaltando(slug: string, fotos: Partial<Record<Slot, string>> | undefined) {
  const slots = SLOTS.filter((s) => fotos?.[s]);
  const existem = await Promise.all(slots.map((s) => existe(slug, s)));
  return slots.filter((_, i) => !existem[i]);
}

/** As posições com foto enviada e ainda não publicada: a prévia mostra essas. */
export async function slotsEmRascunho(slug: string) {
  const tem = await Promise.all(SLOTS.map((s) => objeto(slug, s, true).exists().then(([e]) => e)));
  return SLOTS.filter((_, i) => tem[i]);
}

/** Ao publicar: a foto enviada vira a do site, no nome fixo. Antes de gravar o tenant, para o
 *  carimbo novo (personal.versao) já achar o arquivo novo. */
export async function publicarFotos(slug: string, emUso: Partial<Record<Slot, string>> | undefined) {
  await Promise.all(SLOTS.filter((s) => emUso?.[s]).map(async (s) => {
    const rascunho = objeto(slug, s, true);
    if (!(await rascunho.exists())[0]) return;
    await rascunho.copy(objeto(slug, s));
    await rascunho.delete({ ignoreNotFound: true });
  }));
}

/** Apaga a foto da posição: a publicada e a enviada. */
export async function apagarFoto(slug: string, slot: Slot) {
  await Promise.all([objeto(slug, slot, true), objeto(slug, slot)].map((f) => f.delete({ ignoreNotFound: true })));
}
```
(`apagarFotosFora`, linhas 88-92, fica igual: ela chama `apagarFoto` e agora também limpa rascunhos que sobraram.)
O `copy` é da mesma classe File do @google-cloud/storage que o arquivo já usa (`save`, `exists`, `download`, `delete`).

src/app/admin/actions.ts, import da linha 49. Trecho atual:
```ts
import { apagarFotosFora, fotosFaltando, lerFoto, type Slot, tenantGerado } from "@/lib/foto.server";
```
Trecho novo:
```ts
import { apagarFotosFora, fotosFaltando, lerFoto, publicarFotos, type Slot, slotsEmRascunho, tenantGerado } from "@/lib/foto.server";
```
src/app/admin/actions.ts, previewVisual. Trecho atual:
```ts
  const html = renderSite({ ...dados, personal: Personal.parse(rascunho) });
  // a foto própria tem nome fixo: a prévia pede com um carimbo para ver a que acabou de subir
  // (em src, href e url() do CSS do topo)
  return comBase(html.replace(/(["(])fotos\/(hero|ga1|ga2|ga3)\.jpg(\?v=\d+)?(["\)])/g, `$1/s/${slug}/fotos/$2.jpg?v=${Date.now()}$4`), slug);
```
Trecho novo:
```ts
  const html = renderSite({ ...dados, personal: Personal.parse(rascunho) });
  // a foto enviada e não publicada está em fotos/rascunho-{posição}.jpg; a publicada, no nome fixo.
  // A prévia pede com um carimbo para ver a que acabou de subir (em src, href e url() do CSS do topo)
  const emRascunho = new Set<string>(await slotsEmRascunho(slug));
  return comBase(html.replace(/(["(])fotos\/(hero|ga1|ga2|ga3)\.jpg(\?v=\d+)?(["\)])/g, (_m, antes: string, slot: string, _v, depois: string) => `${antes}/s/${slug}/fotos/${emRascunho.has(slot) ? "rascunho-" : ""}${slot}.jpg?v=${Date.now()}${depois}`), slug);
```
src/app/admin/actions.ts, definirVisual. Trecho atual:
```ts
  const faltam = await fotosFaltando(slug, personal.fotos);
  if (faltam.length) throw new ErroPrevisto(`Foto não encontrada: ${faltam.join(", ")}. Envie de novo ou use a do modelo.`);
```
Trecho novo:
```ts
  const faltam = await fotosFaltando(slug, personal.fotos);
  if (faltam.length) throw new ErroPrevisto(`Foto não encontrada: ${faltam.join(", ")}. Envie de novo ou use a do modelo.`);
  // só agora a foto enviada vai para o nome que o site no ar lê
  await publicarFotos(slug, personal.fotos);
```
src/app/admin/visual-gaveta.tsx:98. Trecho atual:
```ts
  const fotoDe = (slot: Slot) => (rascunho.fotos?.[slot] ? `/s/${slug}/fotos/${slot}.jpg?v=${versao}` : doModelo.fotos[slot]);
```
Trecho novo:
```ts
  // a enviada e não publicada está em rascunho-{posição}.jpg (reenviadas zera ao publicar)
  const fotoDe = (slot: Slot) => (rascunho.fotos?.[slot] ? `/s/${slug}/fotos/${reenviadas.has(slot) ? "rascunho-" : ""}${slot}.jpg?v=${versao}` : doModelo.fotos[slot]);
```
src/lib/site-arquivo.ts:52 (o rascunho também é trocado no lugar). Trecho atual:
```ts
    : /\/fotos\/[a-z0-9]+\.jpg$/.test(nome)
```
Trecho novo:
```ts
    : /\/fotos\/[a-z0-9-]+\.jpg$/.test(nome)
```
Outros pontos a tocar: src/app/api/admin/foto/route.ts não muda (chama `processarFoto`, que agora grava o rascunho).
O og.jpg e o site leem `personal.fotos` no nome fixo e não mudam.
Teste:
- site-arquivo.test.mts: perto da linha 36, acrescente `assert.match(cacheDe("sites/a/fotos/rascunho-hero.jpg"), /must-revalidate/);`. Rode `npm run test:site-arquivo`.
- gerador-banco.test.mts linhas 138-166 (emulador + storage): os testes existentes devem continuar passando.
  `processarFoto` grava o rascunho, `lerFoto` acha o rascunho e `apagarFoto` apaga os dois. Acrescente depois da linha 165:
```ts
  const { publicarFotos, slotsEmRascunho } = await import("@/lib/foto.server");
  assert.deepEqual(await slotsEmRascunho("navalha"), ["ga1", "bio"], "enviadas e não publicadas");
  await publicarFotos("navalha", { bio: "fotos/bio.jpg" });
  assert.ok(!(await slotsEmRascunho("navalha")).includes("bio"), "publicada sai do rascunho");
  assert.ok((await lerFoto("navalha", "bio"))!.length > 0, "e fica no nome fixo");
```
  Antes de colar, confira na linha 140-161 quais posições ficaram com arquivo (hero foi apagada; bio e ga1 ficaram). Se a lista for outra, ajuste o `deepEqual` para a lista real.
  Rode `npm run test:gerador-banco` e `npm run test:foto-rota`.
Critério de pronto: os testes passam. `processarFoto` não grava mais no nome fixo. `definirVisual` chama `publicarFotos` antes do `tenant.ref.update`.

### F3 — Lista de domínios/desativados com erro vira lista vazia
Arquivo(s): src/app/api/dominios/route.ts:14-17, src/app/api/desativados/route.ts:17-20
Por quê: no erro do Firestore as rotas respondem 200 com `{hosts:{}}` ou `[]`. O proxy aceita isso como verdade:
todos os domínios próprios param, e os sites fora do ar voltam ao ar.
Conferido no proxy: src/proxy.ts:41 (`if (r.ok) fechados = …`) e :71 (`if (r.ok) dominios = …`) só trocam
a lista com 200. Com 503, vale a anterior. O proxy não precisa mudar.

Trecho atual (dominios):
```ts
  const mapa = await mapaDominios(adminDb).catch(() => ({ hosts: {}, porSlug: {} }));
  return NextResponse.json(mapa, {
    headers: { "cache-control": segredo ? "private, max-age=30" : "public, max-age=30, stale-while-revalidate=300" },
  });
}
```
Trecho novo:
```ts
  try {
    return NextResponse.json(await mapaDominios(adminDb), {
      headers: { "cache-control": segredo ? "private, max-age=30" : "public, max-age=30, stale-while-revalidate=300" },
    });
  } catch (e) {
    // 503, não mapa vazio: o proxy só troca o mapa com 200 e segue com o anterior
    console.error("[dominios] mapa", e);
    return new NextResponse("indisponivel", { status: 503, headers: { "cache-control": "no-store" } });
  }
}
```
Trecho atual (desativados):
```ts
  const slugs = await desativados(adminDb).catch(() => [] as string[]);
  return NextResponse.json(slugs, {
    headers: { "cache-control": segredo ? "private, max-age=30" : "public, max-age=30, stale-while-revalidate=300" },
  });
}
```
Trecho novo:
```ts
  try {
    return NextResponse.json(await desativados(adminDb), {
      headers: { "cache-control": segredo ? "private, max-age=30" : "public, max-age=30, stale-while-revalidate=300" },
    });
  } catch (e) {
    // 503, não lista vazia: o proxy só troca a lista com 200, e lista vazia poria no ar quem não pagou
    console.error("[desativados] lista", e);
    return new NextResponse("indisponivel", { status: 503, headers: { "cache-control": "no-store" } });
  }
}
```
Outros pontos a tocar: nenhum (proxy já correto).
Teste: `npm run test:proxy` (não muda) e `npm run typecheck`.
Critério de pronto: nenhuma das duas rotas tem `.catch(() => …)` devolvendo lista vazia. As duas devolvem 503 no erro.

### F4 — Redirecionamento para domínio próprio é permanente (308)
Arquivo(s): src/proxy.ts:160
Por quê: o navegador guarda o 308 para sempre. Se o cliente desligar o domínio, `{slug}.ruphus.site`
continua mandando para o domínio antigo nos navegadores de quem já visitou. A linha 181 (ruphus.site → www, /sobre → /) é
permanente de verdade e fica 308.

Trecho atual:
```ts
    url.protocol = "https:";
    return NextResponse.redirect(url, 308);
  };
  if (slug) {
```
Trecho novo:
```ts
    url.protocol = "https:";
    // 307: o domínio próprio pode ser desligado, e um 308 ficaria guardado no navegador para sempre
    return NextResponse.redirect(url, 307);
  };
  if (slug) {
```
Outros pontos a tocar: nenhum. proxy.test.mts não testa o código 308 (conferido por grep).
Teste: `npm run test:proxy`.
Critério de pronto: `paraOutroHost` usa 307. A linha 181 continua 308.

### F5 — Domínio ativo nunca é reverificado
Arquivo(s): src/lib/dominio.server.ts (função nova no fim), src/app/api/cron/lembretes/route.ts (no O1)
Por quê: se o cliente muda o DNS ou o domínio expira, o tenant continua "ativo". O Caddy segue
pedindo certificado e o `{slug}.ruphus.site` manda as visitas para um endereço que não é mais nosso.
Cuidado: `conferir` (linha 24) trata QUALQUER erro de DNS como "não aponta". Um timeout passageiro
de madrugada rebaixaria o domínio, e ele só volta quando alguém verificar à mão. Por isso a função
nova só decide quando o DNS responde ou diz que o nome não existe.

Acrescente no FIM de src/lib/dominio.server.ts. Função inteira:
```ts
/** Uma vez por dia (cron de lembretes, 4h): domínio ativo cujo DNS saiu da VPS volta a pendente,
 *  e o proxy para de mandar o subdomínio para ele. Só decide com resposta do DNS (ou "não existe",
 *  domínio expirado): timeout e SERVFAIL ficam para o dia seguinte, sem rebaixar.
 *  Devolve quantos voltaram a pendente. */
export async function reverificarDominios(db: Firestore) {
  const snap = await db.collection("tenants").where("dominio.status", "==", "ativo").select("dominio").get();
  let rebaixados = 0;
  for (const d of snap.docs) {
    const host = (d.get("dominio") as Dominio).host;
    const decidivel = await resolve4(host).then(() => true, (e: { code?: string }) => e?.code === "ENOTFOUND" || e?.code === "ENODATA");
    if (!decidivel) continue;
    const r = await verificarDominio(db, d.id).catch((e) => (console.error(`[dominio] reverificar ${d.id}`, e), null));
    if (r?.dominio.status === "pendente") {
      rebaixados++;
      console.warn(`[dominio] ${host} (${d.id}) não aponta mais para a VPS: voltou a pendente`);
    }
  }
  return rebaixados;
}
```
(`resolve4`, `Firestore`, `Dominio` e `verificarDominio` já estão no arquivo.)
Outros pontos a tocar: a chamada no cron está no trecho novo do O1.
Teste: `npm run typecheck`. Não há teste de DNS no repo. Validação à mão no dev (opcional): com um
tenant de teste no emulador com `dominio: { host: "nao-existe-xyz123.com.br", raiz: null, status: "ativo", desde: 0 }`
e `DOMINIO_IP=1.2.3.4`, chamar `reverificarDominios(db)` num script tsx. Deve voltar 1, e o status vira "pendente".
Critério de pronto: a função existe com o filtro de `ENOTFOUND`/`ENODATA`. O cron a chama só quando `getHours() === 4 && getMinutes() < 10`.

---

## BAIXOS

### L1 — Token de cobrança vazio
Arquivo(s): src/lib/cobranca.ts:165
Trecho atual: `  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;`
Trecho novo: `  if (!guardado || a.length !== b.length || !timingSafeEqual(a, b)) return null;`
Outros pontos: nenhum. Teste: `npm run test:cobranca`. Pronto: a linha começa com `if (!guardado ||`.

### L2 — Telefone inteiro no log
Arquivo(s): src/app/api/webhooks/atendys/route.ts:190, src/app/api/agendar/route.ts:148
O padrão já usado no webhook (linhas 129 e 147) é `${evento.phone.slice(-4)}`.
Trecho atual (webhook:190):
```ts
    console.log(`[atendys] mensagem de ${evento.phone ?? "?"} para ${slug}${nova ? "" : " (repetida)"}`);
```
Trecho novo:
```ts
    console.log(`[atendys] mensagem de …${evento.phone?.slice(-4) ?? "?"} para ${slug}${nova ? "" : " (repetida)"}`);
```
Trecho atual (agendar:148):
```ts
          console.warn(`[whatsapp] ${tenantId}: telefone do cliente inválido (${b.data.customerPhone}); recibo de agendamento não enviado`);
```
Trecho novo:
```ts
          console.warn(`[whatsapp] ${tenantId}: telefone do cliente inválido (…${b.data.customerPhone.slice(-4)}); recibo de agendamento não enviado`);
```
Teste: `npm run typecheck`. Pronto: `grep -n "evento.phone ?? \"?\"" src/app/api/webhooks/atendys/route.ts` não acha nada.

### L3 — Regras: etiquetas, serviços e equipe sem validação de conteúdo
Arquivo(s): firestore.rules:119-120 (etiquetas), :158-163 (services), :168-173 (staff)
Por quê: hoje um membro grava etiqueta de 1 MB e serviço ou profissional com qualquer campo e tamanho.
Isso vai para a página pública e para o índice do admin.
Conferido o que o app grava. Serviço: `name, durationMin, priceCents, tipoPreco, active` (servicos/page.tsx:195,
setDoc com merge); o servidor grava também `ordem` e `usos`. Profissional: `name, serviceIds, hours, active`
(profissionais/page.tsx:89, setDoc SEM merge, que substitui o documento). O servidor grava `createdAt` (catalogo,
demo, seed). Por isso as regras de update olham as chaves ALTERADAS (`affectedKeys`), não todas as
chaves. Um documento antigo com campo a mais continua editável.

Acrescente, logo depois de `function gere(t) { ... }` (no topo, junto das outras funções, ~linha 35-39):
```
    // texto até max caracteres
    function textoAte(v, max) {
      return v is string && v.size() <= max;
    }
    // a etiqueta i (se existir) é texto curto: regra não tem laço, então uma por índice (até 8)
    function etiquetaOk(l, i) {
      return l.size() <= i || textoAte(l[i], 40);
    }
```
Trecho atual (customers, etiquetas):
```
          && (
            !("etiquetas" in request.resource.data)
            || (request.resource.data.etiquetas is list && request.resource.data.etiquetas.size() <= 8)
          );
```
Trecho novo:
```
          && (
            !("etiquetas" in request.resource.data)
            || (request.resource.data.etiquetas is list && request.resource.data.etiquetas.size() <= 8
              && etiquetaOk(request.resource.data.etiquetas, 0) && etiquetaOk(request.resource.data.etiquetas, 1)
              && etiquetaOk(request.resource.data.etiquetas, 2) && etiquetaOk(request.resource.data.etiquetas, 3)
              && etiquetaOk(request.resource.data.etiquetas, 4) && etiquetaOk(request.resource.data.etiquetas, 5)
              && etiquetaOk(request.resource.data.etiquetas, 6) && etiquetaOk(request.resource.data.etiquetas, 7))
          );
```
Trecho atual (services):
```
      match /services/{s} {
        allow read: if isMember(t);
        allow create, delete: if gere(t) && !demoProtegida(t);
        allow update: if gere(t) && (!demoProtegida(t)
          || request.resource.data.diff(resource.data).affectedKeys().hasOnly(['priceCents', 'durationMin', 'active', 'tipoPreco', 'ordem']));
      }
```
Trecho novo:
```
      match /services/{s} {
        allow read: if isMember(t);
        allow create: if gere(t) && !demoProtegida(t)
          && request.resource.data.keys().hasOnly(['name', 'durationMin', 'priceCents', 'tipoPreco', 'active'])
          && textoAte(request.resource.data.name, 80);
        allow delete: if gere(t) && !demoProtegida(t);
        // o app só muda os campos do formulário (e a ordem); usos e o resto são do servidor
        allow update: if gere(t)
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['name', 'durationMin', 'priceCents', 'tipoPreco', 'active', 'ordem'])
          && textoAte(request.resource.data.name, 80)
          && (!demoProtegida(t)
            || request.resource.data.diff(resource.data).affectedKeys().hasOnly(['priceCents', 'durationMin', 'active', 'tipoPreco', 'ordem']));
      }
```
Trecho atual (staff):
```
      match /staff/{s} {
        allow read: if isMember(t);
        allow update: if gere(t) && (!demoProtegida(t)
          || !request.resource.data.diff(resource.data).affectedKeys().hasAny(['name']));
        allow create, delete: if false;
      }
```
Trecho novo:
```
      match /staff/{s} {
        allow read: if isMember(t);
        // o app grava o documento inteiro (setDoc sem merge): createdAt, do servidor, some na edição
        allow update: if gere(t)
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['name', 'serviceIds', 'hours', 'active', 'createdAt'])
          && textoAte(request.resource.data.name, 80)
          && (!("serviceIds" in request.resource.data) || (request.resource.data.serviceIds is list && request.resource.data.serviceIds.size() <= 200))
          && (!("hours" in request.resource.data) || request.resource.data.hours is map)
          && (!demoProtegida(t)
            || !request.resource.data.diff(resource.data).affectedKeys().hasAny(['name']));
        allow create, delete: if false;
      }
```
Teste: em rules.test.mjs, perto da linha 188-193 (etiquetas), acrescente:
```js
await assertFails(updateDoc(cliente(alice), { etiquetas: ["x".repeat(41)] }), "etiqueta longa");
await assertFails(updateDoc(cliente(alice), { etiquetas: ["ok", 5] }), "etiqueta não texto");
```
perto da linha 232 (staff):
```js
await assertFails(setDoc(doc(alice, "tenants/acme/staff/bia"), { name: "x".repeat(81), active: true }), "nome longo");
await assertFails(updateDoc(doc(alice, "tenants/acme/staff/bia"), { lixo: "a" }), "campo fora da lista");
```
e perto da linha 43 (services):
```js
await assertFails(setDoc(doc(suporte, "tenants/acme/services/longo"), { name: "x".repeat(81), durationMin: 30, priceCents: 1, active: true }), "nome longo");
await assertFails(setDoc(doc(suporte, "tenants/acme/services/extra"), { name: "Corte", durationMin: 30, priceCents: 1, active: true, usos: 999 }), "usos é do servidor");
```
Rode `npm run test:rules`. Os testes antigos (linhas 43, 71-84, 110, 188-193, 230-233, 267-270) TÊM que continuar passando.
Se algum antigo falhar, pare e reporte: não afrouxe a regra por conta própria.
Pronto: `npm run test:rules` passa com os testes novos.
Na VPS/Firebase (revisão humana): `firebase deploy --only firestore:rules` depois do merge.

### L4 — CSP (fase 2, não implementar)
Arquivo(s): next.config.ts:12
Por quê: não há Content-Security-Policy. Sem nonce testado, uma CSP quebra os scripts inline do
Next, o Firebase Auth (popup do Google), o pixel e os sites com fontes do Google.
Esboço para a fase 2: `proxy.ts` gera um nonce por requisição e manda no cabeçalho
`Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-{n}' 'strict-dynamic'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com; frame-src https://*.firebaseapp.com https://accounts.google.com; frame-ancestors 'self'`.
Comece em `Content-Security-Policy-Report-Only` por 1 semana. Siga o guia de CSP em node_modules/next/dist/docs/.
Teste e pronto: nada nesta rodada.

### L5 — Dependências com vulnerabilidade
Arquivo(s): package.json, package-lock.json
`npm audit` em 10/11/2026: 38 vulnerabilidades (2 baixas, 24 moderadas, 12 altas). Quase todas são
transitivas (undici do firebase-tools, uuid/gaxios, re2, stream-json) e têm "fix available via `npm audit fix`".
Passos: `git show HEAD:package.json | grep firebase-admin` (anote: `^14.4.0`) → `npm audit fix` (SEM `--force`)
→ `grep '"firebase-admin"' package.json` e `npm ls firebase-admin`: o major tem que continuar 14. O mesmo vale
para `next` (16.4.4), `firebase` (12.x) e `react` (19.2.8).
Se algum major mudou: `git checkout package.json package-lock.json` e pare.
Teste: `npm run lint && npm run typecheck && npm run build`, mais a suíte sem emulador do CI (lista em .github/workflows/testes.yml).
Pronto: `npm audit` mostra menos vulnerabilidades, nenhum major de dependência direta mudou, e build e testes passam.

### L6 — Colisão de domínio entre host e raiz
Arquivo(s): src/lib/dominio.server.ts:31-47
Por quê: só se confere `dominio.host == host`. Se A tem `www.salao.com.br` (raiz `salao.com.br`) e B
cadastra `salao.com.br` (ou `www.salao.com.br` com outra grafia), `mapaDominios` (linha 79-81) sobrescreve
`hosts[...]` e um site passa a responder no domínio do outro.

Trecho atual (função inteira):
```ts
export async function conectarDominio(db: Firestore, slug: string, entrada: string): Promise<Dominio> {
  const host = normalizarHost(entrada);
  if (!host) throw new ErroPrevisto("Endereço inválido. Use algo como www.salaodaana.com.br.");
  const t = db.doc(`tenants/${slug}`);
  const [tenant, outro] = await Promise.all([
    t.get(),
    db.collection("tenants").where("dominio.host", "==", host).limit(1).get(),
  ]);
  if (!tenant.exists) throw new ErroPrevisto("Negócio não encontrado.");
  if (!tenant.get("gerado.publicadoEm")) throw new ErroPrevisto("O domínio próprio é do site publicado: dê baixa na entrada antes.");
  if (!outro.empty && outro.docs[0].id !== slug) throw new ErroPrevisto(`${host} já está ligado a outro negócio (${outro.docs[0].id}).`);
  ipDaVps();
  const raiz = raizDe(host);
  const dominio: Dominio = { host, raiz, status: "pendente", desde: Date.now() };
  await t.update({ dominio });
  return dominio;
}
```
Trecho novo (função inteira):
```ts
export async function conectarDominio(db: Firestore, slug: string, entrada: string): Promise<Dominio> {
  const host = normalizarHost(entrada);
  if (!host) throw new ErroPrevisto("Endereço inválido. Use algo como www.salaodaana.com.br.");
  const raiz = raizDe(host);
  const t = db.doc(`tenants/${slug}`);
  // o host e a raiz não podem ser nem o host nem a raiz de outro negócio: o mapa do proxy junta
  // os dois em hosts{}, e um sobrescreveria o outro. limit(2): o próprio negócio pode aparecer
  const tenants = db.collection("tenants");
  const com = (campo: string, valor: string) => tenants.where(campo, "==", valor).limit(2).get();
  const [tenant, ...achados] = await Promise.all([
    t.get(),
    com("dominio.host", host),
    com("dominio.raiz", host),
    ...(raiz ? [com("dominio.host", raiz), com("dominio.raiz", raiz)] : []),
  ]);
  if (!tenant.exists) throw new ErroPrevisto("Negócio não encontrado.");
  if (!tenant.get("gerado.publicadoEm")) throw new ErroPrevisto("O domínio próprio é do site publicado: dê baixa na entrada antes.");
  const outro = achados.flatMap((q) => q.docs).find((d) => d.id !== slug);
  if (outro) throw new ErroPrevisto(`${host} já está ligado a outro negócio (${outro.id}).`);
  ipDaVps();
  const dominio: Dominio = { host, raiz, status: "pendente", desde: Date.now() };
  await t.update({ dominio });
  return dominio;
}
```
Outros pontos a tocar: nenhum. A consulta `dominio.raiz ==` já existe na rota tls e o índice simples é automático.
Teste: `npm run typecheck`. Se houver teste de domínio em admin.test.mts ou atendys.test.mts (`grep -ln conectarDominio *.test.mts`),
rode-o. Senão, só typecheck.
Pronto: `conectarDominio` consulta 2 ou 4 vezes e recusa qualquer documento com id diferente de `slug`.

### L7 — /api/dominios/tls consulta o Firestore a cada host desconhecido
Arquivo(s): src/app/api/dominios/tls/route.ts:15-25
Por quê: bot varrendo o IP faz o Caddy perguntar por nomes aleatórios, e cada pergunta são 2 consultas no Firestore.
Trecho atual:
```ts
export async function GET(request: NextRequest) {
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.get("host") ?? "")) return new NextResponse(null, { status: 404 });
  const host = normalizarHost(request.nextUrl.searchParams.get("domain") ?? "");
  if (!host) return new NextResponse(null, { status: 404 });
  const tenants = adminDb.collection("tenants");
  const [principal, raiz] = await Promise.all([
    tenants.where("dominio.host", "==", host).limit(1).get(),
    tenants.where("dominio.raiz", "==", host).limit(1).get(),
  ]);
  return new NextResponse(null, { status: principal.empty && raiz.empty ? 404 : 200 });
}
```
Trecho novo:
```ts
// host recusado fica 5 min sem nova consulta: bot varrendo o IP pede certificado para nomes
// aleatórios. Domínio recém-ligado no admin espera no máximo esses 5 min pelo certificado.
// ponytail: limpa tudo ao bater o teto; LRU se o mapa encher sempre
const recusados = new Map<string, number>();
const RECUSA_MS = 5 * 60_000;
const TETO_RECUSADOS = 1000;

export async function GET(request: NextRequest) {
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.get("host") ?? "")) return new NextResponse(null, { status: 404 });
  const host = normalizarHost(request.nextUrl.searchParams.get("domain") ?? "");
  if (!host) return new NextResponse(null, { status: 404 });
  if ((recusados.get(host) ?? 0) > Date.now()) return new NextResponse(null, { status: 404 });
  const tenants = adminDb.collection("tenants");
  const [principal, raiz] = await Promise.all([
    tenants.where("dominio.host", "==", host).limit(1).get(),
    tenants.where("dominio.raiz", "==", host).limit(1).get(),
  ]);
  if (principal.empty && raiz.empty) {
    if (recusados.size >= TETO_RECUSADOS) recusados.clear();
    recusados.set(host, Date.now() + RECUSA_MS);
    return new NextResponse(null, { status: 404 });
  }
  recusados.delete(host);
  return new NextResponse(null, { status: 200 });
}
```
Teste: `npm run typecheck`. Pronto: existe `recusados` com TTL de 5 min e teto de 1000.

### L8 — Reenvio da planilha apaga o que o admin editou na gaveta
Arquivo(s): src/lib/negocios.server.ts:204 (salvarNegocio), src/lib/gerador.server.ts:136-149 (porTelefone) e :202-206
Por quê: `salvarNegocio` (aba Site da gaveta e "Meu negócio" do dono) grava `gerado.*` e `site.*`, mas
não deixa marca de edição. Um reenvio de planilha ou coleta com o mesmo telefone cai em "atualizar" e regrava nome,
endereço e Instagram por cima.

src/lib/negocios.server.ts:204. Trecho atual:
```ts
  await ref.set({ ...negocio.dados, site: { ...(google ? negocio.dados.site : site), fuso: d.fuso || null } }, { merge: true });
```
Trecho novo:
```ts
  // editadoEm: a planilha e a coleta (gerarNoBanco) não regravam o que foi editado aqui
  await ref.set({ ...negocio.dados, gerado: { ...(negocio.dados.gerado as Record<string, unknown>), editadoEm: FieldValue.serverTimestamp() }, site: { ...(google ? negocio.dados.site : site), fuso: d.fuso || null } }, { merge: true });
```
src/lib/gerador.server.ts, tipo do mapa (linha 136). Trecho atual:
```ts
  const porTelefone = new Map<string, { slug: string; gerado: boolean; cadastro: boolean; publicado: boolean; escolha?: Escolha; personal?: Personal | null }>();
```
Trecho novo:
```ts
  const porTelefone = new Map<string, { slug: string; gerado: boolean; cadastro: boolean; publicado: boolean; editado: boolean; escolha?: Escolha; personal?: Personal | null }>();
```
Linha 144. Trecho atual:
```ts
          porTelefone.set(t, { slug: d.id, gerado: !!d.get("gerado"), cadastro: d.get("gerado.origem") === "cadastro", publicado: !!d.get("gerado.publicadoEm"), escolha: d.get("gerado.escolha"), personal: personalDe(d.get("gerado.personal")) });
```
Trecho novo:
```ts
          porTelefone.set(t, { slug: d.id, gerado: !!d.get("gerado"), cadastro: d.get("gerado.origem") === "cadastro", publicado: !!d.get("gerado.publicadoEm"), editado: !!d.get("gerado.editadoEm"), escolha: d.get("gerado.escolha"), personal: personalDe(d.get("gerado.personal")) });
```
Linhas 202-206. Trecho atual:
```ts
    if (ja && assumidos.has(ja.slug)) {
      saida.push({ ...base, slug: ja.slug, acao: "pular", motivo: `negócio já assumido pelo dono (${ja.slug}): edite pela gaveta, aba Site` });
      continue;
    }
    if (ja) {
```
Trecho novo:
```ts
    if (ja && assumidos.has(ja.slug)) {
      saida.push({ ...base, slug: ja.slug, acao: "pular", motivo: `negócio já assumido pelo dono (${ja.slug}): edite pela gaveta, aba Site` });
      continue;
    }
    // editado pela gaveta (salvarNegocio marca gerado.editadoEm): a planilha não passa por cima
    if (ja?.editado) {
      saida.push({ ...base, slug: ja.slug, acao: "pular", motivo: `site editado pela gaveta (${ja.slug}): mude por lá, aba Site` });
      continue;
    }
    if (ja) {
```
Outros pontos a tocar: confira que `FieldValue` já está importado em src/lib/negocios.server.ts (a linha 205 usa `FieldValue.delete()`, então está).
Teste: em gerador-banco.test.mts, depois do bloco de `assumido` (linha ~96-103), acrescente:
```ts
// editado pela gaveta: o reenvio pula em vez de regravar
{
  const { salvarNegocio, lerNegocio } = await import("@/lib/negocios.server");
  const [g] = await gerarNoBanco(db, planilha(["Editado Gaveta", "(91) 97777-6655", "Barbearia", "Belém", "PA", "", "", "", "", "", ""]), true, "a");
  await salvarNegocio(db, g.slug, await lerNegocio(db, g.slug));
  const [de_novo2] = await gerarNoBanco(db, planilha(["Outro Nome", "(91) 97777-6655", "Barbearia", "Belém", "PA", "", "", "", "", "", ""]), true, "a");
  assert.equal(de_novo2.acao, "pular");
  assert.match(de_novo2.motivo ?? "", /editado pela gaveta/);
}
```
(confira na linha 9 que `salvarNegocio` e `lerNegocio` existem. Se `lerNegocio` devolver outro formato que `salvarNegocio`
não aceita, monte a entrada copiando o que o próprio teste já usa para `salvarNegocio` no arquivo: `grep -n salvarNegocio gerador-banco.test.mts`.)
Rode `npm run test:gerador-banco`.
Pronto: o teste passa. `salvarNegocio` grava `gerado.editadoEm`. `gerarNoBanco` pula os editados com o motivo novo.

### L9 — Prévia da coleta relê o estado inteiro a cada lote
Arquivo(s): src/lib/gerador.server.ts:124 e :163, src/app/admin/coleta-actions.ts:252-258
Por quê: `previaDaColeta` chama `gerarNoBanco` uma vez por lote de 300. Cada chamada relê todos os tenants da UF (`doEstado`),
o que dá milhares de leituras repetidas numa coleta grande.
gerador.server.ts:124. Trecho atual:
```ts
export async function gerarNoBanco(db: Firestore, entrada: unknown, aplicar: boolean, ownerId: string): Promise<LinhaGerada[]> {
```
Trecho novo:
```ts
/** doEstado: os tenants de cada UF, lidos uma vez; quem chama em lotes (a prévia da coleta) passa o
 *  mesmo mapa a todos, para não reler o estado inteiro a cada lote. */
export async function gerarNoBanco(db: Firestore, entrada: unknown, aplicar: boolean, ownerId: string, doEstado = new Map<string, Promise<QueryDocumentSnapshot[]>>()): Promise<LinhaGerada[]> {
```
gerador.server.ts:162-163. Trecho atual:
```ts
  // o estado é lido uma vez para todos os ramos: uma leitura por ramo eram até 62 mil por lote em MG (4.447 × 14)
  const doEstado = new Map<string, Promise<QueryDocumentSnapshot[]>>();
```
Trecho novo (só o comentário fica; a linha `const doEstado` sai, porque agora é parâmetro):
```ts
  // o estado é lido uma vez para todos os ramos: uma leitura por ramo eram até 62 mil por lote em MG (4.447 × 14)
```
coleta-actions.ts. Trecho atual:
```ts
  const leads = await novosDa(ref);
  const linhas: LinhaDaPrevia[] = [];
  for (let i = 0; i < leads.length; i += TETO_LOTE) {
    const lote = leads.slice(i, i + TETO_LOTE);
    const geradas = await gerarNoBanco(adminDb, lote.map(({ id: _, ...l }) => l), false, process.env.OWNER_UID || user.uid);
```
Trecho novo:
```ts
  const leads = await novosDa(ref);
  const linhas: LinhaDaPrevia[] = [];
  // a UF é lida uma vez para todos os lotes (a prévia não grava, então a leitura não envelhece)
  const doEstado = new Map();
  for (let i = 0; i < leads.length; i += TETO_LOTE) {
    const lote = leads.slice(i, i + TETO_LOTE);
    const geradas = await gerarNoBanco(adminDb, lote.map(({ id: _, ...l }) => l), false, process.env.OWNER_UID || user.uid, doEstado);
```
Teste: `npm run typecheck` e `npm run test:gerador-banco`. Pronto: `previaDaColeta` cria um `doEstado` fora do laço e passa a todas as chamadas.

### L10 — Worker grava leads sem conferir se o pedido ainda é dele
Arquivo(s): scripts/coletar.mts:124-128
Trecho atual:
```ts
  for (let i = 0; i < docs.length; i += 400) {
    const lote = adminDb.batch();
    docs.slice(i, i + 400).forEach((d, k) => lote.set(leads.doc(String(placeId(d.link_maps) ?? `sem-id-${i + k}`).replace(/[:/]/g, "_")), d));
    await lote.commit();
  }
```
Trecho novo:
```ts
  for (let i = 0; i < docs.length; i += 400) {
    const lote = adminDb.batch();
    docs.slice(i, i + 400).forEach((d, k) => lote.set(leads.doc(String(placeId(d.link_maps) ?? `sem-id-${i + k}`).replace(/[:/]/g, "_")), d));
    // a cada lote: o admin pode ter cancelado ou passado o pedido a outro worker no meio da gravação
    await seAindaMeu(ref, worker);
    await lote.commit();
  }
```
Teste: `npm run test:coleta` e `npm run typecheck`. Pronto: `seAindaMeu` aparece antes de cada `lote.commit()`.

### L11 — Gaveta do admin recebe resposta de outro negócio
Arquivo(s): src/app/admin/page.tsx:396 e :466. O padrão é o da linha 328 (`if (abertoRef.current !== e.slug) return;`).
Trecho atual (395-396):
```ts
    const lida = await listarAcessos(await token(), slug);
    setAcessos(lida.ok ? lida.dados : (a) => a?.filter((x) => x.uid !== uid) ?? null);
```
Trecho novo:
```ts
    const lida = await listarAcessos(await token(), slug);
    // a gaveta pode ter mudado de negócio enquanto a lista vinha
    if (abertoRef.current !== slug) return;
    setAcessos(lida.ok ? lida.dados : (a) => a?.filter((x) => x.uid !== uid) ?? null);
```
Trecho atual (465-466):
```ts
      const n = await linhaDoTempoDo(await token(), slug);
      if (n.ok) setEventos(n.dados);
```
Trecho novo:
```ts
      const n = await linhaDoTempoDo(await token(), slug);
      if (n.ok && abertoRef.current === slug) setEventos(n.dados);
```
Teste: `npm run typecheck` e `npm run lint`. Pronto: as duas guardas estão no lugar.

### L12 — Regex de slug própria no admin
Arquivo(s): src/app/admin/actions.ts:118. Era a 166 no pedido, mas a constante está na 118. A 166 só a usa via `limpar`.
Por quê: `SLUG` ali exige 3+ caracteres (`{1,61}`). O `SLUG_SITE` de src/lib/site-arquivo.ts:12 aceita 2. Um site de 2
letras some do admin.
Trecho atual:
```ts
const SLUG = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
```
Trecho novo:
```ts
// o mesmo endereço de site do resto do sistema
const SLUG = SLUG_SITE;
```
e acrescente aos imports do arquivo: `import { SLUG_SITE } from "@/lib/site-arquivo";`
Teste: `npm run typecheck` e `npm run test:admin`. Pronto: não há mais regex literal de slug em src/app/admin/actions.ts:118.

### L13 — Ambiente da VPS fora do repo
Arquivo(s): deploy/ruphus-site.service:11-15
Trecho atual:
```
Environment=NODE_ENV=production
Environment=NEXT_TELEMETRY_DISABLED=1
Environment=TZ=America/Sao_Paulo
```
Trecho novo:
```
Environment=NODE_ENV=production
Environment=NEXT_TELEMETRY_DISABLED=1
Environment=TZ=America/Sao_Paulo
# memória (antes só no drop-in /etc/systemd/system/ruphus-site.service.d/memoria.conf da VPS):
# heap de 1280 MB e o jemalloc, que devolve memória ao sistema (apt install libjemalloc2)
Environment=NODE_OPTIONS=--max-old-space-size=1280
Environment=LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libjemalloc.so.2
```
Outros pontos: nenhum no repo. NÃO apague o memoria.conf da VPS nesta rodada: com os dois, vale o drop-in, que tem o mesmo valor.
Teste: `systemd-analyze verify deploy/ruphus-site.service` só funciona em Linux; no Mac, só revisão. Pronto: as duas linhas estão no arquivo.

### L14 — .env.example incompleto
Arquivo(s): .env.example (no fim)
Acrescente no fim do arquivo (comentários conferidos no uso real de cada variável):
```
# Endereço do www da Ruphus (https://www.ruphus.site): links de convite e cobrança, renovar cache, og.jpg.
SITE_URL=
# Base pública que o atendys usa para chamar o webhook (/api/webhooks/atendys) e montar links de agendar.
PUBLIC_SITE_URL=
# Endereço do site no navegador (metadataBase do layout); fallback do SITE_URL no servidor.
NEXT_PUBLIC_SITE_URL=
# Segredo do cabeçalho x-ruphus: só o proxy lê /api/desativados e /api/dominios. Obrigatório em produção.
DESATIVADOS_TOKEN=
# JSON da conta de serviço do Firebase (firebase-admin) no servidor e nos scripts.
FIREBASE_SERVICE_ACCOUNT=
# uid que vira dono dos sites gerados pela coleta e pela importação (sem ele, o admin que gerou).
OWNER_UID=
# Par VAPID dos avisos push do painel (web-push). A pública vai para o navegador.
VAPID_PRIVATE_KEY=
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
# Instância do atendys do canal oficial da plataforma (padrão: ruphus-plataforma-cloud-teste).
ATENDYS_PLATAFORMA_INSTANCIA=
# 1 depois que a Meta aprovar os templates com botões na WABA do número oficial.
ATENDYS_TEMPLATES_BOTOES=
```
Teste: nenhum. Pronto: as 11 variáveis estão no arquivo, cada uma com comentário.

### L15 — Endereço do www repetido em 8 lugares
Arquivo(s): src/lib/dominio.ts (exporta), src/app/[tenant]/actions.ts:136 e :528, src/app/admin/actions.ts:147, :481, :512, :524, src/lib/renovar-site.server.ts:6, scripts/convite.mts:10
Por quê: cada lugar repete `process.env.SITE_URL ?? "https://www.ruphus.site"`. O comentário de admin/actions.ts:142 conta
que já divergiram uma vez.
Módulo escolhido: src/lib/dominio.ts. É puro (roda no proxy, no servidor e nos scripts) e já cuida de endereços (`urlDoSite`).
NÃO unificar (significado diferente; confirmado por grep):
- `PUBLIC_SITE_URL` em src/lib/atendys.ts:21, src/lib/whatsapp.server.ts:638, src/lib/botoes-whatsapp.server.ts:30 e
  scripts/canal-oficial.mts:16. É a base do webhook e dos links de agendar, com fallback no subdomínio do negócio.
  Juntar mudaria a URL do webhook registrada no atendys.
- `ORIGEM` em src/proxy.ts:10 (fallback vazio de propósito).
- `BASE` em src/app/s/[slug]/og.jpg/route.tsx:31 (tem fallback de localhost no dev).

Acrescente no fim de src/lib/dominio.ts:
```ts
/** O www da Ruphus, sem barra no fim: links de convite, cobrança e recibo. SITE_URL no servidor. */
export const SITE_BASE = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://www.ruphus.site").replace(/\/+$/, "");
```
Em cada um destes, troque a linha pela de baixo e acrescente `import { SITE_BASE } from "@/lib/dominio";` (ou junte ao import existente de "@/lib/dominio"):
- src/app/[tenant]/actions.ts:136 e :528: `const base = process.env.SITE_URL ?? "https://www.ruphus.site";` → `const base = SITE_BASE;`
- src/app/admin/actions.ts:147, :481, :512, :524: o mesmo.
- src/lib/renovar-site.server.ts:6: `const BASE = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://www.ruphus.site";` → `const BASE = SITE_BASE;`
- scripts/convite.mts:10: `const BASE = process.env.SITE_URL ?? "https://www.ruphus.site";` → `const BASE = SITE_BASE;`
Teste: `npm run typecheck`, `npm run test:admin`, `npm run test:convite`. Depois,
`grep -rn 'SITE_URL ?? "https://www.ruphus.site"' src scripts` não acha nada.
Pronto: um só `SITE_BASE`, e o grep acima vazio.

### L16 — sharp carregado no boot de quem importa foto.server
Arquivo(s): src/lib/foto.server.ts:2 e :54
Trecho atual (linha 2): `import sharp from "sharp";` → apague a linha.
Trecho atual (linha 54):
```ts
    const img = sharp(corpo, { limitInputPixels: MAX_PIXELS });
```
Trecho novo:
```ts
    // sob demanda, como em admin/actions.ts (pré-visualização da IA): quem importa este módulo só para
    // ler ou apagar foto não carrega o binário nativo
    const sharp = (await import("sharp")).default;
    const img = sharp(corpo, { limitInputPixels: MAX_PIXELS });
```
Teste: `npm run test:gerador-banco` (processarFoto) e `npm run typecheck`. Pronto: não há `import sharp` no topo do arquivo.
Faça no mesmo PR do F2: os dois mexem em foto.server.ts.

### L17 — Rota morta do wtsfy
Arquivo(s): src/app/api/webhooks/wtsfy/route.ts, docs/roteiro-de-teste.md:140
Passos: `git rm -r src/app/api/webhooks/wtsfy`. Em docs/roteiro-de-teste.md, linha 140:
Trecho atual: ``- [ ] `API-05` `/api/webhooks/wtsfy` POST → 410; `/api/webhooks/atendys` sem assinatura → 401.``
Trecho novo: ``- [ ] `API-05` `/api/webhooks/atendys` sem assinatura → 401.``
(mantém o número API-05: os outros itens não são renumerados)
Teste: `npm run typecheck` e `npm run build`. Pronto: a pasta não existe e o roteiro não cita wtsfy.

### L18 — tenantCollection sem uso
Arquivo(s): src/lib/tenants.ts:1, :3 e :41-43
Conferido: `grep -rn tenantCollection src *.test.mts` só acha a definição.
Apague as linhas 41-43:
```ts
// Todo dado de negócio vive em tenants/{id}/<coleção>
export const tenantCollection = (tenantId: string, name: string) =>
  collection(db, "tenants", tenantId, name);
```
e, porque ficam sem uso, os imports da linha 1 (`import { collection } from "firebase/firestore";`) e da linha 3 (`import { db } from "@/lib/firebase-db";`).
Antes de apagar os imports, rode `grep -n "collection\|\bdb\b" src/lib/tenants.ts` e confira que não há outro uso.
Teste: `npm run typecheck` e `npm run lint`. Pronto: o arquivo não importa firebase/firestore nem firebase-db.

### L19 — Luminância duplicada
Arquivo(s): src/lib/contraste.ts:6-16, src/lib/site-claro.ts:10 e :91
É mecânico. Faça.
src/lib/contraste.ts, arquivo inteiro novo:
```ts
const canal = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = (rgb: number[]) => 0.2126 * canal(rgb[0] / 255) + 0.7152 * canal(rgb[1] / 255) + 0.0722 * canal(rgb[2] / 255);

/** Luminância relativa (WCAG) de "#RRGGBB". */
export const luminancia = (hex: string) => lum([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));

/** O destaque do topo sobre a foto escurecida (--gold no modelo claro, a segunda linha do nome
 *  no editorial): paletas de azul, verde-petróleo, marrom e vinho escuros sumiam ali ("no seu
 *  ritmo" no idiomas-3, "Estrelas" no Barbeiro das Estrelas). Clareia a mesma cor, só no topo, até dar
 *  3,5:1 (3:1 é o mínimo para título; a margem cobre foto clara atrás do nome)
 *  contra o fundo do título (#3f4441, a foto sob o escurecido). Cor que já passa volta igual. */
export function destaqueNoTopo(hex: string): string {
  const fundo = lum([0x3f, 0x44, 0x41]);
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (let t = 0; t <= 1; t += 0.05) {
    const m = rgb.map((c) => Math.round(c + (255 - c) * t));
    if ((lum(m) + 0.05) / (fundo + 0.05) >= 3.5) return "#" + m.map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  return "#FFFFFF";
}
```
src/lib/site-claro.ts:10: `import { destaqueNoTopo } from "@/lib/contraste";` → `import { destaqueNoTopo, luminancia } from "@/lib/contraste";`
src/lib/site-claro.ts:91: apague a linha `const luminancia = (hex: string) => [1, 3, 5].map(...)...;` (a linha 90, o comentário, e a 92, `tintaSobre`, ficam).
"Ícones comuns": fase 2 (não é mecânico).
Teste: `npm run test:gerador` e `npm run typecheck`. Pronto: só existe uma `luminancia`, em contraste.ts.

### L20 — Scripts de migração já rodados
Arquivo(s): scripts/
Conferido: nenhum é citado em package.json. `git rm` em:
scripts/migrar-nicho.mts, scripts/migrar-podologia.mts, scripts/corrigir-ramos.mts, scripts/corrigir-telefones.mts,
scripts/limpar-catalogo.mts, scripts/aplicar-modelos.mts, scripts/importar-mensagens-paradas.mts.
NÃO apagar scripts/consolidar-planilhas.mts: ainda está no fluxo de coleta documentado
(docs/pesquisa-leads.md:112, passo 5) e alimenta a tabela `planilhas` do dblocal. Não é migração de uma vez só.
CHANGELOG.md e docs/analise-projeto-2026-11-03.md citam alguns desses nomes. São histórico e ficam como estão.
Teste: `npm run typecheck` e `npm run lint`. Antes do `git rm`, confira que nenhum outro script importa os apagados:
`grep -rn "migrar-nicho\|migrar-podologia\|corrigir-ramos\|corrigir-telefones\|limpar-catalogo\|aplicar-modelos\|importar-mensagens-paradas" scripts src package.json`.
Só podem aparecer os próprios arquivos e a menção textual de migrar-podologia dentro de corrigir-ramos, que também sai.
Pronto: os 7 arquivos não existem, e typecheck e lint passam.

### L21 — write-excel-file em devDependencies
Arquivo(s): package.json
Por quê: scripts/coletar.mts:19 importa no topo, e o worker da VPS roda `npm run coletar`.
Comando: `npm install --save write-excel-file@^4.1.1` (move para dependencies e atualiza o lock).
Confira que saiu de devDependencies.
DECISÃO DO USUÁRIO: o worker também usa o `tsx` (devDependency) para rodar `npm run coletar`. Hoje funciona
porque o `npm ci` do deploy instala as devDependencies. Mover o `tsx` junto? Padrão: não mover.
Teste: `npm run test:coleta`. Pronto: `write-excel-file` está em `dependencies` e fora de `devDependencies`.

### L22 — Testes fora do CI
Arquivo(s): .github/workflows/testes.yml
Conferido em 10/11/2026: os 5 passam localmente.
Trecho atual:
```yaml
      - run: npm run test:proposta-email
      - run: npm run test:convite-email

      # Com emulador do Firestore (e do Auth, no booking)
```
Trecho novo:
```yaml
      - run: npm run test:proposta-email
      - run: npm run test:convite-email
      - run: npm run test:recibo
      - run: npm run test:mensagens
      - run: npm run test:coleta
      - run: npm run test:canal-oficial

      # Com emulador do Firestore (e do Auth, no booking)
```
E no fim do arquivo, depois de `      - run: npm run test:painel-indice`:
```yaml
      # a tela das conversas roda sem emulador; o resto com o do Firestore
      - run: npm run test:conversas
```
Teste: rode os 5 de novo localmente antes do push. O CI do PR é a validação.
Pronto: o CI do PR fica verde com os 5 passos novos.

---

## Ordem e agrupamento em PRs

Ordem de merge: PR1 → PR2 → PR3 → PR4 → PR5 → PR6. Cada PR sai de `origin/main` atualizado. Antes
de cada branch: `git fetch origin && git switch -c <branch> origin/main`. Rode o comando de teste de cada PR antes de abrir.

1. **PR1** branch `fix/deploy-rollback-e-teto` — título "Deploy: rollback automático, build com teto de memória e worker reiniciado".
   Itens: A5, A6, O4, O3, L13. Arquivos: scripts/deploy-vps.sh, deploy/Caddyfile.ruphus, deploy/ruphus-site.service.
   Teste: `bash -n scripts/deploy-vps.sh && shellcheck scripts/deploy-vps.sh`, mais o teste com funções falsas do O4.
   Precisa de revisão humana antes do primeiro uso real.
2. **PR2** branch `fix/alertas-cron-e-erros` — "Alertas: cron parado, erro de servidor por e-mail e domínio reverificado".
   Itens: O1, O2, O5, F5, O8. Arquivos: deploy/crontab.txt, src/instrumentation.ts, src/lib/alerta-admin.server.ts,
   src/app/api/cron/lembretes/route.ts, src/lib/dominio.server.ts (só a função nova), src/lib/email.server.ts, integracoes.test.mts.
   Teste: `npm run typecheck && npm run lint && npm run test:integracoes && npm run test:painel-indice && npm run test:proposta-email && npm run test:convite-email && npm run build`.
3. **PR3** branch `fix/sites-publicos-e-dominios` — "Sites: gerador antes do Storage, og.jpg com timeout e listas do proxy sem falso vazio".
   Itens: O6, O7, F3, F4, L6, L7. Arquivos: rotas em src/app/s/[slug]/, src/app/api/dominios/**, src/app/api/desativados/route.ts,
   src/proxy.ts, src/lib/dominio.server.ts (conectarDominio).
   Teste: `npm run typecheck && npm run lint && npm run test:proxy && npm run test:site-arquivo`.
4. **PR4** branch `fix/cota-de-email-e-regras` — "Segurança: cota diária de convites e recibos, e-mail confirmado e regras de conteúdo".
   Itens: S1, S2, L1, L2, L3. Teste: `npm run typecheck && npm run test:booking && npm run test:recibo && npm run test:cobranca && npm run test:rules`.
   Depois do merge (revisão humana): `firebase deploy --only firestore:rules`.
5. **PR5** branch `fix/fabrica-fotos-e-gerador` — "Fábrica: foto só troca ao publicar, gerar não sobrescreve e edição da gaveta preservada".
   Itens: F1, F2, L16, L8, L9, L10, L11, L12.
   Teste: `npm run typecheck && npm run lint && npm run test:gerador-banco && npm run test:foto-rota && npm run test:site-arquivo && npm run test:admin && npm run test:coleta`.
6. **PR6** branch `chore/limpeza-e-ci` — "Limpeza: rotas e scripts mortos, SITE_BASE único, .env.example e testes no CI".
   Itens: L14, L15, L17, L18, L19, L20, L21, L22, L5 (o L5 por último, num commit próprio).
   Teste: `npm run lint && npm run typecheck && npm run build`, mais os 5 testes do L22, `npm run test:admin`, `npm run test:convite` e `npm run test:gerador`.

L4 (CSP) não entra em PR nesta rodada.

## Riscos e o que NÃO fazer

- `scripts/deploy-vps.sh`: só `bash -n`, `shellcheck` e o teste com funções falsas. NÃO rode o script
  nem partes dele contra a VPS. O primeiro deploy com a versão nova é feito por um humano, olhando.
- Não apague `app-prev` nem `app-ruim` na VPS à mão. Não apague `/opt/ruphus-site/.deploy.trava` sem confirmar que não há deploy rodando.
- Não remova o drop-in `/etc/systemd/system/ruphus-site.service.d/memoria.conf` da VPS nesta rodada (L13 só documenta).
- Nada de `npm audit fix --force`, `git push --force` ou `git reset --hard` em branch compartilhada.
- Não instale o crontab (`crontab -u ruphus …`), não recarregue o Caddy e não publique as regras do Firestore. Tudo isso é passo humano depois do merge.
- F2 muda onde a foto fica antes de publicar. Fotos já enviadas e ainda não publicadas no momento do deploy estão no
  nome fixo e continuam funcionando, porque `fotosFaltando` e `lerFoto` aceitam os dois nomes.
- F5: nunca troque o filtro `ENOTFOUND`/`ENODATA` por "qualquer erro". Timeout de DNS rebaixaria domínio de cliente.
- L3: se um teste ANTIGO de `npm run test:rules` falhar, pare e reporte. Não afrouxe nem apague teste.
- S1 parte 2 (e-mail confirmado) e O5/L21 (opções) só com o "sim" do usuário.
- Não apague dados de produção, nem CRM, nem sites gerados, nem a demo `barbearia-force` (memória do projeto).
- Não commite `docs/revisao-final-2026-11-10.md` nem `.claude/` junto destes PRs, porque não fazem parte deles.
