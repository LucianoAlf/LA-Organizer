#!/bin/bash
# P0-2 v2 — Patch IDEMPOTENTE do crontab do root. DRY-RUN por padrão.
#
# Idempotente por marcador de comentário: cada linha nossa termina em `# <TAG>`.
# Rodar N vezes deixa exatamente o mesmo resultado que rodar 1 vez.
# Não mexe em NENHUMA linha de outro sistema (hermes, monitor-agentes, ig-token, la-os, etc).
#
# Uso:  ./patch-crontab.sh            -> mostra o diff, não altera nada
#       ./patch-crontab.sh --aplicar  -> instala (só após GATE HUMANO A)
#       ./patch-crontab.sh --reverter -> volta ao estado anterior a partir do backup

set -euo pipefail

BKP_DIR=/opt/backups/la-organizer/crontab
SCRIPTS=/opt/LA-Organizer/scripts
LOG=/opt/LA-Organizer/logs/backup.log

APLICAR=0; REVERTER=0
case "${1:-}" in
  --aplicar)  APLICAR=1 ;;
  --reverter) REVERTER=1 ;;
  "")         ;;
  *) echo "uso: $0 [--aplicar|--reverter]" >&2; exit 2 ;;
esac

ATUAL=$(crontab -l 2>/dev/null || true)

if [ "$REVERTER" = 1 ]; then
  ULTIMO=$(find "$BKP_DIR" -name 'crontab-*.bak' -type f 2>/dev/null | sort | tail -1)
  [ -n "$ULTIMO" ] || { echo "sem backup de crontab para reverter" >&2; exit 1; }
  crontab "$ULTIMO"
  echo "crontab revertido a partir de $ULTIMO"; exit 0
fi

# 1) remove a linha QUEBRADA (aponta para script inexistente desde >= 20/08)
#    e a linha antiga do backup-secrets (o script sai de dentro do diretório de backup
#    e passa a morar versionado em scripts/).
NOVO=$(printf '%s\n' "$ATUAL" \
  | grep -v '^0 6 \* \* \* /opt/LA-Organizer/backup\.sh' \
  | grep -v '^0 6 \* \* \* /opt/backups/la-organizer/backup-secrets\.sh' \
  | grep -v '# tom-backup-db$'      \
  | grep -v '# tom-backup-secrets$' \
  | grep -v '# tom-check-backup$'   \
  | grep -v '# tom-varrer-permissoes$' )

# 2) acrescenta as linhas novas, sempre com marcador (o grep -v acima já garante
#    que não duplicam)
# A varredura de permissoes NAO e opcional: medido em 28/08, o CLI do Claude cria ~27
# arquivos/hora e as sessoes nascem 644 (umask 022 do root). Dois minutos depois da
# contencao ja havia arquivo reexposto. Sem esta linha, a contencao decai sozinha.
# A correcao de RAIZ e o umask do processo que spawna o CLI — ainda nao decidida.
NOVO=$(printf '%s\n%s\n%s\n%s\n%s\n' "$NOVO" \
  "0 6 * * * $SCRIPTS/backup-db.sh >>$LOG 2>&1 # tom-backup-db" \
  "15 6 * * * $SCRIPTS/backup-secrets.sh >>$LOG 2>&1 # tom-backup-secrets" \
  "7 * * * * $SCRIPTS/check-backup.sh >>$LOG 2>&1 # tom-check-backup" \
  "*/15 * * * * $SCRIPTS/conter-permissoes.sh --varrer >>$LOG 2>&1 # tom-varrer-permissoes")

echo "=== DIFF (- remove / + adiciona) ==="
diff <(printf '%s\n' "$ATUAL") <(printf '%s\n' "$NOVO") || true

if [ "$APLICAR" != 1 ]; then
  echo "=== DRY-RUN: crontab NAO alterado. rode com --aplicar apos autorizacao do Alf ==="
  exit 0
fi

# Pré-condição: os três scripts precisam existir e ser executáveis ANTES de agendar.
for s in backup-db.sh backup-secrets.sh check-backup.sh; do
  [ -x "$SCRIPTS/$s" ] || { echo "FATAL: $SCRIPTS/$s ausente ou nao executavel" >&2; exit 1; }
done

install -d -m 0700 "$BKP_DIR"
printf '%s\n' "$ATUAL" > "$BKP_DIR/crontab-$(date -u +%Y%m%dT%H%M%SZ).bak"
chmod 0600 "$BKP_DIR"/crontab-*.bak

printf '%s\n' "$NOVO" | crontab -
echo "=== crontab aplicado. conferindo: ==="
crontab -l | grep -E '# tom-(backup|check)'
