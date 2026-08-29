#!/bin/bash
# rodar-baterias.sh -- roda TODAS as baterias e CALCULA o total de asseracoes.
#
# Existe por causa do criterio de entrega da v2.6: "a contagem da bateria deve ser calculada,
# nao escrita como texto fixo". Nas rodadas anteriores o total ia para o dossie a mao, somado
# por mim -- e um numero escrito a mao e uma afirmacao sem medicao, exatamente a classe de
# coisa que esta frente existe para nao produzir.
#
# FAIL-CLOSED em tres situacoes, e nao so em "falhou":
#   1. teste que sai != 0                       -> reprova;
#   2. teste que NAO imprime contagem            -> reprova como NAO MEDIDO (nao conta 0 falhas);
#   3. teste que reporta 0 asseracoes            -> reprova (bateria vazia parece verde).
#
# Uso:  ./rodar-baterias.sh              roda tudo
#       ./rodar-baterias.sh nome parcial roda so os que casam

set -uo pipefail
AQUI="$(dirname "$(readlink -f "$0")")"
FILTRO=${1:-}
SAIDAS=$(mktemp -d "${TMPDIR:-/tmp}/baterias.XXXXXX")
trap 'rm -rf "$SAIDAS"' EXIT INT TERM

# Baterias que dependem do ambiente sao DECLARADAS, nunca puladas em silencio.
AMB="$AQUI/baterias-ambiente.txt"
declarada() { [ -r "$AMB" ] && grep -qE "^$1([[:space:]]|$)" "$AMB"; }
motivo_amb() { sed -nE "s/^$1[[:space:]]+//p" "$AMB" | head -1; }
AMBIENTE=0

TOT_P=0; TOT_F=0; TOT_ARQ=0; PROBLEMAS=0
printf '%-30s %8s %8s  %s\n' "bateria" "passou" "falhou" "veredito"
printf '%-30s %8s %8s  %s\n' "------------------------------" "--------" "--------" "--------"

for t in "$AQUI"/teste-*.sh; do
  n=$(basename "$t")
  [ -n "$FILTRO" ] && case "$n" in *"$FILTRO"*) : ;; *) continue ;; esac
  [ -r "$t" ] || continue
  TOT_ARQ=$((TOT_ARQ+1))
  out="$SAIDAS/$n.out"
  bash "$t" > "$out" 2>&1; rc=$?

  # Dois formatos convivem no repo: "N passaram, M falharam" e "N pass, M falha".
  linha=$(grep -oE '== [0-9]+ (passaram, [0-9]+ falharam|pass, [0-9]+ (falha|falha/inconclusivo))' "$out" | tail -1)
  p=$(grep -oE '^== [0-9]+' <<<"$linha" | grep -oE '[0-9]+' || true)
  f=$(grep -oE '[0-9]+ (falharam|falha)' <<<"$linha" | grep -oE '^[0-9]+' || true)

  if [ -z "$linha" ] || [ -z "$p" ] || [ -z "$f" ]; then
    if declarada "$n"; then
      printf '%-30s %8s %8s  %s\n' "$n" "-" "-" "EXIGE AMBIENTE: $(motivo_amb "$n" | cut -c1-40)"
      AMBIENTE=$((AMBIENTE+1)); continue
    fi
    printf '%-30s %8s %8s  %s\n' "$n" "?" "?" "NAO MEDIDO (rc=$rc) <- reprova, e nao esta declarado"
    PROBLEMAS=$((PROBLEMAS+1)); continue
  fi
  if [ "$p" -eq 0 ] && [ "$f" -eq 0 ]; then
    printf '%-30s %8s %8s  %s\n' "$n" "0" "0" "BATERIA VAZIA <- reprova"
    PROBLEMAS=$((PROBLEMAS+1)); continue
  fi
  TOT_P=$((TOT_P+p)); TOT_F=$((TOT_F+f))
  if [ "$f" -gt 0 ] || [ "$rc" -ne 0 ]; then
    printf '%-30s %8s %8s  %s\n' "$n" "$p" "$f" "REPROVOU (rc=$rc)"
    PROBLEMAS=$((PROBLEMAS+1))
    grep -E '^  FALHA|^FALHA|INCONCLUSIVO' "$out" | head -4 | sed 's/^/      /'
  else
    printf '%-30s %8s %8s  %s\n' "$n" "$p" "$f" "ok"
  fi
done

echo
echo "baterias: $TOT_ARQ arquivo(s) -- $((TOT_ARQ - AMBIENTE)) auto-contida(s), $AMBIENTE dependente(s) de ambiente (declaradas em $(basename "$AMB"))"
echo "asseracoes: $((TOT_P + TOT_F)) no total -- $TOT_P passaram, $TOT_F falharam"
if [ "$PROBLEMAS" -gt 0 ]; then
  echo "== REPROVADO: $PROBLEMAS bateria(s) com falha ou sem medicao =="
  exit 1
fi
echo "== TODAS AS BATERIAS VERDES: $((TOT_P + TOT_F)) asseracoes contadas, 0 falhas =="
