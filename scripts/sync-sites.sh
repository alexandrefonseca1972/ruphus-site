#!/bin/sh
# Copia as pastas de site (../sites) para public/s, que é o que o subdomínio serve.
# previa.jpg fica de fora: é a miniatura do catálogo, não do site.
set -e
cd "$(dirname "$0")/.."
ls ../sites | grep -Ev '^(_|\.|login|agendar|api|catalogo|privacidade)' \
  | while read -r d; do [ -f "../sites/$d/index.html" ] && echo "$d/"; done > /tmp/sync-sites.txt
rsync -a --delete --exclude previa.jpg --files-from=/tmp/sync-sites.txt ../sites/ public/s/
echo "$(ls public/s | wc -l) sites em public/s"
