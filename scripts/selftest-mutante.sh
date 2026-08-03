#!/usr/bin/env bash
# Autoteste do VEREDITO do modo mutante — prova que ele REPROVA.
#
# A rodada 12 fechou o runner normal. O mutante ainda dizia "detectou o bug" com qualquer
# FAILED=1: falha de ambiente, de cleanup ou de outro cenário se autoaprovava. Agora ele
# exige as falhas NOMEADAS de MUT_ESPERADAS e nenhuma fora da lista.
#
# Um veredito que nunca foi visto reprovando é só mais uma promessa. Este script sabota o
# runner de duas formas e exige que ele reprove em ambas:
#   A) falha fabricada fora da lista          -> tem de acusar FALHA INESPERADA
#   B) mutação placebo (relógio intacto)      -> tem de acusar NÃO DETECTOU
#
#   bash scripts/selftest-mutante.sh
#
# Cada variante roda a suíte inteira contra o schema descartável (~1 min cada).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNNER="$ROOT/scripts/test-router-ownership.sh"
COPIA="$ROOT/scripts/.selftest-runner.sh"
TMPD="$(mktemp -d)"
OK=1

limpar() { local c=$?; rm -f "$COPIA"; rm -rf "$TMPD"; exit $c; }
trap limpar EXIT

variante() {
  local nome="$1" sedexpr="$2" espera="$3" rc
  sed "$sedexpr" "$RUNNER" > "$COPIA"
  # Sabotagem que não sabota nada produziria um "reprovou" sem valor nenhum.
  if cmp -s "$COPIA" "$RUNNER"; then
    echo "  FALHOU [$nome]: a sabotagem não alterou o runner (âncora saiu do lugar?)"; OK=0; return
  fi
  MUTATE=1 bash "$COPIA" >"$TMPD/$nome.out" 2>&1; rc=$?
  if [ $rc -eq 0 ]; then
    echo "  FALHOU [$nome]: o mutante saiu 0 — o veredito se autoaprovou"; OK=0
  elif ! grep -q "$espera" "$TMPD/$nome.out"; then
    echo "  FALHOU [$nome]: reprovou (exit $rc) mas sem acusar '$espera'"; OK=0
  else
    echo "  OK   [$nome] reprovou com exit $rc — $(grep -m1 "$espera" "$TMPD/$nome.out" | sed 's/^ *//')"
  fi
}

echo "=== A: falha FORA da lista tem de reprovar o mutante ==="
variante "sabotagem" \
  's|# --- VEREDITO ---|fail "sabotagem-de-ambiente" "falha fabricada pelo autoteste"|' \
  "FALHA INESPERADA"

echo
echo "=== B: mutação placebo (relógio intacto) tem de reprovar o mutante ==="
variante "placebo" \
  's|MUT_SED="$MUT_SED; s/clock_timestamp()/now()/g"|MUT_SED="$MUT_SED"|' \
  "NÃO DETECTOU"

echo
if [ "$OK" = "1" ]; then
  echo "=== o veredito do mutante REPROVA nos dois casos ==="; exit 0
fi
echo "=== PROBLEMA: o veredito do mutante não reprova como deveria ==="; exit 1
