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

echo "== BLOQUEADOR 9a: heartbeat impede que deploy LENTO seja roubado =="
# A v2.6 considerava orfao qualquer lock mais velho que o TTL, sem perguntar se o dono estava
# vivo: um deploy legitimo e demorado (build da Vercel, suite completa) era roubado e passava a
# concorrer com quem roubou. Com lease, TTL vencido significa "ninguem renova ha X min".
rm -rf "$LK"
lock_tomar "$LK" "$A" 30 >/dev/null
echo $(( $(date +%s) - 3600 )) > "$LK/epoch"          # deploy longo, sem renovar: seria roubado
lock_heartbeat "$LK" "$A"; RC=$?
[ "$RC" = 0 ] && ok "o dono renova o lease (rc=0)" || falhou "heartbeat do dono falhou (rc=$RC)"
R=$(lock_tomar "$LK" "$B" 30); RC=$?
[ "$RC" = 1 ] && ok "apos o heartbeat, o lock NAO e mais orfao ($R)" \
  || falhou "roubaram um lock que acabou de ser renovado (rc=$RC r=$R)"
# e o inverso: sem renovar, o TTL ainda funciona
echo $(( $(date +%s) - 3600 )) > "$LK/epoch"
R=$(lock_tomar "$LK" "$B" 30); RC=$?
[ "$RC" = 0 ] && ok "sem heartbeat, o TTL continua liberando orfao de verdade ($R)" \
  || falhou "TTL parou de funcionar (rc=$RC)"
lock_soltar "$LK" "$B" >/dev/null 2>&1

echo "== heartbeat de quem NAO e dono e recusado =="
rm -rf "$LK"; lock_tomar "$LK" "$A" 30 >/dev/null
lock_heartbeat "$LK" "$B" 2>/dev/null; RC=$?
[ "$RC" = 1 ] && ok "B nao consegue renovar o lease de A (rc=1)" || falhou "B renovou lease alheio (rc=$RC)"
lock_confirmar "$LK" "$B" 2>/dev/null; RC=$?
[ "$RC" = 1 ] && ok "lock_confirmar recusa quem nao e dono" || falhou "confirmacao de posse passou para B"
lock_confirmar "$LK" "$A"; RC=$?
[ "$RC" = 0 ] && ok "lock_confirmar aceita o dono" || falhou "o dono nao passou na confirmacao"

echo "== BLOQUEADOR 9b: liberacao ATOMICA condicionada ao dono =="
# Antes era "confere nonce" e depois `rm -rf`: entre as duas coisas o lock podia trocar de
# dono, e o rm apagava o lock do novo. Agora a remocao comeca por um `mv -T` atomico e o nonce
# e reconferido no diretorio ja fora do caminho.
rm -rf "$LK"; lock_tomar "$LK" "$A" 30 >/dev/null
# monta a corrida: o diretorio passa a ser de OUTRO dono no instante da liberacao
printf '%s\n' "$B" > "$LK/nonce"
lock_soltar "$LK" "$A" 2>/dev/null; RC=$?
[ "$RC" = 1 ] && ok "A nao remove um lock que virou de B (rc=1)" || falhou "removeu lock alheio (rc=$RC)"
[ -d "$LK" ] && ok "o lock de B continua de pe" || falhou "o lock de B foi apagado"
[ "$(cat "$LK/nonce" 2>/dev/null)" = "$B" ] && ok "o conteudo do lock de B esta intacto" || falhou "o lock de B foi corrompido"
lock_soltar "$LK" "$B" >/dev/null; [ ! -d "$LK" ] && ok "o dono verdadeiro libera" || falhou "B nao conseguiu liberar"
# nenhum diretorio orfao de liberacao ficou para tras
[ -z "$(ls -d "$LK".soltando.* 2>/dev/null)" ] && ok "nenhum residuo .soltando.* deixado" || falhou "sobrou diretorio de liberacao"

