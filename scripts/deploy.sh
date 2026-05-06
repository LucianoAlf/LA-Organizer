#!/bin/bash
# Deploy script — Claude Code usa isso para deployar na VPS
# Chave SSH restrita: só executa git pull + pm2 restart tom

VPS_HOST="89.116.73.186"
VPS_USER="root"
KEY_FILE="$HOME/.ssh/claude_code_deploy"

# Verificar se a chave existe
if [ ! -f "$KEY_FILE" ]; then
  echo "ERRO: Chave SSH não encontrada em $KEY_FILE"
  echo "Execute: setup-vps-key.sh antes de deployar"
  exit 1
fi

echo "Deployando na VPS..."
ssh -i "$KEY_FILE" -o StrictHostKeyChecking=no "$VPS_USER@$VPS_HOST"
echo "Deploy concluído."
