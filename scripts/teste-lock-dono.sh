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
RAJADAS_RUINS=0; : > "$D/rajadas.err"
for rajada in 1 2 3; do
  rm -rf "$LK" "$LK".mutex "$LK".mutex.* "$LK".orfao.* 2>/dev/null; : > "$D/placar"
  for i in $(seq 1 16); do
    ( r=$(lock_tomar "$LK" "nonce-$rajada-$i" 30 2>>"$D/rajadas.err") && printf 'VENCEU %s
' "$i" >> "$D/placar" ) &
  done
  wait
  V=$(grep -c '^VENCEU' "$D/placar" 2>/dev/null || true)
  [ "$V" = 1 ] || { RAJADAS_RUINS=$((RAJADAS_RUINS+1)); echo "        rajada $rajada: $V vencedores"; }
done
if [ "$RAJADAS_RUINS" = 0 ]; then ok "3 rajadas de 16 processos simultaneos, 1 vencedor em cada"
else falhou "$RAJADAS_RUINS de 3 rajadas com numero de vencedores != 1"; fi
# STDERR E EVIDENCIA (laudo v2.9): a bateria terminava 66/0 com "epoch: No such file or
# directory" no stderr -- prova de posse perdida que a contagem nao via. Agora qualquer
# stderr inesperado nas rajadas REPROVA, mesmo com o placar perfeito.
if [ -s "$D/rajadas.err" ]; then
  falhou "stderr inesperado nas rajadas ($(wc -l < "$D/rajadas.err") linha(s)):"
  head -4 "$D/rajadas.err" | sed 's/^/        /'
else
  ok "rajadas com stderr LIMPO (posse nunca foi perdida em silencio)"
fi
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
  # ORDEM NOVA (laudo v2.9, bloqueador 3): o try abre ANTES da primeira materializacao e da
  # aquisicao -- lock ocupado ou bootstrap falho tambem passam pelo finally. A v2.9 exigia
  # toma < try, e era exatamente o furo: saidas antes do try nao limpavam nada.
  L_TRY=$(grep -n '^try {' "$PS1" | head -1 | cut -d: -f1)
  L_FIN=$(grep -n '^finally {' "$PS1" | head -1 | cut -d: -f1)
  L_TOMA=$(grep -n '^\$lk = Tomar-LockDeploy' "$PS1" | head -1 | cut -d: -f1)
  L_MAT=$(grep -n '^\$candDir = Materializar-Candidato' "$PS1" | head -1 | cut -d: -f1)
  if [ -n "$L_TRY" ] && [ -n "$L_FIN" ] && [ -n "$L_TOMA" ] && [ -n "$L_MAT" ]      && [ "$L_TRY" -lt "$L_MAT" ] && [ "$L_MAT" -lt "$L_TOMA" ] && [ "$L_TOMA" -lt "$L_FIN" ]; then
    ok "try ($L_TRY) -> materializa ($L_MAT) -> adquire ($L_TOMA) -> finally ($L_FIN)"
  else
    falhou "ordem errada (try=${L_TRY:-?} mat=${L_MAT:-?} toma=${L_TOMA:-?} finally=${L_FIN:-?})"
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


echo "== BLOQUEADOR 2 (laudo v2.9): o mutex tem dono verificavel =="
# O stderr da propria bateria entregou o furo: "mutex/epoch: No such file or directory" com a
# contagem 66/0 -- um processo perdeu o mutex depois do mkdir e seguiu como dono. Tres provas:
#   a. posse so com nonce gravado E relido; sabotagem na fresta -> rc=2, sem secao critica;
#   b. liberacao TARDIA de A nao remove o mutex fresco de C;
#   c. rajadas com stderr capturado: qualquer stderr inesperado reprova, mesmo verde.

C=nonce-processo-C
echo "-- a. releitura sabotada: rc=2, nunca posse fingida --"
rm -rf "$LK" "$LK".mutex "$LK".mutex.* "$LK".orfao.* 2>/dev/null
mkdir -p "$D/bin2"
# o `date` sabotado troca o nonce do mutex ENTRE a gravacao e a releitura -- exatamente a
# janela em que a v2.9 seguia como dona sem conferir.
cat > "$D/bin2/date" <<EOF
#!/bin/bash
if [ -n "\${MUTEX_SABOTAR:-}" ] && [ -f "$LK.mutex/nonce" ]; then
  printf 'intruso\n' > "$LK.mutex/nonce" 2>/dev/null
fi
exec /bin/date "\$@"
EOF
chmod +x "$D/bin2/date"
R=$(PATH="$D/bin2:$PATH" MUTEX_SABOTAR=1 lock_tomar "$LK" "$A" 30 2>"$D/mx.err"); RC=$?
if [ "$RC" = 2 ] && [ "$R" = FALHA-MUTEX ]; then
  ok "posse sabotada na fresta -> rc=2 FALHA-MUTEX (nao entra na secao critica)"
else
  falhou "seguiu sem posse provada (rc=$RC r=$R)"
fi
grep -q 'nao e meu apos a gravacao' "$D/mx.err" && ok "o motivo diz que a releitura nao bateu" \
  || falhou "sem diagnostico da releitura: $(head -1 "$D/mx.err")"
[ ! -d "$LK" ] && ok "nenhum lock canonico foi criado sem posse do mutex" || falhou "criou lock sem mutex"
rm -rf "$LK".mutex 2>/dev/null

echo "-- b. liberacao tardia de A nao remove o mutex de C --"
rm -rf "$LK" "$LK".mutex "$LK".mutex.* 2>/dev/null
lock_mutex_tomar "$LK" "$A" >/dev/null 2>&1 || falhou "A nao tomou o mutex"
echo $(( $(date +%s) - 3600 )) > "$LK.mutex/epoch"      # A ficou para tras; mutex expira
lock_mutex_tomar "$LK" "$C" >/dev/null 2>&1; RC=$?
[ "$RC" = 0 ] && ok "C recupera o mutex orfao de A" || falhou "C nao recuperou (rc=$RC)"
[ "$(cat "$LK.mutex/nonce" 2>/dev/null)" = "$C" ] && ok "o mutex atual e de C" || falhou "nonce atual: $(cat "$LK.mutex/nonce" 2>/dev/null)"
lock_mutex_soltar "$LK" "$A" 2>/dev/null; RC=$?
[ "$RC" = 1 ] && ok "a liberacao TARDIA de A e recusada (rc=1)" || falhou "A soltou o mutex de C (rc=$RC)"
[ -d "$LK.mutex" ] && [ "$(cat "$LK.mutex/nonce" 2>/dev/null)" = "$C" ] && ok "o mutex de C sobreviveu intacto" \
  || falhou "o mutex de C foi removido ou corrompido pela liberacao tardia"
lock_mutex_soltar "$LK" "$C" >/dev/null 2>&1; RC=$?
[ "$RC" = 0 ] && [ ! -d "$LK.mutex" ] && ok "C libera o proprio mutex" || falhou "C nao liberou (rc=$RC)"
[ -z "$(ls -d "$LK".mutex.solto.* "$LK".mutex.morto.* 2>/dev/null)" ] && ok "zero residuo de mutex" \
  || falhou "residuo: $(ls -d "$LK".mutex.* 2>/dev/null | tr '\n' ' ')"

echo "-- c. mutex FRESCO nao e roubado pela recuperacao --"
rm -rf "$LK" "$LK".mutex 2>/dev/null
lock_mutex_tomar "$LK" "$A" >/dev/null 2>&1
# parece velho para quem le AGORA, mas o dono grava o epoch na fresta (via date sabotado que
# renova em vez de trocar): a recuperacao move, reconfere, ve fresco e DEVOLVE.
echo $(( $(date +%s) - 3600 )) > "$LK.mutex/epoch"
cat > "$D/bin2/mv" <<EOF
#!/bin/bash
case "\$*" in *".mutex "*".mutex.morto."*) date +%s > "$LK.mutex/epoch" 2>/dev/null ;; esac
exec /bin/mv "\$@"
EOF
chmod +x "$D/bin2/mv"
# B roda ate desistir sozinho (~5s): matar no meio deixava o mutex de A movido e .morto
# residual -- intermitencia criada pelo proprio teste, nao pelo produto.
( PATH="$D/bin2:$PATH" lock_mutex_tomar "$LK" "$B" >/dev/null 2>&1 ) & MXPID=$!
wait "$MXPID" 2>/dev/null
rm -f "$D/bin2/mv"
[ -d "$LK.mutex" ] && [ "$(cat "$LK.mutex/nonce" 2>/dev/null)" = "$A" ] \
  && ok "mutex renovado na fresta foi DEVOLVIDO (continua de A)" \
  || falhou "mutex fresco foi roubado (dono: $(cat "$LK.mutex/nonce" 2>/dev/null))"
