#!/bin/bash
# P0-2 v2.3 — Backup lógico completo do banco do TOM.
#
# CORREÇÕES v2.2 -> v2.3:
#   #5  OFFSITE ATÔMICO E RESTAURÁVEL. A v2.2 enviava só o .dump, e o enviava ANTES de o
#       .baseline existir — mas o restore drill EXIGE dump + baseline. O conjunto offsite
#       era, por construção, irrestaurável pelo próprio runbook. Agora o offsite só sai
#       depois que dump + baseline + sha256 + manifesto existem, sobe para um diretório
#       temporário remoto e só então é movido para o definitivo.
#   #6  TELEMETRIA DEIXA DE SER BEST-EFFORT. `registrar` não engole mais falha com
#       `|| true`: o run final é RELIDO do arquivo, e se não estiver lá o backup FALHA.
#       Backup que "deu certo" sem registro é backup que a sentinela não consegue provar.
#   #1  BASELINE POR IDENTIDADE, não por contagem. Grava listas ordenadas (hash sha256) de
#       tabelas, funções, policies, índices, constraints e grants — assim o drill detecta
#       "perdi a policy X e ganhei a Y", que contagem nenhuma pega.
#
# Herdado: sem `source .env`; lib-pgconn (.pgpass 0600 em dir 0700, nada no argv); flock;
# .partial + rename atômico; sha256; retenção em dry-run; dump COM privilégios (sem isso o
# drill não prova recuperação de ACL).

set -euo pipefail
umask 077

RAIZ_TOM=/opt/LA-Organizer
RAIZ_BKP=/opt/backups/la-organizer
DEST="$RAIZ_BKP/db"
LOCKDIR="$RAIZ_BKP/locks"
TELEMETRY="$DEST/runs.jsonl"
TELEMETRY_FALLBACK_DIR=/run/tom-backup
ENV_FILE="$RAIZ_TOM/.env"
LIB="$(dirname "$(readlink -f "$0")")/lib-pgconn.sh"
RETENCAO_DIAS=14
TAM_MINIMO=$((1024 * 1024))

APLICAR_RETENCAO=0
[ "${1:-}" = "--aplicar-retencao" ] && APLICAR_RETENCAO=1

INICIO=$(date +%s)
TS=$(date -u +%Y%m%dT%H%M%SZ)
DATE=$(date -u +%Y-%m-%d)
RUN_ID="bkp-$TS-$$"
VERSAO=$(git -C "$RAIZ_TOM" rev-parse --short HEAD 2>/dev/null || echo desconhecida)
FINAL=""; PARCIAL=""; FINALIZADO=0

destino_seguro() {
  local d=$1 real
  install -d -m 0700 "$d" 2>/dev/null || return 1
  real=$(realpath "$d" 2>/dev/null) || return 1
  [ "$real" = "$d" ] || return 1
  [ "$(stat -c%U "$real")" = root ] || return 1
  [ "$(stat -c%a "$real")" = 700 ] || return 1
  return 0
}
if destino_seguro "$DEST" && touch "$TELEMETRY" 2>/dev/null; then chmod 0600 "$TELEMETRY"
elif destino_seguro "$TELEMETRY_FALLBACK_DIR" && touch "$TELEMETRY_FALLBACK_DIR/runs.jsonl" 2>/dev/null; then
  TELEMETRY="$TELEMETRY_FALLBACK_DIR/runs.jsonl"; chmod 0600 "$TELEMETRY"
  echo "[backup-db] AVISO: destino principal indisponivel, telemetria em $TELEMETRY" >&2
else
  echo "[backup-db] FATAL: nenhum destino de telemetria seguro disponivel" >&2; exit 3
fi

sanitizar() { sed -E 's#(postgres(ql)?://)[^[:space:]"]*#\1<REDACTED>#g' <<<"${1:-}" | tr -d '\n"\\' | cut -c1-300; }

# #6: escreve E CONFIRMA. Devolve != 0 se a linha não ficou no arquivo.
registrar() { # status, erro, bytes, sha, caminho
  local linha
  linha=$(printf '{"ts":"%s","run_id":"%s","evento":"backup-db","versao":"%s","status":"%s","duracao_s":%s,"bytes":%s,"sha256":"%s","artefato":"%s","erro":"%s"}' \
    "$(date -Iseconds)" "$RUN_ID" "$VERSAO" "$1" "$(( $(date +%s) - INICIO ))" \
    "${3:-0}" "${4:-}" "${5:-}" "$(sanitizar "${2:-}")")
  printf '%s\n' "$linha" >> "$TELEMETRY" || return 1
  tail -1 "$TELEMETRY" | grep -qF "\"run_id\":\"$RUN_ID\",\"evento\":\"backup-db\",\"versao\":\"$VERSAO\",\"status\":\"$1\"" || return 1
  return 0
}
falhar() { registrar erro "$1" || echo "[backup-db] ALERTA: falha ao gravar telemetria do erro" >&2
           FINALIZADO=1; echo "[backup-db] FALHA: $(sanitizar "$1")" >&2; exit 1; }

