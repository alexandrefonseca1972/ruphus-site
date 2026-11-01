# Plano de migração: ruphus-site → VPS (179.197.81.188)

Status: **proposta para revisão**. Nada foi executado na VPS.
Revisado em 2026-10-31, substituindo a versão anterior do mesmo dia.

## 1. Onde estamos

- **A produção está fora do ar.** A Vercel devolve `402 DEPLOYMENT_DISABLED` por
  cobrança. Por isso não existe rollback para a Vercel sem pagar: o plano
  antigo dizia "devolver os A records à Vercel", e isso só vale se a conta for
  reativada.
- **O WhatsApp (WTSFY) não está ligado em produção.** As variáveis
  `WTSFY_BASE_URL` e `WTSFY_API_KEY` não existem no painel. Portanto a
  migração do app **não depende** da adaptação ao gateway novo: o app sobe
  igual, e o WhatsApp vira uma fase posterior (seção 6).
- **DNS:** `ruphus.site` já está na Cloudflare (`dane`/`sky.ns.cloudflare.com`),
  hoje em modo cinza apontando para a Vercel (216.150.1.1 e 216.150.16.1).
- **O que continua no Google:** Firebase (Auth, Firestore, Storage dos sites).
  A VPS recebe só o Next.js.
- **O app não usa nada exclusivo da Vercel:** nem edge runtime, nem
  `@vercel/*`. As dependências da plataforma são estas, todas tratadas na
  seção 3:
  - crons do `vercel.json`;
  - `VERCEL_ENV` em duas rotas;
  - `VERCEL_GIT_COMMIT_SHA` no rodapé;
  - `VERCEL_PROJECT_PRODUCTION_URL` no layout (tem fallback);
  - o IP do cliente vindo do proxy.
- **VPS:** 1 vCPU, 3,8 GB de RAM, 4 GB de swap, Caddy instalado por apt (já
  serve outros sites). O WTSFY roda nela na porta 3002 e o painel na 8088.

## 2. Arquitetura alvo

```
visitante ─► Cloudflare (laranja, *.ruphus.site e ruphus.site)
               │ Origin Certificate wildcard, SSL Full (Strict)
               ▼
cliente com domínio próprio ─► (cinza, A → 179.197.81.188)
               ▼
           Caddy :443 ──► next start :3001 (pm2 "ruphus-site")
               │                 │
               │                 └─► Firebase (Google)
               └─ on_demand_tls ask → 127.0.0.1:3001/api/dominios/tls
crontab ─► 127.0.0.1:3001/api/cron/{lembretes,demo}
```

- **TLS de `ruphus.site` e subdomínios:** proxy laranja da Cloudflare com
  Origin Certificate wildcard (validade de cerca de 15 anos).
  - O certificado fica num arquivo no Caddy.
  - Não é preciso trocar o binário do Caddy nem usar plugin de DNS.
  - Bônus: a Cloudflare faz o cache de `/s/*` e `og.jpg` e esconde o IP.
- **Domínio próprio de cliente:** fica fora da Cloudflare.
  - O cliente cria A `www` e A `@` apontando para o IP da VPS.
  - O Caddy emite o certificado sob demanda.
  - Já implementado no PR #157: modo VPS com `DOMINIO_IP` e rota
    `/api/dominios/tls`.
- **Build fora da VPS (recomendado):**
  - Um GitHub Action no push para `main` roda `next build` com
    `output: "standalone"` em ubuntu (linux-x64, o mesmo binário do `sharp`
    da VPS).
  - O resultado sobe por rsync/ssh para `/opt/ruphus-site/releases/<sha>`.
  - O link `current` passa a apontar para a nova versão, seguido de
    `pm2 reload`.
  - Ganhos: a VPS de 1 vCPU não sofre com o build (10–20 min e pico de
    memória ao lado do WTSFY); o fluxo continua sendo "merge → deploy", como na
    Vercel; e o rollback é apontar `current` para a versão anterior.
  - Alternativa sem Action: `scripts/deploy-vps.sh` roda o mesmo processo a
    partir do Mac. O build precisa ser feito na VPS ou em Docker linux-x64,
    nunca com o `node_modules` do Mac.

