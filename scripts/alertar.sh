#!/bin/bash
# alertar.sh — canal de alerta EXTERNO para os guardas do safety gate.
#
# Por que existe (laudo, item 1): este host não tem MTA nem MAILTO, então tudo que o cron
# imprime morre dentro do backup.log. A sentinela DETECTAVA a falha, mas ninguém era
# avisado — detecção sem notificação é meia-vigilância.
#
# Por que Telegram: não inventei canal novo. O host já tem um, em uso e provado, pelos
# monitores `check-agentes.py` e `check-openai-billing.py`. Alerta que chega onde a pessoa
# já olha vale mais do que alerta bonito num canal que ninguém abre.
#
# FONTE ÚNICA, sem duplicar segredo nem destino:
#   token   -> /etc/monitor-agentes.env (mesmo arquivo dos monitores)
#   destino -> CHAT_ID/TOPIC_ID lidos do próprio check-agentes.py
# Nada é copiado para cá. Se a origem mudar, este script acompanha ou falha explícito —
# nunca manda para o lugar errado por causa de uma cópia velha.
#
# Uso:  ./alertar.sh "texto"            envia
#       ./alertar.sh --testar-canal     só valida token/destino, NÃO envia nada
#
# O token nunca é impresso. Em erro, a URL é sanitizada.

set -uo pipefail
ENV_MONITOR=/etc/monitor-agentes.env
MONITOR_PY=/usr/local/bin/check-agentes.py

sanitizar() { sed -E 's#bot[0-9]+:[A-Za-z0-9_-]+#bot<REDACTED>#g'; }

ler_token() {
  [ -r "$ENV_MONITOR" ] || { echo "alertar: $ENV_MONITOR ilegivel" >&2; return 1; }
  local t
  t=$(grep -m1 -E '^[[:space:]]*TELEGRAM_BOT_TOKEN[[:space:]]*=' "$ENV_MONITOR" \
      | sed -E 's/^[^=]*=[[:space:]]*//; s/^["'"'"']//; s/["'"'"']$//')
  [ -n "$t" ] || { echo "alertar: TELEGRAM_BOT_TOKEN ausente" >&2; return 1; }
  printf '%s' "$t"
}
ler_const() {  # nome da constante no monitor
  [ -r "$MONITOR_PY" ] || { echo "alertar: $MONITOR_PY ilegivel" >&2; return 1; }
  local v
  v=$(grep -m1 -E "^${1}[[:space:]]*=" "$MONITOR_PY" | sed -E 's/^[^=]*=[[:space:]]*//; s/[[:space:]]*#.*$//; s/^["'"'"']//; s/["'"'"']$//' | tr -d '[:space:]')
  [ -n "$v" ] || { echo "alertar: constante $1 nao encontrada em $MONITOR_PY" >&2; return 1; }
  printf '%s' "$v"
}

TOKEN=$(ler_token) || exit 2
CHAT=$(ler_const CHAT_ID) || exit 2
TOPICO=$(ler_const TOPIC_ID) || true   # opcional: nem todo destino usa tópico

if [ "${1:-}" = "--testar-canal" ]; then
  # getMe é LEITURA: prova que o token é válido sem mandar mensagem para ninguém.
  RESP=$(curl -s -m 15 "https://api.telegram.org/bot$TOKEN/getMe")
  if grep -q '"ok":true' <<<"$RESP"; then
    echo "alertar: token OK (bot $(sed -E 's/.*"username":"([^"]+)".*/\1/' <<<"$RESP"))"
    echo "alertar: destino chat=${CHAT:0:4}…(mascarado) topico=${TOPICO:-nenhum}"
    echo "alertar: NENHUMA mensagem foi enviada"
    exit 0
  fi
  echo "alertar: token REPROVADO: $(cut -c1-160 <<<"$RESP" | sanitizar)" >&2; exit 1
fi

# ANTI-SPAM. O scanner roda a cada 15 min e a sentinela de hora em hora: uma falha
# persistente viraria ~120 mensagens/dia, e alerta que satura vira alerta ignorado — o
# oposto do que ele existe para fazer. Com --chave, o mesmo assunto só reenvia depois de
# --intervalo-min (padrão 60). O estado fica em /run: reinício limpa e o alerta volta.
CHAVE=""; INTERVALO=60
while [ $# -gt 1 ]; do
  case "$1" in
    --chave)        CHAVE=$2; shift 2 ;;
    --intervalo-min) INTERVALO=$2; shift 2 ;;
    *) break ;;
  esac
done
if [ -n "$CHAVE" ]; then
  MARCA="/run/alertar-$(printf '%s' "$CHAVE" | tr -c 'A-Za-z0-9_.-' '_')"
  if [ -f "$MARCA" ]; then
    ULT=$(cat "$MARCA" 2>/dev/null || echo 0)
    MIN=$(( ( $(date +%s) - ${ULT:-0} ) / 60 ))
    if [ "$MIN" -lt "$INTERVALO" ]; then
      echo "alertar: suprimido (mesmo assunto ha ${MIN} min, intervalo ${INTERVALO})"; exit 0
    fi
  fi
fi

TEXTO=${1:?uso: $0 [--chave K] [--intervalo-min N] \"texto\" | --testar-canal}
CAMPOS=(--data-urlencode "chat_id=$CHAT" --data-urlencode "text=$TEXTO")
[ -n "${TOPICO:-}" ] && CAMPOS+=(--data-urlencode "message_thread_id=$TOPICO")

RESP=$(curl -s -m 20 -X POST "${CAMPOS[@]}" "https://api.telegram.org/bot$TOKEN/sendMessage")
if grep -q '"ok":true' <<<"$RESP"; then
  [ -n "$CHAVE" ] && { date +%s > "$MARCA" 2>/dev/null; chmod 0600 "$MARCA" 2>/dev/null; }
  echo "alertar: enviado"; exit 0
fi
echo "alertar: FALHA no envio: $(cut -c1-200 <<<"$RESP" | sanitizar)" >&2
exit 1