echo "== BLOQUEADOR 9c: escopo unico cobre TODAS as saidas do auto-deploy =="
PS1="$AQUI/auto-deploy.ps1"
if [ -r "$PS1" ]; then
  grep -qE '^try \{' "$PS1" && ok "existe um try de topo" || falhou "sem try de topo"
  grep -qE '^finally \{' "$PS1" && ok "existe um finally de topo" || falhou "sem finally de topo"
  L_TRY=$(grep -n '^try {' "$PS1" | head -1 | cut -d: -f1)
  L_FIN=$(grep -n '^finally {' "$PS1" | head -1 | cut -d: -f1)
  L_TOMA=$(grep -n '^\$lk = Tomar-LockDeploy' "$PS1" | head -1 | cut -d: -f1)
  if [ -n "$L_TRY" ] && [ -n "$L_FIN" ] && [ -n "$L_TOMA" ] && [ "$L_TOMA" -lt "$L_TRY" ] && [ "$L_TRY" -lt "$L_FIN" ]; then
    ok "aquisicao ($L_TOMA) -> try ($L_TRY) -> finally ($L_FIN)"
  else
    falhou "ordem errada (toma=${L_TOMA:-?} try=${L_TRY:-?} finally=${L_FIN:-?})"
  fi
  # nenhuma saida entre o try e o finally pode estar FORA do escopo
  FORA=$(awk -v ini="$L_TRY" -v fim="$L_FIN" 'NR>ini && NR<fim' "$PS1" | grep -cE '^\s*exit [0-9]' || true)
  DENTRO=$(awk -v ini="$L_TRY" -v fim="$L_FIN" 'NR>ini && NR<fim' "$PS1" | grep -cE 'exit [0-9]' || true)
  [ "$DENTRO" -gt 0 ] && ok "$DENTRO saida(s) dentro do escopo protegido" || falhou "nenhuma saida no escopo -- o try nao cobre nada"
  DEPOIS=$(awk -v fim="$L_FIN" 'NR>fim' "$PS1" | grep -cE '^\s*exit [0-9]' || true)
  [ "$DEPOIS" = 0 ] && ok "nenhuma saida DEPOIS do finally" || falhou "$DEPOIS saida(s) fora do escopo"
  grep -q 'Bater-LockDeploy' "$PS1" && ok "confirma posse antes de efeito critico (Bater-LockDeploy)" \
    || falhou "nao ha confirmacao de posse antes dos efeitos"
else
  falhou "auto-deploy.ps1 nao encontrado"
fi


echo "== BLOQUEADOR 4: heartbeat ENTRE a leitura da idade e o rename =="
# `lock_tomar` lia epoch vencido e so entao fazia `mv -T`. Se o dono renovasse nessa fresta, o
# invasor ainda movia e substituia um lock RECEM-RENOVADO. Reproducao independente do Alfredo:
# um wrapper de `mv` renovava o epoch imediatamente antes do rename e mesmo assim saia
# ORFAO-REMOVIDO, rc=0, com o invasor virando dono.
# Aqui a fresta e montada de forma DETERMINISTICA: um `mv` falso que renova o epoch antes de
# chamar o mv de verdade. Se o takeover ainda vencer, o lock foi roubado de um dono vivo.
rm -rf "$LK"; lock_tomar "$LK" "$A" 30 >/dev/null
echo $(( $(date +%s) - 3600 )) > "$LK/epoch"      # parece orfao para quem le agora
mkdir -p "$D/bin"
cat > "$D/bin/mv" <<EOF
#!/bin/bash
# renova o lease do dono EXATAMENTE na fresta entre a leitura da idade e o rename
[ -d "$LK" ] && date +%s > "$LK/epoch" 2>/dev/null
exec /bin/mv "\$@"
EOF
chmod +x "$D/bin/mv"
R=$(PATH="$D/bin:$PATH" lock_tomar "$LK" "$B" 30); RC=$?
if [ "$RC" = 1 ]; then
  ok "heartbeat na fresta impede o takeover ($R)"
else
  falhou "roubou lock renovado na fresta (rc=$RC r=$R)"
fi
[ -d "$LK" ] && ok "o lock do dono continua existindo" || falhou "o lock do dono sumiu"
[ "$(cat "$LK/nonce" 2>/dev/null)" = "$A" ] && ok "o dono continua sendo A (nao virou invasor)" \
  || falhou "o dono virou $(cat "$LK/nonce" 2>/dev/null)"
