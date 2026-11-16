#!/bin/sh
# Publica as pastas de site (../sites) no Storage, de onde o subdomínio as serve:
# não precisa de deploy. As capturas de ../sites/_p (miniaturas do painel) vão junto.
# previa.jpg, *.py e as páginas do app antigo (login, catalogo…) ficam de fora: ver scripts/site.mts.
set -e
cd "$(dirname "$0")/.."
npm run -s site -- publicar-todos ../sites --aplicar
# assets/ é compartilhada entre os sites (../assets/... nas páginas) e ainda vai no deploy
# beleza/, gerado/ e saude/ são do gerador de sites, não da fábrica: o --delete não pode levá-las.
# pet/ ficou na fábrica: o nicho saiu em 15/11/2026 e o banco de fotos não volta para o deploy
rsync -a --delete --exclude beleza --exclude gerado --exclude saude --exclude pet ../sites/assets/ public/s/assets/
echo "$(find public/s/assets -type f | wc -l) arquivos em public/s/assets (publique para o assets ir ao ar)"
