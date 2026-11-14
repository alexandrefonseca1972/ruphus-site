#!/bin/sh
# Fim de cada turno do Claude (hook Stop): se algum arquivo de código mudou depois do grafo,
# atualiza o grafo em segundo plano. É só AST (`graphify update`): não usa LLM nem custa token.
# O commit, o checkout e o merge já atualizam pelos hooks do git (`graphify hook install`); este
# cobre o trabalho ainda sem commit. Nunca falha o turno: qualquer problema, sai calado.
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
G=graphify-out/graph.json
TRAVA=graphify-out/.atualizando
[ -f "$G" ] || exit 0
command -v graphify >/dev/null 2>&1 || exit 0

# alterado ou novo (fora do .gitignore) e mais recente que o grafo
mudou=$(git ls-files -m -o --exclude-standard 2>/dev/null | grep -E '\.(ts|tsx|mts|mjs|js|sh|css)$' | while IFS= read -r f; do
  [ "$f" -nt "$G" ] && { echo 1; break; }
done)
[ -n "$mudou" ] || exit 0

# um por vez; trava esquecida (processo morto) vale 10 minutos
find "$TRAVA" -maxdepth 0 -mmin +10 -exec rmdir {} \; 2>/dev/null
mkdir "$TRAVA" 2>/dev/null || exit 0
nohup sh -c 'graphify update . > graphify-out/.atualizacao.log 2>&1; rmdir graphify-out/.atualizando' >/dev/null 2>&1 &
exit 0
