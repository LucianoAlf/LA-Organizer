#!/bin/bash
# restaurar-guardas.sh — reinstala os scripts de guarda a partir do snapshot do preflight.
#
# POR QUE EXISTE (laudo v2, bloqueador 5): o rollback por `git revert` remove os scripts da
# arvore, entao o `git reset --hard` seguinte os APAGA do disco da VPS — e leva junto backup,
# sentinela, varredura e alerta. O pacote v2 admitia isso numa nota e parava ali. Admitir um
# buraco nao e o mesmo que fechar. Este script e a sequencia segura que faltava.
#
# Ele NAO consulta git: le o tarball que o preflight guardou ANTES do reset, restaura os
# arquivos e reaplica os modos. Assim funciona mesmo com a arvore revertida, que e
# exatamente o cenario em que ele e necessario.
#
# Uso:  ./restaurar-guardas.sh              -> usa o snapshot mais recente
#       ./restaurar-guardas.sh <tarball>    -> usa um especifico
#       ./restaurar-guardas.sh --listar
#
# SEQUENCIA DE ROLLBACK COMPLETA (a ordem importa):
#   1. git revert --no-commit <commits> && git commit && git push origin main
#   2. ssh tom 'cd /opt/LA-Organizer && git reset --hard origin/main'
#   3. ssh tom '/opt/backups/la-organizer/guardas/restaurar-guardas.sh'   <- ESTE
#   4. ssh tom 'cd /opt/LA-Organizer && ./scripts/check-backup.sh'        <- confirma
#   5. ssh tom 'pm2 restart tom'
# Pular o passo 3 deixa a VPS rodando sem nenhum guarda, e calada sobre isso.

set -uo pipefail
DEST=${GUARDAS_DIR:-/opt/backups/la-organizer/guardas}
RAIZ=${GUARDAS_RAIZ:-/opt/LA-Organizer}

if [ "${1:-}" = "--listar" ]; then
  ls -la "$DEST"/guardas-*.tar.gz 2>/dev/null || echo "nenhum snapshot em $DEST"
  exit 0
fi

TAR=${1:-}
if [ -z "$TAR" ]; then
  TAR=$(find "$DEST" -name 'guardas-*.tar.gz' -type f 2>/dev/null | sort | tail -1)
fi
[ -n "$TAR" ] && [ -s "$TAR" ] || { echo "FATAL: nenhum snapshot utilizavel em $DEST" >&2; exit 1; }
# Integridade ANTES de extrair: este script pega sempre o mais recente, entao um tarball
# truncado seria escolhido de preferencia ao bom. Rollback nao e hora de descobrir isso.
tar -tzf "$TAR" >/dev/null 2>&1 || { echo "FATAL: $TAR esta corrompido — use --listar e escolha outro" >&2; exit 1; }
echo "== restaurando guardas de $TAR =="
echo "   ($(tar -tzf "$TAR" 2>/dev/null | wc -l) arquivos, de $(stat -c %y "$TAR" | cut -c1-19))"

cd "$RAIZ" || { echo "FATAL: $RAIZ inacessivel" >&2; exit 2; }
if ! tar -xzf "$TAR" -C "$RAIZ" 2>/dev/null; then
  echo "FATAL: extracao falhou — guardas NAO restaurados" >&2; exit 1
fi

# O tar preserva modo, mas nao confio nisso sozinho: quem manda no modo e o pos-deploy-modos,
# que e fail-closed e confere alvo por alvo.
if [ -x "$RAIZ/scripts/pos-deploy-modos.sh" ]; then
  "$RAIZ/scripts/pos-deploy-modos.sh" || { echo "FATAL: modos nao ficaram corretos apos restaurar" >&2; exit 1; }
else
  chmod 0750 "$RAIZ"/scripts/pos-deploy-modos.sh 2>/dev/null
  "$RAIZ/scripts/pos-deploy-modos.sh" || { echo "FATAL: pos-deploy-modos indisponivel apos restaurar" >&2; exit 1; }
fi

# Prova de vida: sem isto o script diria "restaurado" sobre arquivos que nao rodam.
FALTOU=0
for s in alertar backup-db check-backup conter-permissoes pos-deploy-modos; do
  if [ -x "$RAIZ/scripts/$s.sh" ]; then printf '  ok      %s.sh\n' "$s"
  else printf '  FALTOU  %s.sh\n' "$s"; FALTOU=$((FALTOU+1)); fi
done
[ "$FALTOU" -eq 0 ] || { echo "FATAL: $FALTOU guarda(s) ainda ausente(s)/sem +x" >&2; exit 1; }

echo "== guardas restaurados e executaveis. Rode check-backup.sh antes do restart. =="
