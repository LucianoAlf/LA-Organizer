#!/bin/bash
# P0-1 v2.2 — Teste NEGATIVO da Data API. NÃO DESTRUTIVO POR CONSTRUÇÃO.
#
# =============================================================================
# O QUE A v2.1 FAZIA, E POR QUE ERA PERIGOSO (bloqueador #1 — aceito integralmente)
# =============================================================================
# A v2.1 emitia POST {}, PATCH ?id=not.is.null e DELETE ?id=not.is.null.
# Medido no catálogo em 2026-08-27:
#   pf_transactions_bkp_20260716_rose : tem `id` e ZERO colunas NOT NULL sem default
#       -> DELETE apagaria as 58 linhas financeiras; POST {} GRAVARIA uma linha.
#   voice_message_log                 : idem -> 158 linhas apagáveis.
#   event_category_leaders            : NÃO tem coluna `id`
#       -> o filtro daria 400 = INCONCLUSIVO, jamais prova de negação.
# E o comentário prometia um cleanup que NÃO EXISTIA no código. Prometer limpeza
# inexistente é pior do que não limpar: convida a rodar.
#
# =============================================================================
# DESENHO SEGURO
# =============================================================================
# (B) CATÁLOGO (prova primária, assertada, entra no exit code):
#     has_table_privilege para `anon` E `authenticated`, nos 5 verbos, via psql com
#     lib-pgconn (sem credencial no argv). É a única prova que cobre INSERT e TRUNCATE
#     sem executá-los.
# (A) HTTP (prova de tráfego, complementar):
#     SELECT  : requisição real.
#     UPDATE  : PATCH com filtro CONTRADITÓRIO -> and=(col.is.null,col.not.is.null).
#     DELETE  : idem. Contradição válida em qualquer tabela, casa ZERO linhas: mesmo se a
#               permissão existir, nada é alterado. Mede-se o código, não o efeito.
#     INSERT  : NUNCA por HTTP — todo INSERT aceito grava. Só catálogo.
#     A coluna do filtro sai do catálogo por tabela (assumir `id` foi defeito da v2.1).
#
# TRAVA: as sondas de escrita só rodam se o catálogo JÁ tiver provado que anon perdeu
# UPDATE/DELETE. Escrita PostgREST termina em commit por padrão e não dependo de
# `Prefer: tx=rollback`, que eu não posso provar que este servidor honra.
#
# Uso:  ./teste-negativo-dataapi.sh                 -> catálogo + SELECT (seguro sempre)
#       ./teste-negativo-dataapi.sh --com-escrita   -> + sondas contraditórias

set -uo pipefail
RAIZ=/opt/LA-Organizer
ENV_FILE="$RAIZ/.env"
LIB="$(dirname "$(readlink -f "$0")")/lib-pgconn.sh"
TABELAS=(event_category_leaders pf_transactions_bkp_20260716_rose task_classifications voice_message_log webhook_queue)
COM_ESCRITA=0; [ "${1:-}" = "--com-escrita" ] && COM_ESCRITA=1
FALHAS=0; PASSOU=0

[ -r "$LIB" ] || { echo "lib-pgconn.sh ausente em $LIB"; exit 3; }
# shellcheck disable=SC1090
. "$LIB"
trap pg_limpar EXIT INT TERM
pg_conectar "$ENV_FILE" || { echo "nao consegui montar a conexao"; exit 3; }
command -v psql >/dev/null || { echo "psql ausente"; exit 3; }

lista=$(printf "'%s'," "${TABELAS[@]}"); lista=${lista%,}

