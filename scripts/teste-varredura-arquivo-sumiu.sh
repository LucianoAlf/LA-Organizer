#!/bin/bash
# Bateria: arquivo que SOME durante a varredura não é problema de segurança (27/09).
#
# POR QUE EXISTE: desde 24/09 (CLI do Claude 2.1.281) o `.claude.json.lock` e os
# `.claude.json.tmp.*` nascem e morrem em milissegundos dentro de .claude-tom-w0. Quando o
# `find` da varredura lista o diretório e o arquivo some antes do stat, ele escreve
# "No such file or directory" e sai com rc=1 — e a regra fail-closed (qualquer linha no
# stderr = problema) mandava "varredura REPROVOU" pro Alf no WhatsApp: 30 vezes em 3 dias,
# todas falsas. A regra fail-closed está CERTA e continua: aqui só o "sumiu no meio" ganha
# até 2 repetições; qualquer outro erro (permissão, I/O) reprova na primeira.
#
# COMO TESTA: cópia do script com as raízes redirecionadas pra sandbox (mesmo método de
# teste-varredura-contador.sh) e um `find` falso no PATH que devolve o erro que a gente quer.
set -uo pipefail
AQUI=$(dirname "$(readlink -f "$0")")
ORIG="$AQUI/conter-permissoes.sh"
P=0; F=0
ok()    { P=$((P+1)); printf '  ok    %s\n' "$1"; }
falha() { F=$((F+1)); printf '  FALHA %s\n' "$1"; }
[ "$(id -u)" = 0 ] || { echo "ABORTADO: precisa de root (dono esperado das raízes)"; exit 2; }

S=$(mktemp -d) || exit 2
trap 'rm -rf "$S"' EXIT INT TERM
COPIA="$S/conter.sh"
sed -e "s|/opt/backups/la-organizer|$S/backup|g" -e "s|/opt/LA-Organizer/.claude-tom|$S/cli|g" \
    -e "s|/opt/LA-Organizer/logs|$S/logs|g" -e "s|find /tmp -maxdepth 1|find $S/tmp -maxdepth 1|g" \
    -e "s|mktemp /run/varrer|mktemp $S/varrer|g" "$ORIG" > "$COPIA" || exit 2
chmod 0700 "$COPIA"
grep -q "/opt/LA-Organizer/logs" "$COPIA" && { echo "ABORTADO: sobrou raiz viva na copia"; exit 2; }
printf '#!/bin/bash\nprintf "%%s\\n" "$*" >> "%s/alertas.txt"\n' "$S" > "$S/alertar.sh"; chmod 0700 "$S/alertar.sh"
mkdir -m 0700 -p "$S/backup" "$S/cli" "$S/cli-w0" "$S/cli-w1" "$S/logs" "$S/tmp" "$S/bin"

# find falso: nas N primeiras chamadas dentro de cli-w0 imprime ERRO e sai 1; depois delega pro real.
FIND_REAL=$(command -v find)
cat > "$S/bin/find" <<EOF
#!/bin/bash
if [ "\$1" = "$S/cli-w0" ] && [ -f "$S/falhas" ] && [ "\$(cat $S/falhas)" -gt 0 ]; then
  echo \$(( \$(cat $S/falhas) - 1 )) > "$S/falhas"
  echo "find: '\$1/.claude.json.lock': \$(cat $S/msg)" >&2
  exit 1
fi
exec "$FIND_REAL" "\$@"
EOF
chmod 0700 "$S/bin/find"
rodar() { SAIDA=$(PATH="$S/bin:$PATH" "$COPIA" --varrer 2>/dev/null | grep 'conter --varrer'); }
prob() { grep -o 'problemas=[0-9]*' <<<"$SAIDA" | head -1 | cut -d= -f2; }

echo 1 > "$S/falhas"; echo 'No such file or directory' > "$S/msg"; rodar
[ "$(prob)" = 0 ] && ok "arquivo que sumiu 1x no meio da varredura NÃO vira problema" || falha "sumiu 1x -> $SAIDA"

echo 2 > "$S/falhas"; echo 'No such file or directory' > "$S/msg"; rodar
[ "$(prob)" = 0 ] && ok "sumiu 2x seguidas ainda converge (2 repetições)" || falha "sumiu 2x -> $SAIDA"

echo 5 > "$S/falhas"; echo 'No such file or directory' > "$S/msg"; rodar
[ "$(prob)" = 1 ] && ok "sumiu SEMPRE (3 tentativas) -> problema: não é transitório" || falha "sumiu sempre -> $SAIDA"

echo 1 > "$S/falhas"; echo 'Permission denied' > "$S/msg"; rodar
[ "$(prob)" = 1 ] && ok "permissão negada reprova NA PRIMEIRA (fail-closed mantido)" || falha "permission -> $SAIDA"

echo 1 > "$S/falhas"; echo 'Input/output error' > "$S/msg"; rodar
[ "$(prob)" = 1 ] && ok "erro de I/O reprova na primeira" || falha "I/O -> $SAIDA"

echo 0 > "$S/falhas"; rodar
[ "$(prob)" = 0 ] && ok "sem erro nenhum continua 0" || falha "limpo -> $SAIDA"

echo "── $P ok, $F falha(s)"
[ "$F" -eq 0 ]
