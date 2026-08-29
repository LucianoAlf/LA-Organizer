#!/bin/bash
# P0-2 v2.4 — Sentinela. Só LÊ.
#
# CORREÇÃO v2.3 -> v2.4 (bloqueador #5): a v2.3 conferia só o `.dump`. Baseline, manifesto e
# checksum podiam sumir e a sentinela continuava verde — mas o restore drill EXIGE dump +
# baseline. Ou seja: ela dizia "backup ok" sobre um conjunto que já não era restaurável.
#
# Critério de "backup comprovado" (todos obrigatórios):
#   1. existe run status=ok na janela;
#   2. o artefato do caminho registrado existe, com tamanho e sha256 da telemetria;
#   3. o CONJUNTO existe ao lado dele: .baseline, .manifest, .sha256;
#   4. o .baseline tem as 8 seções de lista que o drill consome;
#   5. os hashes do .sha256 conferem com os arquivos;
#   6. idade dentro do limite, e NÃO negativa.
# Falta qualquer um => CRÍTICO. Backup que a sentinela não consegue provar restaurável não
# é backup: é arquivo.

set -uo pipefail
# DEST sobrescrevivel para os testes de linha do tempo (nunca em producao).
DEST=${CHECK_BACKUP_DEST:-/opt/backups/la-organizer/db}
TELEMETRY="$DEST/runs.jsonl"
LIMITE_H=36

grito() {
  echo "[check-backup] CRITICO: $1" >&2
  # Sem MTA neste host, um CRITICO no log nao avisa ninguem. A sentinela e horaria, entao
  # o intervalo de supressao de 3h evita repetir o mesmo assunto a cada execucao.
  # FALSO-VERDE (laudo v2): `>/dev/null 2>&1` jogava fora saida e codigo de retorno do
  # alerta. Se o envio falhasse, o CRITICO ia para o log e ninguem era avisado — exatamente
  # o buraco que este canal existe para fechar. Agora a falha de ENVIO tambem e impressa.
  A="$(dirname "$(readlink -f "$0")")/alertar.sh"
  if [ ! -x "$A" ]; then
    echo "[check-backup] ALERTA INDISPONIVEL: $A ausente ou sem +x — o CRITICO acima nao foi notificado" >&2
  elif ! S=$("$A" --chave sentinela-backup --intervalo-min 180         "TOM: sentinela de backup CRITICO — $1" 2>&1); then
    echo "[check-backup] ALERTA FALHOU: $(printf '%s' "$S" | head -1 | cut -c1-160)" >&2
  fi
  exit 2
}
campo() { sed -E "s/.*\"$1\":\"?([^,\"}]*)\"?.*/\1/" <<<"$2"; }

[ -s "$TELEMETRY" ] || grito "sem telemetria em $TELEMETRY"
ULTIMO=$(grep '"status":"ok"' "$TELEMETRY" | tail -1)
[ -n "$ULTIMO" ] || grito "nenhum run com status=ok registrado"

RUN=$(campo run_id "$ULTIMO"); TS=$(campo ts "$ULTIMO")
BYTES=$(campo bytes "$ULTIMO"); SHA=$(campo sha256 "$ULTIMO"); ARQ=$(campo artefato "$ULTIMO")
[ -n "$ARQ" ] || grito "run $RUN nao registrou caminho do artefato"

IDADE_H=$(( ( $(date +%s) - $(date -d "$TS" +%s) ) / 3600 ))
[ "$IDADE_H" -ge 0 ]           || grito "run $RUN tem timestamp no FUTURO (${IDADE_H}h)"
[ "$IDADE_H" -le "$LIMITE_H" ] || grito "ultimo backup ok ha ${IDADE_H}h (limite ${LIMITE_H}h)"

# 2. o dump
[ -f "$ARQ" ] || grito "run $RUN diz ok mas o artefato nao existe: $ARQ"
[ "$(stat -c%s "$ARQ")" = "$BYTES" ] || grito "tamanho de $ARQ diverge da telemetria"
[ "$(sha256sum "$ARQ" | cut -d' ' -f1)" = "$SHA" ] || grito "sha256 de $ARQ diverge da telemetria"

