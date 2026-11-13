#!/usr/bin/env bash
# Salva um retrato da sessão antes de /clear (SessionEnd) e da compactação (PreCompact).
# Lê o JSON do hook no stdin. Nunca falha: um hook não pode travar o /clear.
set -uo pipefail

entrada="$(cat 2>/dev/null || true)"
evento="$(jq -r '.hook_event_name // "manual"' <<<"$entrada" 2>/dev/null || echo manual)"
motivo="$(jq -r '.reason // .trigger // ""' <<<"$entrada" 2>/dev/null || echo "")"
transcript="$(jq -r '.transcript_path // ""' <<<"$entrada" 2>/dev/null || echo "")"

# SessionEnd por outro motivo (logout, sair do prompt) não precisa de handoff.
if [[ "$evento" == "SessionEnd" && "$motivo" != "clear" ]]; then exit 0; fi

raiz="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$raiz" || exit 0
plano="docs/plano-prospeccao-whatsapp-ia.md"
log="docs/prospeccao/handoff.md"
destino=".omc/handoffs"
mkdir -p "$destino" || exit 0
arquivo="$destino/prospeccao-$(date +%Y%m%d-%H%M%S).md"

{
  echo "# Handoff automático: $(date '+%Y-%m-%d %H:%M') ($evento ${motivo})"
  echo
  echo "## Git"
  echo "- Branch: $(git branch --show-current 2>/dev/null)"
  echo '```'
  git status --short 2>/dev/null | head -40
  echo '```'
  echo "Últimos commits:"
  git log --oneline -5 2>/dev/null | sed 's/^/- /'
  echo

  if [[ -f "$plano" ]]; then
    echo "## Plano ($plano)"
    proxima="$(grep -n -m1 -E '^- \[ \]' "$plano" 2>/dev/null)"
    fase="$(head -n "${proxima%%:*}" "$plano" 2>/dev/null | grep -E '^### Fase' | tail -1)"
    echo "- Fase atual: ${fase#\#\#\# }"
    echo "- Próxima tarefa (linha ${proxima%%:*}): ${proxima#*:}"
    echo "- Progresso por fase:"
    awk '/^### Fase/{if(n)printf "  - %s: %d/%d\n",f,c,n; f=substr($0,5); n=0; c=0}
         /^- \[[ x]\]/{n++} /^- \[x\]/{c++}
         END{if(n)printf "  - %s: %d/%d\n",f,c,n}' "$plano" 2>/dev/null
    echo
  fi

  if [[ -f "$log" ]]; then
    echo "## Últimas linhas de $log"
    tail -20 "$log"
    echo
  fi

  if [[ -n "$transcript" && -f "$transcript" ]]; then
    echo "## Últimas mensagens do assistente"
    jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="text") | .text' "$transcript" 2>/dev/null \
      | tail -c 3000
    echo
  fi

  if [[ -f .omc/state/ultimo-teste.log ]]; then
    echo "## Último log de teste (falhas)"
    grep -iE 'fail|erro|error|✗' .omc/state/ultimo-teste.log | tail -15
  fi
} 2>/dev/null \
  | grep -viE '(api[_-]?key|secret|token|senha|password|\bpin\b|BEGIN [A-Z ]*PRIVATE)' >"$arquivo"

cp "$arquivo" "$destino/prospeccao-ultimo.md" 2>/dev/null
# Mantém só os 20 retratos mais recentes.
ls -1t "$destino"/prospeccao-2*.md 2>/dev/null | tail -n +21 | xargs rm -f 2>/dev/null
exit 0
