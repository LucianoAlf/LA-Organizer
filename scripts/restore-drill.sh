#!/bin/bash
# P0-2 v2.4 — Restore drill em ambiente ISOLADO e DESCARTÁVEL.
#
# CORREÇÕES v2.3 -> v2.4 (bloqueador #2):
#   * TODOS os erros do pg_restore são analisados. O `head -40` sumiu: com 41 erros, o 41º
#     — que podia ser o único fora da allowlist — nunca era lido.
#   * TOLERÂNCIA PRECISA. "Qualquer linha contendo 'extension'" era largo demais: uma
#     mensagem sobre uma TABELA cujo nome contivesse "extension" passaria. Agora os padrões
#     casam a forma exata da mensagem do Postgres.
#   * EXTENSÕES COMPARADAS CONTRA O BASELINE, não contra lista fixa no código. A lista fixa
#     era eu adivinhando o que a origem tinha; o baseline É o que a origem tinha.
#   * DIFF DE NOMES. O baseline agora traz a lista completa de cada categoria, então o drill
#     imprime QUAIS objetos faltam (ou sobram), não só que os números diferem.
#
# LIMITE HONESTO: pg_dump do schema da aplicação NÃO recupera auth.*, storage.*, realtime.*,
# Edge Functions nem configuração do projeto. DRILL APROVADO = "os dados e o schema da
# aplicação voltam", não "o projeto inteiro volta".
#
# Uso: ./restore-drill.sh <dump>   (exige <dump sem .dump>.baseline ao lado)

set -euo pipefail
DUMP=${1:?uso: $0 <caminho-do-dump>}
[ -r "$DUMP" ] || { echo "dump ilegivel: $DUMP" >&2; exit 2; }
BASELINE="${DUMP%.dump}.baseline"
[ -r "$BASELINE" ] || { echo "baseline ausente: $BASELINE" >&2; exit 2; }
# MANIFESTO OBRIGATORIO (laudo v2.5, bloqueador 7). Antes o drill rodava sem manifesto e
# gravava `manifest_sha256=ausente` no atestado -- e a sentinela aceitava esse valor. O
# atestado existe para AMARRAR o veredito aos artefatos; com um deles fora, ele certifica
# um conjunto que ninguem conferiu. Falha fechada, e antes do docker: assim a recusa e
# reproduzivel em qualquer host.
MANIFESTO="${DUMP%.dump}.manifest"
[ -s "$MANIFESTO" ] || { echo "manifesto ausente ou vazio: $MANIFESTO -- o drill nao certifica conjunto incompleto" >&2; exit 2; }
command -v docker >/dev/null || { echo "docker ausente" >&2; exit 2; }
# As consultas do baseline vem da MESMA lib que o backup-db usa para grava-las. Duplicar
# aqui significaria, mais cedo ou mais tarde, conferir contra pergunta diferente da que
# gerou o baseline — e a divergencia apareceria como "conjunto DIVERGE" sem causa visivel.
LIBQ="$(dirname "$(readlink -f "$0")")/lib-baseline-queries.sh"
[ -r "$LIBQ" ] || { echo "lib-baseline-queries.sh ausente em $LIBQ" >&2; exit 2; }
# shellcheck disable=SC1090
. "$LIBQ"

CONT=tom-restore-drill-$$
SENHA=$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 24)
ANCORAS=(collaborators tasks conversation_history marker_logs health_check_runs)

# IMAGEM DO DESTINO — descoberto no 1o drill real (28/08): com `postgres:17` puro, a
# extensao `vector` nao existe, o tipo `public.vector` falha, e DUAS tabelas
# (collaborator_memory, collaborator_weekly_summaries) nao sao criadas — gerando 165 erros
# em cascata. O dump estava bom; o AMBIENTE do drill e que era infiel a producao.
# `pgvector/pgvector:pg17` e o mesmo Postgres 17 com a extensao instalada.
# Licao: um drill so prova recuperacao se o destino puder receber o que a origem tem.
IMAGEM=${DRILL_IMAGE:-pgvector/pgvector:pg17}
FALHAS=0
falha() { echo "  FALHA $1"; FALHAS=$((FALHAS+1)); }

