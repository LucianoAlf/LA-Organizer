#!/bin/bash
# lib-seq-compare.sh — comparacao de UMA sequence entre baseline e restaurado.
#
# Existe como lib para ser TESTAVEL. Antes a logica morava inline no restore-drill.sh, e o
# unico jeito de exercita-la era rodar um drill inteiro (~5 min, docker, dump de 21 MB). Na
# pratica isso significa nunca testar os casos negativos — e foi assim que o parser quebrado
# (`${linha##*:}` devolvendo `called=true` em vez do valor) sobreviveu a uma revisao inteira,
# contando como "2 sequence(s) com valor preservado" sem ter comparado nada.
#
# Contrato:
#   seq_verificar "<linha_baseline>" "<obtido>"
#     linha_baseline : nome:valor:called=BOOL          (secao sequences_estado do baseline)
#     obtido         : valor:called_bool               (vazio = sequence ausente no restaurado)
#   Escreve o motivo em SEQ_MOTIVO e devolve:
#     0 = ok   1 = divergencia real   2 = nao consegui interpretar (fail-closed)
#
# FAIL-CLOSED: parse ausente ou invalido devolve 2, nunca 0. A regra que este arquivo existe
# para nao repetir: valor nao-numerico fazia `-gt` e `-lt` falharem em silencio, o fluxo caia
# no `else` e a divergencia virava sucesso.

seq_verificar() {
  local linha=$1 obtido=$2
  local nome resto espv campo espc obtv obtc
  SEQ_MOTIVO=""

  case "$linha" in
    *:*:called=*) : ;;
    *) SEQ_MOTIVO="linha do baseline fora do formato nome:valor:called=BOOL [$linha]"; return 2 ;;
  esac
  nome=${linha%%:*}; resto=${linha#*:}
  espv=${resto%%:*}; campo=${resto#*:}; espc=${campo#called=}

  case "$nome" in '') SEQ_MOTIVO="nome vazio [$linha]"; return 2 ;; esac
  case "$espv" in ''|*[!0-9]*) SEQ_MOTIVO="valor do baseline nao-numerico [$linha]"; return 2 ;; esac
  case "$espc" in true|false) : ;; *) SEQ_MOTIVO="called do baseline invalido [$linha]"; return 2 ;; esac

  if [ -z "$obtido" ]; then
    SEQ_MOTIVO="sequence ausente no restaurado: $nome"; return 1
  fi
  case "$obtido" in *:*) : ;; *) SEQ_MOTIVO="$nome: leitura do restaurado fora do formato valor:called"; return 2 ;; esac
  obtv=${obtido%%:*}; obtc=${obtido##*:}
  # pg_sequences.last_value e NULO enquanto a sequence nunca foi lida; a consulta devolve
  # string vazia nesse caso, e o par correto la e (0, called=false).
  [ -z "$obtv" ] && obtv=0
  case "$obtv" in ''|*[!0-9]*) SEQ_MOTIVO="$nome: valor restaurado nao-numerico"; return 2 ;; esac
  case "$obtc" in true|false) : ;; *) SEQ_MOTIVO="$nome: called restaurado invalido"; return 2 ;; esac

  # is_called comparado SEPARADAMENTE do valor: uma sequence que volta com is_called falso
  # entrega o mesmo numero outra vez, mesmo com last_value correto.
  if [ "$obtc" != "$espc" ]; then
    SEQ_MOTIVO="$nome: is_called restaurado=$obtc, origem=$espc"; return 1
  fi
  # valor so cresce entre o dump e a consulta do baseline: restaurado <= baseline.
  if [ "$obtv" -gt "$espv" ]; then
    SEQ_MOTIVO="$nome: restaurado ($obtv) MAIOR que a origem ($espv) — dump inconsistente"; return 1
  fi
  if [ "$obtv" -lt "$espv" ]; then
    SEQ_MOTIVO="$nome: restaurado $obtv, origem $espv — valor PERDIDO (proxima escrita colide)"; return 1
  fi
  SEQ_MOTIVO="$nome ok ($obtv, called=$obtc)"; return 0
}
