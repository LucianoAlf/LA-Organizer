#!/bin/bash
# lib-pgconn.sh — conexão Postgres SEM credencial no argv e SEM `source .env`.
# Usada por backup-db.sh e por teste-negativo-dataapi.sh. Código de segurança não deve
# existir em duas cópias: uma delas envelhece e vira a versão errada da verdade.
#
# Uso:
#   . /opt/LA-Organizer/scripts/lib-pgconn.sh
#   pg_conectar /opt/LA-Organizer/.env   # exporta PGPASSFILE/PGHOST/PGPORT/PGUSER/PGDATABASE
#   ... psql/pg_dump sem passar URI ...
#   pg_limpar                            # remove o diretório temporário
#
# Garantias:
#   * lê APENAS a linha DATABASE_URL (sem source, sem eval): os outros segredos do .env
#     não entram no ambiente deste processo nem dos filhos;
#   * .pgpass 0600 em diretório 0700 sob /run;
#   * percent-decode correto ('+' é literal em userinfo; `printf %b` NÃO interpreta \xHH);
#   * query string vira PG* equivalente em vez de ser descartada;
#   * a senha nunca é ecoada nem entra em argv.

PGCONN_TMPDIR=""

pg_limpar() { [ -n "$PGCONN_TMPDIR" ] && rm -rf "$PGCONN_TMPDIR"; PGCONN_TMPDIR=""; }

pg_urldecode() {
  local s=$1 out="" hex oct
  while [[ $s =~ ^([^%]*)%([0-9A-Fa-f]{2})(.*)$ ]]; do
    out+=${BASH_REMATCH[1]}
    hex=${BASH_REMATCH[2]}
    printf -v oct '%03o' "0x$hex"
    printf -v hex '\'"$oct"
    out+=$hex
    s=${BASH_REMATCH[3]}
  done
  printf '%s' "$out$s"
}

# pg_conectar <env_file>  -> 0 em sucesso; ecoa motivo em stderr e devolve != 0 em falha.
pg_conectar() {
  local env_file=${1:?pg_conectar <env_file>}
  local dburl rest userinfo hostpart hostport pathq query u p h pt db esc
  [ -r "$env_file" ] || { echo "pg_conectar: env ilegivel" >&2; return 1; }

  dburl=$(grep -m1 -E '^[[:space:]]*DATABASE_URL[[:space:]]*=' "$env_file" \
          | sed -E 's/^[^=]*=//; s/^["'"'"']//; s/["'"'"']$//')
  [ -n "$dburl" ] || { echo "pg_conectar: DATABASE_URL ausente" >&2; return 1; }
  case "$dburl" in *://*) ;; *) echo "pg_conectar: URL sem esquema" >&2; return 1 ;; esac

  rest=${dburl#*://}
  userinfo=${rest%%@*}
  hostpart=${rest#*@}
  [ "$userinfo" != "$rest" ] || { echo "pg_conectar: URL sem credencial" >&2; return 1; }

  u=$(pg_urldecode "${userinfo%%:*}")
  p=$(pg_urldecode "${userinfo#*:}")
  hostport=${hostpart%%/*}
  h=${hostport%%:*}
  pt=${hostport#*:}; [ "$pt" = "$h" ] && pt=5432
  pathq=${hostpart#*/}
  db=${pathq%%\?*}
  query=""; [ "$pathq" != "${pathq#*\?}" ] && query=${pathq#*\?}

  [ -n "$h" ] && [ -n "$u" ] && [ -n "$db" ] && [ -n "$p" ] \
    || { echo "pg_conectar: URL malformada" >&2; return 1; }

  PGCONN_TMPDIR=$(mktemp -d /run/pgconn.XXXXXX) || { echo "pg_conectar: mktemp falhou" >&2; return 1; }
  chmod 0700 "$PGCONN_TMPDIR"
  esc=${p//\\/\\\\}; esc=${esc//:/\\:}
  ( umask 077; printf '%s:%s:%s:%s:%s\n' "$h" "$pt" "$db" "$u" "$esc" > "$PGCONN_TMPDIR/pgpass" )
  chmod 0600 "$PGCONN_TMPDIR/pgpass"
  unset p esc dburl userinfo rest

  export PGPASSFILE="$PGCONN_TMPDIR/pgpass" PGHOST="$h" PGPORT="$pt" PGUSER="$u" PGDATABASE="$db"

  if [ -n "$query" ]; then
    local pares par k v
    IFS='&' read -ra pares <<<"$query"
    for par in "${pares[@]}"; do
      k=${par%%=*}; v=$(pg_urldecode "${par#*=}")
      case "$k" in
        sslmode)          export PGSSLMODE="$v" ;;
        sslrootcert)      export PGSSLROOTCERT="$v" ;;
        options)          export PGOPTIONS="$v" ;;
        application_name) export PGAPPNAME="$v" ;;
        *) echo "pg_conectar: parametro de conexao ignorado: $k" >&2 ;;
      esac
    done
  fi
  return 0
}
