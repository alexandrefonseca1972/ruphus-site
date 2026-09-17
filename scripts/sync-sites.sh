#!/bin/sh
# Copia as pastas de site (../sites) para public/s, que é o que o subdomínio serve.
# previa.jpg fica de fora: é a miniatura do catálogo, não do site.
# -r é obrigatório: --files-from desliga a recursão e as subpastas (img/) viriam vazias.
set -e
cd "$(dirname "$0")/.."
ls ../sites | grep -Ev '^(_|\.|login|agendar|api|catalogo|privacidade|assets)$' \
  | while read -r d; do [ -f "../sites/$d/index.html" ] && echo "$d/"; done > /tmp/sync-sites.txt
rsync -a -r --delete --exclude previa.jpg --files-from=/tmp/sync-sites.txt ../sites/ public/s/
# assets/ é compartilhada entre os sites (../assets/... nas páginas)
rsync -a --delete ../sites/assets/ public/s/assets/
echo "$(ls public/s | wc -l) pastas em public/s, $(find public/s -type f | wc -l) arquivos"
