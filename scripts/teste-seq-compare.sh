#!/bin/bash
# Testes da comparacao de sequences. Positivos e negativos, sem docker e sem banco.
. "$(dirname "$(readlink -f "$0")")/lib-seq-compare.sh"
P=0; F=0
caso() { # <esperado_rc> <descricao> <linha_baseline> <obtido>
  local esp=$1 desc=$2; shift 2
  seq_verificar "$1" "$2"; local rc=$?
  if [ "$rc" = "$esp" ]; then P=$((P+1)); printf '  ok    %-52s rc=%s\n' "$desc" "$rc"
  else F=$((F+1)); printf '  FALHA %-52s rc=%s (esperado %s) %s\n' "$desc" "$rc" "$esp" "$SEQ_MOTIVO"; fi
}
echo "== positivos =="
caso 0 "valor e called iguais"                 "s1:999:called=true"  "999:true"
caso 0 "sequence nunca lida (0/false)"         "s2:0:called=false"   ":false"
echo "== negativos (o que a v2.4 deixava passar) =="
caso 1 "baseline 999, restore 1 (PERDA)"       "s1:999:called=true"  "1:true"
caso 1 "is_called mudou sozinho"               "s1:999:called=true"  "999:false"
caso 1 "restaurado MAIOR que a origem"         "s1:10:called=true"   "11:true"
caso 1 "sequence ausente no restaurado"        "s1:5:called=true"    ""
echo "== fail-closed (nao interpretavel nunca vira ok) =="
caso 2 "baseline sem o campo called"           "s1:999"              "999:true"
caso 2 "valor do baseline nao-numerico"        "s1:abc:called=true"  "999:true"
caso 2 "called do baseline invalido"           "s1:9:called=talvez"  "9:true"
caso 2 "leitura do restaurado sem os 2 campos" "s1:9:called=true"    "9"
caso 2 "valor restaurado nao-numerico"         "s1:9:called=true"    "x:true"
echo
echo "== $P passaram, $F falharam =="
[ "$F" -eq 0 ]