TMPD=$(mktemp -d /run/tom-drill.XXXXXX) || { echo "mktemp falhou" >&2; exit 2; }
chmod 0700 "$TMPD"
limpar() {
  rm -rf "$TMPD"
  if docker inspect "$CONT" >/dev/null 2>&1; then
    docker rm -f "$CONT" >/dev/null 2>&1 || {
      echo "REPROVADO: nao consegui destruir o container $CONT — container efemero VAZOU" >&2; exit 1; }
  fi
}
trap limpar EXIT INT TERM

# Extrai a lista de uma categoria do baseline.
lista_baseline() { sed -n "/^--- lista:$1 ---$/,/^--- fim:$1 ---$/p" "$BASELINE" | sed '1d;$d'; }
esperado() { grep -m1 "^$1=" "$BASELINE" | cut -d= -f2; }

# GUARD DE VERSAO (laudo v2.3). Comparar consulta nova contra baseline velho produz
# centenas de diferencas falsas e um REPROVADO que nao significa nada. Melhor recusar.
BV=$(grep -m1 '^baseline_versao=' "$BASELINE" | cut -d= -f2)
if [ "${BV:-1}" != "${BASELINE_VERSAO:-1}" ]; then
  echo "baseline na versao ${BV:-1}, este drill exige a ${BASELINE_VERSAO:-1}." >&2
  echo "Rode backup-db.sh para gerar um baseline no formato atual e refaca o drill." >&2
  exit 2
fi
for c in "${BASELINE_CHAVES[@]}"; do
  grep -q -- "^--- lista:$c ---$" "$BASELINE" || { echo "baseline sem a secao de $c — gerado por versao antiga do backup-db" >&2; exit 2; }
done

echo "== baseline: $(grep -oE '^[a-z]+_n=[0-9]+' "$BASELINE" | tr '\n' ' ')"

echo "== destino isolado (sem rede, sem porta publicada) =="
docker run -d --name "$CONT" --network none \
  -e POSTGRES_PASSWORD="$SENHA" -e POSTGRES_DB=drill "$IMAGEM" >/dev/null
echo -n "aguardando"
pronto=0
for _ in $(seq 1 60); do
  if docker exec -e PGPASSWORD="$SENHA" "$CONT" psql -U postgres -d drill -tAc 'select 1' >/dev/null 2>&1; then pronto=1; echo " ok"; break; fi
  echo -n "."; sleep 1
done
[ "$pronto" = 1 ] || { echo; echo "REPROVADO: destino nao subiu"; exit 1; }

q()     { docker exec -e PGPASSWORD="$SENHA" "$CONT" psql -U postgres -d drill -tAc "$1"; }
lista() { docker exec -e PGPASSWORD="$SENHA" "$CONT" psql -U postgres -d drill -tAc "$1" 2>/dev/null | LC_ALL=C sort; }

echo "== criando os roles do Supabase (sem eles o restore descarta os GRANTs em silencio) =="
for r in anon authenticated service_role authenticator supabase_admin supabase_auth_admin dashboard_user; do
  q "do \$\$ begin if not exists (select 1 from pg_roles where rolname='$r') then create role \"$r\" nologin; end if; end \$\$;" >/dev/null
done

echo "== restaurando (com privilegios; --no-owner porque o dono original nao existe aqui) =="
docker cp "$DUMP" "$CONT:/tmp/drill.dump" >/dev/null
set +e
docker exec -e PGPASSWORD="$SENHA" "$CONT" pg_restore -U postgres -d drill --no-owner /tmp/drill.dump 2>"$TMPD/restore.err"
RC=$?
set -e

