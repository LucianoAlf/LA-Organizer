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
CB="$AQUI/check-backup.sh"   # substituido logo abaixo pela copia com o canal neutralizado
P=0; F=0
ok()    { P=$((P+1)); printf '  ok    %s\n' "$1"; }
falhou(){ F=$((F+1)); printf '  FALHA %s\n' "$1"; }
D=$(mktemp -d /tmp/sentinela.XXXXXX)
trap 'rm -rf "$D"' EXIT INT TERM
mkdir -p "$D/db/dia"

# CANAL DE ALERTA NEUTRALIZADO (31/08). O cabecalho desta bateria dizia "nao toca em producao"
# e tocava: `grito()` no check-backup resolve `alertar.sh` AO LADO do proprio script, entao
# rodar o binario de PRODUCAO mandava WhatsApp DE VERDADE pro grupo a cada cenario CRITICO --
# e os atestados aqui sao fixture ("velho.drill", vencido-10d), ou seja, o grupo levava alarme
# sobre um backup que nao existe. Aconteceu 3x em 31/08, uma por rodada da suite, e passou por
# bug de producao. CHECK_BACKUP_DEST redireciona os DADOS; nao redirecionava o CANAL.
# A copia leva junto o lib-baseline-queries porque o check-backup tambem o resolve por dirname.
BIN="$D/bin"; mkdir -p "$BIN"
cp "$AQUI/check-backup.sh" "$AQUI/lib-baseline-queries.sh" "$BIN/"   || { echo "ABORTADO: nao consegui copiar o check-backup para o sandbox"; exit 2; }
cat > "$BIN/alertar.sh" <<'ALERTAFALSO'
#!/bin/bash
printf '%s
' "$*" >> "${ALERTAS_CAPTURADOS:?ALERTAS_CAPTURADOS nao definido}"
ALERTAFALSO
chmod 0700 "$BIN/alertar.sh" "$BIN/check-backup.sh"
CB="$BIN/check-backup.sh"
export ALERTAS_CAPTURADOS="$D/alertas-capturados.txt"; : > "$ALERTAS_CAPTURADOS"

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
drill_telem() { # <status> <minutos_atras> [exit_code]
  local st=$1 min=$2 ec=${3:-} extra=""
  [ -n "$ec" ] && extra=",\"exit_code\":$ec"
  printf '{"ts":"%s","evento":"restore-drill","status":"%s","dump":"x.dump","falhas":0,"imagem":"i"%s}\n' \
    "$(date -d "-$min minutes" -Iseconds)" "$st" "$extra" >> "$D/db/runs.jsonl"
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

echo "== BLOQUEADOR 5: mtime nao ressuscita atestado vencido =="
# A v2.5 selecionava por `find -mtime` e media idade por `stat -c %Y`. Um `touch` bastava
# para um drill de 10 dias voltar a certificar - sem que uma linha do atestado mudasse.
rm -f "$D/db/dia"/*.drill
criar_backup t 0; criar_drill t 10 aprovado
espera critico "drill de 10d (ts interno) reprova"
touch "$D/db/dia/t.drill"                      # mtime = agora; ts interno segue 10 dias atras
espera critico "touch NAO ressuscita: a validade vem do ts interno"
grep -q '^ts=' "$D/db/dia/t.drill" && ok "o atestado continua intacto (nada foi reescrito)" \
  || falhou "o teste corrompeu o atestado e nao mediu o que queria"

echo "== ts no FUTURO e ts ilegivel nao certificam =="
rm -f "$D/db/dia"/*.drill; criar_drill t 0 aprovado
sed -i "s/^ts=.*/ts=$(date -d '+3 days' -Iseconds)/" "$D/db/dia/t.drill"
espera critico "ts no futuro reprova"
sed -i 's/^ts=.*/ts=ontem de manha/' "$D/db/dia/t.drill"
espera critico "ts fora do formato reprova"
sed -i 's/^ts=.*/ts=/' "$D/db/dia/t.drill"
espera critico "ts vazio reprova"

echo "== BLOQUEADOR 7: manifesto obrigatorio no atestado =="
rm -f "$D/db/dia"/*.drill; criar_drill t 0 aprovado
espera ok "atestado completo (3 hashes) certifica"
sed -i 's/^manifest_sha256=.*/manifest_sha256=ausente/' "$D/db/dia/t.drill"
espera critico "manifest_sha256=ausente reprova (a v2.5 aceitava com um continue)"
sed -i 's/^manifest_sha256=.*/manifest_sha256=deadbeef/' "$D/db/dia/t.drill"
espera critico "hash de manifesto truncado reprova"

echo "== selecao pelo ts, nao pelo nome nem pela data do arquivo =="
rm -f "$D/db/dia"/*.drill
criar_drill t 7 aprovado                        # dentro da janela, mas velho
cp "$D/db/dia/t.drill" "$D/db/dia/t.drill.bkp" 2>/dev/null
espera ok "o unico valido dentro da janela certifica"
rm -f "$D/db/dia/t.drill.bkp"

echo "== o proprio restore-drill recusa conjunto sem manifesto =="
# Sem isto, a sentinela so trataria o sintoma: quem GRAVA `ausente` e o drill. A checagem
# fica ANTES do docker de proposito, para ser reproduzivel em qualquer host.
RD="$AQUI/restore-drill.sh"
if [ -x "$RD" ]; then
  mkdir -p "$D/semman"
  printf 'DUMP FALSO\n' > "$D/semman/x.dump"
  printf 'baseline_versao=3\n' > "$D/semman/x.baseline"
  SAIDA=$("$RD" "$D/semman/x.dump" 2>&1); RC=$?
  if [ "$RC" = 2 ] && grep -qi 'manifesto ausente' <<<"$SAIDA"; then
    ok "drill recusa dump sem .manifest (rc=2)"
  else
    falhou "drill nao recusou conjunto sem manifesto (rc=$RC): $(head -1 <<<"$SAIDA" | cut -c1-70)"
  fi
  [ -f "$D/semman/x.drill" ] && falhou "gravou atestado mesmo recusando" || ok "nenhum atestado gravado na recusa"
  printf 'manifesto\n' > "$D/semman/x.manifest"
  SAIDA=$("$RD" "$D/semman/x.dump" 2>&1); RC=$?
  grep -qi 'manifesto ausente' <<<"$SAIDA" && falhou "ainda reclama de manifesto existente" \
    || ok "com manifesto presente, a recusa passa a ser outra (docker/restore), nao o manifesto"
else
  falhou "restore-drill.sh nao encontrado em $RD"
fi

echo "== DESFECHO DO ULTIMO DRILL: a falha avisa no MESMO domingo, nao no vencimento =="
# Conjunto limpo: backup e atestado de HOJE. Assim o contrato B (vencimento) esta satisfeito,
# e o unico que pode gritar e o desfecho do drill — que e exatamente o buraco que se fechou.
rm -f "$D/db/runs.jsonl"; rm -f "$D/db/dia/"*
criar_backup fresco 0; criar_drill fresco 0 aprovado

drill_telem aprovado 5
espera ok "drill aprovado ha 5 min: segue verde"

# A sentinela e horaria e o drill leva ~1 min: ela pode passar no meio da execucao.
drill_telem inicio 3
espera ok "inicio RECENTE e drill rodando agora, nao alarme"

drill_telem inicio 240
espera critico "inicio parado ha 4h: morreu sem o trap conseguir carimbar"

# O CENARIO QUE JUSTIFICA TUDO: o atestado de hoje ainda vale, entao o vencimento de 8 dias
# nao acusaria nada — e mesmo assim a proxima prova NAO vai existir. Antes de 06/09 isso
# passava calado por ate 8 dias (foi o que aconteceu em 30/08 e 06/09).
drill_telem morreu 30 125
espera critico "morreu no meio: grita hoje, com o atestado AINDA dentro da janela"

drill_telem reprovado 10
espera critico "reprovado tambem grita pelo desfecho, nao so pelo atestado"

echo "== o canal de alerta NAO pode ter saido do sandbox =="
if [ -s "$ALERTAS_CAPTURADOS" ]; then
  ok "os $(grep -c . "$ALERTAS_CAPTURADOS") alerta(s) foram para o canal FALSO -- producao intocada"
else
  falhou "zero alertas capturados: ou nenhum cenario gritou, ou o grito escapou para o alertar REAL"
fi

echo
echo "== $P passaram, $F falharam =="
[ "$F" -eq 0 ]
