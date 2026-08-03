#!/usr/bin/env bash
# Prova da migration de ownership contra um schema DESCARTÁVEL.
#
# Aplica a MIGRATION REAL (sed public.→tom_router_test.) num schema temporário do mesmo
# banco — de propósito: os roles anon/authenticated/service_role são os de produção, então
# o teste de privilégio vale de verdade. Nada em `public` é tocado.
#
#   bash scripts/test-router-ownership.sh              # prova
#   MUTATE=1 bash scripts/test-router-ownership.sh     # prova que a prova DETECTA o bug
#
# RIGOR (rodada 11) — prova que passa com erro escondido é pior que prova nenhuma:
#   * todo psql roda com ON_ERROR_STOP=1 e tem o EXIT CODE conferido;
#   * stderr vai para arquivo próprio, nunca se mistura ao valor comparado;
#   * as asserções exigem o recibo EXATO (false/stale_lease), não "não deu true";
#   * falha de processo em background entra no resultado via wait;
#   * trap garante o drop do schema mesmo se o script morrer no meio;
#   * (rodada 13) no mutante, EXIT=0 exige as falhas NOMEADAS de MUT_ESPERADAS e
#     NENHUMA falha fora dessa lista — "alguma coisa falhou" se autoaprovava.
#     O autoteste do próprio veredito está em scripts/selftest-mutante.sh.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCHEMA="tom_router_test"
MIG="$ROOT/migrations/2026-08-03-tom-router-ownership.sql"
TESTS="$ROOT/scripts/sql/test-router-ownership.sql"
TMPD="$(mktemp -d)"
FAILED=0
FAIL_KEYS=""   # uma chave por linha; é o que o veredito do mutante confere nome a nome

# As asserções que a mutação clock_timestamp()->now() TEM de derrubar. A chave é o
# próprio label impresso — sem indireção: se alguém renomear o label, o mutante reprova
# por "faltando" e obriga a atualizar conscientemente.
MUT_ESPERADAS=(
  "C2 touch com TTL cruzando a espera"
  "C2 TTL revivido"
  "C3 open com TTL vencido durante a espera"
  "C4 step_finish com lease vencendo na espera"
  "C4 status do passo"
)

if [ -z "${DATABASE_URL:-}" ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"'"'"'')"
fi
[ -n "$DATABASE_URL" ] || { echo "DATABASE_URL ausente"; exit 1; }

# fail <chave> <mensagem...> — TODA falha carrega uma chave estável. Sem isso o modo
# mutante só sabia que "alguma coisa falhou": falha de ambiente, de cleanup ou de outro
# cenário se autoaprovava como "detectou o bug".
fail() {
  local k="$1"; shift
  echo "  FALHOU[$k]: $*"
  FAILED=1
  FAIL_KEYS="${FAIL_KEYS}${k}"$'\n'
}

# Rede de segurança: o schema descartável some mesmo se o script morrer no meio — e se
# NÃO sair, isso vira falha explícita. Resíduo silencioso no banco de produção é
# justamente o que a promessa "descartável" não pode quebrar.
limpar() {
  local code=$? left
  psql "$DATABASE_URL" -qAt -c "drop schema if exists $SCHEMA cascade;" >/dev/null 2>&1
  left="$(psql "$DATABASE_URL" -qAt -c "select count(*) from information_schema.schemata where schema_name='$SCHEMA';" 2>/dev/null)" || left="?"
  if [ "$left" != "0" ]; then
    echo "  ATENÇÃO: schema '$SCHEMA' NÃO foi removido (restante=$left) — resíduo no banco"
    code=1
  fi
  rm -rf "$TMPD"
  exit $code
}
trap limpar EXIT

# Roda SQL exigindo sucesso. Resultado em $SQL_OUT; erro derruba o cenário.
# Sem isto, um ERROR virava texto em $SQL_OUT, não casava com "true/*" e PASSAVA.
sql() {
  local desc="$1" q="$2" rc
  SQL_OUT="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAt -c "$q" 2>"$TMPD/err")"; rc=$?
  if [ $rc -ne 0 ]; then
    fail "sql:$desc" "psql saiu com $rc: $(head -2 "$TMPD/err" | tr '\n' ' ')"
    SQL_OUT=""
    return 1
  fi
  return 0
}

# Igualdade exata. "não retornou true" aceitaria qualquer lixo, inclusive erro.
assert_eq() {
  local esperado="$1" obtido="$2" label="$3"
  if [ "$obtido" = "$esperado" ]; then
    echo "  OK   $label = $obtido"
  else
    fail "$label" "esperado '$esperado', obtido '$obtido'"
  fi
}

# Segura a linha numa transação própria. O PID vai para BG_PID (variável global) e NÃO
# por substituição de comando: dentro de $(...) o background nasce num subshell, deixa de
# ser filho deste shell e o `wait` devolve 127 sem conferir nada — verificação que não
# verifica. O exit code é conferido em esperar_bg; background que morre calado é falso-verde.
segurar_linha() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAt -c "$1" >"$TMPD/bg.out" 2>"$TMPD/bg.err" &
  BG_PID=$!
}
esperar_bg() {
  local pid="$1" desc="$2" rc
  wait "$pid"; rc=$?
  [ $rc -eq 0 ] || fail "bg:$desc" "conexão de apoio saiu com $rc: $(head -2 "$TMPD/bg.err" | tr '\n' ' ')"
}