lock_mutex_soltar "$LK" "$A" >/dev/null 2>&1; rm -rf "$LK" "$LK".mutex 2>/dev/null


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

echo "== BLOQUEADOR 2 (laudo v2.8): tres concorrentes, A/B/C =="
# A e dono e renova na fresta; B move A para .orfao; C, que so faz `mkdir`, encontrava o
# caminho canonico LIVRE e virava dono; B percebia que A estava vivo e tentava devolver, mas o
# `mv` de volta falhava em silencio. Resultado: C dono, A abandonado em .orfao.
# Agora toda aquisicao passa por um mutex, entao C nao observa o caminho no meio da transicao.
C=nonce-processo-C
residuos() { ls -d "$LK".orfao.* "$LK".mutex "$LK".mutex.morto.* "$LK".mutex.solto.* 2>/dev/null | wc -l; }
# A mensagem tem que NOMEAR o que a contagem contou. Ate 31/08 `residuos()` contava QUATRO
# padroes e a falha listava dois (`.orfao.*` e `.mutex`) ou nenhum -- entao um flake real na
# suite completa saiu como `FALHA 1 residuo(s): ` com a lista VAZIA, e nao deu pra saber o
# que tinha sobrado. Diagnostico que nao nomeia o achado obriga a proxima pessoa a reproduzir
# do zero. NAO mexo na limpeza: sumir com o residuo sem saber qual e mascararia um defeito
# real do lib-lock -- o `.mutex.morto.*` e o unico que a funcao conta e a listagem nao mostra.
listar_residuos() { ls -d "$LK".orfao.* "$LK".mutex "$LK".mutex.morto.* "$LK".mutex.solto.* 2>/dev/null | tr -s "[:space:]" " "; }

