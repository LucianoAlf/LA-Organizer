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

# LEITURA FAIL-CLOSED (laudo v2.6, bloqueador 2). Era `ATUAL=$(crontab -l 2>/dev/null || true)`:
# QUALQUER falha de leitura virava "crontab vazio". Reproduzido com `crontab -l` saindo 42 -- o
# script instalou so as linhas TOM, gravou um backup VAZIO e o rollback restaurou vazio. Perder
# o crontab do host inteiro por causa de um `|| true`.
#
# "usuario sem crontab" e um fato legitimo (rc=1 com a mensagem conhecida). Qualquer outro rc,
# ou rc=1 sem essa mensagem, e ERRO DE LEITURA: nao escreve, nao faz backup, nao reverte.
CRON_ERR=$(mktemp "${TMPDIR:-/tmp}/cronread.XXXXXX") || { echo "FATAL: mktemp" >&2; exit 2; }
trap 'rm -f "$CRON_ERR"' EXIT INT TERM
# `set -e` mata a substituicao de comando ANTES de `RC_LER=$?` rodar -- o script saia com o
# rc do crontab e a mensagem de diagnostico nunca era impressa. Ou seja: o proprio conserto
# do fail-closed tinha o defeito que ele existe para impedir. errexit desligado so aqui.
set +e
ATUAL=$("$CRONTAB" -l 2>"$CRON_ERR"); RC_LER=$?
set -e
case "$RC_LER" in
  0) : ;;
  1)
    # rc=1 e ambiguo: pode ser "sem crontab" (normal) ou erro. So a mensagem distingue.
    if grep -qiE 'no crontab for|crontab: no crontab' "$CRON_ERR" 2>/dev/null || [ ! -s "$CRON_ERR" ]; then
      ATUAL=""
      echo "== usuario ainda nao tem crontab (rc=1, mensagem conhecida): partindo de vazio =="
    else
      echo "FATAL: crontab -l falhou (rc=1): $(head -1 "$CRON_ERR" | cut -c1-140)" >&2
      echo "       leitura nao confiavel -- nao escrevo nem faco backup" >&2
      exit 2
    fi ;;
  *)
    echo "FATAL: crontab -l falhou (rc=$RC_LER): $(head -1 "$CRON_ERR" | cut -c1-140)" >&2
    echo "       leitura nao confiavel -- nao escrevo nem faco backup" >&2
    exit 2 ;;
esac

if [ "$REVERTER" = 1 ]; then
  # ROLLBACK TRANSACIONAL (laudo v2.6, bloqueador 2). Antes o revert pegava "o backup mais
  # novo do diretorio". Reproduzido: se `--aplicar` falha ANTES de criar o backup desta
  # tentativa, o revert restaura o backup de OUTRA tentativa -- troca CURRENT por OLD e
  # apresenta isso como rollback bem-sucedido.
  # Agora o revert exige o caminho EXATO do backup criado por esta tentativa. Sem ele, nao
  # restaura nada: "nao ha o que reverter" e um resultado honesto; restaurar o passado de
  # outra tentativa nao e.
  ALVO_BKP=${2:-}
  if [ -z "$ALVO_BKP" ]; then
    echo "FATAL: --reverter exige o caminho do backup desta tentativa." >&2
    echo "       O --aplicar imprime 'backup=<caminho>'; passe exatamente esse valor." >&2
    echo "       Sem backup desta tentativa, nada e restaurado (por desenho)." >&2
    exit 2
  fi
  case "$ALVO_BKP" in
    "$BKP_DIR"/crontab-*.bak) : ;;
    *) echo "FATAL: caminho de backup fora de $BKP_DIR ou com nome inesperado: $ALVO_BKP" >&2; exit 2 ;;
  esac
  [ -f "$ALVO_BKP" ] || { echo "FATAL: backup desta tentativa nao existe: $ALVO_BKP -- nada a restaurar" >&2; exit 2; }
  # backup vazio so e restauravel se ele PROVAR que o estado anterior era vazio
  if [ ! -s "$ALVO_BKP" ] && ! grep -q '^# crontab-vazio-confirmado$' "$ALVO_BKP" 2>/dev/null; then
    echo "FATAL: backup vazio e sem marca de vazio-confirmado: $ALVO_BKP" >&2
    echo "       restaurar isso apagaria o crontab do host. Recusado." >&2
    exit 2
  fi
  "$CRONTAB" "$ALVO_BKP" || { echo "FATAL: nao consegui restaurar $ALVO_BKP" >&2; exit 2; }
  echo "crontab revertido a partir de $ALVO_BKP"; exit 0
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

# BACKUP DESTA TENTATIVA, com identidade. O caminho e impresso como `backup=<caminho>` e e o
# UNICO valor que o `--reverter` aceita. Assim o rollback nao pode restaurar o passado de
# outra tentativa.
install -d -m 0700 "$BKP_DIR" || { echo "FATAL: nao consegui criar $BKP_DIR" >&2; exit 2; }
BKP="$BKP_DIR/crontab-$(date -u +%Y%m%dT%H%M%SZ).bak"
if [ -n "$ATUAL" ]; then
  printf '%s\n' "$ATUAL" > "$BKP" || { echo "FATAL: nao consegui gravar $BKP" >&2; exit 2; }
else
  # Vazio LEGITIMO (usuario sem crontab, ja confirmado na leitura). A marca distingue isso de
  # "backup saiu vazio porque a leitura falhou" -- e o revert so restaura vazio com a marca.
  printf '# crontab-vazio-confirmado\n' > "$BKP" || { echo "FATAL: nao consegui gravar $BKP" >&2; exit 2; }
fi
chmod 0600 "$BKP"
# conferencia do proprio backup: backup que nao bate com o que foi lido nao serve de rollback
if [ -n "$ATUAL" ] && ! diff -q <(printf '%s\n' "$ATUAL") "$BKP" >/dev/null 2>&1; then
  rm -f "$BKP"; echo "FATAL: backup gravado diverge do crontab lido -- abortando sem escrever" >&2; exit 2
fi
echo "backup=$BKP"

printf '%s\n' "$NOVO" | "$CRONTAB" - || {
  echo "FATAL: nao consegui escrever o crontab. Reverta com: $0 --reverter $BKP" >&2; exit 1; }

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
  echo "FATAL: $FALTOU linha(s) esperada(s) nao entraram no crontab -- reverta com: $0 --reverter $BKP" >&2
  exit 1
fi
echo "=== 5/5 linhas confirmadas no crontab instalado ==="
