#!/usr/bin/env bash
# Publica o commit atual (HEAD, sem o que não foi commitado) na VPS: o código vai para
# /opt/ruphus-site/app-new, o build roda lá (o sharp precisa ser o de Linux), e a pasta
# troca de lugar com a app. A anterior fica em app-prev.
#
# Se o app novo não responder em 40 s, o script volta sozinho para o anterior (o novo fica em app-ruim).
# Voltar atrás à mão: ssh root@VPS 'cd /opt/ruphus-site && rm -rf app-ruim && mv app app-ruim && mv app-prev app && systemctl restart ruphus-site'
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