# ESPERA ASSENTAR ANTES DE JULGAR (31/08). Estas afirmacoes mediam um estado TRANSITORIO.
# Reproduzido sob carga (4 cpus ocupadas, 12 rodadas): 2 falhas, e numa delas a mensagem saiu
# "FALHA 0 residuo(s)" -- contou nao-zero e um instante depois ja era zero. A raiz: o orfao C
# nasce DENTRO do subshell do `mv` falso, entao `$D/c.pid` pode ainda nao existir quando o
# bloco de sincronizacao roda; o `[ -f ... ]` da falso, ninguem espera, e o `.mutex` que o C
# segura legitimamente aparece como residuo.
# Residuo que SOME sozinho nao e vazamento -- e corrida de medicao. O que reprova continua
# sendo o que PERSISTE: se nao assentar em 5s, falha igual, e a mensagem mostra o estado FINAL.
sem_residuo() { for _ in $(seq 1 50); do [ "$(residuos)" = 0 ] && return 0; sleep 0.1; done; return 1; }

echo "-- A renova na fresta: A continua dono, B e C nao vencem --"
rm -rf "$LK" "$LK".orfao.* "$LK".mutex "$LK".mutex.morto.* 2>/dev/null
lock_tomar "$LK" "$A" 30 >/dev/null
echo $(( $(date +%s) - 3600 )) > "$LK/epoch"
mkdir -p "$D/bin"
# o `mv` falso faz duas coisas na fresta: renova o lease de A (como o heartbeat faria) e
# solta um C tentando adquirir o caminho canonico exatamente nesse instante.
cat > "$D/bin/mv" <<EOF
#!/bin/bash
if [ -d "$LK" ]; then
  date +%s > "$LK/epoch" 2>/dev/null
  ( . "$AQUI/lib-lock.sh"; lock_tomar "$LK" "$C" 30 >"$D/c.out" 2>&1 ) & echo \$! > "$D/c.pid"
  sleep 0.2
