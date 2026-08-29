#!/bin/bash
# lib-lock.sh — lock de deploy com DONO verificavel.
#
# LAUDO v2.5, BLOQUEADOR 1. O lock antigo era `mkdir` + `rm -rf` incondicional. Duas falhas:
#   1. quem recebia OCUPADO chamava a liberacao mesmo assim e APAGAVA o lock do dono. O
#      segundo processo nao entrava na janela — ele destruia a protecao do primeiro, que
#      seguia deployando sem lock nenhum. Lock que o perdedor apaga e pior que nao ter lock:
#      cria a crenca de que a janela esta protegida.
#   2. o caminho sem commit nunca ADQUIRIA o lock, mas chamava a liberacao ao sair — entao
#      um turno que so sincroniza apagava o lock de um turno que estava empurrando.
#
# A logica virou lib de shell (e nao ficou em PowerShell-sobre-ssh) exatamente porque o bug
# sobreviveu a tres revisoes: nao havia como escrever um teste para ela.
#
# Contrato:
#   lock_tomar <dir> <nonce> <ttl_min>  -> imprime ADQUIRIDO|ORFAO-REMOVIDO|OCUPADO <idade>
#                                          rc 0 = e seu; rc 1 = nao e seu; rc 2 = erro
#   lock_soltar <dir> <nonce>           -> so remove se o nonce gravado for o seu
#                                          rc 0 = liberado; rc 1 = nao era seu; rc 2 = erro
#   lock_dono <dir> <nonce>             -> rc 0 se o lock existe e e seu
#
# O nonce e gravado DENTRO do diretorio, depois do mkdir atomico. Quem nao criou o diretorio
# nunca escreve nele.

# MUTEX DE TAKEOVER (laudo v2.8, bloqueador 2). O desenho anterior serializava so o RENAME.
# Com tres concorrentes a janela reaparecia: A dono renovando; B move A para .orfao; C, que
# so faz `mkdir`, encontra o caminho canonico LIVRE e vira dono; B percebe que A estava vivo
# e tenta devolver, mas o `mv` de volta falha porque o caminho ja esta ocupado -- e o erro
# era engolido. Resultado: C dono, A abandonado dentro de .orfao.
#
# A correcao e serializar a AQUISICAO INTEIRA, nao so o rename: todo caminho que possa criar
# ou mover o lock canonico passa antes por um mutex proprio. `mkdir` continua sendo a
# primitiva atomica, o dono continua sendo o nonce, o heartbeat e a recuperacao de orfao
# continuam iguais -- o que muda e que ninguem observa o caminho canonico no meio de uma
# transicao alheia.
# O mutex tem TTL proprio e CURTO: as operacoes dentro dele levam milissegundos, entao um
# mutex velho e residuo de processo morto, nao contencao legitima.
LOCK_MUTEX_TTL_SEG=${LOCK_MUTEX_TTL_SEG:-60}

lock_mutex_tomar() {   # <dir-do-lock> -> rc 0 tenho o mutex | 1 nao consegui
  local mx="$1.mutex" i ep morto
  for i in $(seq 1 50); do
    # o `2>/dev/null` no epoch e proposital: se o mutex sumir entre o mkdir e a escrita, a
    # idade cai para o mtime do diretorio -- que e o mesmo instante. Nao ha o que reportar.
    if mkdir "$mx" 2>/dev/null; then date +%s > "$mx/epoch" 2>/dev/null; return 0; fi
    ep=$(cat "$mx/epoch" 2>/dev/null)
    case "$ep" in ''|*[!0-9]*) ep=$(stat -c %Y "$mx" 2>/dev/null) ;; esac
    case "$ep" in ''|*[!0-9]*) ep=0 ;; esac
    if [ $(( $(date +%s) - ep )) -ge "$LOCK_MUTEX_TTL_SEG" ]; then
      # RECUPERACAO POR RENAME, nao por `rm -rf`: com remocao crua, dois processos podem
      # passar pelo teste de idade, os dois removerem -- e o segundo apagar o mutex FRESCO
      # que o primeiro acabou de criar. `mv` para nome unico e atomico: so um move.
      morto="$mx.morto.$$.$(date +%s%N 2>/dev/null || date +%s)"
      if mv -T "$mx" "$morto" 2>/dev/null; then rm -rf "$morto" 2>/dev/null; fi
      continue
    fi
    sleep 0.1 2>/dev/null || sleep 1
  done
  return 1
}
lock_mutex_soltar() { rm -rf "$1.mutex" 2>/dev/null; }

