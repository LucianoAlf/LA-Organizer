#!/bin/bash
# rodar-baterias.sh -- roda as baterias POR NIVEL DE ISOLAMENTO e CALCULA o total.
#
# Existe por dois criterios de entrega:
#   v2.6: "a contagem da bateria deve ser calculada, nao escrita como texto fixo";
#   v2.7 (laudo v2.6, bloqueador 10): "separe unit, integration-sandbox e environment-read-only;
#         teste esperado ausente ou crashado deve reprovar".
#
# O que mudou em relacao a v2.6, e por que:
#   * a v2.6 tinha uma lista de baterias "que exigem ambiente" e, quando uma delas CRASHAVA
#     antes de imprimir a contagem, o runner a classificava como "exige ambiente" -- ou seja,
#     um teste quebrado saia como dispensa, nao como falha. Isso acabou: ausente ou sem
#     contagem REPROVA, sempre, em qualquer nivel;
#   * o nivel vem de baterias-niveis.txt. Bateria sem nivel declarado REPROVA -- classificacao
#     esquecida vira, com o tempo, um teste tocando producao sem ninguem notar;
#   * a contagem sai separada por nivel. "166 auto-contidas" era rotulo falso quando duas
#     baterias liam .env, rede e /run.
#
# Uso:  ./rodar-baterias.sh                  roda tudo
#       ./rodar-baterias.sh --nivel unit     roda so um nivel
#       ./rodar-baterias.sh <filtro>         roda so as baterias cujo nome casa

set -uo pipefail
AQUI="$(dirname "$(readlink -f "$0")")"
NIVEIS_ARQ="$AQUI/baterias-niveis.txt"
FILTRO=""; SO_NIVEL=""
case "${1:-}" in
  --nivel) SO_NIVEL=${2:?uso: --nivel <unit|integration-sandbox|environment-read-only>} ;;
  "")      : ;;
  *)       FILTRO=$1 ;;
esac
SAIDAS=$(mktemp -d "${TMPDIR:-/tmp}/baterias.XXXXXX")
trap 'rm -rf "$SAIDAS"' EXIT INT TERM

[ -r "$NIVEIS_ARQ" ] || { echo "FATAL: $NIVEIS_ARQ ilegivel -- sem classificacao nao ha contagem confiavel" >&2; exit 2; }
nivel_de() { sed -nE "s/^$1[[:space:]]+([a-z-]+)[[:space:]].*/\1/p" "$NIVEIS_ARQ" | head -1; }
motivo_de() { sed -nE "s/^$1[[:space:]]+[a-z-]+[[:space:]]+(.*)/\1/p" "$NIVEIS_ARQ" | head -1; }

declare -A P_NIVEL F_NIVEL N_NIVEL
for k in unit integration-sandbox environment-read-only; do P_NIVEL[$k]=0; F_NIVEL[$k]=0; N_NIVEL[$k]=0; done
PROBLEMAS=0; TOT_ARQ=0

printf '%-32s %-22s %7s %7s  %s\n' "bateria" "nivel" "passou" "falhou" "veredito"
printf '%-32s %-22s %7s %7s  %s\n' "--------------------------------" "----------------------" "-------" "-------" "--------"

