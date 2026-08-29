#!/usr/bin/env bash
# scripts/replay-lab-run.sh — sobe a instância efêmera e roda um cenário do Replay Lab.
#
#   N=5 bash scripts/replay-lab-run.sh cenario-piso
#
# A instância é a mesma do teste de auth: MESMO router e MESMA config de rawBody do
# index.js, sem cron/realtime/replay (subir o index completo dispararia startCrons,
# startRealtime e replayPending CONTRA O BANCO DE PRODUÇÃO).
# O cron do cenário é chamado com relógio controlado pelo próprio script do cenário.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CENARIO="${1:-cenario-piso}"
PORTA="${PORT_LAB:-3199}"
TMPD="$(mktemp -d)"
PID=""

limpar() {
  local code=$?
  [ -n "$PID" ] && kill "$PID" 2>/dev/null && sleep 1
  [ -n "$PID" ] && kill -9 "$PID" 2>/dev/null
  if curl -s -o /dev/null -m 2 "http://127.0.0.1:$PORTA/health" 2>/dev/null; then
    echo "  ATENÇÃO: algo ainda escuta na $PORTA — resíduo"; code=1
  fi
  echo "  log da instância: $TMPD/lab.log"
  exit $code
}
trap limpar EXIT

cd "$ROOT"
set -a; . ./.env; set +a

# Segredo PRÓPRIO do laboratório. Não herda o de produção — e, no estado atual, produção
# está com WEBHOOK_SECRET vazio (achado de 05/08), o que colocaria o verificador em modo
# `disabled` e faria o cenário injetar sem autenticação nenhuma: o teste passaria sem
# provar o caminho autenticado.
export WEBHOOK_SECRET="replay-lab-$(date +%s)-$$"
export TOM_QA_PHONES="${TOM_QA_PHONES:-5500000000001,5500000000002,5500000000003,5500000000004}"
export TOM_QA_EVIDENCE_FILE="${TOM_QA_EVIDENCE_FILE:-$TMPD/evidencia.jsonl}"
export PORT_LAB="$PORTA"
# O cenário precisa PROVAR que exercitou o caminho que diz medir, e esse rastro sai no
# stdout do servidor (outro processo). Sem isto o cenário B passou verde com a flag
# desligada: ele nunca tocou no title-lookup e ninguém percebeu.
export TOM_QA_LAB_LOG="$TMPD/lab.log"

# O run é gerado AQUI porque dois processos precisam concordar sobre ele: o servidor abre o
# turno conversacional (é lá que a fala do TOM nasce) e o cenário roda o cron. Run gerado
# dentro do cenário deixaria a fala do TOM órfã — foi assim que o laboratório ficou sem
# enxergar o que ele disse.
export TOM_QA_RUN_ID="${CENARIO}-$(date +%s)-$$"
echo "=== run: $TOM_QA_RUN_ID ==="

echo "=== instância efêmera na $PORTA (QA=${TOM_QA_PHONES%%,*}...) ==="
(
  export PORT="$PORTA"
  export UAZAPI_URL="http://127.0.0.1:$((PORTA+1))/sink"   # nada sai daqui
  export UAZAPI_TOKEN="token-de-teste"
  node scripts/replay-lab-server.js
) >"$TMPD/lab.log" 2>&1 &
PID=$!

for _ in $(seq 1 40); do curl -s -o /dev/null -m 1 "http://127.0.0.1:$PORTA/health" && break; sleep 0.5; done
curl -s -o /dev/null -m 2 "http://127.0.0.1:$PORTA/health" || { echo "instância não subiu:"; tail -20 "$TMPD/lab.log"; exit 1; }
echo "  OK   instância no ar (pid $PID)"
echo

node "scripts/replay-lab-$CENARIO.js"
