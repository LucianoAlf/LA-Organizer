#!/bin/bash
# DESFAZER da contenção de permissões — restaura os modos EXATOS salvos antes da mudança.
#
# Não é "chmod de volta no chute": lê o arquivo `%m %p` gerado antes da contenção e devolve
# cada caminho ao modo que tinha. Só toca caminhos que estão no arquivo E existem hoje.
#
# Uso:  ./restaurar-modos.sh <arquivo-de-modos>            (dry-run)
#       ./restaurar-modos.sh <arquivo-de-modos> --aplicar
set -uo pipefail
ARQ=${1:?uso: $0 <arquivo-de-modos> [--aplicar]}
APLICAR=0; [ "${2:-}" = "--aplicar" ] && APLICAR=1
[ -r "$ARQ" ] || { echo "arquivo de modos ilegivel: $ARQ" >&2; exit 2; }

RAIZES="/opt/backups/la-organizer /opt/LA-Organizer/.claude-tom /opt/LA-Organizer/.claude-tom-w0 /opt/LA-Organizer/.claude-tom-w1"
TOTAL=0; APLICADOS=0; DIVERGENTES=0; SUMIRAM=0; FORA=0; ERROS=0

while read -r modo caminho; do
  [ -n "${caminho:-}" ] || continue
  TOTAL=$((TOTAL+1))
  # trava de escopo: so caminhos dentro das 4 raizes conhecidas
  dentro=0
  for r in $RAIZES; do case "$caminho" in "$r"|"$r"/*) dentro=1; break;; esac; done
  [ "$dentro" = 1 ] || { FORA=$((FORA+1)); continue; }
  [ -e "$caminho" ] || { SUMIRAM=$((SUMIRAM+1)); continue; }
  atual=$(stat -c%a "$caminho" 2>/dev/null) || { ERROS=$((ERROS+1)); continue; }
  [ "$atual" = "$modo" ] && continue
  DIVERGENTES=$((DIVERGENTES+1))
  if [ "$APLICAR" = 1 ]; then
    if chmod "$modo" "$caminho" 2>/dev/null; then APLICADOS=$((APLICADOS+1)); else ERROS=$((ERROS+1)); fi
  fi
done < "$ARQ"

echo "lidos=$TOTAL  divergentes=$DIVERGENTES  restaurados=$APLICADOS  sumiram=$SUMIRAM  fora-de-escopo=$FORA  erros=$ERROS"
[ "$APLICAR" = 1 ] || echo "== DRY-RUN: nada alterado. use --aplicar para restaurar =="
[ "$ERROS" -eq 0 ] || exit 1