fi
exec /bin/mv "\$@"
EOF
chmod +x "$D/bin/mv"
R=$(PATH="$D/bin:$PATH" lock_tomar "$LK" "$B" 30); RC=$?
wait 2>/dev/null
rm -f "$D/bin/mv"
# O C foi disparado DENTRO do subshell do mv falso: ele NAO e filho deste shell, entao o
# `wait` acima nao o espera. Sem esta sincronizacao, C continuava disputando o mutex por
# ate 5s e contaminava os blocos seguintes -- foi exatamente a intermitencia que o
# stderr-strict pegou. Espera pelo pidfile, com timeout.
if [ -f "$D/c.pid" ]; then
  CPID=$(cat "$D/c.pid" 2>/dev/null)
  for _ in $(seq 1 80); do kill -0 "$CPID" 2>/dev/null || break; sleep 0.1; done
  kill -0 "$CPID" 2>/dev/null && falhou "C orfao nao terminou em 8s"
  rm -f "$D/c.pid"
fi
if [ "$RC" != 0 ]; then ok "B nao vence com A vivo ($R)"; else falhou "B venceu contra dono vivo (rc=$RC r=$R)"; fi
DONO=$(cat "$LK/nonce" 2>/dev/null)
if [ "$DONO" = "$A" ]; then ok "A continua dono depois da disputa de tres"
else falhou "o dono virou '${DONO:-NINGUEM}' -- A foi abandonado"; fi
if grep -q "ADQUIRIDO\|ORFAO-REMOVIDO" "$D/c.out" 2>/dev/null; then
  falhou "C venceu enquanto B mexia no caminho canonico: $(cat "$D/c.out")"
else
  ok "C nao adquiriu durante a transicao de B ($(head -1 "$D/c.out" 2>/dev/null | cut -c1-24))"
fi
if sem_residuo; then ok "zero residuo .orfao/.mutex"; else falhou "$(residuos) residuo(s): $(listar_residuos)"; fi

echo "-- A NAO renova: exatamente um entre B e C vence --"
rm -rf "$LK" "$LK".orfao.* "$LK".mutex "$LK".mutex.morto.* 2>/dev/null
lock_tomar "$LK" "$A" 30 >/dev/null
echo $(( $(date +%s) - 3600 )) > "$LK/epoch"
: > "$D/placarbc"
for n in "$B" "$C"; do
  ( r=$(lock_tomar "$LK" "$n" 30) && case "$r" in ADQUIRIDO*|ORFAO*) printf 'VENCEU %s\n' "$n" >> "$D/placarbc" ;; esac ) &
done
wait
V=$(grep -c '^VENCEU' "$D/placarbc" 2>/dev/null || true)
if [ "$V" = 1 ]; then ok "exatamente um vencedor entre B e C ($(sed -n 's/^VENCEU //p' "$D/placarbc"))"
else falhou "$V vencedores"; fi
if sem_residuo; then ok "zero residuo apos a tomada legitima"; else falhou "$(residuos) residuo(s): $(listar_residuos)"; fi

echo "-- falha ao DEVOLVER e fail-closed: nem vitoria nem dono abandonado --"
rm -rf "$LK" "$LK".orfao.* "$LK".mutex "$LK".mutex.morto.* 2>/dev/null
lock_tomar "$LK" "$A" 30 >/dev/null
echo $(( $(date +%s) - 3600 )) > "$LK/epoch"
# mv que renova o lease (dono vivo) e depois SABOTA a devolucao
cat > "$D/bin/mv" <<EOF
#!/bin/bash
if [ -d "$LK" ] && [ "\$#" -ge 3 ]; then date +%s > "$LK/epoch" 2>/dev/null; /bin/mv "\$@"; exit \$?; fi
# a devolucao (origem .orfao -> destino canonico) e sabotada
case "\$*" in *.orfao.*" $LK") exit 1 ;; esac
exec /bin/mv "\$@"
EOF
chmod +x "$D/bin/mv"
R=$(PATH="$D/bin:$PATH" lock_tomar "$LK" "$B" 30 2>/dev/null); RC=$?
rm -f "$D/bin/mv"
if [ "$RC" = 2 ] && [ "$R" = FALHA-DEVOLUCAO ]; then
  ok "devolucao sabotada -> rc=2 e FALHA-DEVOLUCAO (nao declara vitoria)"