## 3. Mudanças de código (um PR, antes do corte)

| # | Onde | Mudança |
|---|---|---|
| 1 | `next.config.ts` | `output: "standalone"`; `NEXT_PUBLIC_COMMIT` passa a aceitar também `GIT_COMMIT_SHA` (vindo do Action), além de `VERCEL_GIT_COMMIT_SHA` |
| 2 | `src/app/api/desativados/route.ts:12`, `src/app/api/dominios/route.ts:11` | Trocar `VERCEL_ENV === "production"` por `NODE_ENV === "production"`: sem token em produção, a rota responde 404 em qualquer host, e não só na Vercel |
| 3 | `.github/workflows/deploy-vps.yml` (novo) | Build standalone, copia `public/` e `.next/static`, rsync para a release, troca `current`, `pm2 reload`. Secrets: `VPS_SSH_KEY`, `VPS_HOST`. Os `NEXT_PUBLIC_*` (públicos) ficam como *variables* do repositório, porque entram no bundle no build |
| 4 | `deploy/` (novo) | `Caddyfile.ruphus` (trecho a incluir), `ecosystem.config.cjs` (pm2), `crontab.txt`, `env.production.example` |
| 5 | `vercel.json` | Manter até o fim da Fase 6 (é inofensivo); depois remover |

O `x-real-ip` em `src/app/api/agendar/route.ts:28` não muda: o Caddy passa a
enviá-lo (seção 4).

## 4. Configuração na VPS

**Caddy:** acrescentar o trecho ao Caddyfile existente. A linha
`on_demand_tls` entra no bloco de opções globais que já existe.

```
{
	on_demand_tls {
		ask http://127.0.0.1:3001/api/dominios/tls
	}
}

ruphus.site, *.ruphus.site {
	tls /etc/caddy/origin-ruphus.pem /etc/caddy/origin-ruphus.key
	reverse_proxy 127.0.0.1:3001 {
		header_up X-Real-IP {http.request.header.CF-Connecting-IP}
	}
}

# domínio próprio de cliente (DNS direto na VPS, sem Cloudflare)
https:// {
	tls {
		on_demand
	}
	reverse_proxy 127.0.0.1:3001 {
		header_up X-Real-IP {remote_host}
	}
}
```

**pm2:**
- `cwd: /opt/ruphus-site/current`, `script: server.js`, `PORT=3001`,
  `HOSTNAME=127.0.0.1`, `env_file` = `/opt/ruphus-site/.env.production`.
- `pm2 save`, `pm2 startup` e `pm2-logrotate`.

**crontab** (substitui os crons do `vercel.json`):

```
*/10 * * * * curl -fs -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3001/api/cron/lembretes
0 6 * * *    curl -fs -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3001/api/cron/demo
```

Atenção: os crons da Vercel rodam em UTC. A `0 6` da Vercel equivale a 03:00
em Brasília. Conferir o fuso da VPS (`timedatectl`) e ajustar a hora.

**Segredos:**
- `/opt/ruphus-site/.env.production`, com `chmod 600`.
- Service account em `/opt/ruphus-site/secrets/firebase-adminsdk.json`, com
  `chmod 600`, referenciado por `GOOGLE_APPLICATION_CREDENTIALS`.
- Nada disso entra em release nem no git.

## 5. Variáveis de ambiente

