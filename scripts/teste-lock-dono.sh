#!/bin/bash
# Testes do lock de deploy com DONO (laudo v2.5, bloqueador 1). Diretorio descartavel.
#
# O falso-verde que estes testes existem para nao ter: o processo que recebe OCUPADO chamava
# a liberacao e APAGAVA o lock do dono — o segundo deploy nao entrava na janela, ele destruia
# a protecao do primeiro. E o caminho sem commit soltava um lock que nunca tinha adquirido.

set -uo pipefail
AQUI="$(dirname "$(readlink -f "$0")")"
# shellcheck disable=SC1090
. "$AQUI/lib-lock.sh"
P=0; F=0
ok()    { P=$((P+1)); printf '  ok    %s\n' "$1"; }
falhou(){ F=$((F+1)); printf '  FALHA %s\n' "$1"; }
D=$(mktemp -d "${TMPDIR:-/tmp}/lockdono.XXXXXX")
trap 'rm -rf "$D"' EXIT INT TERM
LK="$D/deploy.lock"
A=nonce-processo-A; B=nonce-processo-B

echo "== aquisicao e exclusao mutua =="
R=$(lock_tomar "$LK" "$A" 30); RC=$?
[ "$RC" = 0 ] && [ "$R" = ADQUIRIDO ] && ok "A adquire ($R)" || falhou "A nao adquiriu (rc=$RC r=$R)"
R=$(lock_tomar "$LK" "$B" 30); RC=$?
[ "$RC" = 1 ] && case "$R" in OCUPADO*) ok "B recebe OCUPADO e rc=1 ($R)" ;; *) falhou "B recebeu '$R'" ;; esac \
  || falhou "B deveria ter rc=1, veio rc=$RC ($R)"

echo "== O BLOQUEADOR: o perdedor nao pode liberar o lock do dono =="
lock_soltar "$LK" "$B" 2>/dev/null; RC=$?
[ "$RC" = 1 ] && ok "B tenta soltar e e RECUSADO (rc=1)" || falhou "B soltou lock alheio (rc=$RC)"
[ -d "$LK" ] && ok "o lock de A CONTINUA de pe depois da tentativa de B" \
             || falhou "o lock de A foi apagado por B — e exatamente o bloqueador"
lock_dono "$LK" "$A" && ok "o dono continua sendo A" || falhou "o nonce gravado nao e mais o de A"

echo "== o dono libera =="
lock_soltar "$LK" "$A"; RC=$?
[ "$RC" = 0 ] && [ ! -d "$LK" ] && ok "A libera o proprio lock" || falhou "A nao liberou (rc=$RC)"
lock_soltar "$LK" "$A"; RC=$?
[ "$RC" = 0 ] && ok "soltar lock inexistente e no-op (idempotente)" || falhou "rc=$RC em lock ja liberado"

echo "== orfao: o TEMPO libera, a vontade nao =="
lock_tomar "$LK" "$A" 30 >/dev/null
echo $(( $(date +%s) - 3600 )) > "$LK/epoch"
R=$(lock_tomar "$LK" "$B" 30); RC=$?
[ "$RC" = 0 ] && [ "$R" = ORFAO-REMOVIDO ] && ok "B recupera orfao de 60min (ttl 30)" || falhou "B nao recuperou (rc=$RC r=$R)"
lock_dono "$LK" "$B" && ok "o dono passou a ser B" || falhou "nonce nao virou o de B"
lock_soltar "$LK" "$A" 2>/dev/null; RC=$?
[ "$RC" = 1 ] && [ -d "$LK" ] && ok "o dono ANTIGO nao consegue soltar o lock novo" || falhou "A soltou o lock de B (rc=$RC)"
lock_soltar "$LK" "$B" >/dev/null

echo "== concorrencia real: N processos, exatamente 1 vencedor =="
# TRES rajadas de 16. Com 8 numa rajada so, a corrida entre `mkdir` e a escrita do `epoch`
# aparecia de vez em quando -- e teste que pega o bug "as vezes" deixa o bug passar. Aqui
# ela apareceu: dois vencedores, porque quem chegava na fresta lia epoch vazio, calculava
# idade infinita e tratava um lock recem-criado como orfao, roubando-o.
RAJADAS_RUINS=0
for rajada in 1 2 3; do
  rm -rf "$LK"; : > "$D/placar"
  for i in $(seq 1 16); do
    ( r=$(lock_tomar "$LK" "nonce-$rajada-$i" 30) && printf 'VENCEU %s\n' "$i" >> "$D/placar" ) &
  done
  wait
  V=$(grep -c '^VENCEU' "$D/placar" 2>/dev/null || true)
  [ "$V" = 1 ] || { RAJADAS_RUINS=$((RAJADAS_RUINS+1)); echo "        rajada $rajada: $V vencedores"; }
done
[ "$RAJADAS_RUINS" = 0 ] && ok "3 rajadas de 16 processos simultaneos, 1 vencedor em cada" \
  || falhou "$RAJADAS_RUINS de 3 rajadas com numero de vencedores != 1"
