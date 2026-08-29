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

# Caminhos sobrescreviveis SO para teste (laudo v2.5, bloqueador 9): sem isso nao havia como
# exercitar a instalacao sem mexer no crontab REAL do root -- e o resultado disso foi que o
# quinto cron so existia porque eu o instalei a mao, fora do caminho canonico. Em producao
# os defaults valem e nada muda.
BKP_DIR=${PATCH_CRONTAB_BKP_DIR:-/opt/backups/la-organizer/crontab}
SCRIPTS=${PATCH_CRONTAB_SCRIPTS:-/opt/LA-Organizer/scripts}
LOG=${PATCH_CRONTAB_LOG:-/opt/LA-Organizer/logs/backup.log}
CRONTAB=${PATCH_CRONTAB_CMD:-crontab}

APLICAR=0; REVERTER=0
case "${1:-}" in
  --aplicar)  APLICAR=1 ;;
  --reverter) REVERTER=1 ;;
  "")         ;;
  *) echo "uso: $0 [--aplicar|--reverter]" >&2; exit 2 ;;
esac

ATUAL=$("$CRONTAB" -l 2>/dev/null || true)

if [ "$REVERTER" = 1 ]; then
  ULTIMO=$(find "$BKP_DIR" -name 'crontab-*.bak' -type f 2>/dev/null | sort | tail -1)
  [ -n "$ULTIMO" ] || { echo "sem backup de crontab para reverter" >&2; exit 1; }
  "$CRONTAB" "$ULTIMO"
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
  | grep -v '# tom-varrer-permissoes$'   | grep -v '# tom-restore-drill$' )

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
  "*/15 * * * * $SCRIPTS/conter-permissoes.sh --varrer >>$LOG 2>&1 # tom-varrer-permissoes"   "30 4 * * 0 $SCRIPTS/restore-drill.sh \$(ls -t /opt/backups/la-organizer/db/*/*.dump 2>/dev/null | head -1) >>$LOG 2>&1 # tom-restore-drill")

echo "=== DIFF (- remove / + adiciona) ==="
diff <(printf '%s\n' "$ATUAL") <(printf '%s\n' "$NOVO") || true

if [ "$APLICAR" != 1 ]; then
  echo "=== DRY-RUN: crontab NAO alterado. rode com --aplicar apos autorizacao do Alf ==="
  exit 0
fi

# Pré-condição: TODO script agendado precisa existir e ser executável ANTES de agendar.
# Faltava `conter-permissoes.sh` nesta lista (laudo v2): a varredura era instalada no cron
# sem ninguem conferir se o arquivo era sequer executavel — e depois de um `git reset --hard`
# ela chega 0644. Agendar script sem +x e agendar silencio.
for s in backup-db.sh backup-secrets.sh check-backup.sh conter-permissoes.sh restore-drill.sh; do
  [ -x "$SCRIPTS/$s" ] || { echo "FATAL: $SCRIPTS/$s ausente ou nao executavel" >&2; exit 1; }
done
# O alerta nao vai no cron, mas os dois agendados dependem dele para avisar.
[ -x "$SCRIPTS/alertar.sh" ] || echo "AVISO: $SCRIPTS/alertar.sh sem +x — os crons vao detectar mas NAO avisar" >&2

install -d -m 0700 "$BKP_DIR"
printf '%s\n' "$ATUAL" > "$BKP_DIR/crontab-$(date -u +%Y%m%dT%H%M%SZ).bak"
chmod 0600 "$BKP_DIR"/crontab-*.bak

printf '%s\n' "$NOVO" | "$CRONTAB" -

# Conferir de verdade: antes o `grep -E '# tom-(backup|check)'` nem casava a linha da
# varredura (marcador `# tom-varrer-permissoes`) e, sendo so um `grep` de exibicao, nao
# reprovava nada. Agora cada marcador esperado e exigido de volta do crontab instalado.
echo "=== crontab aplicado. conferindo: ==="
INSTALADO=$("$CRONTAB" -l 2>/dev/null)
FALTOU=0
for m in tom-backup-db tom-backup-secrets tom-check-backup tom-varrer-permissoes tom-restore-drill; do
  if printf '%s\n' "$INSTALADO" | grep -q -- "# $m\$"; then
    printf '  ok      %s\n' "$m"
  else
    printf '  FALTOU  %s\n' "$m"; FALTOU=$((FALTOU+1))
  fi
done
if [ "$FALTOU" -gt 0 ]; then
  echo "FATAL: $FALTOU linha(s) esperada(s) nao entraram no crontab — restaure com --reverter" >&2
  exit 1
fi
echo "=== 5/5 linhas confirmadas no crontab instalado ==="
