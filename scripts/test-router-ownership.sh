#!/usr/bin/env bash
# Prova da migration de ownership contra um schema DESCARTÁVEL, exigida pela rodada 3.
#
# Aplica a MIGRATION REAL (sed public.→tom_router_test.) num schema temporário do mesmo
# banco — de propósito: os roles anon/authenticated/service_role são os de produção, então
# o teste de privilégio vale de verdade. Nada em `public` é tocado; o schema é dropado no
# início e no fim.
#
# Uso, no host que tem DATABASE_URL (a VPS do TOM):
#   bash scripts/test-router-ownership.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCHEMA="tom_router_test"
MIG="$ROOT/migrations/2026-08-03-tom-router-ownership.sql"
TESTS="$ROOT/scripts/sql/test-router-ownership.sql"

if [ -z "${DATABASE_URL:-}" ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"'"'"'')"
fi
[ -n "$DATABASE_URL" ] || { echo "DATABASE_URL ausente"; exit 1; }

psql_q() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAt "$@"; }

echo "=== schema descartável: $SCHEMA ==="
psql_q -c "drop schema if exists $SCHEMA cascade; create schema $SCHEMA;" >/dev/null
# stub de collaborators só para as FKs da migration
psql_q -c "create table $SCHEMA.collaborators (id uuid primary key default gen_random_uuid());" >/dev/null

# MUTATE=1 aplica a migration com clock_timestamp() trocado por now() — a versão
# vulnerável. Serve para provar que os testes concorrentes DETECTAM o bug: com ela,
# eles têm de FALHAR. Teste que passa dos dois jeitos não prova nada.
MUT_SED="s/public\./$SCHEMA./g"
if [ "${MUTATE:-0}" = "1" ]; then
  echo "### MODO MUTANTE: clock_timestamp() -> now() (os testes concorrentes devem FALHAR)"
  MUT_SED="$MUT_SED; s/clock_timestamp()/now()/g"
fi

echo "=== aplicando a migration real ==="
if ! sed "$MUT_SED" "$MIG" | psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q; then
  echo "FALHOU: a migration não aplicou"
  psql_q -c "drop schema if exists $SCHEMA cascade;" >/dev/null
  exit 1
fi

echo "=== testes de privilégio, corrida, lease/crash e fluxo ==="
# Um bloco DO que aborta não registra os testes dele em _res — e o resumo sairia verde
# com asserções que nunca rodaram (falso verde observado na primeira execução da rodada 4).
# Por isso o stderr é capturado e QUALQUER erro derruba a prova.
TESTLOG=$(mktemp)
psql "$DATABASE_URL" -f "$TESTS" -q -P pager=off 2>&1 | tee "$TESTLOG"
SQL_ERRORS=$(grep -c '^psql:.*ERROR:' "$TESTLOG" || true)
rm -f "$TESTLOG"
RES=$(psql_q -c "select count(*) filter (where not ok) from $SCHEMA._res;" 2>/dev/null || echo "erro")
echo "erros SQL durante os testes: $SQL_ERRORS (esperado 0)"

echo
echo "=== corrida REAL: 8 conexões simultâneas no mesmo inbound ==="
# O teste sequencial prova o contrato; este prova o comportamento sob concorrência de
# verdade, que é onde o RETURNING do ON CONFLICT importa.
WA="wa-race-$$"
for i in $(seq 1 8); do
  (psql "$DATABASE_URL" -qAt -c "set search_path=$SCHEMA,public; select outcome from tom_route_claim_inbound('$WA','v1');" 2>/dev/null) &
done
wait
CLAIMED=$(psql_q -c "select count(*) from $SCHEMA.tom_message_ownership where wa_message_id='$WA';")
OPS=$(psql_q -c "select count(*) from $SCHEMA.tom_operations where inbound_wa_message_id='$WA';")
echo "linhas de ownership para o mesmo inbound: $CLAIMED (esperado 1)"
echo "operações criadas: $OPS (esperado 1)"
RACE_OK=1
[ "$CLAIMED" = "1" ] || RACE_OK=0
[ "$OPS" = "1" ] || RACE_OK=0

echo
echo "=== R8: check-then-write sob concorrência REAL (duas conexões) ==="
# O teste sequencial não alcança este bug: ele mora na janela entre validar e escrever.
# Aqui a conexão A trava a linha e, enquanto B está no meio da função, muda a posse.
# Com lock + revalidação + row_count, B precisa recusar. Sem, B escreve zero linhas e
# ainda devolve ok=true — o recibo mais perigoso que existe: falso e silencioso.
WA8="wa-r8-$$"
TOK=$(psql_q -c "set search_path=$SCHEMA,public; select lease_token from tom_route_claim_inbound('$WA8','v2');")