rm -rf "$LK"

echo "== a fresta entre mkdir e epoch (deterministico) =="
# `mkdir` e atomico, mas o dono ainda leva microsegundos para escrever `epoch`. Quem
# chegasse nessa fresta lia epoch VAZIO; a versao anterior assumia 0, calculava idade
# astronomica e ROUBAVA um lock recem-criado. A rajada concorrente so exibia isso as
# vezes -- teste que pega o bug "as vezes" deixa o bug passar. Aqui a fresta e montada a
# mao: diretorio de lock existente, SEM epoch. Recem-criado -> OCUPADO.
rm -rf "$LK"; mkdir "$LK"
R=$(lock_tomar "$LK" "$B" 30); RC=$?
[ "$RC" = 1 ] && ok "lock sem epoch e RECENTE nao e tratado como orfao ($R)" \
  || falhou "roubou lock recem-criado que ainda nao tinha epoch (rc=$RC r=$R)"
[ -d "$LK" ] && [ ! -f "$LK/nonce" ] && ok "o lock do dono continua de pe, sem nonce alheio" \
  || falhou "o lock foi tomado ou marcado por quem chegou na fresta"
# e o mesmo diretorio, envelhecido pelo mtime, PRECISA expirar -- senao um lock
# abandonado sem epoch travaria o deploy para sempre.
touch -d "-2 hours" "$LK"
R=$(lock_tomar "$LK" "$B" 30); RC=$?
[ "$RC" = 0 ] && ok "o mesmo lock sem epoch, com 2h de mtime, expira ($R)" \
  || falhou "lock sem epoch nunca expira (rc=$RC r=$R) -- deploy travado para sempre"
rm -rf "$LK"

echo "== ordem no auto-deploy.ps1: adquirir ANTES de qualquer sync =="
# Nao basta a lib estar certa: o caminho SEM COMMIT precisa adquirir antes de sincronizar, e
# nenhuma saida pode soltar sem nonce. Isso e propriedade do chamador, entao e medido nele.
PS1="$AQUI/auto-deploy.ps1"
if [ -r "$PS1" ]; then
  # NAO basta preceder textualmente: na v2.5 a chamada estava DENTRO do `if ($temCommit)`,
  # 8 espacos indentada, e o ramo que so sincroniza nunca passava por ela. A aquisicao tem
  # que ser de topo (coluna 0), fora de qualquer ramo.
  L_TOMAR=$(grep -n '^\$lk = Tomar-LockDeploy' "$PS1" | head -1 | cut -d: -f1)
  L_SYNC=$(grep -n 'vpsAtras = ' "$PS1" | head -1 | cut -d: -f1)
  L_ANINHADA=$(grep -cE '^[[:space:]]+\$lk = Tomar-LockDeploy' "$PS1" || true)
  if [ -n "$L_TOMAR" ] && [ -n "$L_SYNC" ] && [ "$L_TOMAR" -lt "$L_SYNC" ] && [ "$L_ANINHADA" = 0 ]; then
    ok "lock adquirido no topo (linha $L_TOMAR), fora de ramo, antes da sincronizacao (linha $L_SYNC)"
  else
    falhou "aquisicao nao e de topo (topo=${L_TOMAR:-nenhuma} aninhadas=$L_ANINHADA sync=${L_SYNC:-?})"
  fi
  # Toda liberacao tem que passar pelo nonce; `rm -rf` do diretorio de lock, cru ou por
  # variavel, e o bug — foi assim que o perdedor apagava o lock do dono.
  CRU=$(grep -cE 'rm -rf .*[Ll]ock' "$PS1" || true)
  [ "$CRU" = 0 ] && ok "nenhuma remocao crua do diretorio de lock no ps1" || falhou "$CRU remocao(oes) crua(s) de lock no ps1"
  grep -q 'lock_soltar \$lockDir \$lockNonce' "$PS1" && ok "a liberacao passa o nonce para a lib"     || falhou "Soltar-LockDeploy nao passa nonce — nao ha como a lib recusar lock alheio"
  # E o perdedor nao pode soltar: depois de "DEPLOY ADIADO: outra reconciliacao", nada de Soltar
  ADIADO=$(grep -n 'outra reconciliacao' "$PS1" | head -1 | cut -d: -f1)
  if [ -n "$ADIADO" ]; then
    TRECHO=$(sed -n "${ADIADO},$((ADIADO+3))p" "$PS1")
    grep -q 'Soltar-LockDeploy' <<<"$TRECHO" && falhou "o caminho OCUPADO ainda chama Soltar-LockDeploy" \
      || ok "o caminho OCUPADO sai SEM soltar o lock alheio"
  else
    falhou "nao achei o caminho OCUPADO no ps1"
  fi
else
  falhou "auto-deploy.ps1 nao encontrado em $PS1"
fi

echo
echo "== $P passaram, $F falharam =="
[ "$F" -eq 0 ]