lock_tomar() {   # <dir> <nonce> <ttl_min>
  local dir=$1 nonce=$2 ttl=${3:-30} idade epoch rc
  [ -n "$dir" ] && [ -n "$nonce" ] || { echo "lock_tomar: dir e nonce obrigatorios" >&2; return 2; }
  case "$nonce" in *[!A-Za-z0-9._-]*|'') echo "lock_tomar: nonce invalido" >&2; return 2 ;; esac

  if ! lock_mutex_tomar "$dir"; then
    echo "OCUPADO mutex"; return 1
  fi
  _lock_tomar_serializado "$dir" "$nonce" "$ttl"; rc=$?
  lock_mutex_soltar "$dir"
  return $rc
}

# Corpo da aquisicao. So roda com o mutex na mao, entao ninguem cria nem move o caminho
# canonico enquanto isto acontece.
_lock_tomar_serializado() {
  local dir=$1 nonce=$2 ttl=$3 idade epoch nonce_antes morto ep2 idade2 nonce_depois

  if mkdir "$dir" 2>/dev/null; then
    printf '%s
' "$nonce" > "$dir/nonce" || return 2
    date +%s > "$dir/epoch"
    printf '%s
' "${LOCK_DONO_DESC:-desconhecido}" > "$dir/dono"
    echo ADQUIRIDO; return 0
  fi

  # Ocupado: so o TEMPO pode liberar, nunca a vontade de quem chegou depois.
  # Sem epoch legivel, a idade vem do mtime do DIRETORIO, que o mkdir ja carimbou: assim um
  # lock criado ha microsegundos (ainda sem epoch) aparece NOVO, e nao como orfao.
  epoch=$(cat "$dir/epoch" 2>/dev/null)
  case "$epoch" in ''|*[!0-9]*) epoch=$(stat -c %Y "$dir" 2>/dev/null) ;; esac
  case "$epoch" in ''|*[!0-9]*) echo "OCUPADO ?"; return 1 ;; esac
  idade=$(( ( $(date +%s) - epoch ) / 60 ))
  if [ "$idade" -lt "$ttl" ]; then echo "OCUPADO $idade"; return 1; fi

  # Candidato a orfao. Move para fora do caminho e RECONFERE ali: o dono pode ter renovado
  # entre a leitura da idade e o rename.
  nonce_antes=$(cat "$dir/nonce" 2>/dev/null)
  morto="$dir.orfao.$$.$(date +%s%N 2>/dev/null || date +%s)"
  mv -T "$dir" "$morto" 2>/dev/null || { echo "OCUPADO $idade"; return 1; }
  ep2=$(cat "$morto/epoch" 2>/dev/null)
  case "$ep2" in ''|*[!0-9]*) ep2=$(stat -c %Y "$morto" 2>/dev/null) ;; esac
  case "$ep2" in ''|*[!0-9]*) ep2=0 ;; esac
  idade2=$(( ( $(date +%s) - ep2 ) / 60 ))
  nonce_depois=$(cat "$morto/nonce" 2>/dev/null)
  if [ "$idade2" -lt "$ttl" ] || [ "$nonce_depois" != "$nonce_antes" ]; then
    # o dono estava vivo. Devolver e OBRIGATORIO -- e se falhar, e falha FECHADA: nao
    # declaro vitoria e nao deixo o dono abandonado em silencio.
    if mv -T "$morto" "$dir" 2>/dev/null; then
      echo "OCUPADO $idade2"; return 1
    fi
    echo "lock_tomar: FALHA CRITICA -- nao consegui devolver o lock do dono vivo; ele esta em $morto" >&2
    echo "FALHA-DEVOLUCAO"; return 2
  fi
  rm -rf "$morto" 2>/dev/null
  if mkdir "$dir" 2>/dev/null; then
    printf '%s