# #2: TODOS os erros, com padrao PRECISO. Nada de "contem a palavra extension".
if [ "$RC" -ne 0 ]; then
  grep -iE '^pg_restore: (error|erro)' "$TMPD/restore.err" > "$TMPD/erros.txt" || true
  TOTAL_ERR=$(wc -l < "$TMPD/erros.txt" 2>/dev/null || echo 0)
  echo "  pg_restore rc=$RC — $TOTAL_ERR linha(s) de erro, TODAS classificadas:"
  # rc != 0 SEM nenhuma linha de erro reconhecivel e o pior caso: o restore falhou e o
  # classificador nao tem o que classificar (pg_restore morto por sinal, saida em outro
  # formato, stderr perdido). Antes isso resultava em tolerados=0/inesperados=0 e o drill
  # seguia para o veredito como se nada tivesse acontecido. rc nao explicado REPROVA.
  if [ "$TOTAL_ERR" -eq 0 ]; then
    echo "    stderr bruto (primeiras linhas): $(head -3 "$TMPD/restore.err" | tr '\n' ' ' | cut -c1-200)"
    falha "pg_restore saiu rc=$RC sem NENHUMA linha de erro classificavel — falha nao explicada"
  fi
  INESPERADOS=0
  while IFS= read -r l; do
    case "$l" in
      *'could not open extension control file'*|*'extension "'*'" is not available'*|\
      *'required extension "'*'" is not installed'*|*'extension "pgaudit" does not exist'*|\
      *'extension "supabase_vault" does not exist'*|*'relation "vault.'*'" does not exist'*|\
      *'function public.pgaudit_'*'does not exist'*|*'function vault.'*'does not exist'*)
        # Extensoes de PLATAFORMA que nao existem fora do Supabase e nao criam tabela de
        # aplicacao. `vector` NAO entra aqui: ela cria tipo usado por 2 tabelas reais, e
        # tolera-la mascararia perda de dado — foi exatamente o que o 1o drill pegou.
        ;;
      *'must be owner of'*|*'role "'*'" does not exist'*|*'permission denied to set role'*)
        ;;                                            # owner/role: esperado com --no-owner
      *) echo "    INESPERADO: $(cut -c1-150 <<<"$l")"; INESPERADOS=$((INESPERADOS+1)) ;;
    esac
  done < "$TMPD/erros.txt"
  TOLERADOS=$(( TOTAL_ERR - INESPERADOS ))
  echo "    tolerados: $TOLERADOS | inesperados: $INESPERADOS"
  [ "$INESPERADOS" -eq 0 ] || falha "pg_restore teve $INESPERADOS erro(s) fora da allowlist"
fi

echo "== comparacao por IDENTIDADE, tolerancia ZERO, com diff de nomes =="
comparar() { # chave, sql
  local chave=$1 sql=$2 esp_sha obt obt_sha
  esp_sha=$(esperado "${chave}_sha")
  [ -n "$esp_sha" ] || { falha "$chave: baseline sem hash"; return; }
  lista_baseline "$chave" > "$TMPD/esp.$chave"
  lista "$sql"            > "$TMPD/obt.$chave"
  obt_sha=$(sha256sum < "$TMPD/obt.$chave" | cut -d' ' -f1)
  # o baseline hasheia a lista com \n final via printf; recalcula igual para comparar
  local esp_recalc; esp_recalc=$(sha256sum < "$TMPD/esp.$chave" | cut -d' ' -f1)
  if [ "$obt_sha" = "$esp_recalc" ]; then
    printf '  ok  %-12s %s objetos, conjunto IDENTICO\n' "$chave" "$(grep -c . "$TMPD/obt.$chave")"
  else
    falha "$chave: conjunto DIVERGE (baseline $(grep -c . "$TMPD/esp.$chave"), restaurado $(grep -c . "$TMPD/obt.$chave"))"
    comm -23 "$TMPD/esp.$chave" "$TMPD/obt.$chave" | head -8 | sed 's/^/      FALTANDO: /'
    comm -13 "$TMPD/esp.$chave" "$TMPD/obt.$chave" | head -8 | sed 's/^/      A MAIS:   /'
  fi
}
for par in "${BASELINE_QUERIES[@]}"; do
  chave=${par%%|*}; sql=${par#*|}
  # extensoes e dados tem secao propria: a primeira usa allowlist, a segunda compara
  # NUMEROS com tolerancia declarada (hash de contagem nao serve — a origem muda).
  # `sequences_estado` entra aqui tambem: e NUMERO que so cresce entre o dump e a consulta
  # do baseline, entao compara-lo por identidade daria falso vermelho toda vez que o TOM
  # escrevesse na janela. Tem secao propria, com a mesma regra assimetrica das ancoras.
  case "$chave" in extensoes|dados|sequences_estado) continue ;; esac
  comparar "$chave" "$sql"
