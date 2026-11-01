#!/usr/bin/env bash
# Vigia do ruphus-site (crontab do root, a cada 2 min). O systemd já reinicia o app quando
# ele cai; isto cobre o app que fica no ar mas parado (travado, sem responder). Duas falhas
# seguidas reiniciam: uma sozinha pode ser o reinício de um deploy.
# Instalar: crontab do root com
#   */2 * * * * /opt/ruphus-site/vigia.sh
set -u
MARCA=/run/ruphus-vigia.falhas
if curl -fsS -m 15 -o /dev/null -H "Host: www.ruphus.site" http://localhost:3001/api/versao; then
  rm -f "$MARCA"
  exit 0
fi
falhas=$(( $(cat "$MARCA" 2>/dev/null || echo 0) + 1 ))
echo "$falhas" > "$MARCA"
logger -t ruphus-vigia "app sem resposta ($falhas seguida(s))"
if [ "$falhas" -ge 2 ]; then
  logger -t ruphus-vigia "reiniciando ruphus-site"
  systemctl restart ruphus-site
  rm -f "$MARCA"
fi
