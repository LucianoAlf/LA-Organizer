#!/bin/bash
# Cron dos guardas: instalacao canonica + leitura fail-closed + rollback transacional.
# (laudo v2.5 bloqueador 9; laudo v2.6 bloqueador 2)
#
# NIVEL: integration-sandbox. Crontab FALSO em diretorio descartavel, com o binario falso no
# inicio do PATH: nenhuma versao do script -- nem a antiga -- alcanca o crontab real, e nada
# e escrito no diretorio real de backup.
#
# Dois falsos-verdes cobertos aqui:
#   * `ATUAL=$(crontab -l ... || true)` transformava QUALQUER erro de leitura em "crontab
#     vazio": com rc=42 o script instalava so as linhas TOM, gravava backup vazio, e o
#     rollback restaurava vazio -- perdendo o crontab do host inteiro por causa de um `|| true`;
#   * `--reverter` pegava "o backup mais novo do diretorio". Se o `--aplicar` falhasse ANTES de
#     criar o backup desta tentativa, o revert restaurava o de OUTRA tentativa: trocava CURRENT
#     por OLD e chamava isso de rollback.

set -uo pipefail
AQUI="$(dirname "$(readlink -f "$0")")"
PC="$AQUI/patch-crontab.sh"
P=0; F=0
ok()    { P=$((P+1)); printf '  ok    %s\n' "$1"; }
falhou(){ F=$((F+1)); printf '  FALHA %s\n' "$1"; }
D=$(mktemp -d "${TMPDIR:-/tmp}/cronteste.XXXXXX")
trap 'rm -rf "$D"' EXIT INT TERM

mkdir -p "$D/bin" "$D/scripts" "$D/bkp" "$D/logs"
cat > "$D/bin/crontab" <<'EOF'
#!/bin/bash
# crontab de mentira. CRONTAB_FALSO_RC força um rc de leitura (para os testes fail-closed).
TAB="$CRONTAB_FALSO"
case "${1:-}" in
  -l)
    case "${CRONTAB_FALSO_RC:-}" in
      42)     echo "crontab: temporary file /tmp/crontab.XXXX: Permission denied" >&2; exit 42 ;;
      vazio)  echo "no crontab for root" >&2; exit 1 ;;
      erro1)  echo "crontab: cannot read /var/spool/cron/root: I/O error" >&2; exit 1 ;;
    esac
    [ -s "$TAB" ] && cat "$TAB" || { echo "no crontab for root" >&2; exit 1; } ;;
  -)  cat > "$TAB" ;;
  "") exit 2 ;;
  *)  cat "$1" > "$TAB" ;;
esac
EOF
chmod +x "$D/bin/crontab"
export CRONTAB_FALSO="$D/crontab.txt"

for s in backup-db backup-secrets check-backup conter-permissoes restore-drill alertar; do
  printf '#!/bin/sh\nexit 0\n' > "$D/scripts/$s.sh"; chmod 0750 "$D/scripts/$s.sh"
done

# PATH com o crontab falso na FRENTE, alem da injecao por env: a injecao sozinha nao basta
# quando o teste roda contra a versao ANTIGA do script, que ignora as variaveis.
rodar() { PATH="$D/bin:$PATH" PATCH_CRONTAB_CMD="$D/bin/crontab" PATCH_CRONTAB_BKP_DIR="$D/bkp" \
          PATCH_CRONTAB_SCRIPTS="$D/scripts" PATCH_CRONTAB_LOG="$D/logs/backup.log" \
          "$PC" "$@" 2>&1; }
marcadores() { grep -cE '# tom-(backup-db|backup-secrets|check-backup|varrer-permissoes|restore-drill)$' "$CRONTAB_FALSO" 2>/dev/null || true; }
alheias()    { grep -cE '# (hermes|monitor-agentes|ig-token)$' "$CRONTAB_FALSO" 2>/dev/null || true; }
nbkp()       { ls -1 "$D/bkp"/crontab-*.bak 2>/dev/null | wc -l; }

ALHEIAS_ORIG='*/5 * * * * /opt/hermes/tick.sh # hermes
0 3 * * * /opt/monitor/agentes.sh # monitor-agentes
30 2 * * 1 /opt/ig/refresh.sh # ig-token'
printf '%s\n' "$ALHEIAS_ORIG" > "$CRONTAB_FALSO"

echo "== host limpo: nenhum marcador tom- =="
[ "$(marcadores)" = 0 ] && ok "estado inicial sem marcador nosso" || falhou "estado inicial ja tinha $(marcadores)"