echo "=== schema descartável: $SCHEMA ==="
sql "recriar schema" "drop schema if exists $SCHEMA cascade; create schema $SCHEMA;" || exit 1

# (rodada 14) O schema descartável NÃO herda as DEFAULT PRIVILEGES que o Supabase mantém
# em `public`: lá, `alter default privileges ... grant all on tables to anon,
# authenticated, service_role` faz TODA tabela nova nascer com ALL para os três roles.
# Sem espelhar isso aqui, o teste R5-4 media um banco que não existe — passava porque o
# schema temporário nasce limpo, não porque a migration revogava. Foi assim que o
# `service_role` chegou a `public` com INSERT/UPDATE, contrariando o R5-4 declarado.
sql "espelhar default privileges de public" \
  "alter default privileges in schema $SCHEMA grant all on tables to anon, authenticated, service_role;" || exit 1
sql "stub collaborators" "create table $SCHEMA.collaborators (id uuid primary key default gen_random_uuid());" || exit 1

MUT_SED="s/public\./$SCHEMA./g"
if [ "${MUTATE:-0}" = "1" ]; then
  echo "### MODO MUTANTE: clock_timestamp() -> now() (os cenários concorrentes DEVEM falhar)"
  MUT_SED="$MUT_SED; s/clock_timestamp()/now()/g"
fi

echo "=== aplicando a migration real ==="
if ! sed "$MUT_SED" "$MIG" | psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q; then
  echo "FALHOU: a migration não aplicou"
  exit 1
fi

echo "=== testes de privilégio, corrida, lease/crash e fluxo ==="
# Um bloco DO que aborta não registra os testes dele em _res — e o resumo sairia verde
# com asserções que nunca rodaram (falso verde da rodada 4).
#
# RODADA 12: esta chamada era a última que ainda decidia por INTERPRETAÇÃO DE TEXTO
# (grep '^psql:.*ERROR:') em vez de sucesso verificável — dependia do formato exato da
# mensagem e do idioma/versão do psql, e deixava o processo terminar sem contrato. Agora
# é igual a todas as outras: ON_ERROR_STOP=1, stderr em arquivo próprio, exit code
# conferido. O _res continua existindo, mas para asserção LÓGICA, não para saber se rodou.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$TESTS" -q -P pager=off \
  >"$TMPD/tests.out" 2>"$TMPD/tests.err"; TESTS_RC=$?
cat "$TMPD/tests.out"
if [ $TESTS_RC -ne 0 ]; then
  fail "suíte SQL" "saiu com $TESTS_RC: $(head -3 "$TMPD/tests.err" | tr '\n' ' ')"
else
  echo "  OK   suíte SQL executou até o fim (exit 0)"
