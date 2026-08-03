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

echo "=== aplicando a migration real ==="
if ! sed "s/public\./$SCHEMA./g" "$MIG" | psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q; then
  echo "FALHOU: a migration não aplicou"
  psql_q -c "drop schema if exists $SCHEMA cascade;" >/dev/null
  exit 1
fi

echo "=== testes de privilégio, corrida, lease/crash e fluxo ==="
psql "$DATABASE_URL" -f "$TESTS" -q -P pager=off
RES=$(psql_q -c "select count(*) filter (where not ok) from $SCHEMA._res;" 2>/dev/null || echo "erro")

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
echo "=== limpeza ==="
psql_q -c "drop schema if exists $SCHEMA cascade;" >/dev/null
LEFT=$(psql_q -c "select count(*) from information_schema.schemata where schema_name='$SCHEMA';")
echo "schema restante: $LEFT (esperado 0)"

if [ "$RES" = "0" ] && [ "$RACE_OK" = "1" ] && [ "$LEFT" = "0" ]; then
  echo; echo "=== TODAS AS CHECAGENS PASSARAM ==="; exit 0
fi
echo; echo "=== FALHAS: asserções=$RES corrida_ok=$RACE_OK schema_restante=$LEFT ==="; exit 1
