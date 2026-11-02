#!/usr/bin/env bash
# Publica o commit atual (HEAD, sem o que não foi commitado) na VPS: o código vai para
# /opt/ruphus-site/app-new, o build roda lá (o sharp precisa ser o de Linux), e a pasta
# troca de lugar com a app. A anterior fica em app-prev.
#
# Voltar atrás: ssh root@VPS 'cd /opt/ruphus-site && mv app app-ruim && mv app-prev app && systemctl restart ruphus-site'
set -euo pipefail
VPS=${VPS:-root@179.197.81.188}
BASE=/opt/ruphus-site
SHA=$(git rev-parse HEAD)

# Um deploy por vez: dois ao mesmo tempo apagam o app-new um do outro (e o segundo
# troca a pasta no meio do build do primeiro). A trava é um diretório (mkdir é atômico);
# deploy que morreu no meio deixa a trava: apague /opt/ruphus-site/.deploy.trava à mão.
ssh "$VPS" "mkdir $BASE/.deploy.trava 2>/dev/null" || { echo "outro deploy em andamento na VPS (ou trava velha em $BASE/.deploy.trava)" >&2; exit 1; }
trap 'ssh "$VPS" "rmdir $BASE/.deploy.trava" 2>/dev/null' EXIT

echo "enviando $(git rev-parse --short HEAD)…"
git archive --format=tar HEAD | ssh "$VPS" "rm -rf $BASE/app-new && mkdir $BASE/app-new && tar -x -C $BASE/app-new"

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