# 3. o CONJUNTO — sem estes o drill nao roda, logo o backup nao e restauravel
BASE="${ARQ%.dump}"
for ext in baseline manifest sha256; do
  [ -f "$BASE.$ext" ] || grito "conjunto incompleto: falta $(basename "$BASE").$ext (o drill exige)"
  [ -s "$BASE.$ext" ] || grito "conjunto incompleto: $(basename "$BASE").$ext esta vazio"
done

# 4. o baseline precisa ter as secoes que o drill consome
# 14/14, nao 8 (laudo v2.2). A sentinela exigia 8 secoes enquanto o drill compara 14 — entao
# um baseline sem `colunas`, `views`, `sequences`, `types` ou `dados` passava pela sentinela
# como "backup comprovado" e so seria reprovado la na frente, se alguem rodasse o drill.
# Sentinela que aprova o que o drill reprova nao esta medindo o mesmo backup.
# A lista sai do MESMO arquivo que o drill usa, para nao voltar a divergir por copia manual.
LIBQ="$(dirname "$(readlink -f "$0")")/lib-baseline-queries.sh"
if [ -r "$LIBQ" ] && . "$LIBQ" 2>/dev/null && [ "${#BASELINE_CHAVES[@]}" -ge 14 ]; then
  CATEGORIAS=("${BASELINE_CHAVES[@]}")
else
  grito "nao consegui carregar as categorias de $LIBQ — sem isso nao sei o que exigir do baseline"
fi
FALTAM=""
for c in "${CATEGORIAS[@]}"; do
  grep -q -- "^--- lista:$c ---$" "$BASE.baseline" || FALTAM="$FALTAM $c"
done
[ -z "$FALTAM" ] || grito "baseline sem a(s) secao(oes):$FALTAM — o drill compara ${#CATEGORIAS[@]} categorias e reprovaria"
BV=$(grep -m1 '^baseline_versao=' "$BASE.baseline" | cut -d= -f2)
[ "${BV:-1}" = "${BASELINE_VERSAO:-1}" ] || grito "baseline na versao ${BV:-1}, o drill exige ${BASELINE_VERSAO:-1} — este backup nao e drillavel"
echo "[check-backup] baseline: ${#CATEGORIAS[@]}/${#CATEGORIAS[@]} categorias, versao ${BV:-1}"

# 6. CERTIFICADO DE RECUPERACAO (laudo v2.3). Ate aqui a sentinela provava que o CONJUNTO
# esta integro — dump, baseline, manifesto, checksum. Integro nao e o mesmo que RESTAURAVEL:
# so o drill responde isso, e a sentinela nunca exigia um. "Backup verde" sem drill aprovado
# e a definicao de backup nao testado.
# Janela de 8 dias porque o drill roda semanalmente no cron (tom-restore-drill).
# DOIS CONTRATOS SEPARADOS (laudo v2.4, bloqueador 6).
#
# A v2.4 exigia o drill DO DUMP DESTE RUN. Isso confundiu duas perguntas diferentes e criou um
# critico diario garantido: o backup das 06:00 de segunda nunca tem drill (o drill e semanal,
# domingo 04:30), entao a sentinela gritava CRITICO todo dia da semana — alarme que toca sempre
# e alarme que ninguem le, e ai o dia em que ele estiver certo passa junto.
#
#   Contrato A — INTEGRIDADE E FRESCOR (acima): o backup MAIS RECENTE existe, esta completo,
#                bate hash e tem idade dentro do limite. E sobre o dump de hoje.
#   Contrato B — RESTAURABILIDADE (aqui): existe um drill APROVADO dentro da janela, e os
#                artefatos que ele diz ter certificado continuam intactos. E sobre a capacidade
#                de recuperar, que nao se prova todo dia — se prova periodicamente.
#
# O drill continua amarrado ao dump exato que testou (por hash). O que muda e que esse dump
# NAO precisa ser o mais novo. "Tenho backup integro hoje" e "ja provei que consigo restaurar"
# sao afirmacoes distintas, e juntar as duas quebrava a primeira sem fortalecer a segunda.
# VALIDADE PELO ts INTERNO, NUNCA POR mtime (laudo v2.5, bloqueador 5). A v2.5 selecionava
# com `find -mtime` e media a idade com `stat -c %Y`: um `touch` num atestado vencido o
# ressuscitava, embora o `ts` gravado DENTRO dele continuasse antigo. Data de arquivo e
# metadado de filesystem - qualquer rsync, cp -p ou restore a reescreve. O que certifica e o
# que o drill ESCREVEU. Formato invalido, ts no FUTURO ou fora da janela nao certificam nada.
DRILL_MAX_DIAS=${DRILL_MAX_DIAS:-8}
AGORA=$(date +%s)
ULT_DRILL=""; ULT_EPOCH=0; IDADE_DRILL=0; VISTOS=0; RECUSADOS=""
while IFS= read -r d; do
  [ -f "$d" ] || continue
  VISTOS=$((VISTOS+1))
  n=$(basename "$d")
  grep -q '^veredito=aprovado' "$d" 2>/dev/null || { RECUSADOS="$RECUSADOS $n(nao-aprovado)"; continue; }
  dts=$(sed -n 's/^ts=//p' "$d" | head -1)
  case "$dts" in
    [0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*) : ;;
    *) RECUSADOS="$RECUSADOS $n(ts-invalido)"; continue ;;
  esac
  de=$(date -d "$dts" +%s 2>/dev/null)
  case "${de:-}" in ''|*[!0-9]*) RECUSADOS="$RECUSADOS $n(ts-ilegivel)"; continue ;; esac
  # 300s de folga cobre relogio/timezone; alem disso e atestado datado no futuro.
  if [ "$de" -gt $((AGORA + 300)) ]; then RECUSADOS="$RECUSADOS $n(ts-no-FUTURO)"; continue; fi
  idade=$(( (AGORA - de) / 86400 ))
  if [ "$idade" -gt "$DRILL_MAX_DIAS" ]; then RECUSADOS="$RECUSADOS $n(vencido-${idade}d)"; continue; fi
  if [ "$de" -gt "$ULT_EPOCH" ]; then ULT_EPOCH=$de; ULT_DRILL=$d; IDADE_DRILL=$idade; fi
