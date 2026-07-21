#!/usr/bin/env bash
# Re-login turnkey e auto-verificável do Claude CLI do TOM.
# Faz backup, loga (paste-back no TTY), verifica com canário REAL (não confia no
# "Login successful" da tela) e só então carimba o marker que zera o lembrete.
set -euo pipefail

export HOME=/opt/LA-Organizer/.claude-tom
CRED="$HOME/.claude/.credentials.json"
STAMP="$HOME/.last-relogin"

# 1) backup das credenciais atuais (se existirem)
if [ -f "$CRED" ]; then
  cp -a "$CRED" "$CRED.bak.$(date +%s)"
  echo "🗂️  backup: $CRED.bak.*"
fi

# 2) login interativo (imprime URL -> autoriza no browser -> cola o código aqui)
claude auth login --claudeai

# 3) canário REAL — a verdade (auth status MENTE)
if timeout 60 claude -p ok >/dev/null 2>&1; then
  date -Iseconds > "$STAMP"
  echo "✅ Re-login verificado (canário ok). Lembrete zerado: $(cat "$STAMP")"
else
  echo "❌ Canário falhou após o login — NÃO carimbei. Rode 'HOME=$HOME claude -p ok' e veja o erro." >&2
  exit 1
fi
