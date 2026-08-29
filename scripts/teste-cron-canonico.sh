#!/bin/bash
# Cron dos guardas instalado pelo CAMINHO CANONICO (laudo v2.5, bloqueador 9).
# Crontab FALSO, em diretorio descartavel: o crontab real do root nunca e lido nem escrito.
#
# O problema: o auto-deploy VALIDAVA os cinco marcadores e nunca os INSTALAVA. Os cinco
# estavam vivos porque eu rodei `patch-crontab.sh --aplicar` a mao durante a preparacao do
# pacote -- fora do caminho canonico. Num host limpo, ou depois de alguem editar o crontab,
# o deploy reprovaria em vez de convergir. Validar sem instalar transforma um estado que o
# deploy deveria GARANTIR num estado que ele apenas TORCE para encontrar.

set -uo pipefail
AQUI="$(dirname "$(readlink -f "$0")")"
PC="$AQUI/patch-crontab.sh"
P=0; F=0
ok()    { P=$((P+1)); printf '  ok    %s\n' "$1"; }
falhou(){ F=$((F+1)); printf '  FALHA %s\n' "$1"; }
D=$(mktemp -d "${TMPDIR:-/tmp}/cronteste.XXXXXX")
trap 'rm -rf "$D"' EXIT INT TERM

# SENTINELA DO DIRETORIO REAL DE BACKUP. Rodando este mesmo teste contra a versao ANTIGA do
# script (para provar que ela reprova), o BKP_DIR hardcoded dela escreve em
# /opt/backups/la-organizer/crontab -- e o .bak resultante contem o crontab FALSO. Como o
# --reverter restaura o backup MAIS NOVO, isso deixaria uma bomba armada: reverter apagaria
# todos os crons reais do host. Aconteceu em 29/08 e so apareceu porque fui conferir.
# Agora o teste fotografa o diretorio e REPROVA se algo aparecer la, dizendo o que remover.
BKP_REAL=${BKP_REAL:-/opt/backups/la-organizer/crontab}
FOTO_BKP="$D/bkp-real-antes.txt"
ls -1 "$BKP_REAL" 2>/dev/null | LC_ALL=C sort > "$FOTO_BKP" || true

# --- crontab FALSO, respaldado por arquivo ------------------------------------------------
mkdir -p "$D/bin" "$D/scripts" "$D/bkp" "$D/logs"
cat > "$D/bin/crontab" <<'EOF'
#!/bin/bash
# crontab de mentira: -l le o arquivo, `-` grava a stdin, <arquivo> grava o arquivo.
TAB="$CRONTAB_FALSO"
case "${1:-}" in
  -l) [ -s "$TAB" ] && cat "$TAB" || exit 1 ;;
  -)  cat > "$TAB" ;;
  "") exit 2 ;;
  *)  cat "$1" > "$TAB" ;;
esac
EOF
chmod +x "$D/bin/crontab"
export CRONTAB_FALSO="$D/crontab.txt"

# scripts agendados precisam existir e ser executaveis
for s in backup-db backup-secrets check-backup conter-permissoes restore-drill alertar; do
  printf '#!/bin/sh\nexit 0\n' > "$D/scripts/$s.sh"; chmod 0750 "$D/scripts/$s.sh"
done

# PATH com o crontab falso na FRENTE, alem da injecao por env. A injecao sozinha nao basta:
# rodando este mesmo teste contra a versao ANTIGA do script (para provar que ela reprova), a
# versao antiga IGNORA as variaveis e chama `crontab` direto -- ou seja, o crontab REAL do
# root. Aconteceu comigo em 29/08: duas execucoes contra producao, sem mudanca de conteudo
# porque o patch e idempotente, mas foi sorte, nao desenho. Com o PATH na frente, nenhuma
# versao do script alcanca o crontab de verdade.
rodar() { PATH="$D/bin:$PATH" PATCH_CRONTAB_CMD="$D/bin/crontab" PATCH_CRONTAB_BKP_DIR="$D/bkp" \
          PATCH_CRONTAB_SCRIPTS="$D/scripts" PATCH_CRONTAB_LOG="$D/logs/backup.log" \
          "$PC" "$@" 2>&1; }
marcadores() { grep -cE '# tom-(backup-db|backup-secrets|check-backup|varrer-permissoes|restore-drill)$' "$CRONTAB_FALSO" 2>/dev/null || true; }
alheias() { grep -cE '# (hermes|monitor-agentes|ig-token)$' "$CRONTAB_FALSO" 2>/dev/null || true; }

# --- HOST LIMPO: so linhas de outros sistemas ---------------------------------------------
cat > "$CRONTAB_FALSO" <<'EOF'
*/5 * * * * /opt/hermes/tick.sh # hermes
0 3 * * * /opt/monitor/agentes.sh # monitor-agentes
30 2 * * 1 /opt/ig/refresh.sh # ig-token
EOF
echo "== host limpo: nenhum marcador tom- =="
[ "$(marcadores)" = 0 ] && ok "estado inicial sem marcador nosso" || falhou "estado inicial ja tinha $(marcadores)"

echo "== dry-run NAO altera nada =="
ANTES=$(cat "$CRONTAB_FALSO")
rodar >/dev/null
[ "$ANTES" = "$(cat "$CRONTAB_FALSO")" ] && ok "sem --aplicar, crontab intacto" || falhou "dry-run alterou o crontab"