finalizar() {
  local rc=$?
  [ -n "$PARCIAL" ] && rm -f "$PARCIAL" 2>/dev/null
  command -v pg_limpar >/dev/null 2>&1 && pg_limpar
  [ "$FINALIZADO" = 0 ] && registrar erro "encerramento sem run final (rc=$rc)"
  return 0
}
trap finalizar EXIT
trap 'FINALIZADO=1; registrar erro "interrompido por sinal"; exit 130' INT TERM

registrar inicio "" || { echo "[backup-db] FATAL: telemetria nao gravavel" >&2; exit 3; }

destino_seguro "$LOCKDIR" || falhar "diretorio de lock inseguro ou nao criavel"
exec 9>"$LOCKDIR/backup-db.lock" || falhar "nao consegui abrir lock"
flock -n 9 || falhar "outra execucao em andamento (lock ocupado)"

[ -r "$ENV_FILE" ] || falhar "env ausente ou ilegivel"
[ -r "$LIB" ]      || falhar "lib-pgconn.sh ausente em $LIB"
LIBQ="$(dirname "$(readlink -f "$0")")/lib-baseline-queries.sh"
[ -r "$LIBQ" ]     || falhar "lib-baseline-queries.sh ausente em $LIBQ"
for b in pg_dump pg_restore psql sha256sum flock; do command -v "$b" >/dev/null || falhar "$b ausente"; done
# shellcheck disable=SC1090
. "$LIB"
# shellcheck disable=SC1090
. "$LIBQ"
pg_conectar "$ENV_FILE" || falhar "nao consegui montar a conexao"

destino_seguro "$DEST/$DATE" || falhar "diretorio do dia inseguro ou nao criavel"
BASE="$DEST/$DATE/tom-$TS"
FINAL="$BASE.dump"; PARCIAL="$FINAL.partial"
BASELINE="$BASE.baseline"; MANIFESTO="$BASE.manifest"; SHAFILE="$BASE.sha256"

pg_dump --format=custom --file="$PARCIAL" || falhar "pg_dump retornou erro"
[ -s "$PARCIAL" ] || falhar "dump vazio"
BYTES=$(stat -c%s "$PARCIAL")
[ "$BYTES" -ge "$TAM_MINIMO" ] || falhar "dump menor que o minimo ($BYTES bytes)"
pg_restore --list "$PARCIAL" >/dev/null 2>&1 || falhar "dump reprovado no pg_restore --list"
SHA=$(sha256sum "$PARCIAL" | cut -d' ' -f1)
chmod 0600 "$PARCIAL"
mv -f "$PARCIAL" "$FINAL" || falhar "rename atomico falhou"
PARCIAL=""