IDADE=$(( ( $(date +%s) - $(cat "$LK/epoch" 2>/dev/null || echo 0) ) / 60 ))
[ "$IDADE" -lt 2 ] && ok "o lease renovado foi preservado (idade ${IDADE}min)" || falhou "lease perdido (${IDADE}min)"
rm -f "$D/bin/mv"
# e o orfao DE VERDADE (sem heartbeat) continua sendo recuperado
echo $(( $(date +%s) - 3600 )) > "$LK/epoch"
R=$(lock_tomar "$LK" "$B" 30); RC=$?
[ "$RC" = 0 ] && ok "orfao sem heartbeat continua sendo recuperado ($R)" || falhou "TTL parou de funcionar (rc=$RC)"
lock_soltar "$LK" "$B" >/dev/null 2>&1; rm -rf "$LK"

echo "== BLOQUEADOR 7: guarda ADJACENTE a cada efeito critico =="
PS1="$AQUI/auto-deploy.ps1"
if [ -r "$PS1" ]; then
  # cada efeito critico e sua assinatura no .ps1
  efeitos=(
    'git -C \$srcRoot push origin main'
    'git reset --hard \$script:deploySha --quiet'
    'pm2 restart tom --no-color 2>&1 | tail -2'
    'patch-crontab.sh --aplicar 2>&1'
  )
  for e in "${efeitos[@]}"; do
    LN=$(grep -nE "$e" "$PS1" | head -1 | cut -d: -f1)
    if [ -z "$LN" ]; then falhou "efeito nao encontrado no ps1: $e"; continue; fi
    # a guarda tem que estar nas 3 linhas ANTES do efeito -- adjacencia, nao "existe em algum lugar"
    if sed -n "$((LN-3)),$((LN-1))p" "$PS1" | grep -q 'Confirmar-AntesDoEfeito'; then
      ok "guarda adjacente antes de: $(printf '%s' "$e" | cut -c1-42)"
    else
      falhou "SEM guarda adjacente antes de: $(printf '%s' "$e" | cut -c1-42) (linha $LN)"
    fi
  done
  # quantidade: uma guarda por efeito, no minimo
  N_G=$(grep -c 'if (-not (Confirmar-AntesDoEfeito' "$PS1" || true)
  [ "$N_G" -ge "${#efeitos[@]}" ] && ok "$N_G guarda(s) para ${#efeitos[@]} efeito(s) criticos" \
    || falhou "so $N_G guarda(s) para ${#efeitos[@]} efeitos"
  # a guarda confirma posse E alvo
  if grep -A12 'function Confirmar-AntesDoEfeito' "$PS1" | grep -q 'Bater-LockDeploy' \
     && grep -A18 'function Confirmar-AntesDoEfeito' "$PS1" | grep -q 'rev-parse origin/main'; then
    ok "a guarda confirma posse do lock E que origin/main nao moveu"
  else
    falhou "a guarda nao cobre as duas coisas"
  fi

  echo "== BLOQUEADOR 2: nenhum reset em ref MUTAVEL =="
  MUT=0
  while IFS= read -r linha; do
    case "$linha" in
      *'reset --hard $script:deploySha'*|*'reset --hard $prev'*|*'reset --hard $CAND'*) : ;;
      *'reset --hard'*)
        case "$linha" in *'#'*) : ;; *) MUT=$((MUT+1)); echo "        ref mutavel: $(printf '%s' "$linha" | sed 's/^ *//' | cut -c1-72)" ;; esac ;;
    esac
  # so INVOCACOES de verdade: linhas com `git reset --hard`. Mensagem de erro que MENCIONA
  # "reset --hard" nao e chamada -- contar texto como codigo e a forma mais facil de um
  # teste estrutural virar ruido e ser ignorado.
  done < <(grep -E 'ssh tom .*git reset --hard|git -C .*reset --hard' "$PS1" | grep -v '^\s*#')
  [ "$MUT" = 0 ] && ok "todas as chamadas a reset --hard usam SHA literal ou ponto de retorno" \
    || falhou "$MUT chamada(s) a reset --hard em referencia mutavel"
  grep -q 'reset --hard origin/main' "$PS1" && falhou "ainda ha 'reset --hard origin/main'" \
    || ok "nenhum 'reset --hard origin/main' no caminho canonico"
else
  falhou "auto-deploy.ps1 nao encontrado"
fi


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
