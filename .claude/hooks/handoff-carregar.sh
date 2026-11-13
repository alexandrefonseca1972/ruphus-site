#!/usr/bin/env bash
# SessionStart (clear|compact|resume): injeta o último handoff e as regras do Haiku como contexto.
set -uo pipefail

raiz="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$raiz" || exit 0
ultimo=".omc/handoffs/prospeccao-ultimo.md"
regras="docs/prospeccao/handoff.md"
[[ -f "$ultimo" || -f "$regras" ]] || exit 0

contexto="$(
  echo "Contexto restaurado do projeto de prospecção (plano: docs/plano-prospeccao-whatsapp-ia.md)."
  echo
  # Regras = tudo até a linha "## Registro" do handoff manual.
  [[ -f "$regras" ]] && sed '/^## Registro/,$d' "$regras"
  echo
  [[ -f "$ultimo" ]] && cat "$ultimo"
)"

jq -n --arg c "${contexto:0:8000}" \
  '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $c}}'
exit 0
