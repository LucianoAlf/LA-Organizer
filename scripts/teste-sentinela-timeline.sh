#!/bin/bash
# Linha do tempo da sentinela: backup DIARIO x drill SEMANAL, em diretorio descartavel.
# Nao toca em producao — usa CHECK_BACKUP_DEST/CHECK_BACKUP_VARREDURA.
#
# O bloqueador (laudo v2.4, item 6): a v2.4 exigia o drill DO DUMP DESTE RUN. Como o drill e
# semanal e o backup e diario, de segunda a sabado a sentinela gritava CRITICO todo dia.
# Alarme que toca sempre e alarme que ninguem le — e ai o dia em que ele estiver certo passa
# junto. Sao dois contratos: integridade/frescor (diario) e restaurabilidade (periodica).

set -uo pipefail
AQUI="$(dirname "$(readlink -f "$0")")"
CB="$AQUI/check-backup.sh"
P=0; F=0
ok()    { P=$((P+1)); printf '  ok    %s\n' "$1"; }
falhou(){ F=$((F+1)); printf '  FALHA %s\n' "$1"; }
D=$(mktemp -d /tmp/sentinela.XXXXXX)
trap 'rm -rf "$D"' EXIT INT TERM
mkdir -p "$D/db/dia"

# varredura sempre saudavel: nao e o que este teste mede
VARR="$D/varredura"
{ echo "ts=$(date -Iseconds)"; echo "epoch=$(date +%s)"; echo "veredito=ok"; echo "restante=0"; echo "problemas=0"; } > "$VARR"

# Cria um conjunto de backup completo e coerente, com idade em dias.
criar_backup() { # <nome> <dias_atras>
  local n=$1 dias=$2 base
  base="$D/db/dia/$n"   # separado: com `set -u`, usar $n no mesmo `local` que o declara falha
  printf 'DUMP FALSO %s\n' "$n" > "$base.dump"
  { echo "baseline_versao=3"; echo "tabelas_n=1"
    for c in tabelas colunas funcoes views sequences triggers types policies indices constraints grants acl_funcoes acl_tabelas rls extensoes dados sequences_estado; do
      printf -- '--- lista:%s ---\nx\n--- fim:%s ---\n' "$c" "$c"; done
  } > "$base.baseline"
  printf 'manifesto falso\n' > "$base.manifest"
  ( cd "$D/db/dia" && sha256sum "$n.dump" "$n.baseline" "$n.manifest" > "$n.sha256" )
  local ts; ts=$(date -d "-$dias days" -Iseconds)
  printf '{"ts":"%s","run_id":"run-%s","status":"ok","bytes":%s,"sha256":"%s","artefato":"%s"}\n' \
    "$ts" "$n" "$(stat -c%s "$base.dump")" "$(sha256sum "$base.dump" | cut -d' ' -f1)" "$base.dump" >> "$D/db/runs.jsonl"
  touch -d "-$dias days" "$base.dump" "$base.baseline" "$base.manifest" "$base.sha256"
}
criar_drill() { # <nome> <dias_atras> <veredito>
  local n=$1 dias=$2 v=$3 base
  base="$D/db/dia/$n"
  { echo "veredito=$v"; echo "ts=$(date -d "-$dias days" -Iseconds)"
    echo "backup_id=$n"
    echo "dump_sha256=$(sha256sum "$base.dump" | cut -d' ' -f1)"
    echo "baseline_sha256=$(sha256sum "$base.baseline" | cut -d' ' -f1)"
    echo "manifest_sha256=$(sha256sum "$base.manifest" | cut -d' ' -f1)"
    echo "baseline_versao=3"
  } > "$base.drill"
  touch -d "-$dias days" "$base.drill"
}
rodar() { CHECK_BACKUP_DEST="$D/db" CHECK_BACKUP_VARREDURA="$VARR" "$CB" 2>&1; }
espera() { # <esperado ok|critico> <descricao>
  local out rc; out=$(rodar); rc=$?
  if [ "$1" = ok ] && [ "$rc" = 0 ]; then ok "$2"
  elif [ "$1" = critico ] && [ "$rc" != 0 ]; then ok "$2 -> $(grep -o 'CRITICO.*' <<<"$out" | cut -c1-72)"
  else falhou "$2 (rc=$rc) $(tail -1 <<<"$out" | cut -c1-90)"; fi
}

echo "== domingo 05:00, ANTES do backup: dump de sabado + drill de sabado =="
criar_backup sab 1; criar_drill sab 1 aprovado
espera ok "backup de ontem, drill do mesmo dump"

echo "== domingo 06:05, DEPOIS do backup: dump novo, drill ainda no de sabado =="
criar_backup dom 0
espera ok "backup novo sem drill proprio NAO derruba (era o critico diario da v2.4)"

echo "== quarta: dump de quarta, drill continua o de sabado (4 dias) =="
criar_backup qua 0
espera ok "drill de 1 dia atras ainda dentro da janela"

echo "== drill VENCIDO (10 dias, janela 8) =="
rm -f "$D/db/dia"/*.drill
criar_backup velho 0; criar_drill velho 10 aprovado
espera critico "drill fora da janela reprova"

echo "== drill REPROVADO dentro da janela =="
rm -f "$D/db/dia"/*.drill
criar_drill velho 1 reprovado
espera critico "drill reprovado nao certifica"

echo "== drill aprovado, mas o BASELINE mudou depois dele =="
rm -f "$D/db/dia"/*.drill
criar_drill velho 1 aprovado
espera ok "estado coerente antes de adulterar"
printf 'baseline ADULTERADO\n' >> "$D/db/dia/velho.baseline"
espera critico "baseline alterado apos o drill invalida a certificacao"

echo "== drill aprovado, mas o DUMP mudou depois dele =="
( cd "$D/db/dia" && sha256sum velho.dump velho.baseline velho.manifest > velho.sha256 )
rm -f "$D/db/dia"/*.drill; criar_drill velho 1 aprovado
espera ok "estado coerente de novo"
printf 'dump ADULTERADO\n' >> "$D/db/dia/velho.dump"
espera critico "dump alterado apos o drill invalida a certificacao"

echo
echo "== $P passaram, $F falharam =="
[ "$F" -eq 0 ]
