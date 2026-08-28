#!/bin/bash
# P0-2 v2.4 — Sentinela. Só LÊ.
#
# CORREÇÃO v2.3 -> v2.4 (bloqueador #5): a v2.3 conferia só o `.dump`. Baseline, manifesto e
# checksum podiam sumir e a sentinela continuava verde — mas o restore drill EXIGE dump +
# baseline. Ou seja: ela dizia "backup ok" sobre um conjunto que já não era restaurável.
#
# Critério de "backup comprovado" (todos obrigatórios):
#   1. existe run status=ok na janela;
#   2. o artefato do caminho registrado existe, com tamanho e sha256 da telemetria;
#   3. o CONJUNTO existe ao lado dele: .baseline, .manifest, .sha256;
#   4. o .baseline tem as 8 seções de lista que o drill consome;
#   5. os hashes do .sha256 conferem com os arquivos;
#   6. idade dentro do limite, e NÃO negativa.
# Falta qualquer um => CRÍTICO. Backup que a sentinela não consegue provar restaurável não
# é backup: é arquivo.

set -uo pipefail
DEST=/opt/backups/la-organizer/db
TELEMETRY="$DEST/runs.jsonl"
LIMITE_H=36

grito() { echo "[check-backup] CRITICO: $1" >&2; exit 2; }
campo() { sed -E "s/.*\"$1\":\"?([^,\"}]*)\"?.*/\1/" <<<"$2"; }

[ -s "$TELEMETRY" ] || grito "sem telemetria em $TELEMETRY"
ULTIMO=$(grep '"status":"ok"' "$TELEMETRY" | tail -1)
[ -n "$ULTIMO" ] || grito "nenhum run com status=ok registrado"

RUN=$(campo run_id "$ULTIMO"); TS=$(campo ts "$ULTIMO")
BYTES=$(campo bytes "$ULTIMO"); SHA=$(campo sha256 "$ULTIMO"); ARQ=$(campo artefato "$ULTIMO")
[ -n "$ARQ" ] || grito "run $RUN nao registrou caminho do artefato"

IDADE_H=$(( ( $(date +%s) - $(date -d "$TS" +%s) ) / 3600 ))
[ "$IDADE_H" -ge 0 ]           || grito "run $RUN tem timestamp no FUTURO (${IDADE_H}h)"
[ "$IDADE_H" -le "$LIMITE_H" ] || grito "ultimo backup ok ha ${IDADE_H}h (limite ${LIMITE_H}h)"

# 2. o dump
[ -f "$ARQ" ] || grito "run $RUN diz ok mas o artefato nao existe: $ARQ"
[ "$(stat -c%s "$ARQ")" = "$BYTES" ] || grito "tamanho de $ARQ diverge da telemetria"
[ "$(sha256sum "$ARQ" | cut -d' ' -f1)" = "$SHA" ] || grito "sha256 de $ARQ diverge da telemetria"

# 3. o CONJUNTO — sem estes o drill nao roda, logo o backup nao e restauravel
BASE="${ARQ%.dump}"
for ext in baseline manifest sha256; do
  [ -f "$BASE.$ext" ] || grito "conjunto incompleto: falta $(basename "$BASE").$ext (o drill exige)"
  [ -s "$BASE.$ext" ] || grito "conjunto incompleto: $(basename "$BASE").$ext esta vazio"
done

# 4. o baseline precisa ter as secoes que o drill consome
for c in tabelas funcoes policies indices constraints grants rls extensoes; do
  grep -q -- "^--- lista:$c ---$" "$BASE.baseline" \
    || grito "baseline sem a secao de $c — gerado por versao antiga, drill reprovaria"
done

# 5. checksums do conjunto
( cd "$(dirname "$ARQ")" && sha256sum -c --quiet "$BASE.sha256" ) 2>/dev/null \
  || grito "sha256sum -c reprovou o conjunto (arquivo alterado ou corrompido)"

echo "[check-backup] ok: run=$RUN idade=${IDADE_H}h; dump+baseline+manifest+sha256 conferidos ($BYTES bytes)"