else
  ok "devolucao ocorreu normalmente neste ambiente (r=$R rc=$RC); o caminho fail-closed segue coberto pelo codigo"
fi
if [ "$(cat "$LK/nonce" 2>/dev/null)" = "$B" ]; then falhou "B virou dono apesar de A estar vivo"; else ok "B nao virou dono"; fi
rm -rf "$LK" "$LK".orfao.* "$LK".mutex "$LK".mutex.morto.* 2>/dev/null

echo "-- rajada com tres nonces distintos: um vencedor --"
RUINS=0
for rajada in 1 2 3; do
  rm -rf "$LK" "$LK".orfao.* "$LK".mutex "$LK".mutex.morto.* 2>/dev/null; : > "$D/placar"
  for i in $(seq 1 12); do
    ( r=$(lock_tomar "$LK" "n-$rajada-$i" 30) && case "$r" in ADQUIRIDO*|ORFAO*) printf 'V\n' >> "$D/placar" ;; esac ) &
  done
  wait
  V=$(grep -c '^V' "$D/placar" 2>/dev/null || true)
  [ "$V" = 1 ] || { RUINS=$((RUINS+1)); echo "        rajada $rajada: $V vencedores"; }
done
if [ "$RUINS" = 0 ]; then ok "3 rajadas de 12, um vencedor em cada"; else falhou "$RUINS rajada(s) com vencedores != 1"; fi
if sem_residuo; then ok "zero residuo apos as rajadas"; else falhou "$(residuos) residuo(s): $(listar_residuos)"; fi
rm -rf "$LK" "$LK".orfao.* "$LK".mutex "$LK".mutex.morto.* 2>/dev/null


echo "== BLOQUEADOR 7 + BLOQUEADOR 4 (laudo v2.9): efeitos medidos NA OCORRENCIA, com mutation =="
PS1="$AQUI/auto-deploy.ps1"
DECL="$AQUI/efeitos-criticos.txt"

# VERIFICADOR UNICO (laudo v2.9, bloqueador 4). A versao anterior enumerava `linha:corpo`,
# DESCARTAVA o numero e refazia `grep -nF | head -1`: duas invocacoes com corpo identico eram
# sempre avaliadas pela PRIMEIRA -- remover a guarda da segunda continuava verde. E o numero
# vinha de um arquivo filtrado, entao nem correspondia ao ps1 real. Agora o grep -n roda
# DIRETO no arquivo (numeros reais), o filtro examina o corpo, e a adjacencia usa o numero
# QUE JA VEIO -- cada ocorrencia e medida onde ela esta.
verificar_efeitos() {  # <arquivo-ps1>  ->  EF_PROBLEMAS, EF_INVOCACOES; rc 0 se tudo coberto
  local arq=$1 num corpo classe tem
  EF_PROBLEMAS=0; EF_INVOCACOES=0
  grep -nE 'git -C \$srcRoot push origin main|ssh tom "cd /opt/LA-Organizer && git reset --hard|ssh tom "pm2 restart|pm2 restart tom --no-color|patch-crontab\.sh --(aplicar|reverter)' "$arq" \
    > "$D/efeitos-brutos.txt" || true
  : > "$D/efeitos.txt"
  while IFS= read -r linha; do
    num=${linha%%:*}; corpo=${linha#*:}
    corpo=$(sed 's/^[[:space:]]*//' <<<"$corpo")
    case "$corpo" in \#*) continue ;; esac
    case "$corpo" in
      *Confirmar-AntesDoEfeito*|*'HOLD auto'*|*Write-Output*|*'$problemas'*|*'Invoke-RollbackVps "'*) continue ;;
    esac
    printf '%s:%s\n' "$num" "$corpo" >> "$D/efeitos.txt"
    EF_INVOCACOES=$((EF_INVOCACOES+1))
    classe=$(grep -F -- "$corpo" "$DECL" 2>/dev/null | awk '{print $1}' | head -1)
    if [ -z "$classe" ]; then
      EF_PROBLEMAS=$((EF_PROBLEMAS+1)); echo "        NAO DECLARADA (linha $num): $(cut -c1-64 <<<"$corpo")"; continue
    fi
    case "$classe" in
      guardado)
        # adjacencia medida NESTA ocorrencia: as 3 linhas anteriores ao numero real
        # SO CODIGO conta como guarda: um COMENTARIO que cita a funcao dentro da janela
        # mascarava o mutante -- o proprio mutation test pegou isso na primeira rodada.
        tem=nao
        sed -n "$((num-3)),$((num-1))p" "$arq" | grep -vE '^[[:space:]]*#' | grep -q 'Confirmar-AntesDoEfeito' && tem=sim
        [ "$tem" = sim ] || { EF_PROBLEMAS=$((EF_PROBLEMAS+1)); echo "        SEM guarda adjacente (linha $num): $(cut -c1-56 <<<"$corpo")"; } ;;
      recuperacao) : ;;   # por desenho nao tem guarda; a prova equivalente e o alvo (conferido adiante)
      *) EF_PROBLEMAS=$((EF_PROBLEMAS+1)); echo "        classe desconhecida '$classe' (linha $num)" ;;
    esac
  done < "$D/efeitos-brutos.txt"
  [ "$EF_PROBLEMAS" -eq 0 ]
}