done < <(find "$DEST" -name '*.drill' -type f 2>/dev/null)

if [ -z "$ULT_DRILL" ]; then
  # (o motivo de cada descarte vai na mensagem: sem isso, "nenhum drill" nao diz se e
  #  ausencia, vencimento ou ts adulterado)
  grito "nenhum restore drill APROVADO e VALIDO nos ultimos $DRILL_MAX_DIAS dias (${VISTOS} atestado(s) examinado(s); descartado(s):${RECUSADOS:- nenhum}) -- backup integro, recuperacao NAO comprovada"
fi

# ATESTADO AMARRADO AOS ARTEFATOS (bloqueador 8). "Aprovado" sem dizer aprovado sobre O QUE
# nao vale: trocar o dump, o baseline ou o manifesto depois do drill deixaria o atestado
# valendo para um conjunto que ja nao existe. Cada hash gravado e reconferido contra o arquivo.
DBASE="${ULT_DRILL%.drill}"
campo_drill() { sed -n "s/^$1=//p" "$ULT_DRILL" | head -1; }
D_ID=$(campo_drill backup_id); D_DUMP=$(campo_drill dump_sha256)
D_BASE=$(campo_drill baseline_sha256); D_MAN=$(campo_drill manifest_sha256)
D_VER=$(campo_drill baseline_versao); D_TS=$(campo_drill ts)

# Campos obrigatorios primeiro, e a mensagem diz QUAIS faltam — um atestado de versao antiga
# tem alguns e nao outros, e "drill diz certificar ''" nao explica nada a quem le as 3 da manha.
FALTANDO=""
[ -n "$D_ID" ]   || FALTANDO="$FALTANDO backup_id"
[ -n "$D_DUMP" ] || FALTANDO="$FALTANDO dump_sha256"
[ -n "$D_BASE" ] || FALTANDO="$FALTANDO baseline_sha256"
[ -n "$D_MAN" ]  || FALTANDO="$FALTANDO manifest_sha256"
[ -n "$D_VER" ]  || FALTANDO="$FALTANDO baseline_versao"
[ -n "$D_TS" ]   || FALTANDO="$FALTANDO ts"
[ -z "$FALTANDO" ]   || grito "drill $(basename "$ULT_DRILL") sem o(s) campo(s):$FALTANDO — gerado por versao antiga, nao amarra o atestado a artefato nenhum. Rode restore-drill.sh de novo."
[ "$D_ID" = "$(basename "$DBASE")" ]   || grito "drill diz certificar '$D_ID' mas esta ao lado de '$(basename "$DBASE")'"
[ "$D_VER" = "${BASELINE_VERSAO:-1}" ]   || grito "drill rodou com baseline versao $D_VER, atual e ${BASELINE_VERSAO:-1}"