echo "== dry-run NAO altera nada =="
ANTES=$(cat "$CRONTAB_FALSO")
rodar >/dev/null
[ "$ANTES" = "$(cat "$CRONTAB_FALSO")" ] && ok "sem --aplicar, crontab intacto" || falhou "dry-run alterou o crontab"
[ "$(nbkp)" = 0 ] && ok "dry-run nao cria backup" || falhou "dry-run criou backup"

echo "== --aplicar instala os CINCO e IDENTIFICA o backup desta tentativa =="
S=$(rodar --aplicar); RC=$?
[ "$RC" = 0 ] && ok "aplicou (rc=0)" || { falhou "rc=$RC"; tail -4 <<<"$S" | sed 's/^/        /'; }
BKP1=$(sed -n 's/^backup=//p' <<<"$S" | head -1)
[ -n "$BKP1" ] && [ -f "$BKP1" ] && ok "imprimiu backup=<caminho> e o arquivo existe" \
  || falhou "nao identificou o backup desta tentativa (backup='$BKP1')"
[ "$(marcadores)" = 5 ] && ok "5/5 marcadores no crontab" || falhou "$(marcadores)/5 marcadores"
grep -q '# tom-restore-drill$' "$CRONTAB_FALSO" && ok "o QUINTO entrou pelo caminho canonico" \
  || falhou "tom-restore-drill ausente"
[ "$(alheias)" = 3 ] && ok "as 3 linhas de outros sistemas intactas" || falhou "mexeu em linha alheia ($(alheias)/3)"
diff -q <(printf '%s\n' "$ALHEIAS_ORIG") "$BKP1" >/dev/null 2>&1 && ok "o backup guarda EXATAMENTE o crontab lido" \
  || falhou "o backup nao bate com o estado anterior"

echo "== idempotencia =="
DEPOIS1=$(cat "$CRONTAB_FALSO")
rodar --aplicar >/dev/null
[ "$DEPOIS1" = "$(cat "$CRONTAB_FALSO")" ] && ok "segunda aplicacao nao muda nada" || falhou "nao e idempotente"
rodar --aplicar >/dev/null
[ "$(marcadores)" = 5 ] && ok "terceira aplicacao continua 5/5 (nao duplica)" || falhou "duplicou: $(marcadores)"

echo "== convergencia: falta SO o quinto =="
grep -v '# tom-restore-drill$' "$CRONTAB_FALSO" > "$D/tmp" && mv "$D/tmp" "$CRONTAB_FALSO"
[ "$(marcadores)" = 4 ] && ok "estado degradado montado (4/5)" || falhou "nao consegui degradar"
rodar --aplicar >/dev/null
[ "$(marcadores)" = 5 ] && ok "o deploy reconverge para 5/5 sozinho" || falhou "nao reconvergiu ($(marcadores)/5)"

echo "== BLOQUEADOR 2a: erro de leitura NAO vira crontab vazio =="
ANTES=$(cat "$CRONTAB_FALSO"); N_ANTES=$(nbkp)
S=$(CRONTAB_FALSO_RC=42 rodar --aplicar); RC=$?
[ "$RC" != 0 ] && ok "rc=42 na leitura aborta (rc=$RC)" || falhou "instalou com a leitura falhando"
grep -qi 'nao confiavel' <<<"$S" && ok "diz que a leitura nao foi confiavel" || falhou "sem motivo claro: $(head -1 <<<"$S")"
[ "$ANTES" = "$(cat "$CRONTAB_FALSO")" ] && ok "crontab NAO foi tocado" || falhou "reescreveu o crontab com leitura falha"
[ "$(nbkp)" = "$N_ANTES" ] && ok "nenhum backup criado com leitura nao confiavel" || falhou "gravou backup a partir de leitura falha"
S=$(CRONTAB_FALSO_RC=erro1 rodar --aplicar); RC=$?
[ "$RC" != 0 ] && ok "rc=1 com mensagem de ERRO tambem aborta" || falhou "confundiu erro de I/O com 'sem crontab'"
[ "$ANTES" = "$(cat "$CRONTAB_FALSO")" ] && ok "crontab intacto no rc=1 de erro" || falhou "escreveu apesar do erro"

echo "== 'usuario sem crontab' e legitimo e NAO e erro =="
cp "$CRONTAB_FALSO" "$D/guardado"; : > "$CRONTAB_FALSO"
S=$(rodar --aplicar); RC=$?
[ "$RC" = 0 ] && ok "crontab vazio de verdade: aplica normalmente (rc=0)" || falhou "rc=$RC: $(head -2 <<<"$S")"
[ "$(marcadores)" = 5 ] && ok "instalou os 5 num host sem crontab" || falhou "$(marcadores)/5 no host limpo"
BKP_VAZIO=$(sed -n 's/^backup=//p' <<<"$S" | head -1)
grep -q '^# crontab-vazio-confirmado$' "$BKP_VAZIO" 2>/dev/null && ok "backup de vazio carrega marca de vazio-CONFIRMADO" \
  || falhou "backup vazio sem marca: nao da para distinguir de leitura falha"
