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
  local morto="$dir.orfao.$$.$(date +%s)"
  mv -T "$dir" "$morto" 2>/dev/null || { echo "OCUPADO $idade"; return 1; }
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

lock_soltar() {  # <dir> <nonce>
  local dir=$1 nonce=$2
  [ -n "$dir" ] && [ -n "$nonce" ] || return 2
  [ -d "$dir" ] || return 0                      # ja liberado: nada a fazer, e nao e erro
  if ! lock_dono "$dir" "$nonce"; then
    echo "lock_soltar: RECUSADO — o lock em $dir nao e meu" >&2
    return 1
  fi
  rm -rf "$dir" 2>/dev/null || return 2
  return 0
}