echo "== --aplicar instala os CINCO, inclusive o restore-drill =="
S=$(rodar --aplicar); RC=$?
[ "$RC" = 0 ] && ok "aplicou (rc=0)" || { falhou "rc=$RC"; echo "$S" | tail -4 | sed 's/^/        /'; }
[ "$(marcadores)" = 5 ] && ok "5/5 marcadores no crontab" || falhou "$(marcadores)/5 marcadores"
grep -q '# tom-restore-drill$' "$CRONTAB_FALSO" && ok "o QUINTO (tom-restore-drill) entrou pelo caminho canonico" \
  || falhou "tom-restore-drill ausente -- e exatamente o que estava sendo instalado a mao"
[ "$(alheias)" = 3 ] && ok "as 3 linhas de outros sistemas continuam intactas" || falhou "mexeu em linha alheia ($(alheias)/3)"
[ "$(ls -1 "$D/bkp"/crontab-*.bak 2>/dev/null | wc -l)" -ge 1 ] && ok "backup do crontab anterior gravado" || falhou "nao gravou backup"

echo "== idempotencia: rodar de novo deixa o MESMO resultado =="
DEPOIS1=$(cat "$CRONTAB_FALSO")
rodar --aplicar >/dev/null
[ "$DEPOIS1" = "$(cat "$CRONTAB_FALSO")" ] && ok "segunda aplicacao nao muda nada" || falhou "aplicacao nao e idempotente"
rodar --aplicar >/dev/null
[ "$(marcadores)" = 5 ] && ok "terceira aplicacao continua 5/5 (nao duplica)" || falhou "duplicou: $(marcadores) marcadores"

echo "== convergencia: falta SO o quinto =="
grep -v '# tom-restore-drill$' "$CRONTAB_FALSO" > "$D/tmp" && mv "$D/tmp" "$CRONTAB_FALSO"
[ "$(marcadores)" = 4 ] && ok "estado degradado montado (4/5)" || falhou "nao consegui degradar"
rodar --aplicar >/dev/null
[ "$(marcadores)" = 5 ] && ok "o deploy reconverge para 5/5 sozinho" || falhou "nao reconvergiu ($(marcadores)/5)"

echo "== pre-condicao: script sem +x aborta e NAO altera o crontab =="
ANTES=$(cat "$CRONTAB_FALSO")
chmod 0640 "$D/scripts/restore-drill.sh"
S=$(rodar --aplicar); RC=$?
[ "$RC" != 0 ] && ok "recusou agendar script sem +x (rc=$RC)" || falhou "agendou script nao executavel"
[ "$ANTES" = "$(cat "$CRONTAB_FALSO")" ] && ok "crontab inalterado na recusa" || falhou "alterou o crontab mesmo abortando"
chmod 0750 "$D/scripts/restore-drill.sh"

echo "== --reverter volta ao crontab anterior =="
rodar --aplicar >/dev/null
ATUAL=$(cat "$CRONTAB_FALSO")
printf 'ESTRAGADO\n' > "$CRONTAB_FALSO"
S=$(rodar --reverter); RC=$?
[ "$RC" = 0 ] && ok "reverteu (rc=0)" || falhou "rc=$RC: $S"
grep -q ESTRAGADO "$CRONTAB_FALSO" && falhou "o crontab estragado continua la" || ok "conteudo estragado desfeito"
[ "$(alheias)" = 3 ] && ok "as linhas de outros sistemas voltaram" || falhou "revert perdeu linha alheia"

echo "== o teste nao deixou rastro no diretorio REAL de backup =="
ls -1 "$BKP_REAL" 2>/dev/null | LC_ALL=C sort > "$D/bkp-real-depois.txt" || true
if diff -q "$FOTO_BKP" "$D/bkp-real-depois.txt" >/dev/null 2>&1; then
  ok "$BKP_REAL intacto ($(wc -l < "$FOTO_BKP") arquivo(s), nenhum novo)"
else
  falhou "o teste criou arquivo em $BKP_REAL -- REMOVA antes de qualquer --reverter:"
  LC_ALL=C comm -13 "$FOTO_BKP" "$D/bkp-real-depois.txt" | sed "s|^|        $BKP_REAL/|"
fi

echo "== o auto-deploy chama --aplicar ANTES de validar =="
PS1="$AQUI/auto-deploy.ps1"
if [ -r "$PS1" ]; then
  L_APLICA=$(grep -n 'patch-crontab.sh --aplicar' "$PS1" | head -1 | cut -d: -f1)
  L_VALIDA=$(grep -n 'cron faltando' "$PS1" | head -1 | cut -d: -f1)
  if [ -n "$L_APLICA" ] && [ -n "$L_VALIDA" ] && [ "$L_APLICA" -lt "$L_VALIDA" ]; then
    ok "instala (linha $L_APLICA) antes de validar (linha $L_VALIDA)"
  else
    falhou "auto-deploy nao instala o cron no caminho canonico (aplica=${L_APLICA:-nenhuma} valida=${L_VALIDA:-?})"
  fi
  grep -q 'patch-crontab.sh --reverter' "$PS1" && ok "tem rollback do crontab na falha" \
    || falhou "sem --reverter no caminho de falha"
else
  falhou "auto-deploy.ps1 nao encontrado"
fi

echo
echo "== $P passaram, $F falharam =="
[ "$F" -eq 0 ]
