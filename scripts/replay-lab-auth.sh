#!/usr/bin/env bash
# scripts/replay-lab-auth.sh
# Prova do VERIFICADOR REAL do webhook, contra uma instância efêmera do TOM.
#
# POR QUE INSTÂNCIA SEPARADA: a UAZAPI autentica por token na URL (o próprio webhook.js
# diz "URL token — UAZAPI atual"). Ligar HMAC_ONLY na instância de produção derrubaria a
# entrada de mensagens do WhatsApp inteiro. Aqui sobe um processo próprio na 3199, com
# segredo e endpoint de teste, que a UAZAPI não conhece.
#
# O VEREDITO É O STATUS QUE O TOM DEVOLVE — o script não julga nada por conta própria.
# Foi a correção do Alfredo: a v1 da spec dizia "o laboratório rejeita mesmo que o TOM
# aceite", o que seria o teste maquiando um furo do produto.
#
#   bash scripts/replay-lab-auth.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORTA=3199
SEGREDO_TESTE="replay-lab-secret-$$-nao-e-o-de-producao"
TMPD="$(mktemp -d)"
FALHAS=0
PID=""

falhou() { echo "  FALHOU: $*"; FALHAS=$((FALHAS+1)); }
ok()     { echo "  OK   $*"; }

limpar() {
  local code=$?
  [ -n "$PID" ] && kill "$PID" 2>/dev/null && sleep 1
  # se não morreu, mata de vez — instância órfã na 3199 seria resíduo
  [ -n "$PID" ] && kill -9 "$PID" 2>/dev/null
  if curl -s -o /dev/null -m 2 "http://127.0.0.1:$PORTA/health" 2>/dev/null; then
    echo "  ATENÇÃO: ainda há algo escutando na $PORTA — resíduo"
    code=1
  fi
  rm -rf "$TMPD"
  exit $code
}
trap limpar EXIT

# ---------------------------------------------------------------------------------
# ASSERT 1 (Alfredo): a instância sobe com segredo e endpoint de UAZAPI PRÓPRIOS.
# Nunca herda credencial/endpoint de produção. O sink local garante que nenhuma
# chamada externa é possível nem por acidente.
# ---------------------------------------------------------------------------------
UAZ_SINK="http://127.0.0.1:$((PORTA+1))/sink"
[ "$SEGREDO_TESTE" != "$(grep -E '^WEBHOOK_SECRET=' "$ROOT/.env" 2>/dev/null | cut -d= -f2-)" ] \
  && ok "assert-1: segredo do laboratório ≠ segredo de produção" \
  || falhou "assert-1: o laboratório está usando o segredo de PRODUÇÃO"

echo "=== subindo instância efêmera na $PORTA (HMAC_ONLY=true) ==="
(
  cd "$ROOT"
  set -a; . ./.env; set +a          # base: banco e chaves de LLM
  export PORT=$PORTA
  export WEBHOOK_SECRET="$SEGREDO_TESTE"      # sobrescreve o de produção
  export UAZAPI_URL="$UAZ_SINK"               # endpoint que não existe: nada sai
  export UAZAPI_TOKEN="token-de-teste"
  export WEBHOOK_HMAC_ONLY=true
  export TOM_QA_PHONES="5500000000001"
  export TOM_QA_EVIDENCE_FILE="$TMPD/evidencia.jsonl"
  node scripts/replay-lab-server.js
) >"$TMPD/tom.log" 2>&1 &
PID=$!

for _ in $(seq 1 40); do
  curl -s -o /dev/null -m 1 "http://127.0.0.1:$PORTA/health" && break
  sleep 0.5
done
curl -s -o /dev/null -m 2 "http://127.0.0.1:$PORTA/health" || { echo "instância não subiu:"; tail -15 "$TMPD/tom.log"; exit 1; }
ok "instância no ar (pid $PID)"

CORPO='{"EventType":"messages","message":{"id":"QA-AUTH-0001","sender":"5599999999999@s.whatsapp.net","chatid":"5599999999999@s.whatsapp.net","text":"ping do laboratorio","fromMe":false}}'
ASSINATURA="sha256=$(printf '%s' "$CORPO" | openssl dgst -sha256 -hmac "$SEGREDO_TESTE" -hex | sed 's/^.*= //')"