for par in "dump:$D_DUMP" "baseline:$D_BASE" "manifest:$D_MAN"; do
  ext=${par%%:*}; esp=${par#*:}
  arq="$DBASE.$ext"
  # MANIFESTO OBRIGATORIO (laudo v2.5, bloqueador 7). Aqui havia uma linha que pulava a
  # conferencia quando o drill gravava `manifest_sha256=ausente`. Ou seja: o atestado podia
  # certificar um conjunto SEM manifesto e a sentinela aceitava. Atestado que aceita artefato
  # ausente nao amarra nada -- e a amarracao e a razao de o atestado existir.
  # `ausente` comeca com `a`, que e digito hex: casar por prefixo nao serve. Exige 64
  # caracteres e NADA fora do alfabeto hex.
  if [ "${#esp}" != 64 ] || [ -n "${esp//[0-9a-f]/}" ]; then
    grito "drill nao certifica o $ext (gravou '$esp') -- sem os TRES artefatos com hash o atestado nao amarra nada. Rode restore-drill.sh de novo."
  fi
  [ -f "$arq" ] || grito "artefato certificado pelo drill sumiu: $(basename "$arq")"
  real=$(sha256sum "$arq" | cut -d' ' -f1)
  [ "$real" = "$esp" ]     || grito "$(basename "$arq") MUDOU depois do drill (sha no atestado != sha no disco) — a certificacao nao vale mais"
done

# IDADE_DRILL ja veio do `ts` interno na selecao acima -- nada de stat/mtime aqui tambem.
echo "[check-backup] restauracao comprovada: $(basename "$ULT_DRILL") (ts interno ha ${IDADE_DRILL}d, limite ${DRILL_MAX_DIAS}d, 3 artefatos conferidos por hash)"

# 5. checksums do conjunto
( cd "$(dirname "$ARQ")" && sha256sum -c --quiet "$BASE.sha256" ) 2>/dev/null \
  || grito "sha256sum -c reprovou o conjunto (arquivo alterado ou corrompido)"

# A sentinela roda de hora em hora e alguém olha para ela. Como não há MTA neste host, ela
# é o único lugar onde a falha da varredura (que roda a cada 15 min) pode ser NOTADA.
# Sem isto, um scanner reprovando ficava enterrado no backup.log e ninguém saberia.
ESTADO=${CHECK_BACKUP_VARREDURA:-/opt/backups/la-organizer/varredura-status}
if [ -f "$ESTADO" ]; then
  V=$(sed -n 's/^veredito=//p' "$ESTADO"); E=$(sed -n 's/^epoch=//p' "$ESTADO")
  IDADE_MIN=$(( ( $(date +%s) - ${E:-0} ) / 60 ))
  [ "$V" = ok ] || grito "varredura de permissoes REPROVOU (restante=$(sed -n 's/^restante=//p' "$ESTADO"), problemas=$(sed -n 's/^problemas=//p' "$ESTADO"))"
  # roda a cada 15 min; acima de 45 min significa que parou de rodar
  [ "$IDADE_MIN" -le 45 ] || grito "varredura de permissoes parada ha ${IDADE_MIN} min (esperado <= 45)"
  # A varredura agora registra se conseguiu AVISAR. Alerta que nao sai e mordaça: a falha
  # existe, o canal esta mudo, e sem esta linha ninguem saberia da mudez.
  AL=$(sed -n 's/^alerta=//p' "$ESTADO" | tail -1)
  case "${AL:-}" in
    falhou|indisponivel) grito "varredura tentou alertar e NAO conseguiu (alerta=$AL) — canal externo mudo" ;;
  esac
  echo "[check-backup] varredura: $V, ha ${IDADE_MIN} min${AL:+, alerta=$AL}"
else
  grito "sem estado da varredura de permissoes em $ESTADO — ela nunca rodou ou nao consegue gravar"
fi

echo "[check-backup] ok: run=$RUN idade=${IDADE_H}h; dump+baseline+manifest+sha256 conferidos ($BYTES bytes)"
