#!/bin/bash
# Sprint 22.23 — push + auto-deploy unificado.
# Substitui o `git push origin main` direto que vinha sendo usado nos workflows
# de deploy. Detecta automaticamente se precisa restart do TOM na VPS (so quando
# arquivos em src/, skills/, migrations/ mudaram — alteracoes em web/ vao via
# Vercel auto-deploy e nao tocam a VPS).
#
# Uso: bash scripts/push-and-deploy.sh /path/to/clone
#
# Onde /path/to/clone eh o diretorio temporario com o repo clonado e commit
# pronto. Tipico: /tmp/deploy-sprint22-23

CLONE_DIR="$1"
if [ -z "$CLONE_DIR" ]; then
  echo "Uso: bash scripts/push-and-deploy.sh /path/to/clone"
  exit 1
fi
cd "$CLONE_DIR" || exit 1
git push origin main
echo "Push OK. Vercel auto-deploy em ~2min."
if git diff --name-only HEAD~1 | grep -qE '^(src/|skills/|migrations/)'; then
  echo "Detectou mudanca no TOM. Deploy VPS..."
  ssh tom "cd /opt/LA-Organizer && git pull origin main && pm2 restart tom"
  echo "VPS atualizada."
else
  echo "So web/ mudou. VPS nao precisa de restart."
fi