# -----------------------------------------------------------------------------
# (B) CATÁLOGO — prova primária. 10 linhas (5 tabelas x 2 papéis).
# -----------------------------------------------------------------------------
echo "== (B) CATALOGO — anon e authenticated, 5 verbos =="
CAT=$(psql -tA -F'|' -c "
select c.relname, r.rolname,
       concat_ws(',',
         case when has_table_privilege(r.rolname,c.oid,'SELECT')   then 'SELECT'   end,
         case when has_table_privilege(r.rolname,c.oid,'INSERT')   then 'INSERT'   end,
         case when has_table_privilege(r.rolname,c.oid,'UPDATE')   then 'UPDATE'   end,
         case when has_table_privilege(r.rolname,c.oid,'DELETE')   then 'DELETE'   end,
         case when has_table_privilege(r.rolname,c.oid,'TRUNCATE') then 'TRUNCATE' end)
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  cross join (select unnest(array['anon','authenticated']) rolname) r
 where n.nspname='public' and c.relname in ($lista)
 order by 1,2;" 2>&1)

if [ -z "$CAT" ] || grep -qi 'error' <<<"$CAT"; then
  echo "FAIL  catalogo nao pode ser consultado: $(head -1 <<<"$CAT")"
  FALHAS=$((FALHAS+1)); CAT_OK=0
else
  CAT_OK=1
  ESPERADAS=$(( ${#TABELAS[@]} * 2 ))
  OBTIDAS=$(grep -c '|' <<<"$CAT")
  if [ "$OBTIDAS" -ne "$ESPERADAS" ]; then
    echo "FAIL  catalogo devolveu $OBTIDAS linhas, esperado $ESPERADAS (tabela sumiu?)"
    FALHAS=$((FALHAS+1))
  fi
  while IFS='|' read -r tab rol privs; do
    [ -z "$tab" ] && continue
    if [ -n "$privs" ]; then echo "FAIL  $rol tem [$privs] em $tab"; FALHAS=$((FALHAS+1))
    else echo "PASS  $rol sem privilegio em $tab"; PASSOU=$((PASSOU+1)); fi
  done <<<"$CAT"
fi

# -----------------------------------------------------------------------------
# TRAVA de escrita
# -----------------------------------------------------------------------------
if [ "$COM_ESCRITA" = 1 ]; then
  [ "$CAT_OK" = 1 ] || { echo "ABORTADO: --com-escrita exige catalogo consultavel."; exit 2; }
  if [ "$FALHAS" -gt 0 ]; then
    echo "ABORTADO: o catalogo ainda mostra privilegio publico — sondar escrita agora poderia GRAVAR."
    exit 2
  fi
fi

# -----------------------------------------------------------------------------
# (A) HTTP
# -----------------------------------------------------------------------------
leia_env() { grep -m1 -E "^[[:space:]]*$1[[:space:]]*=" "$ENV_FILE" | sed -E 's/^[^=]*=//; s/^["'"'"']//; s/["'"'"']$//'; }
URL=$(leia_env SUPABASE_URL); ANON=$(leia_env SUPABASE_ANON_KEY)
[ -n "$URL" ] && [ -n "$ANON" ] || { echo "SUPABASE_URL/ANON_KEY ausentes"; exit 3; }

req() { curl -s -o /dev/null -w '%{http_code}' -m 15 -X "$1" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  -H 'Content-Type: application/json' -H 'Prefer: return=minimal' "${@:3}" "$URL/rest/v1/$2"; }

primeira_coluna() { psql -tA -c "
  select a.attname from pg_attribute a join pg_class c on c.oid=a.attrelid
   join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname='$1' and a.attnum>0 and not a.attisdropped
   order by a.attnum limit 1;" 2>/dev/null | head -1; }

echo "== (A) HTTP com anon key $([ "$COM_ESCRITA" = 1 ] && echo '(SELECT + sondas contraditorias)' || echo '(SO SELECT)') =="
for t in "${TABELAS[@]}"; do
  S=$(req GET "$t?select=*&limit=1")
  linha="  $t: SELECT=$S"; ruim=0; incon=0
  case "$S" in 2??) ruim=1 ;; 401|403|404) ;; *) incon=1 ;; esac

  if [ "$COM_ESCRITA" = 1 ]; then
    COL=$(primeira_coluna "$t")
    if [ -z "$COL" ]; then
      linha="$linha UPDATE=n/a DELETE=n/a (nao achei coluna no catalogo)"; incon=1
    else
      F="and=($COL.is.null,$COL.not.is.null)"   # contradicao: casa ZERO linhas
      U=$(req PATCH  "$t?$F" -d '{}')
      D=$(req DELETE "$t?$F")
      linha="$linha UPDATE=$U DELETE=$D (filtro contraditorio em $COL, 0 linhas)"
      for c in "$U" "$D"; do case "$c" in 2??) ruim=1 ;; 401|403|404) ;; *) incon=1 ;; esac; done
    fi
  fi

  if   [ "$ruim" = 1 ];  then echo "FAIL $linha  <- anon ACESSA"; FALHAS=$((FALHAS+1))
  elif [ "$incon" = 1 ]; then echo "INCONCLUSIVO $linha  <- codigo nao prova negacao"; FALHAS=$((FALHAS+1))
  else echo "PASS $linha"; PASSOU=$((PASSOU+1)); fi
done

echo "== $PASSOU pass, $FALHAS falha/inconclusivo =="
exit $(( FALHAS > 0 ? 1 : 0 ))