fi
sql "contar falhas" "select count(*) filter (where not ok) from $SCHEMA._res;" && \
  assert_eq "0" "$SQL_OUT" "asserções falhas"
# Piso de cobertura: com ON_ERROR_STOP a suíte aborta em erro (e o rc acima pega), mas
# um bloco comentado por engano cairia calado. O total nunca deve DIMINUIR.
sql "total de asserções" "select count(*) from $SCHEMA._res;" && {
  if [ "${SQL_OUT:-0}" -ge 181 ] 2>/dev/null; then
    echo "  OK   asserções executadas = $SQL_OUT (piso 181)"
  else
    fail "cobertura" "caiu para $SQL_OUT asserções (piso 181)"
  fi
}

echo
echo "=== corrida REAL: 8 conexões simultâneas no mesmo inbound ==="
WA="wa-race-$$"
PIDS=()
for _ in $(seq 1 8); do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAt \
    -c "set search_path=$SCHEMA,public; select outcome from tom_route_claim_inbound('$WA','v1');" \
    >>"$TMPD/race.out" 2>>"$TMPD/race.err" &
  PIDS+=($!)
done
for pid in "${PIDS[@]}"; do
  wait "$pid" || fail "corrida de 8" "uma conexão saiu com erro — $(head -2 "$TMPD/race.err" | tr '\n' ' ')"
done
sql "linhas do inbound" "select count(*) from $SCHEMA.tom_message_ownership where wa_message_id='$WA';" && \
  assert_eq "1" "$SQL_OUT" "linhas de ownership para o mesmo inbound"
sql "operações do inbound" "select count(*) from $SCHEMA.tom_operations where inbound_wa_message_id='$WA';" && \
  assert_eq "1" "$SQL_OUT" "operações criadas"
assert_eq "1" "$(grep -c '^claimed$' "$TMPD/race.out" || true)" "conexões que receberam claimed"

echo
echo "=== R8: check-then-write sob concorrência REAL (duas conexões) ==="
WA8="wa-r8-$$"
sql "claim R8" "set search_path=$SCHEMA,public; select lease_token from tom_route_claim_inbound('$WA8','v2');"
TOK="$SQL_OUT"
segurar_linha "set search_path=$SCHEMA,public;
  begin;
  select 1 from tom_message_ownership where wa_message_id='$WA8' for update;
  select pg_sleep(2);
  update tom_message_ownership
     set lease_token = gen_random_uuid(), lease_until = clock_timestamp() + interval '5 minutes'
   where wa_message_id='$WA8';
  commit;"
PID=$BG_PID
sleep 0.5
sql "R8 finish com token perdido" "set search_path=$SCHEMA,public;
  select ok::text || '/' || reason from tom_route_finish_inbound('$WA8','v2','completed',null,'$TOK'::uuid);" && \
  assert_eq "false/stale_token" "$SQL_OUT" "R8 worker antigo"
esperar_bg "$PID" "R8"
sql "R8 status" "select status from $SCHEMA.tom_message_ownership where wa_message_id='$WA8';" && \
  assert_eq "claimed" "$SQL_OUT" "R8 status final"

echo
echo "=== R9: concorrência REAL no verify e no TTL de fluxo (quatro cenários) ==="
# Os blocos R9 do SQL são sequenciais: expiram a linha na mão. Isso não alcança a classe
# "começou antes, esperou o lock, expirou durante a espera" — aqui cada cenário tem uma
# conexão que SEGURA a linha e outra que entra no meio.

# ---- C1: verify com troca de posse durante a espera; passo em voo deve sobreviver
WA9="wa-r9c-$$"
sql "C1 claim" "set search_path=$SCHEMA,public; select operation_id from tom_route_claim_inbound('$WA9','v2');"
OP="$SQL_OUT"
sql "C1 token" "select lease_token from $SCHEMA.tom_message_ownership where wa_message_id='$WA9';"
TOK1="$SQL_OUT"
sql "C1 abrir passo" "set search_path=$SCHEMA,public;
  select outcome from tom_operation_step_begin('$OP'::uuid,'mutar','$TOK1'::uuid);" && \
  assert_eq "new" "$SQL_OUT" "C1 passo aberto"