| Variável | Na VPS |
|---|---|
| `NEXT_PUBLIC_FIREBASE_*` (6), `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | variables do repo no GitHub (entram no build) |
| `GOOGLE_APPLICATION_CREDENTIALS` | caminho do arquivo em `secrets/` |
| `SITE_URL`, `NEXT_PUBLIC_SITE_URL`, `PUBLIC_SITE_URL` | `https://www.ruphus.site` (o `NEXT_PUBLIC_*` também no build) |
| `DESATIVADOS_TOKEN` | **gerar** (`openssl rand -hex 24`): protege `/api/desativados` e `/api/dominios` |
| `CRON_SECRET` | gerar; o mesmo valor no crontab |
| `DOMINIO_IP` | `179.197.81.188` (liga o modo VPS do domínio próprio) |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `RESEND_API_KEY`, `VAPID_PRIVATE_KEY` | copiar do `.env.local` |
| `OWNER_UID`, `AGENDAMENTO_SEM_LIMITE` | do painel da Vercel ou do `.env.local` |
| `WTSFY_*` | só na fase do WhatsApp (seção 6) |
| `VERCEL_*`, `FIREBASE_SERVICE_ACCOUNT` | não vão |

Sem acesso ao painel da Vercel, os valores saem do `.env.local`. Os que
existiam só no painel (`OWNER_UID`, `CRON_SECRET`) podem ser regenerados ou
conferidos no Firebase Console (o UID do dono).

## 6. Fases

### Fase 0: decisões e acessos (você)
- [ ] Aprovar a arquitetura da seção 2 (Cloudflare laranja + Origin
      Certificate + build no GitHub Action).
- [ ] Me dar acesso SSH à VPS (chave e usuário) ou executar os comandos que eu
      preparar. Hoje não há host da VPS no `~/.ssh/config` deste Mac.
- [ ] Emitir o Origin Certificate em Cloudflare → SSL/TLS → Origin Server,
      para `ruphus.site` e `*.ruphus.site`.
- [ ] Decidir se a Vercel fica paga durante a transição, como rollback, ou
      não. Sem ela, o rollback é a release anterior na própria VPS.

### Fase 1: PR de preparação (eu)
- [ ] Mudanças da seção 3, mais `deploy/` com Caddyfile, pm2, crontab e o
      exemplo de env.
- [ ] Rodar `next build` com `output: "standalone"` local e conferir que
      `node .next/standalone/server.js` sobe com as páginas, `/s/{slug}`,
      `og.jpg` (sharp), `/api/agendar` e o login.
- [ ] Merge do PR #157 (domínio próprio) antes ou junto deste.

### Fase 2: VPS
- [ ] Node 24 LTS (conferir `node -v`), pm2 e pm2-logrotate.
- [ ] `/opt/ruphus-site/{releases,secrets}`, `.env.production` e a service
      account.
- [ ] Primeiro deploy pelo Action (ou pelo script), seguido de
      `pm2 start deploy/ecosystem.config.cjs`.
- [ ] Teste local na VPS: `curl -H "Host: www.ruphus.site" 127.0.0.1:3001/`
      deve responder 200.
- [ ] Caddy: certificado em `/etc/caddy/`, trecho da seção 4,
      `caddy validate` e então `systemctl reload caddy`. Os outros sites da
      VPS não podem ser afetados.
- [ ] crontab.

### Fase 3: validação antes do DNS
- [ ] `staging.ruphus.site` cinza → VPS. O Caddy emite um certificado normal
      para esse host com um bloco próprio, temporário.
- [ ] Adicionar `staging.ruphus.site` nos Authorized domains do Firebase Auth.
- [ ] Ponta a ponta:
  - landing;
  - login (dono, equipe por convite);
  - /admin;
  - um site `/s/{slug}` e seu `og.jpg`;
  - `/bio/{slug}`;
  - agendar (conferir o IP gravado);
  - e-mail de convite;
  - web-push;
  - cron de lembretes disparado à mão;
  - `/api/desativados` sem token deve dar 404.
- [ ] Domínio próprio: ligar um subdomínio de teste seu (A → VPS), conferir
      Verificar, o certificado emitido pelo Caddy, o redirect do
      `{slug}.ruphus.site` (simulado no staging) e Desligar.