# status <descrição> <esperado> [args curl...]
checar() {
  local desc="$1" esperado="$2"; shift 2
  local got
  got=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$@")
  if [ "$got" = "$esperado" ]; then ok "$desc → HTTP $got"; else falhou "$desc → HTTP $got (esperado $esperado)"; fi
}

echo
echo "=== os 5 negativos + o positivo (veredito = status do TOM) ==="
checar "sem header de assinatura" 401 \
  -X POST "http://127.0.0.1:$PORTA/webhook" -H 'Content-Type: application/json' -d "$CORPO"

checar "HMAC inválido" 401 \
  -X POST "http://127.0.0.1:$PORTA/webhook" -H 'Content-Type: application/json' \
  -H "x-webhook-signature: sha256=$(printf 'f%.0s' {1..64})" -d "$CORPO"

checar "HMAC de OUTRO corpo" 401 \
  -X POST "http://127.0.0.1:$PORTA/webhook" -H 'Content-Type: application/json' \
  -H "x-webhook-signature: sha256=$(printf '%s' '{"outro":"corpo"}' | openssl dgst -sha256 -hmac "$SEGREDO_TESTE" -hex | sed 's/^.*= //')" \
  -d "$CORPO"

checar "secret LITERAL no header (static_header)" 401 \
  -X POST "http://127.0.0.1:$PORTA/webhook" -H 'Content-Type: application/json' \
  -H "x-webhook-signature: $SEGREDO_TESTE" -d "$CORPO"

checar "token na URL (url_token)" 401 \
  -X POST "http://127.0.0.1:$PORTA/webhook/$SEGREDO_TESTE" -H 'Content-Type: application/json' -d "$CORPO"

checar "HMAC VÁLIDO do rawBody" 200 \
  -X POST "http://127.0.0.1:$PORTA/webhook" -H 'Content-Type: application/json' \
  -H "x-webhook-signature: $ASSINATURA" -d "$CORPO"

# ---------------------------------------------------------------------------------
# ASSERT 2 (Alfredo): com HMAC_ONLY=false o url_token volta a 200 — prova de que a
# flag é o que recusa, e de que produção continua funcionando como sempre.
# ---------------------------------------------------------------------------------
echo
echo "=== prova de compatibilidade: mesma instância, HMAC_ONLY=false ==="
kill "$PID" 2>/dev/null; sleep 1.5; PID=""
(
  cd "$ROOT"
  set -a; . ./.env; set +a
  export PORT=$PORTA WEBHOOK_SECRET="$SEGREDO_TESTE" UAZAPI_URL="$UAZ_SINK" UAZAPI_TOKEN="token-de-teste"
  export WEBHOOK_HMAC_ONLY=false
  node scripts/replay-lab-server.js
) >"$TMPD/tom2.log" 2>&1 &
PID=$!
for _ in $(seq 1 40); do curl -s -o /dev/null -m 1 "http://127.0.0.1:$PORTA/health" && break; sleep 0.5; done
checar "assert-2: url_token com HMAC_ONLY=false" 200 \
  -X POST "http://127.0.0.1:$PORTA/webhook/$SEGREDO_TESTE" -H 'Content-Type: application/json' -d "$CORPO"

# ---------------------------------------------------------------------------------
# ASSERT 3 (Alfredo): o caso HMAC válido NÃO faz chamada de rede externa.
# O endpoint da UAZAPI aponta para um sink que não existe; qualquer tentativa apareceria
# no log como erro de conexão para ele. Zero ocorrência = zero chamada.
# ---------------------------------------------------------------------------------
sleep 3
TENTATIVAS=$(grep -c "$UAZ_SINK" "$TMPD/tom.log" "$TMPD/tom2.log" 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')
EXTERNAS=$(grep -cE 'lamusic\.uazapi\.com|api\.uazapi' "$TMPD/tom.log" "$TMPD/tom2.log" 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')
if [ "$EXTERNAS" = "0" ]; then
  ok "assert-3: ZERO chamada para UAZAPI de produção (tentativas ao sink local: $TENTATIVAS)"
else
  falhou "assert-3: $EXTERNAS referência(s) à UAZAPI de PRODUÇÃO nos logs"
fi

echo
if [ "$FALHAS" = "0" ]; then echo "=== AUTH: TODAS AS CHECAGENS PASSARAM ==="; exit 0; fi
echo "=== AUTH: $FALHAS FALHA(S) ==="; exit 1
