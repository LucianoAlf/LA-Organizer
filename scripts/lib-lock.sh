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

lock_tomar() {   # <dir> <nonce> <ttl_min>
  local dir=$1 nonce=$2 ttl=${3:-30} idade epoch
  [ -n "$dir" ] && [ -n "$nonce" ] || { echo "lock_tomar: dir e nonce obrigatorios" >&2; return 2; }
  case "$nonce" in *[!A-Za-z0-9._-]*|'') echo "lock_tomar: nonce invalido" >&2; return 2 ;; esac

  if mkdir "$dir" 2>/dev/null; then
    printf '%s\n' "$nonce" > "$dir/nonce" || return 2
    date +%s > "$dir/epoch"
    printf '%s\n' "${LOCK_DONO_DESC:-desconhecido}" > "$dir/dono"
    echo ADQUIRIDO; return 0
  fi

  # Ocupado: so o TEMPO pode liberar, nunca a vontade de quem chegou depois.
  # JANELA ENTRE mkdir E epoch. `mkdir` e atomico, mas o dono ainda leva alguns microsegundos
  # para escrever `epoch`. Quem chegasse nessa fresta lia epoch VAZIO; a versao anterior
  # assumia epoch=0, calculava idade astronomica e ROUBAVA um lock recem-criado. Com 8
  # processos simultaneos isso deu DOIS vencedores -- a propria bateria pegou.
  # Sem epoch legivel, a idade vem do mtime do DIRETORIO, que o mkdir ja carimbou. Assim um
  # lock novo aparece novo (OCUPADO) e um lock abandonado sem epoch ainda envelhece e expira.
  epoch=$(cat "$dir/epoch" 2>/dev/null)
  case "$epoch" in
    ''|*[!0-9]*) epoch=$(stat -c %Y "$dir" 2>/dev/null) ;;
  esac
  case "$epoch" in
    ''|*[!0-9]*) echo "OCUPADO ?"; return 1 ;;   # nao consegui medir: fail-closed
  esac
  idade=$(( ( $(date +%s) - epoch ) / 60 ))
  if [ "$idade" -lt "$ttl" ]; then
    echo "OCUPADO $idade"; return 1
  fi

  # TOMADA DE ORFAO POR RENAME. `rm -rf` seguido de `mkdir` tem janela: dois processos podem
  # remover e os dois criarem. `mv` de diretorio para nome inexistente e atomico e a origem
  # deixa de existir — entao so UM processo consegue mover, e so ele segue para o mkdir.
  # TOMADA DE ORFAO POR RENAME, com RECONFERENCIA (laudo v2.7, bloqueador 4).
  # `mv` de diretorio para nome inexistente e atomico, entao so um processo move. Mas entre
  # LER a idade e MOVER passa tempo: se o dono fizer heartbeat nessa fresta, o invasor ainda
  # move e substitui um lock RECEM-RENOVADO -- reproduzido com um wrapper de `mv` que renova
  # o epoch imediatamente antes do rename. Mover primeiro e perguntar depois nao basta:
  # e preciso PERGUNTAR DE NOVO, ja com o diretorio fora do caminho, e DESFAZER se o dono
  # estava vivo. O rename e reversivel; roubar o lock de um deploy vivo nao e.
  local nonce_antes morto ep2 idade2 nonce_depois
  nonce_antes=$(cat "$dir/nonce" 2>/dev/null)
  morto="$dir.orfao.$$.$(date +%s%N 2>/dev/null || date +%s)"
  mv -T "$dir" "$morto" 2>/dev/null || { echo "OCUPADO $idade"; return 1; }
  ep2=$(cat "$morto/epoch" 2>/dev/null)
  case "$ep2" in ''|*[!0-9]*) ep2=$(stat -c %Y "$morto" 2>/dev/null) ;; esac
  case "$ep2" in ''|*[!0-9]*) ep2=0 ;; esac
  idade2=$(( ( $(date +%s) - ep2 ) / 60 ))
  nonce_depois=$(cat "$morto/nonce" 2>/dev/null)
  if [ "$idade2" -lt "$ttl" ] || [ "$nonce_depois" != "$nonce_antes" ]; then
    # o dono renovou (ou trocou) na fresta: devolve intacto e desiste.
    mv -T "$morto" "$dir" 2>/dev/null
    echo "OCUPADO $idade2"; return 1
  fi
  rm -rf "$morto" 2>/dev/null
  if mkdir "$dir" 2>/dev/null; then
    printf '%s\n' "$nonce" > "$dir/nonce" || return 2
    date +%s > "$dir/epoch"
    printf '%s\n' "${LOCK_DONO_DESC:-desconhecido}" > "$dir/dono"
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