done

# Contagem contra a ORIGEM, nao contra "> 0" (achado do laudo). O pg_dump e um snapshot
# consistente tirado ANTES da consulta que gerou o baseline, entao:
#   restaurado <= baseline  (o que entrou nos segundos seguintes nao esta no dump)
#   restaurado >= baseline - FOLGA
# FOLGA (v2.2, laudo): era "0,5% OU 20 linhas, o que for MAIOR" — e o piso de 20 era absoluto.
# Em `collaborators`, que tem 40 linhas, isso tolerava perder 20: METADE da tabela passava
# como aprovada. O piso absoluto veio de raciocinio sobre tabelas grandes e ficou sem limite
# nas pequenas.
# A janela real e de SEGUNDOS (o baseline e consultado logo depois do dump), entao a folga
# nao precisa de piso generoso: 0,5% arredondado para cima, minimo 1 linha. Assim nenhuma
# tabela pode perder mais que 0,5% do seu proprio tamanho, grande ou pequena.
#   collaborators (40)        -> folga 1   (era 20 = 50%)
#   conversation_history (28866) -> folga 145
echo "== dados nas tabelas ancora (contra a contagem da ORIGEM) =="
lista_baseline dados > "$TMPD/dados.esp"
if [ ! -s "$TMPD/dados.esp" ]; then
  falha "baseline sem a secao 'dados' — gerado por versao antiga; contagem nao verificavel"