# A: segura a linha por 2s e então entrega a posse a outro worker (token novo)
psql "$DATABASE_URL" -qAt -c "set search_path=$SCHEMA,public;
  begin;
  select 1 from tom_message_ownership where wa_message_id='$WA8' for update;
  select pg_sleep(2);
  update tom_message_ownership
     set lease_token = gen_random_uuid(), lease_until = now() + interval '5 minutes'
   where wa_message_id='$WA8';
  commit;" >/dev/null 2>&1 &
A_PID=$!
sleep 0.5

# B: worker antigo tenta fechar com o token que ERA dele
B_OUT=$(psql "$DATABASE_URL" -qAt -c "set search_path=$SCHEMA,public;
  select ok::text || '/' || reason from tom_route_finish_inbound('$WA8','v2','completed',null,'$TOK'::uuid);" 2>&1)
wait $A_PID

FINAL=$(psql_q -c "select status from $SCHEMA.tom_message_ownership where wa_message_id='$WA8';")
echo "worker antigo recebeu: $B_OUT (esperado false/...)"
echo "status final da mensagem: $FINAL (esperado != completed)"
RACE2_OK=1
case "$B_OUT" in true/*) RACE2_OK=0 ;; esac
[ "$FINAL" != "completed" ] || RACE2_OK=0

echo
echo "=== R9: concorrência REAL no verify e no TTL de fluxo (três cenários) ==="
# Os blocos R9 do SQL são sequenciais: expiram a linha na mão e chamam a função. Isso não
# alcança a classe "começou antes, esperou o lock, expirou durante a espera" — que é
# exatamente onde now() (congelado no início da transação) mente. Aqui cada cenário tem
# uma conexão que SEGURA a linha e outra que entra no meio.
R9C_OK=1
falha9() { echo "  FALHOU: $1"; R9C_OK=0; }

# ---- C1: verify com mudança de posse durante a espera; passo em voo deve sobreviver
WA9="wa-r9c-$$"
OP=$(psql_q -c "set search_path=$SCHEMA,public;
  select operation_id from tom_route_claim_inbound('$WA9','v2');")
TOK1=$(psql_q -c "select lease_token from $SCHEMA.tom_message_ownership where wa_message_id='$WA9';")
psql_q -c "set search_path=$SCHEMA,public;
  select outcome from tom_operation_step_begin('$OP'::uuid,'mutar','$TOK1'::uuid);" >/dev/null

# A: trava a ownership e, durante a espera de B, entrega a posse a outro worker
psql "$DATABASE_URL" -qAt -c "set search_path=$SCHEMA,public;
  begin;
  select 1 from tom_message_ownership where wa_message_id='$WA9' for update;
  select pg_sleep(3);
  update tom_message_ownership
     set lease_token = gen_random_uuid(), lease_until = clock_timestamp() + interval '5 minutes'
   where wa_message_id='$WA9';
  commit;" >/dev/null 2>&1 &
PIDA=$!
sleep 0.5
# B: entra com o token que ERA a posse atual e tenta negar o passo
B1=$(psql "$DATABASE_URL" -qAt -c "set search_path=$SCHEMA,public;
  select ok::text || '/' || reason from tom_operation_step_verify('$OP'::uuid,'mutar',false,null,'$TOK1'::uuid);" 2>&1)
wait $PIDA
VIVO=$(psql_q -c "select count(*) from $SCHEMA.tom_operation_steps where operation_id='$OP'::uuid and step_key='mutar';")
echo "  C1 verify durante troca de posse: $B1 (esperado false/...) | passo sobreviveu: $VIVO (esperado 1)"
case "$B1" in true/*) falha9 "verify apagou passo com a posse já trocada" ;; esac
[ "$VIVO" = "1" ] || falha9 "passo em voo foi destruído"

# ---- C2: touch que começa antes do prazo e destrava depois dele
CONV9="conv-r9c-$$"
FTOK=$(psql_q -c "set search_path=$SCHEMA,public;
  select flow_token from tom_flow_open('$CONV9','task',gen_random_uuid(),'v2',null,true,null,null,3);")
psql "$DATABASE_URL" -qAt -c "set search_path=$SCHEMA,public;
  begin;
  select 1 from tom_flow_ownership where conversation_key='$CONV9' and closed_at is null for update;
  select pg_sleep(5);
  commit;" >/dev/null 2>&1 &
PIDB=$!
sleep 0.5   # B começa em ~0.5s, com TTL de 3s ainda vivo; só destrava em ~5s
B2=$(psql "$DATABASE_URL" -qAt -c "set search_path=$SCHEMA,public;
  select ok::text || '/' || reason from tom_flow_touch('$CONV9', 7200, 'v2', '$FTOK'::uuid);" 2>&1)
wait $PIDB
TTL_FUT=$(psql_q -c "select (interactive_until > clock_timestamp())::text from $SCHEMA.tom_flow_ownership
                      where conversation_key='$CONV9' and closed_at is null;")
echo "  C2 touch com TTL cruzando a espera: $B2 (esperado false/expired) | TTL revivido: ${TTL_FUT:-f} (esperado f)"
case "$B2" in true/*) falha9 "touch ressuscitou fluxo cujo TTL venceu durante a espera" ;; esac
[ "${TTL_FUT:-f}" != "t" ] || falha9 "TTL foi empurrado para o futuro indevidamente"

# ---- C3: open que espera o lock e destrava com o fluxo anterior já expirado
CONV10="conv-r9d-$$"
psql_q -c "set search_path=$SCHEMA,public;
  select id from tom_flow_open('$CONV10','task',gen_random_uuid(),'v2',null,true,null,null,3);" >/dev/null
psql "$DATABASE_URL" -qAt -c "set search_path=$SCHEMA,public;
  begin;
  select 1 from tom_flow_ownership where conversation_key='$CONV10' and closed_at is null for update;
  select pg_sleep(5);
  commit;" >/dev/null 2>&1 &
PIDC=$!
sleep 0.5
B3=$(psql "$DATABASE_URL" -qAt -c "set search_path=$SCHEMA,public;
  select coalesce(id::text,'NULO') from tom_flow_open('$CONV10','task',gen_random_uuid(),'v1');" 2>&1)
wait $PIDC
ATIVOS=$(psql_q -c "select count(*) from $SCHEMA.tom_flow_ownership
                     where conversation_key='$CONV10' and closed_at is null and interactive;")
echo "  C3 open com TTL vencido durante a espera: $B3 (esperado um id) | interativos ativos: $ATIVOS (esperado 1)"
case "$B3" in NULO|*ERROR*) falha9 "conversa ficou presa: open não expropriou o fluxo expirado" ;; esac
[ "$ATIVOS" = "1" ] || falha9 "sobrou mais de um fluxo interativo ativo"

# ---- C4: lease que vence DURANTE a espera do lock, no fechamento de passo.
# C1 prova a troca de posse, mas não discrimina o eixo temporal (o token já basta para
# recusar). Este cenário isola o relógio: a posse continua a mesma, só o prazo passa.
WA11="wa-r9e-$$"
OP4=$(psql_q -c "set search_path=$SCHEMA,public;
  select operation_id from tom_route_claim_inbound('$WA11','v2',null,null,null,null,null,null,3);")
TOK4=$(psql_q -c "select lease_token from $SCHEMA.tom_message_ownership where wa_message_id='$WA11';")
psql_q -c "set search_path=$SCHEMA,public;
  select outcome from tom_operation_step_begin('$OP4'::uuid,'mutar','$TOK4'::uuid);" >/dev/null
psql "$DATABASE_URL" -qAt -c "set search_path=$SCHEMA,public;
  begin;
  select 1 from tom_message_ownership where wa_message_id='$WA11' for update;
  select pg_sleep(5);
  commit;" >/dev/null 2>&1 &
PIDD=$!
sleep 0.5   # começa com lease de 3s ainda vivo; destrava em ~5s, já vencido
B4=$(psql "$DATABASE_URL" -qAt -c "set search_path=$SCHEMA,public;
  select ok::text || '/' || reason from tom_operation_step_finish('$OP4'::uuid,'mutar','{}'::jsonb,'done',null,'$TOK4'::uuid);" 2>&1)
wait $PIDD
ST4=$(psql_q -c "select status from $SCHEMA.tom_operation_steps where operation_id='$OP4'::uuid and step_key='mutar';")
echo "  C4 step_finish com lease vencendo na espera: $B4 (esperado false/stale_lease) | passo: $ST4 (esperado in_progress)"
case "$B4" in true/*) falha9 "fechou passo com o lease vencido durante a espera" ;; esac
[ "$ST4" = "in_progress" ] || falha9 "passo foi fechado indevidamente"

[ "$R9C_OK" = "1" ] && echo "  → os quatro cenários concorrentes passaram"

echo
echo "=== limpeza ==="
psql_q -c "drop schema if exists $SCHEMA cascade;" >/dev/null
LEFT=$(psql_q -c "select count(*) from information_schema.schemata where schema_name='$SCHEMA';")
echo "schema restante: $LEFT (esperado 0)"

if [ "$RES" = "0" ] && [ "$RACE_OK" = "1" ] && [ "${RACE2_OK:-0}" = "1" ] && [ "${R9C_OK:-0}" = "1" ] && [ "$LEFT" = "0" ] && [ "$SQL_ERRORS" = "0" ]; then
  echo; echo "=== TODAS AS CHECAGENS PASSARAM ==="; exit 0
fi
echo; echo "=== FALHAS: asserções=$RES corrida_ok=$RACE_OK check_then_write_ok=${RACE2_OK:-0} concorrencia_r9_ok=${R9C_OK:-0} schema_restante=$LEFT erros_sql=$SQL_ERRORS ==="; exit 1