segurar_linha "set search_path=$SCHEMA,public;
  begin;
  select 1 from tom_message_ownership where wa_message_id='$WA9' for update;
  select pg_sleep(3);
  update tom_message_ownership
     set lease_token = gen_random_uuid(), lease_until = clock_timestamp() + interval '5 minutes'
   where wa_message_id='$WA9';
  commit;"
PID=$BG_PID
sleep 0.5
sql "C1 verify" "set search_path=$SCHEMA,public;
  select ok::text || '/' || reason from tom_operation_step_verify('$OP'::uuid,'mutar',false,null,'$TOK1'::uuid);" && \
  assert_eq "false/stale_lease" "$SQL_OUT" "C1 verify durante troca de posse"
esperar_bg "$PID" "C1"
sql "C1 passo vivo" "select count(*) from $SCHEMA.tom_operation_steps where operation_id='$OP'::uuid and step_key='mutar';" && \
  assert_eq "1" "$SQL_OUT" "C1 passo em voo sobreviveu"

# ---- C2: touch que começa antes do prazo e destrava depois dele
CONV9="conv-r9c-$$"
sql "C2 abrir fluxo" "set search_path=$SCHEMA,public;
  select flow_token from tom_flow_open('$CONV9','task',gen_random_uuid(),'v2',null,true,null,null,3);"
FTOK="$SQL_OUT"
segurar_linha "set search_path=$SCHEMA,public;
  begin;
  select 1 from tom_flow_ownership where conversation_key='$CONV9' and closed_at is null for update;
  select pg_sleep(5);
  commit;"
PID=$BG_PID
sleep 0.5   # começa com TTL de 3s ainda vivo; só destrava em ~5s
sql "C2 touch" "set search_path=$SCHEMA,public;
  select ok::text || '/' || reason from tom_flow_touch('$CONV9', 7200, 'v2', '$FTOK'::uuid);" && \
  assert_eq "false/expired" "$SQL_OUT" "C2 touch com TTL cruzando a espera"
esperar_bg "$PID" "C2"
sql "C2 ttl" "select (interactive_until > clock_timestamp())::text from $SCHEMA.tom_flow_ownership
              where conversation_key='$CONV9' and closed_at is null;" && \
  assert_eq "false" "$SQL_OUT" "C2 TTL revivido"

# ---- C3: open que espera o lock e destrava com o fluxo anterior já expirado
CONV10="conv-r9d-$$"
sql "C3 abrir fluxo" "set search_path=$SCHEMA,public;
  select id from tom_flow_open('$CONV10','task',gen_random_uuid(),'v2',null,true,null,null,3);"
segurar_linha "set search_path=$SCHEMA,public;
  begin;
  select 1 from tom_flow_ownership where conversation_key='$CONV10' and closed_at is null for update;
  select pg_sleep(5);
  commit;"
PID=$BG_PID
sleep 0.5
sql "C3 open" "set search_path=$SCHEMA,public;
  select case when id is null then 'NULO' else 'ABRIU' end from tom_flow_open('$CONV10','task',gen_random_uuid(),'v1');" && \
  assert_eq "ABRIU" "$SQL_OUT" "C3 open com TTL vencido durante a espera"
esperar_bg "$PID" "C3"
sql "C3 ativos" "select count(*) from $SCHEMA.tom_flow_ownership
                 where conversation_key='$CONV10' and closed_at is null and interactive;" && \
  assert_eq "1" "$SQL_OUT" "C3 interativos ativos"

# ---- C4: lease que vence DURANTE a espera do lock, no fechamento de passo.
# C1 prova a troca de posse, mas não discrimina o eixo temporal (o token já basta para
# recusar). Este isola o relógio: a posse continua a mesma, só o prazo passa.
WA11="wa-r9e-$$"
sql "C4 claim" "set search_path=$SCHEMA,public;
  select operation_id from tom_route_claim_inbound('$WA11','v2',null,null,null,null,null,null,3);"