else
  while IFS= read -r linha; do
    [ -n "$linha" ] || continue
    t=${linha%%:*}; esp=${linha##*:}
    if [ -z "$(q "select to_regclass('public.$t')")" ]; then falha "tabela ancora ausente: $t"; continue; fi
    obt=$(q "select count(*) from public.$t")
    # v2.3: era 0,5% ARREDONDADO PARA CIMA com minimo 1 — o que em collaborators (40 linhas)
    # dava folga 1 = 2,5%, nao 0,5%. Piso minimo virou ZERO: tabela com menos de 200 linhas
    # nao tem folga nenhuma, e e isso mesmo — em 15 segundos ela nao perde linha por acaso.
    folga=$(( esp / 200 ))
    minimo=$(( esp - folga ))
    if [ "$obt" -gt "$esp" ]; then
      falha "$t: restaurado ($obt) MAIOR que a origem ($esp) — dump inconsistente"
    elif [ "$obt" -lt "$minimo" ]; then
      falha "$t: restaurado $obt, origem $esp, minimo $minimo (perda de $(( esp - obt )) linhas)"
    else
      printf '  ok  %-22s %s de %s na origem (folga %s)\n' "$t:" "$obt" "$esp" "$folga"
    fi
  done < "$TMPD/dados.esp"
fi

# ESTADO DAS SEQUENCES (laudo v2.3). `sequences` compara nome e tipo — uma sequence que
# voltasse ZERADA passava, e a proxima escrita colidiria com chave existente. Regra e a mesma
# das ancoras: o valor so cresce, entao restaurado <= baseline. Menor que isso e perda.
echo "== estado das sequences (restaurado <= baseline) =="
lista_baseline sequences_estado > "$TMPD/seq.esp"
if [ ! -s "$TMPD/seq.esp" ]; then
  falha "baseline sem a secao 'sequences_estado'"
else
  # PARSER ESTRITO (v2.5, laudo v2.4 bloqueador 2). O formato virou
  # `nome:valor:called=BOOL`, mas o parser continuou usando `${linha##*:}` — que devolve
  # `called=true`, nao o valor. E o pior nao e errar o campo: com valor nao-numerico as DUAS
  # comparacoes `-gt`/`-lt` falham em silencio (2>/dev/null) e o fluxo cai no `else`, que
  # conta como OK. O drill dizia "2 sequence(s) com valor preservado" sem ter comparado nada.
  # Agora: 3 campos exatos, valor tem que ser inteiro, `called=` tem que ser true/false, e
  # qualquer desvio REPROVA em vez de virar sucesso.
  # A comparacao mora em lib-seq-compare.sh para poder ser testada sem subir um drill
  # inteiro. Aqui fica so a leitura do restaurado e o mapeamento para falha().
  LIBSEQ="$(dirname "$(readlink -f "$0")")/lib-seq-compare.sh"
  if [ ! -r "$LIBSEQ" ]; then
    falha "lib-seq-compare.sh ausente — sem ela nao da para comparar sequences"
  else
    # shellcheck disable=SC1090
    . "$LIBSEQ"
    SEQ_OK=0
    while IFS= read -r linha; do
      [ -n "$linha" ] || continue
      nome=${linha%%:*}
      obt=$(q "select coalesce(last_value::text,'') || ':' || (last_value is not null)::text from pg_sequences where schemaname='public' and sequencename='$nome'" 2>/dev/null | tr -d '[:space:]')
      seq_verificar "$linha" "$obt"; rc=$?
      case $rc in
        0) SEQ_OK=$((SEQ_OK+1)) ;;
        1) falha "$SEQ_MOTIVO" ;;
        *) falha "sequences_estado (nao interpretavel, fail-closed): $SEQ_MOTIVO" ;;
      esac
    done < "$TMPD/seq.esp"
    echo "  ok  $SEQ_OK de $(wc -l < "$TMPD/seq.esp") sequence(s) com valor E is_called preservados"
  fi
fi

# #2: extensoes vindas DO BASELINE. Ausencia so passa se a extensao for comprovadamente
# indisponivel num postgres:17 puro — e essa lista mora aqui como allowlist declarada.
echo "== extensoes (esperadas = as do baseline) =="
EXT_INDISPONIVEIS="pgaudit supabase_vault"
lista "select extname from pg_extension" > "$TMPD/ext.obt"
lista_baseline extensoes > "$TMPD/ext.esp"
while IFS= read -r e; do
  [ -n "$e" ] || continue
  if grep -qx "$e" "$TMPD/ext.obt"; then echo "  ok  $e"
  elif grep -qw -- "$e" <<<"$EXT_INDISPONIVEIS"; then echo "  tolerado (indisponivel em postgres:17 puro): $e"
  else falha "extensao do baseline ausente e FORA da allowlist: $e"; fi
done < "$TMPD/ext.esp"