### Fase 4: corte
- [ ] Na Cloudflare: `ruphus.site`, `www` e `*` com A para 179.197.81.188,
      **laranja**; SSL mode **Full (Strict)**.
- [ ] Cache Rules só para `/s/*`, `*/og.jpg` e `/_next/static/*`. O restante
      fica dinâmico, que é o padrão.
- [ ] Monitorar: `pm2 logs`, erros 5xx no Caddy, cron das 10 em 10 min, login.
- [ ] Remover o bloco de staging e o host dele no Firebase Auth.

### Fase 5: estabilização
- [ ] Uma semana de observação. Rollback: `current` → release anterior e
      `pm2 reload`; ou A records de volta para a Vercel, se ela estiver paga.
- [ ] Remover `vercel.json` e a ligação do repo com a Vercel; pausar ou
      apagar o projeto lá.
- [ ] Atualizar `docs/` e o CHANGELOG.

### Fase 6: WhatsApp no gateway novo (separada, depois do corte)
O detalhamento da versão anterior deste plano continua válido. **Executada em
2026-10-31** (plataforma renomeada para *atendys* entre o plano e a execução):
- [x] contrato novo em `src/lib/atendys.ts` (ex-`src/lib/wtsfy.ts`, removido);
- [x] tenant atendys por negócio, provisionado automaticamente ao conectar
      (`conectarNegocio` em `whatsapp.server.ts`: garante tenant, rotaciona o
      segredo do webhook, cria a instância `{slug}-main` — idempotente);
- [x] evento `message.received` na plataforma, para o "CONFIRMADO" do dono
      (inscrito MESSAGES_UPSERT; payload `{instance, messageId, phone, type, text}`);
- [x] webhook `/api/webhooks/atendys` (assinatura por tenant, segredo gravado no
      doc do negócio; a rota antiga `/api/webhooks/wtsfy` responde 410);
- [x] envs `ATENDYS_BASE_URL`/`ATENDYS_ADMIN_KEY` no `.env.local` da VPS
      (chamada interna `http://127.0.0.1:3002`).
- [ ] Pendente do dono: deploy deste código (action/PR) + conectar um número de
      teste de verdade no painel e responder `CONFIRMADO` ponta a ponta.

Fica separado porque hoje nada disso funciona em produção, então não trava a
volta do site.

## 7. Riscos

| Risco | Mitigação |
|---|---|
| Build pesado derruba o WTSFY | Build no GitHub Action; a VPS só recebe a release pronta |
| `sharp` incompatível | Build em linux-x64 (Action ubuntu); validar `og.jpg` na Fase 3 |
| `/api/desativados` ou `/api/dominios` públicos | Mudança 2 da seção 3 e `DESATIVADOS_TOKEN` |
| IP errado no agendamento | `header_up X-Real-IP` por bloco (Cloudflare vs. domínio direto) |
| Reload do Caddy quebra outros sites | `caddy validate` antes; trecho isolado; `reload`, nunca `restart` |
| On-demand TLS abusado | O `ask` só aprova domínios gravados em algum tenant e só responde a 127.0.0.1 |
| Cron esquecido, lembretes param | Crontab na Fase 2 e disparo manual na Fase 3 |
| Disco cheio | pm2-logrotate; manter só as 3 últimas releases |
| 1 vCPU sob pico | Cache da Cloudflare em `/s/*` e `og.jpg`; acompanhar `pm2 monit` |

## 8. Fora da VPS
- Os scripts de operação (`scripts/*.mts`: gerar-sites, vitrine, coleta etc.)
  continuam rodando deste Mac contra o mesmo Firebase. Não precisam ir para o
  servidor.
- `dblocal/`, `docs/*.xlsx` e `graphify-out/` nunca sobem: têm dados pessoais
  ou são locais.