OP4="$SQL_OUT"
sql "C4 token" "select lease_token from $SCHEMA.tom_message_ownership where wa_message_id='$WA11';"
TOK4="$SQL_OUT"
sql "C4 abrir passo" "set search_path=$SCHEMA,public;
  select outcome from tom_operation_step_begin('$OP4'::uuid,'mutar','$TOK4'::uuid);" && \
  assert_eq "new" "$SQL_OUT" "C4 passo aberto"
segurar_linha "set search_path=$SCHEMA,public;
  begin;
  select 1 from tom_message_ownership where wa_message_id='$WA11' for update;
  select pg_sleep(5);
  commit;"
PID=$BG_PID
sleep 0.5   # começa com lease de 3s vivo; destrava em ~5s, já vencido
sql "C4 finish" "set search_path=$SCHEMA,public;
  select ok::text || '/' || reason from tom_operation_step_finish('$OP4'::uuid,'mutar','{}'::jsonb,'done',null,'$TOK4'::uuid);" && \
  assert_eq "false/stale_lease" "$SQL_OUT" "C4 step_finish com lease vencendo na espera"
esperar_bg "$PID" "C4"
sql "C4 passo" "select status from $SCHEMA.tom_operation_steps where operation_id='$OP4'::uuid and step_key='mutar';" && \
  assert_eq "in_progress" "$SQL_OUT" "C4 status do passo"

echo
echo "=== limpeza ==="
# drop explicito aqui para que o resultado entre no veredito; o trap repete como rede.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAt -c "drop schema if exists $SCHEMA cascade;" >/dev/null 2>"$TMPD/drop.err"   || fail "drop do schema" "falhou: $(head -2 "$TMPD/drop.err" | tr '
' ' ')"
LEFT="$(psql "$DATABASE_URL" -qAt -c "select count(*) from information_schema.schemata where schema_name='$SCHEMA';" 2>/dev/null)" || LEFT="erro"
assert_eq "0" "$LEFT" "schema restante"

echo
# --- VEREDITO ---
if [ "${MUTATE:-0}" = "1" ]; then
  # No mutante, sucesso é DETECTAR **a mutação certa**. "Alguma coisa falhou" não servia:
  # falha de ambiente, de cleanup ou de outro cenário se autoaprovava como detecção.
  # Contrato: cada chave de MUT_ESPERADAS tem de falhar, e nenhuma outra pode falhar.
  n_falt=0
  for k in "${MUT_ESPERADAS[@]}"; do
    if printf '%s' "$FAIL_KEYS" | grep -Fxq -- "$k"; then
      echo "  DETECTOU: $k"
    else
      echo "  NÃO DETECTOU: $k"; n_falt=$((n_falt+1))
    fi
  done
  n_inesp=0
  while IFS= read -r k; do
    [ -n "$k" ] || continue
    prevista=0
    for e in "${MUT_ESPERADAS[@]}"; do [ "$k" = "$e" ] && { prevista=1; break; }; done
    if [ "$prevista" = "0" ]; then
      echo "  FALHA INESPERADA: $k"; n_inesp=$((n_inesp+1))
    fi
  done <<< "$FAIL_KEYS"
  echo "  sensíveis ao relógio detectadas: $(( ${#MUT_ESPERADAS[@]} - n_falt ))/${#MUT_ESPERADAS[@]} · falhas inesperadas: $n_inesp"

  if [ "$n_falt" = "0" ] && [ "$n_inesp" = "0" ]; then
    echo "=== MUTANTE: os testes DETECTARAM exatamente a mutação do relógio ==="; exit 0
  fi
  echo "=== MUTANTE: PROBLEMA — prova inespecífica (não detectou=$n_falt inesperadas=$n_inesp) ==="; exit 1
fi

if [ "$FAILED" = "0" ]; then
  echo "=== TODAS AS CHECAGENS PASSARAM ==="; exit 0
fi
echo "=== HOUVE FALHAS (ver acima) ==="; exit 1