' "$nonce" > "$dir/nonce" || return 2
    date +%s > "$dir/epoch"
    printf '%s
' "${LOCK_DONO_DESC:-desconhecido}" > "$dir/dono"
    echo ORFAO-REMOVIDO; return 0
  fi
  echo "OCUPADO $idade"; return 1
}

lock_dono() {    # <dir> <nonce>
  local dir=$1 nonce=$2 gravado
  [ -d "$dir" ] || return 1
  gravado=$(cat "$dir/nonce" 2>/dev/null)
  [ -n "$gravado" ] && [ "$gravado" = "$nonce" ]
}

# CONFIRMACAO ANTES DE EFEITO CRITICO (laudo v2.6, bloqueador 9). Entre um passo e outro do
# deploy passam minutos; o lock pode ter sido tomado como orfao nesse meio. Todo efeito que
# muda producao chama isto antes e aborta se o lock ja nao for nosso.
lock_confirmar() {  # <dir> <nonce>
  if lock_dono "$1" "$2"; then return 0; fi
  echo "lock: o lock em $1 NAO e mais meu -- abortando antes do efeito" >&2
  return 1
}

# LEASE COM HEARTBEAT (laudo v2.6, bloqueador 9). A v2.6 considerava orfao qualquer lock mais
# velho que o TTL, sem perguntar se o dono estava vivo: um deploy legitimo e lento (build da
# Vercel, suite de testes) era ROUBADO e passava a concorrer com quem roubou. Agora o dono
# renova o lease entre os passos; TTL curto passa a significar "ninguem renova ha X min", que
# e uma afirmacao sobre VIDA, nao sobre duracao total do deploy.
lock_heartbeat() {  # <dir> <nonce>
  local dir=$1 nonce=$2
  lock_confirmar "$dir" "$nonce" || return 1
  date +%s > "$dir/epoch" || return 2
  return 0
}

# LIBERACAO ATOMICA CONDICIONADA AO DONO (laudo v2.6, bloqueador 9). Antes era "confere nonce"
# e depois `rm -rf`: entre as duas coisas o lock podia ter sido tomado por outro, e o rm
# apagava o lock do novo dono. Agora a remocao comeca por um `mv -T`, que e atomico: quem
# consegue mover e o unico que segue. So depois de mover e que o nonce e reconferido no
# diretorio JA fora do caminho -- e, se nao for nosso, ele volta para o lugar.
lock_soltar() {  # <dir> <nonce>
  local dir=$1 nonce=$2 morto gravado
  [ -n "$dir" ] && [ -n "$nonce" ] || return 2
  [ -d "$dir" ] || return 0                      # ja liberado: nao e erro
  if ! lock_dono "$dir" "$nonce"; then
    echo "lock_soltar: RECUSADO -- o lock em $dir nao e meu" >&2
    return 1
  fi
  morto="$dir.soltando.$$.$(date +%s%N 2>/dev/null || date +%s)"
  mv -T "$dir" "$morto" 2>/dev/null || {
    # nao consegui mover: ou sumiu, ou outro processo esta mexendo. Nao removo nada.
    [ -d "$dir" ] || return 0
    echo "lock_soltar: nao consegui mover $dir para remocao" >&2; return 2
  }
  gravado=$(cat "$morto/nonce" 2>/dev/null)
  if [ "$gravado" != "$nonce" ]; then
    # movi o lock de OUTRO dono (janela minuscula): devolvo intacto em vez de apagar.
    mv -T "$morto" "$dir" 2>/dev/null
    echo "lock_soltar: o que movi nao era meu -- devolvido, nada removido" >&2
    return 1
  fi
  rm -rf "$morto" 2>/dev/null || return 2
  return 0
}
