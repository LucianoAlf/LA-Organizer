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

# MUTEX COM DONO VERIFICAVEL (laudo v2.9, bloqueador 2). A versao anterior tinha tres furos,
# e um deles APARECEU no stderr da propria bateria ("mutex/epoch: No such file or directory")
# enquanto a contagem terminava 66/0 -- ou seja, um processo perdeu o mutex depois do mkdir e
# seguiu como se tivesse exclusividade, e o teste nao leu o stderr:
#   1. a escrita do epoch falhando era ignorada: o processo entrava na secao critica sem a
#      prova de posse que os outros iam consultar;
#   2. a liberacao era `rm -rf` cru, sem conferir dono: uma liberacao TARDIA (processo lento)
#      apagava o mutex FRESCO que outro acabara de criar;
#   3. a recuperacao de orfao movia e removia sem reconferir o que moveu.
# Agora o mutex carrega um nonce proprio; quem nao consegue gravar (e RELER) nonce+epoch nao
# entra na secao critica (rc=2); a liberacao e por rename atomico condicionada ao nonce; e a
# recuperacao reconfere o movido e DEVOLVE se ele estiver fresco ou for de outro dono.

lock_mutex_tomar() {   # <dir-do-lock> <nonce> -> rc 0 tenho | 1 nao consegui | 2 erro
  local mx="$1.mutex" nonce=$2 i ep morto relido
  [ -n "$nonce" ] || { echo "lock_mutex_tomar: nonce obrigatorio" >&2; return 2; }
  for i in $(seq 1 50); do
    if mkdir "$mx" 2>/dev/null; then
      # POSSE SO COM PROVA GRAVADA E RELIDA. Se qualquer escrita falhar -- ou se o que foi
      # relido nao for o nosso nonce (alguem removeu e recriou o mutex no meio) -- este
      # processo NAO tem exclusividade e nao pode fingir que tem.
      if ! printf '%s\n' "$nonce" > "$mx/nonce" 2>/dev/null; then
        echo "lock_mutex_tomar: nao consegui gravar o nonce em $mx" >&2; return 2
      fi
      if ! date +%s > "$mx/epoch" 2>/dev/null; then
        echo "lock_mutex_tomar: nao consegui gravar o epoch em $mx" >&2; return 2
      fi
      relido=$(cat "$mx/nonce" 2>/dev/null)
      if [ "$relido" != "$nonce" ]; then
        echo "lock_mutex_tomar: o mutex nao e meu apos a gravacao (relido: '${relido:-nada}')" >&2
        return 2
      fi
      return 0
    fi
    ep=$(cat "$mx/epoch" 2>/dev/null)
    case "$ep" in ''|*[!0-9]*) ep=$(stat -c %Y "$mx" 2>/dev/null) ;; esac
    # NAO-MENSURAVEL != EXPIRADO (achado do stderr-strict): se cat e stat falham juntos, o
    # mutex sumiu NESTE instante (alguem soltou). Tratar isso como idade infinita fazia o
    # processo mover um mutex FRESCO recem-criado por outro. Volta ao mkdir e disputa de novo.
    case "$ep" in ''|*[!0-9]*) sleep 0.05 2>/dev/null || sleep 1; continue ;; esac
    if [ $(( $(date +%s) - ep )) -ge "$LOCK_MUTEX_TTL_SEG" ]; then
      # RECUPERACAO POR RENAME + RECONFERENCIA. `mv` para nome unico e atomico: so um move.
      # Depois de mover, o epoch do MOVIDO e relido -- se ficou fresco (o dono escreveu o
      # epoch na fresta), devolve intacto em vez de apagar um mutex vivo.
      morto="$mx.morto.$$.$(date +%s%N 2>/dev/null || date +%s)"
      if mv -T "$mx" "$morto" 2>/dev/null; then
        ep=$(cat "$morto/epoch" 2>/dev/null)
        case "$ep" in ''|*[!0-9]*) ep=$(stat -c %Y "$morto" 2>/dev/null) ;; esac
        # pos-move: nao-mensuravel tambem NAO e expirado -- devolve, fail-closed
        case "$ep" in ''|*[!0-9]*) mv -T "$morto" "$mx" 2>/dev/null; continue ;; esac
        if [ $(( $(date +%s) - ep )) -lt "$LOCK_MUTEX_TTL_SEG" ]; then
          mv -T "$morto" "$mx" 2>/dev/null || rm -rf "$morto" 2>/dev/null   # devolve; se o caminho ja foi ocupado, o dono detecta pela releitura e o residuo e removido
        else
          rm -rf "$morto" 2>/dev/null
        fi
      fi
      continue
    fi
    sleep 0.1 2>/dev/null || sleep 1
  done
  return 1
}

lock_mutex_soltar() {  # <dir-do-lock> <nonce> -> 0 liberado | 1 nao era meu | 2 erro
  local mx="$1.mutex" nonce=$2 gravado solto
  [ -n "$nonce" ] || return 2
  [ -d "$mx" ] || return 0                       # ja liberado: nao e erro
  gravado=$(cat "$mx/nonce" 2>/dev/null)
  if [ "$gravado" != "$nonce" ]; then
    # LIBERACAO TARDIA DE OUTRA ERA: o mutex atual e de outro processo. Nao tocar.
    return 1
  fi
  solto="$mx.solto.$$.$(date +%s%N 2>/dev/null || date +%s)"
  mv -T "$mx" "$solto" 2>/dev/null || { [ -d "$mx" ] || return 0; return 2; }
  gravado=$(cat "$solto/nonce" 2>/dev/null)
  if [ "$gravado" != "$nonce" ]; then
    mv -T "$solto" "$mx" 2>/dev/null            # movi o de outro (janela minuscula): devolve
    return 1
  fi
  rm -rf "$solto" 2>/dev/null
  return 0
}

lock_tomar() {   # <dir> <nonce> <ttl_min>
  local dir=$1 nonce=$2 ttl=${3:-30} rc mrc
  [ -n "$dir" ] && [ -n "$nonce" ] || { echo "lock_tomar: dir e nonce obrigatorios" >&2; return 2; }
  case "$nonce" in *[!A-Za-z0-9._-]*|'') echo "lock_tomar: nonce invalido" >&2; return 2 ;; esac

  # o mutex usa o MESMO nonce do turno: quem serializa e quem adquire sao o mesmo dono.
  lock_mutex_tomar "$dir" "$nonce"; mrc=$?
  case "$mrc" in
    0) : ;;
    2) echo "FALHA-MUTEX"; return 2 ;;   # nao provei posse do mutex: nao entro na secao critica
    *) echo "OCUPADO mutex"; return 1 ;;
  esac
  _lock_tomar_serializado "$dir" "$nonce" "$ttl"; rc=$?
  lock_mutex_soltar "$dir" "$nonce"
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