cp "$D/guardado" "$CRONTAB_FALSO"

echo "== BLOQUEADOR 2b: rollback transacional =="
S=$(rodar --reverter); RC=$?
[ "$RC" != 0 ] && ok "--reverter sem caminho e RECUSADO (rc=$RC)" || falhou "reverteu sem saber para qual backup"
grep -qi 'exige o caminho' <<<"$S" && ok "explica que precisa do backup desta tentativa" || falhou "sem explicacao"
S=$(rodar --reverter /etc/passwd); RC=$?
[ "$RC" != 0 ] && ok "caminho fora do diretorio de backup e recusado" || falhou "aceitou caminho arbitrario"
printf '' > "$D/bkp/crontab-20200101T000000Z.bak"
S=$(rodar --reverter "$D/bkp/crontab-20200101T000000Z.bak"); RC=$?
[ "$RC" != 0 ] && ok "backup VAZIO sem marca e recusado (apagaria o crontab)" || falhou "restaurou vazio"
rm -f "$D/bkp/crontab-20200101T000000Z.bak"

# o revert desta tentativa, com o caminho exato, funciona
S=$(rodar --aplicar); BKP_AT=$(sed -n 's/^backup=//p' <<<"$S" | head -1)
printf 'ESTRAGADO\n' > "$CRONTAB_FALSO"
S=$(rodar --reverter "$BKP_AT"); RC=$?
[ "$RC" = 0 ] && ok "revert com o caminho desta tentativa funciona" || falhou "rc=$RC: $S"
grep -q ESTRAGADO "$CRONTAB_FALSO" && falhou "o estragado continua la" || ok "conteudo estragado desfeito"
[ "$(alheias)" = 3 ] && ok "linhas de outros sistemas preservadas no revert" || falhou "revert perdeu linha alheia"

echo "== falha ANTES do backup nao deixa backup desta tentativa =="
N_ANTES=$(nbkp)
chmod 0640 "$D/scripts/restore-drill.sh"
ANTES=$(cat "$CRONTAB_FALSO")
S=$(rodar --aplicar); RC=$?
[ "$RC" != 0 ] && ok "pre-condicao (script sem +x) aborta (rc=$RC)" || falhou "agendou script nao executavel"
[ "$(nbkp)" = "$N_ANTES" ] && ok "nenhum backup novo -- entao nao ha o que reverter" || falhou "criou backup mesmo abortando antes"
[ "$ANTES" = "$(cat "$CRONTAB_FALSO")" ] && ok "crontab inalterado na recusa" || falhou "alterou o crontab abortando"
grep -q 'backup=' <<<"$S" && falhou "imprimiu backup= numa tentativa que nao chegou a criar backup" \
  || ok "nao anuncia backup que nao existe"
chmod 0750 "$D/scripts/restore-drill.sh"

echo "== o auto-deploy instala antes de validar E reverte pelo caminho exato =="
PS1="$AQUI/auto-deploy.ps1"
if [ -r "$PS1" ]; then
  L_APLICA=$(grep -n 'patch-crontab.sh --aplicar' "$PS1" | head -1 | cut -d: -f1)
  L_VALIDA=$(grep -n 'cron faltando' "$PS1" | head -1 | cut -d: -f1)
  if [ -n "$L_APLICA" ] && [ -n "$L_VALIDA" ] && [ "$L_APLICA" -lt "$L_VALIDA" ]; then
    ok "instala (linha $L_APLICA) antes de validar (linha $L_VALIDA)"
  else
    falhou "auto-deploy nao instala o cron no caminho canonico (aplica=${L_APLICA:-nenhuma})"
  fi
  grep -q 'cronBackup' "$PS1" && ok "captura o caminho do backup desta tentativa" \
    || falhou "nao captura backup= -- o revert voltaria a chutar o mais novo"
  grep -qE 'patch-crontab.sh --reverter [^"]*\$cronBackup' "$PS1" && ok "reverte passando o caminho capturado" \
    || falhou "--reverter sem o caminho desta tentativa"
else
  falhou "auto-deploy.ps1 nao encontrado"
fi

echo
echo "== $P passaram, $F falharam =="
[ "$F" -eq 0 ]