# ---------------------------------------------------------------------------
# #1 — BASELINE POR IDENTIDADE. Cada categoria vira uma lista ORDENADA, e o baseline
# guarda a contagem e o sha256 da lista. Assim o drill compara conjuntos, não totais:
# perder a policy X e ganhar a Y muda o hash, mas não muda a contagem.
# ---------------------------------------------------------------------------
gerar_lista() { psql -tA -c "$1" 2>/dev/null | LC_ALL=C sort; }
{
  for par in "${BASELINE_QUERIES[@]}"
  do
    chave=${par%%|*}; sql=${par#*|}
    lista=$(gerar_lista "$sql") || { echo "ERRO=$chave"; break; }
    printf '%s_n=%s\n%s_sha=%s\n' "$chave" "$(printf '%s\n' "$lista" | grep -c .)" \
      "$chave" "$(printf '%s\n' "$lista" | sha256sum | cut -d' ' -f1)"
    # #2 (v2.3): baseline so tinha contagem+hash, entao o drill dizia QUE divergiu mas nao
    # QUAL objeto sumiu, e comparava extensoes contra lista fixa no codigo em vez do estado
    # real da origem. Agora a LISTA COMPLETA vai junto, em secoes, e o drill faz diff.
    printf -- '--- lista:%s ---\n' "$chave"
    printf '%s\n' "$lista" | grep . || true
    printf -- '--- fim:%s ---\n' "$chave"
  done
} > "$BASELINE" || falhar "nao consegui gerar o baseline"
grep -q '^ERRO=' "$BASELINE" && falhar "baseline incompleto: $(grep '^ERRO=' "$BASELINE")"
grep -q '^tabelas_n=' "$BASELINE" || falhar "baseline sem a chave tabelas_n"
chmod 0600 "$BASELINE"
for c in "${BASELINE_CHAVES[@]}"; do
  grep -q -- "^--- lista:$c ---$" "$BASELINE" || falhar "baseline sem a secao de lista de $c"
done

# O MANIFESTO vem ANTES do checksum, de proposito. Na versao anterior o .sha256 cobria só
# dump + baseline: o manifesto podia ser trocado ou corrompido sem ninguem notar, e é ele
# que diz de qual commit e de qual run aquele backup veio. Agora o checksum cobre os TRES,
# e o `sha256sum -c` da sentinela valida o conjunto inteiro.
cat > "$MANIFESTO" <<MAN
run_id=$RUN_ID
ts=$(date -Iseconds)
versao_codigo=$VERSAO
dump=$(basename "$FINAL")
dump_bytes=$BYTES
dump_sha256=$SHA
baseline=$(basename "$BASELINE")
shafile=$(basename "$SHAFILE")
pg_dump_versao=$(pg_dump --version | head -1)
# Para restaurar: ./restore-drill.sh <dump>  (exige o .baseline ao lado)
MAN
chmod 0600 "$MANIFESTO"

printf '%s  %s\n' "$SHA" "$(basename "$FINAL")" > "$SHAFILE"
sha256sum "$BASELINE"  | sed "s#$BASELINE#$(basename "$BASELINE")#"   >> "$SHAFILE"
sha256sum "$MANIFESTO" | sed "s#$MANIFESTO#$(basename "$MANIFESTO")#" >> "$SHAFILE"
chmod 0600 "$SHAFILE"

# ---------------------------------------------------------------------------
# #5 — OFFSITE ATÔMICO: sobe o CONJUNTO (dump+baseline+sha+manifesto) para um diretorio
# temporario remoto e so entao move para o definitivo. Nunca existe um destino com dump
# sem baseline, que seria irrestauravel pelo proprio runbook.
# ---------------------------------------------------------------------------
if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
  command -v rclone >/dev/null || falhar "BACKUP_RCLONE_REMOTE definido mas rclone ausente"
  TMP_REMOTO="$BACKUP_RCLONE_REMOTE/.incompleto/$RUN_ID"
  DEF_REMOTO="$BACKUP_RCLONE_REMOTE/$DATE/$RUN_ID"
  for f in "$FINAL" "$BASELINE" "$SHAFILE" "$MANIFESTO"; do
    rclone copyto "$f" "$TMP_REMOTO/$(basename "$f")" --quiet || falhar "rclone: falha em $(basename "$f")"
  done
  rclone check "$(dirname "$FINAL")" "$TMP_REMOTO" --one-way --include "$(basename "$BASE")*" --quiet \
    || falhar "rclone check reprovou o conjunto remoto"
  rclone moveto "$TMP_REMOTO" "$DEF_REMOTO" --quiet || falhar "rclone: promocao atomica falhou"
  echo "[backup-db] offsite ok -> $DEF_REMOTO (conjunto completo)"
fi

DEST_REAL=$(realpath "$DEST") || falhar "realpath do destino falhou"
for d in "$DEST"/*; do
  [ -e "$d" ] || continue
  nome=$(basename "$d")
  [[ "$nome" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue
  [ "$nome" = "$DATE" ] && continue
  [ -d "$d" ] || continue
  real=$(realpath "$d") || continue
  case "$real" in "$DEST_REAL"/*) ;; *) continue ;; esac
  [ -n "$(find "$real" -maxdepth 0 -mtime +$RETENCAO_DIAS 2>/dev/null)" ] || continue
  if [ "$APLICAR_RETENCAO" = 1 ]; then rm -rf -- "$real"; echo "[backup-db] retencao: removido $nome"
  else echo "[backup-db] retencao (DRY-RUN): removeria $nome"; fi
done

registrar ok "" "$BYTES" "$SHA" "$FINAL" || { echo "[backup-db] FATAL: run final nao ficou na telemetria" >&2; exit 1; }
FINALIZADO=1
echo "[backup-db] ok run_id=$RUN_ID -> $FINAL ($BYTES bytes, sha ${SHA:0:12}...)"
echo "[backup-db] baseline: $(tr '\n' ' ' < "$BASELINE" | cut -c1-160)..."
