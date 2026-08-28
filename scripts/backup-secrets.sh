#!/bin/bash
# P0-3 v2 — Backup de configuração do TOM. Substitui a v1 de 2026-05-18.
#
# LIMITE HONESTO DESTE SCRIPT (B6):
#   Isto NÃO é DR offsite. É cópia em TEXTO PURO no MESMO host que ele deveria recuperar.
#   Se o host morrer, morre junto. Se o host for comprometido, o atacante ganha o .env inteiro
#   sem esforço adicional. Serve para UM caso: recuperar runtime após erro humano local
#   (arquivo sobrescrito, edição errada). Para DR de verdade é preciso, em decisão do Alf:
#     (a) cifrar em repouso (gpg simétrico com chave que NÃO more neste host), e
#     (b) enviar para destino externo, e
#     (c) provar a restauração pelo runbook.
#   Enquanto (a)+(b)+(c) não existirem, trate isto como conveniência, não como recuperação.
#
# O QUE MUDA vs v1:
#   1. umask 077 + install -m 0600: nada nasce legível por outro usuário do host compartilhado.
#   2. PARA de copiar .claude-tom/ inteiro. A v1 fazia `cp -r`, que PRESERVA o modo da origem —
#      foi assim que 20.085 transcripts de sessão e cópias de credencial ficaram em 644 numa
#      árvore 755, legíveis pelos outros 8 usuários do host.
#   3. Copia SÓ o que recupera runtime. Transcript, cache, plugins e .claude.json.backup.*
#      não são recuperação — são resíduo, e resíduo com conteúdo de conversa real.
#   4. B6: item obrigatório ausente => FALHA. Não existe verde parcial.

set -euo pipefail
umask 077

SRC=/opt/LA-Organizer
DEST=/opt/backups/la-organizer
DATE=$(date +%Y-%m-%d)
LOCKDIR="$DEST/locks"

falhar() { echo "[backup-secrets] FALHA: $1" >&2; exit 1; }

install -d -m 0700 "$LOCKDIR" || falhar "nao consegui criar $LOCKDIR"
exec 9>"$LOCKDIR/backup-secrets.lock" || falhar "nao consegui abrir lock"
flock -n 9 || falhar "outra execucao em andamento"

install -d -m 0700 "$DEST"
install -d -m 0700 "$DEST/$DATE"

# OBRIGATÓRIOS: ausência é falha explícita.
declare -a OBRIGATORIOS=(
  "$SRC/.env|.env"
  "$SRC/.claude-tom/.claude/.credentials.json|credentials.json"
)
# OPCIONAIS: ausência é apenas registrada.
declare -a OPCIONAIS=(
  "$SRC/package.json|package.json"
)

for par in "${OBRIGATORIOS[@]}"; do
  origem=${par%%|*}; destino=${par#*|}
  [ -r "$origem" ] || falhar "artefato OBRIGATORIO ausente ou ilegivel: $(basename "$origem")"
  install -m 0600 "$origem" "$DEST/$DATE/$destino" || falhar "copia falhou: $destino"
done
for par in "${OPCIONAIS[@]}"; do
  origem=${par%%|*}; destino=${par#*|}
  if [ -r "$origem" ]; then install -m 0600 "$origem" "$DEST/$DATE/$destino"
  else echo "[backup-secrets] opcional ausente: $destino"; fi
done

# Auto-trava: se qualquer coisa aqui nascer legível por grupo/outros, o backup FALHA.
VAZANDO=$(find "$DEST" \( -perm -o=r -o -perm -g=r \) 2>/dev/null | wc -l)
[ "$VAZANDO" -eq 0 ] || falhar "$VAZANDO artefatos legiveis por grupo/outros apos o backup"

echo "[$(date -Iseconds)] backup-secrets ok -> $DEST/$DATE" >> "$DEST/backup.log"
chmod 0600 "$DEST/backup.log"
echo "[backup-secrets] ok -> $DEST/$DATE"
