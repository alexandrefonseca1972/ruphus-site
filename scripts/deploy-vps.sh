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

echo "enviando $(git rev-parse --short HEAD)…"
git archive --format=tar HEAD | ssh "$VPS" "rm -rf $BASE/app-new && mkdir $BASE/app-new && tar -x -C $BASE/app-new"

ssh "$VPS" SHA="$SHA" BASE="$BASE" bash -s <<'REMOTO'
set -euo pipefail
cd "$BASE"
cp app/.env.local app-new/.env.local
chown -R ruphus:ruphus app-new
sudo -u ruphus env SHA="$SHA" bash -c 'cd app-new && npm ci --no-audit --no-fund --loglevel=error && GIT_COMMIT_SHA="$SHA" NEXT_TELEMETRY_DISABLED=1 npm run build'
rm -rf app-prev && mv app app-prev && mv app-new app
systemctl restart ruphus-site
for i in $(seq 20); do
  curl -fsS -o /dev/null -H "Host: www.ruphus.site" http://127.0.0.1:3001/ && { echo "no ar: $(cut -c1-7 <<<"$SHA")"; exit 0; }
  sleep 2
done
echo "o app não respondeu; veja: journalctl -u ruphus-site -n 50" >&2
exit 1
REMOTO