# ---------------------------------------------------------------------------
# ATESTADO DURÁVEL. Antes o veredito do drill só existia no terminal de quem rodou: no dia
# seguinte não havia como provar que aquele dump já tinha sido restaurado com sucesso, nem
# contra qual código. Agora o resultado vira arquivo ao lado do dump e linha na telemetria.
# "Restauração comprovada" precisa ser um fato consultável, não uma lembrança.
# ---------------------------------------------------------------------------
VEREDITO=$([ "$FALHAS" -eq 0 ] && echo aprovado || echo reprovado)
ATESTADO="${DUMP%.dump}.drill"
{
  echo "veredito=$VEREDITO"
  echo "ts=$(date -Iseconds)"
  echo "dump=$(basename "$DUMP")"
  echo "dump_sha256=$(sha256sum "$DUMP" | cut -d' ' -f1)"
  echo "baseline_sha256=$(sha256sum "$BASELINE" | cut -d' ' -f1)"
  echo "imagem=$IMAGEM"
  echo "falhas=$FALHAS"
  echo "categorias=${BASELINE_CHAVES[*]}"
  # `pg_restore_rc=1` ao lado de `veredito=aprovado` parecia contradicao no atestado (o
  # laudo apontou). O rc=1 vem de extensoes de PLATAFORMA que nao existem fora do Supabase.
  # Registrar as duas contagens separadas tira a ambiguidade: o que reprova e
  # `erros_inesperados`, nunca o rc bruto.
  # AMARRACAO AOS ARTEFATOS (laudo v2.4, bloqueador 8). Sem isto o atestado dizia "aprovado"
  # sem dizer aprovado sobre O QUE: trocar o dump, o baseline ou o manifesto depois do drill
  # deixava o atestado valendo para um conjunto que ja nao existia. Agora ele carrega o hash
  # de cada artefato que afirma certificar, e a sentinela reconfere.
  echo "backup_id=$(basename "${DUMP%.dump}")"
  echo "manifest_sha256=$(sha256sum "$MANIFESTO" | cut -d' ' -f1)"
  echo "baseline_versao=${BASELINE_VERSAO:-1}"
  echo "pg_restore_rc=${RC:-0}"
  echo "pg_restore_erros_total=${TOTAL_ERR:-0}"
  echo "pg_restore_erros_tolerados=${TOLERADOS:-0}"
  echo "pg_restore_erros_inesperados=${INESPERADOS:-0}"
  echo "fora_do_escopo=auth,storage,realtime,edge_functions,config_do_projeto"
  echo "host=$(hostname)"
  echo "# NAO cobre auth/storage/realtime/Edge Functions/config do projeto."
} > "$ATESTADO.parcial" 2>/dev/null

LIBPUB="$(dirname "$(readlink -f "$0")")/lib-publicar.sh"
if [ -r "$LIBPUB" ]; then
  # shellcheck disable=SC1090
  . "$LIBPUB"
  if ! publicar_atomico "$ATESTADO" '^veredito=' 0600; then
    echo "[drill] FALHA ao publicar o atestado: $PUBLICAR_MOTIVO" >&2
    FALHAS=$((FALHAS+1)); VEREDITO=reprovado
  fi
else
  rm -f "$ATESTADO.parcial"
  echo "[drill] FALHA: lib-publicar.sh ausente em $LIBPUB" >&2
  FALHAS=$((FALHAS+1)); VEREDITO=reprovado
fi

TELEMETRY_DRILL=/opt/backups/la-organizer/db/runs.jsonl
if [ -w "$TELEMETRY_DRILL" ]; then
  printf '{"ts":"%s","evento":"restore-drill","status":"%s","dump":"%s","falhas":%s,"imagem":"%s"}\n' \
    "$(date -Iseconds)" "$VEREDITO" "$(basename "$DUMP")" "$FALHAS" "$IMAGEM" >> "$TELEMETRY_DRILL"
else
  echo "[drill] aviso: telemetria $TELEMETRY_DRILL nao gravavel — este drill nao aparece no runs.jsonl" >&2
fi

echo
if [ "$FALHAS" -eq 0 ]; then
  echo "== DRILL APROVADO — conjuntos identicos ao baseline em ${#BASELINE_CHAVES[@]} categorias,"
  echo "   comparadas por DEFINICAO (md5), nao so por nome; dados nas ancoras; extensoes conferidas. =="
  echo "   NAO cobre auth/storage/realtime/Edge Functions/config do projeto."
  echo "   atestado: $ATESTADO"
else
  echo "== DRILL REPROVADO: $FALHAS verificacao(oes) falharam =="
  echo "   atestado: $ATESTADO"
  exit 1
fi
