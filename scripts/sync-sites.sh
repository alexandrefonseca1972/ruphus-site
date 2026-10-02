#!/bin/sh
# Publica as pastas de site (../sites) no Storage, de onde o subdomínio as serve:
# não precisa de deploy. As capturas de ../sites/_p (miniaturas do painel) vão junto.
# previa.jpg, *.py e as páginas do app antigo (login, catalogo…) ficam de fora: ver scripts/site.mts.
set -e
cd "$(dirname "$0")/.."
npm run -s site -- publicar-todos ../sites --aplicar
# assets/ é compartilhada entre os sites (../assets/... nas páginas) e ainda vai no deploy
# beleza/, gerado/ e os bancos dos nichos novos são do gerador de sites, não da fábrica: o --delete não pode levá-las
rsync -a --delete --exclude beleza --exclude gerado --exclude saude --exclude aulas --exclude fitness --exclude automotivo ../sites/assets/ public/s/assets/
echo "$(find public/s/assets -type f | wc -l) arquivos em public/s/assets (publique para o assets ir ao ar)"
