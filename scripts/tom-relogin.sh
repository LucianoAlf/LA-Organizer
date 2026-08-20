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

# 2.5) PROPAGA pros HOMEs dos workers do pool (paralelismo CLI).
# RELOGIN-SO-METADE (20/08): cada worker tem .credentials.json PRÓPRIO (inode separado, não
# link). O script só re-logava o HOME canônico, então depois de um re-login "bem-sucedido" o
# pool continuava 401 e o TOM seguia degradado — foi o que aconteceu no apagão de 19->20/08
# (148 keep-alive FALHOU). O canário do canônico passava e escondia isso.
for W in /opt/LA-Organizer/.claude-tom-w*; do
  [ -d "$W/.claude" ] || continue
  [ -f "$W/.claude/.credentials.json" ] && cp -a "$W/.claude/.credentials.json" "$W/.claude/.credentials.json.bak.$(date +%s)"
  install -m 600 "$CRED" "$W/.claude/.credentials.json"
  echo "🔗 propagado: $W"
done

# 3) canário REAL — a verdade (auth status MENTE). Canônico E cada worker: o pool é quem
# atende de verdade, então um worker 401 é apagão mesmo com o canônico verde.
for W in /opt/LA-Organizer/.claude-tom-w*; do
  [ -d "$W/.claude" ] || continue
  if ! HOME="$W" timeout 60 claude -p ok >/dev/null 2>&1; then
    echo "❌ Canário FALHOU no worker $W — pool seguiria degradado. NÃO carimbei." >&2
    exit 1
  fi
  echo "✅ canário ok: $W"
done

if timeout 60 claude -p ok >/dev/null 2>&1; then
  date -Iseconds > "$STAMP"
  echo "✅ Re-login verificado (canário ok). Lembrete zerado: $(cat "$STAMP")"
else
  echo "❌ Canário falhou após o login — NÃO carimbei. Rode 'HOME=$HOME claude -p ok' e veja o erro." >&2
  exit 1
fi