for t in "$AQUI"/teste-*.sh; do
  n=$(basename "$t")
  [ -n "$FILTRO" ] && case "$n" in *"$FILTRO"*) : ;; *) continue ;; esac
  nivel=$(nivel_de "$n")
  if [ -z "$nivel" ]; then
    printf '%-32s %-22s %7s %7s  %s\n' "$n" "SEM NIVEL" "?" "?" "REPROVA: declare em $(basename "$NIVEIS_ARQ")"
    PROBLEMAS=$((PROBLEMAS+1)); continue
  fi
  [ -n "$SO_NIVEL" ] && [ "$nivel" != "$SO_NIVEL" ] && continue
  TOT_ARQ=$((TOT_ARQ+1))
  N_NIVEL[$nivel]=$(( ${N_NIVEL[$nivel]} + 1 ))

  out="$SAIDAS/$n.out"
  bash "$t" > "$out" 2>&1; rc=$?

  # Dois formatos convivem no repo: "N passaram, M falharam" e "N pass, M falha".
  linha=$(grep -oE '== [0-9]+ (passaram, [0-9]+ falharam|pass, [0-9]+ (falha|falha/inconclusivo))' "$out" | tail -1)
  p=$(grep -oE '^== [0-9]+' <<<"$linha" | grep -oE '[0-9]+' || true)
  f=$(grep -oE '[0-9]+ (falharam|falha)' <<<"$linha" | grep -oE '^[0-9]+' || true)

  if [ -z "$linha" ] || [ -z "$p" ] || [ -z "$f" ]; then
    # SEM ESCAPATORIA (bloqueador 10): crash antes da contagem e FALHA, nunca dispensa.
    motivo="NAO MEDIDO (rc=$rc) <- REPROVA"
    grep -q 'ABORTADO' "$out" && motivo="ABORTADO (rc=$rc) <- REPROVA: $(grep -m1 -o 'ABORTADO.*' "$out" | cut -c1-46)"
    printf '%-32s %-22s %7s %7s  %s\n' "$n" "$nivel" "?" "?" "$motivo"
    PROBLEMAS=$((PROBLEMAS+1)); continue
  fi
  if [ "$p" -eq 0 ] && [ "$f" -eq 0 ]; then
    printf '%-32s %-22s %7s %7s  %s\n' "$n" "$nivel" "0" "0" "BATERIA VAZIA <- REPROVA"
    PROBLEMAS=$((PROBLEMAS+1)); continue
  fi
  P_NIVEL[$nivel]=$(( ${P_NIVEL[$nivel]} + p ))
  F_NIVEL[$nivel]=$(( ${F_NIVEL[$nivel]} + f ))
  if [ "$f" -gt 0 ] || [ "$rc" -ne 0 ]; then
    printf '%-32s %-22s %7s %7s  %s\n' "$n" "$nivel" "$p" "$f" "REPROVOU (rc=$rc)"
    PROBLEMAS=$((PROBLEMAS+1))
    grep -E '^  FALHA|^FALHA|INCONCLUSIVO' "$out" | head -4 | sed 's/^/      /'
  else
    printf '%-32s %-22s %7s %7s  %s\n' "$n" "$nivel" "$p" "$f" "ok"
  fi
done

# baterias declaradas que nao existem no disco tambem reprovam
while read -r arq nivel _; do
  case "$arq" in ''|\#*) continue ;; esac
  [ -n "$SO_NIVEL" ] && [ "$nivel" != "$SO_NIVEL" ] && continue
  [ -n "$FILTRO" ] && case "$arq" in *"$FILTRO"*) : ;; *) continue ;; esac
  if [ ! -f "$AQUI/$arq" ]; then
    printf '%-32s %-22s %7s %7s  %s\n' "$arq" "$nivel" "-" "-" "DECLARADA MAS AUSENTE <- REPROVA"
    PROBLEMAS=$((PROBLEMAS+1))
  fi
done < "$NIVEIS_ARQ"

echo
TOT_P=0; TOT_F=0
for k in unit integration-sandbox environment-read-only; do
  [ -n "$SO_NIVEL" ] && [ "$k" != "$SO_NIVEL" ] && continue
  printf '%-22s %2d bateria(s)  %4d asseracao(oes)  %d falha(s)\n' \
    "$k" "${N_NIVEL[$k]}" "$(( ${P_NIVEL[$k]} + ${F_NIVEL[$k]} ))" "${F_NIVEL[$k]}"
  TOT_P=$(( TOT_P + ${P_NIVEL[$k]} )); TOT_F=$(( TOT_F + ${F_NIVEL[$k]} ))
done
echo
echo "baterias executadas: $TOT_ARQ"
echo "asseracoes: $(( TOT_P + TOT_F )) no total -- $TOT_P passaram, $TOT_F falharam"
if [ "$PROBLEMAS" -gt 0 ]; then
  echo "== REPROVADO: $PROBLEMAS bateria(s) com falha, sem medicao, sem nivel ou ausente =="
  exit 1
fi
echo "== TODAS AS BATERIAS VERDES: $(( TOT_P + TOT_F )) asseracoes contadas, 0 falhas =="
