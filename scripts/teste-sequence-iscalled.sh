#!/bin/bash
# is_called REAL da sequence (laudo v2.6, bloqueador 6).
# NIVEL: integration-sandbox. Sobe um Postgres DESCARTAVEL em docker; nao toca no banco de
# producao, em /run, em crontab nem na rede alem da imagem local.
#
# Baseline e drill usavam `(last_value is not null)` no lugar de is_called, e
# `coalesce(last_value, 0)` no lugar do valor. MEDIDO neste Postgres 17: o `called` sai
# certo (a view devolve last_value NULO exatamente quando is_called e false) -- entao a
# frase "confunde is_called" NAO se sustenta aqui, e este teste mede o que realmente
# acontece, nao o que eu supus.
# O falso-verde real e o VALOR: toda sequence com is_called=false era gravada como `0`,
# qualquer que fosse o numero. setval(5,false) e setval(9,false) viram a MESMA string, e o
# drill compara igual com igual e aprova uma restauracao que perdeu 4 no contador.
# A leitura correta vem da propria relation (last_value E is_called), com o identificador
# citado por `format('%I.%I')`.

set -uo pipefail
AQUI="$(dirname "$(readlink -f "$0")")"
P=0; F=0
ok()    { P=$((P+1)); printf '  ok    %s\n' "$1"; }
falhou(){ F=$((F+1)); printf '  FALHA %s\n' "$1"; }

command -v docker >/dev/null 2>&1 || { echo "  ABORTADO: docker ausente (este teste exige sandbox real)"; exit 2; }
# shellcheck disable=SC1090
. "$AQUI/lib-baseline-queries.sh" || { echo "  ABORTADO: lib-baseline-queries.sh nao carrega"; exit 2; }
# shellcheck disable=SC1090
. "$AQUI/lib-seq-compare.sh" 2>/dev/null || { echo "  ABORTADO: lib-seq-compare.sh nao carrega"; exit 2; }

CONT=teste-seq-iscalled-$$
SENHA=$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | head -c 18)
IMAGEM=${DRILL_IMAGE:-postgres:17}
limpar(){ docker rm -f "$CONT" >/dev/null 2>&1; }
trap limpar EXIT INT TERM

docker run -d --name "$CONT" -e POSTGRES_PASSWORD="$SENHA" "$IMAGEM" >/dev/null 2>&1 \
  || { echo "  ABORTADO: nao consegui subir $IMAGEM"; exit 2; }
for _ in $(seq 1 60); do
  docker exec "$CONT" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$CONT" pg_isready -U postgres >/dev/null 2>&1 || { echo "  ABORTADO: postgres nao subiu"; exit 2; }
psql_() { docker exec -i "$CONT" psql -U postgres -tAq -c "$1" 2>/dev/null; }

# a consulta EXATA que o baseline usa -- lida da lib, nunca reescrita aqui, senao o teste
# passaria a medir uma consulta que o produto nao usa.
Q_SEQ=""
for par in "${BASELINE_QUERIES[@]}"; do
  case "$par" in sequences_estado\|*) Q_SEQ=${par#*|} ;; esac
done
[ -n "$Q_SEQ" ] && ok "consulta de sequences_estado veio da lib (nao reescrita no teste)" \
  || { falhou "nao achei sequences_estado em BASELINE_QUERIES"; echo "== $P passaram, $F falharam =="; exit 1; }

psql_ "create sequence public.s_teste;" >/dev/null
psql_ "select nextval('public.s_teste');" >/dev/null   # last_value=1, is_called=true

echo "== o estado real e lido, com identificador citado com seguranca =="
EST=$(psql_ "$Q_SEQ" | tr -d '[:space:]')
[ "$EST" = "s_teste:1:called=true" ] && ok "apos nextval: $EST" || falhou "esperava s_teste:1:called=true, veio '$EST'"

echo "== O BLOQUEADOR: mesmo last_value, is_called INVERTIDO =="
psql_ "select setval('public.s_teste', 1, false);" >/dev/null
EST2=$(psql_ "$Q_SEQ" | tr -d '[:space:]')
[ "$EST2" = "s_teste:1:called=false" ] && ok "apos setval(...,false): $EST2" || falhou "esperava called=false, veio '$EST2'"
[ "$EST" != "$EST2" ] && ok "os dois estados sao DISTINGUIVEIS pela consulta" \
  || falhou "a consulta nao distingue os dois estados -- e o bloqueador"

echo "== e a comparacao do drill REPROVA essa diferenca =="
seq_verificar "s_teste:1:called=true" "1:false"; RC=$?
[ "$RC" = 1 ] && ok "baseline called=true x restore called=false -> reprova (rc=1)" || falhou "rc=$RC, deveria reprovar"
seq_verificar "s_teste:1:called=false" "1:false"; RC=$?
[ "$RC" = 0 ] && ok "estados iguais -> aprova (rc=0)" || falhou "rc=$RC em estados iguais"

echo "== o falso-verde REAL da formula antiga =="
# Eu tinha escrito que a formula antiga confundia o `called`. MEDIDO neste Postgres 17: ela
# ACERTA o called (a view devolve last_value NULO justamente quando is_called e false).
# O falso-verde e outro, e continua sendo falso-verde: com `coalesce(last_value,0)`, TODA
# sequence com is_called=false vira `0`, seja qual for o valor real. Duas sequences bem
# diferentes -- setval(5,false) e setval(9,false) -- sao gravadas com a MESMA string, e o
# drill compara igual com igual e aprova.
antiga() {  # <valor> <called>
  psql_ "select setval('public.s_teste', $1, $2);" >/dev/null
  psql_ "select coalesce(last_value::text,'0')||':called='||(last_value is not null)::text from pg_sequences where schemaname='public' and sequencename='s_teste'" | tr -d '[:space:]'
}
nova() {    # <valor> <called>
  psql_ "select setval('public.s_teste', $1, $2);" >/dev/null
  psql_ "$Q_SEQ" | grep "^s_teste:" | tr -d '[:space:]'
}
A5=$(antiga 5 false); A9=$(antiga 9 false)
if [ "$A5" = "$A9" ]; then
  ok "formula antiga: setval(5,false) e setval(9,false) dao a MESMA string ('$A5') -- falso-verde"
else
  falhou "a formula antiga distinguiu ($A5 x $A9); a premissa deste teste caiu"
fi
N5=$(nova 5 false); N9=$(nova 9 false)
[ "$N5" != "$N9" ] && ok "formula nova distingue: '$N5' x '$N9'" || falhou "a nova tambem colapsou ($N5)"
seq_verificar "s_teste:5:called=false" "9:false"; RC=$?
[ "$RC" = 1 ] && ok "com a leitura correta, 5 x 9 com called=false REPROVA (rc=1)" || falhou "rc=$RC"

echo "== identificador hostil nao quebra nem injeta =="
psql_ 'create sequence public."s com aspas ""e"" espaco";' >/dev/null
SAIDA=$(psql_ "$Q_SEQ")
grep -q 's com aspas' <<<"$SAIDA" && ok "sequence com aspas e espaco e lida (format %I citou certo)" \
  || falhou "identificador hostil nao foi lido: $(head -3 <<<"$SAIDA" | tr '\n' ' ')"
grep -qi 'error' <<<"$SAIDA" && falhou "a consulta errou com identificador hostil" || ok "nenhum erro de SQL com identificador hostil"

echo
echo "== $P passaram, $F falharam =="
[ "$F" -eq 0 ]