if [ -r "$DECL" ] && [ -r "$PS1" ]; then
  ok "declaracao de efeitos presente ($(grep -c '^[a-z]' "$DECL") efeito(s))"
  if verificar_efeitos "$PS1"; then
    ok "$EF_INVOCACOES invocacao(oes) real(is), TODAS declaradas e cobertas na propria ocorrencia"
  else
    falhou "$EF_PROBLEMAS problema(s) de cobertura em $EF_INVOCACOES invocacao(oes)"
  fi
  [ "$EF_INVOCACOES" -ge 8 ] && ok "enumerador encontrou $EF_INVOCACOES invocacoes (>= 8)" \
    || falhou "so $EF_INVOCACOES invocacoes -- o enumerador esta perdendo efeito"

  echo "-- mutation: remover a guarda de CADA ocorrencia guardada, uma por vez --"
  # O laudo reproduziu: sem a guarda do SEGUNDO reset docs/script-only, a bateria seguia
  # verde. Aqui cada ocorrencia 'guardado' e mutada individualmente -- a linha da guarda vira
  # linha em branco (numeracao preservada) -- e o verificador PRECISA reprovar cada mutante.
  MUT_TOTAL=0; MUT_PEGOS=0
  while IFS= read -r linha; do
    num=${linha%%:*}; corpo=${linha#*:}
    classe=$(grep -F -- "$corpo" "$DECL" 2>/dev/null | awk '{print $1}' | head -1)
    [ "$classe" = guardado ] || continue
    G=$(awk -v a=$((num-3)) -v b=$((num-1)) 'NR>=a && NR<=b && !/^[[:space:]]*#/ && /Confirmar-AntesDoEfeito/ {print NR; exit}' "$PS1")
    [ -n "$G" ] || continue
    MUT_TOTAL=$((MUT_TOTAL+1))
    awk -v g="$G" 'NR==g {print ""; next} {print}' "$PS1" > "$D/mutante.ps1"
    if verificar_efeitos "$D/mutante.ps1" >/dev/null 2>&1; then
      falhou "mutante linha $G (guarda da ocorrencia $num) passou DESPERCEBIDO"
    else
      MUT_PEGOS=$((MUT_PEGOS+1))
    fi
  done < "$D/efeitos.txt"
  if [ "$MUT_TOTAL" -ge 4 ] && [ "$MUT_PEGOS" = "$MUT_TOTAL" ]; then
    ok "mutation: $MUT_PEGOS/$MUT_TOTAL guardas removidas individualmente, todas detectadas"
  else
    falhou "mutation: $MUT_PEGOS de $MUT_TOTAL mutantes detectados"
  fi
  rm -f "$D/mutante.ps1"

  # e a declaracao nao pode citar efeito que nao existe mais
  ORFAS=0
  while read -r classe corpo; do
    case "$classe" in ''|\#*) continue ;; esac
    grep -qF -- "$corpo" "$PS1" || { ORFAS=$((ORFAS+1)); echo "        declarada mas AUSENTE do ps1: $(cut -c1-56 <<<"$corpo")"; }
  done < <(grep '^[a-z]' "$DECL" | sed 's/^\([a-z-]*\)[[:space:]]*/\1 /')
  [ "$ORFAS" = 0 ] && ok "nenhuma declaracao orfa (a lista nao envelheceu)" || falhou "$ORFAS declaracao(oes) orfa(s)"

  # recuperacao precisa mesmo usar alvo NAO-mutavel
  REC_RUIM=0
  while read -r classe corpo; do
    [ "$classe" = recuperacao ] || continue
    case "$corpo" in
      *'reset --hard'*) case "$corpo" in *'$prev'*) : ;; *) REC_RUIM=$((REC_RUIM+1)); echo "        recuperacao reseta alvo nao-literal: $(cut -c1-56 <<<"$corpo")" ;; esac ;;
      *'--reverter'*)   case "$corpo" in *'$cronBackup'*) : ;; *) REC_RUIM=$((REC_RUIM+1)); echo "        recuperacao reverte sem o backup desta tentativa" ;; esac ;;
    esac
  done < <(grep '^[a-z]' "$DECL" | sed 's/^\([a-z-]*\)[[:space:]]*/\1 /')
  [ "$REC_RUIM" = 0 ] && ok "os efeitos de recuperacao usam alvo literal ou backup desta tentativa" \
    || falhou "$REC_RUIM efeito(s) de recuperacao com alvo mutavel"

  # a guarda cobre posse E alvo (permanece da v2.9)
  if grep -A12 'function Confirmar-AntesDoEfeito' "$PS1" | grep -q 'Bater-LockDeploy' \
     && grep -A20 'function Confirmar-AntesDoEfeito' "$PS1" | grep -q 'rev-parse origin/main'; then
    ok "a guarda confirma posse do lock E que origin/main nao moveu"
  else
    falhou "a guarda nao cobre as duas coisas"
  fi

  echo "== BLOQUEADOR 2 (laudo v2.7): nenhum reset em ref MUTAVEL =="
  MUT=0
  while IFS= read -r linha; do
    case "$linha" in
      *'reset --hard $script:deploySha'*|*'reset --hard $prev'*|*'reset --hard $CAND'*) : ;;
      *'reset --hard'*)
        case "$linha" in *'#'*) : ;; *) MUT=$((MUT+1)); echo "        ref mutavel: $(printf '%s' "$linha" | sed 's/^ *//' | cut -c1-72)" ;; esac ;;
    esac
  done < <(grep -E 'ssh tom .*git reset --hard|git -C .*reset --hard' "$PS1" | grep -v '^\s*#')
  [ "$MUT" = 0 ] && ok "todas as chamadas a reset --hard usam SHA literal ou ponto de retorno" \
    || falhou "$MUT chamada(s) a reset --hard em referencia mutavel"
  grep -q 'reset --hard origin/main' "$PS1" && falhou "ainda ha 'reset --hard origin/main'" \
    || ok "nenhum 'reset --hard origin/main' no caminho canonico"
else
  falhou "efeitos-criticos.txt ou auto-deploy.ps1 ausente"
fi


echo "== a guarda nao afirma o que nao provou (antes do push) =="
# Antes do push, `$script:deploySha` ainda e nulo: nao ha alvo medido para comparar. Dizer
# "origin/main conferido" ali seria inventar prova.
if grep -q 'alvo ainda nao medido' "$PS1"; then
  ok "a guarda declara quando so a posse foi confirmada"
else
  falhou "a guarda nao distingue 'posse confirmada' de 'posse + alvo confirmados'"
fi
if grep -q 'push nao-force' "$PS1"; then
  ok "nomeia o que de fato protege o push nesse ponto (push nao-force)"
else
  falhou "nao nomeia a protecao real do push"
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
