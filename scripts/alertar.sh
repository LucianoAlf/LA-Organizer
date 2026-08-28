#!/bin/bash
# alertar.sh — canal de alerta EXTERNO para os guardas do safety gate. WhatsApp, via UAZAPI.
#
# POR QUE EXISTE: este host nao tem MTA nem MAILTO, entao tudo que o cron imprime morre dentro
# do backup.log. A sentinela DETECTAVA a falha e ninguem era avisado — deteccao sem notificacao
# e meia-vigilancia.
#
# POR QUE WHATSAPP, E NAO TELEGRAM (correcao de 28/08). A primeira versao mandava para o
# Telegram porque o HOST ja tinha um canal provado ali — o dos monitores de infra
# (`check-agentes.py`, `check-openai-billing.py`). Foi raciocinio errado: "existe um canal
# neste servidor" nao e o mesmo que "existe um canal que a pessoa OLHA". O TOM nao fala
# Telegram; ele fala WhatsApp. Alerta que chega onde ninguem le e igual a nao ter alerta — com
# o agravante de parecer que tem. A sentinela chegou a depender desse canal.
#
# DESTINO: TOM_ALERTA_WA_JID — o espelho WhatsApp do grupo de engenharia do Alf e do Hugo
# (o mesmo TOM_OPS_GROUP_ID onde o agente de governanca publica). E o canal de operacao,
# isento de quiet hours por desenho. Alerta de backup/varredura no grupo financeiro da Rose
# seria ruido para quem nao pode agir nele.
#
# ATENCAO ao configurar: TOM_OPS_GROUP_ID e um UUID de `work_groups` (grupo do APP), nao um
# endereco de WhatsApp. Mandar esse UUID no campo `number` da UAZAPI nao da erro — da
# TIMEOUT, tres vezes, e parece problema de rede. O que a UAZAPI quer e o JID do espelho
# (`...@g.us`), que mora em `work_groups.wa_group_jid` e foi copiado para o .env como
# TOM_ALERTA_WA_JID para que este script nao dependa do banco para conseguir gritar.
#
# NAO DEPENDE DO ENGINE. Fala direto com a UAZAPI por curl, porque este script e acionado
# justamente quando algo esta quebrado — inclusive, possivelmente, o proprio TOM.
#
# Uso:  ./alertar.sh [--chave K] [--intervalo-min N] "texto"   envia
#       ./alertar.sh --testar-canal                            so valida, NAO envia nada
#
# NADA de valor de credencial e impresso. Toda saida da API passa por `sanitizar()` antes de
# aparecer: em 28/08 eu imprimi o token da instancia ao inspecionar /instance/status a mao, e
# essa e a razao desta funcao existir aqui dentro em vez de virar cuidado do chamador.

set -uo pipefail
ENV_TOM=${TOM_ENV_FILE:-/opt/LA-Organizer/.env}

# Redige token (uuid), header `token:` e qualquer coisa com cara de credencial longa.
sanitizar() {
  sed -E 's/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/<REDACTED>/g;
          s/("token"[[:space:]]*:[[:space:]]*")[^"]*/\1<REDACTED>/g;
          s/[A-Za-z0-9_-]{40,}/<REDACTED>/g'
}

# Le UMA variavel do .env sem `source` e sem `eval`: o .env tem dezenas de segredos e
# carrega-lo inteiro no ambiente deste script exporia tudo a qualquer subprocesso.
ler_env() {
  [ -r "$ENV_TOM" ] || { echo "alertar: $ENV_TOM ilegivel" >&2; return 1; }
  local v
  v=$(grep -m1 "^[[:space:]]*$1[[:space:]]*=" "$ENV_TOM" \
      | sed -E 's/^[^=]*=[[:space:]]*//; s/^["'"'"']//; s/["'"'"']$//' | tr -d '\r')
  [ -n "$v" ] || { echo "alertar: $1 ausente em $ENV_TOM" >&2; return 1; }
  printf '%s' "$v"
}

URL=$(ler_env UAZAPI_URL)          || exit 2
TOKEN=$(ler_env UAZAPI_TOKEN)      || exit 2
GRUPO=$(ler_env TOM_ALERTA_WA_JID) || exit 2
case "$GRUPO" in *@g.us|*@s.whatsapp.net) : ;;
  *) echo "alertar: TOM_ALERTA_WA_JID nao parece endereco de WhatsApp (esperado ...@g.us)" >&2; exit 2 ;;
esac

if [ "${1:-}" = "--testar-canal" ]; then
  # /instance/status e LEITURA: prova que a instancia esta conectada sem mandar mensagem.
  RESP=$(curl -s -m 15 -H "token: $TOKEN" "$URL/instance/status")
  ST=$(sed -E 's/.*"status"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/' <<<"$RESP")
  NOME=$(sed -E 's/.*"name"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/' <<<"$RESP")
  if [ "$ST" = connected ]; then
    echo "alertar: instancia CONECTADA ($NOME)"
    echo "alertar: destino=${GRUPO:0:6}…(mascarado)"
    echo "alertar: NENHUMA mensagem foi enviada"
    exit 0
  fi
  echo "alertar: instancia NAO conectada (status=${ST:-desconhecido}): $(cut -c1-160 <<<"$RESP" | sanitizar)" >&2
  exit 1
fi

# ANTI-SPAM. A varredura roda a cada 15 min e a sentinela de hora em hora: uma falha
# persistente viraria ~120 mensagens/dia num grupo de pessoas, e alerta que satura vira alerta
# ignorado — o oposto do que ele existe para fazer. Com --chave, o mesmo assunto so reenvia
# depois de --intervalo-min. O estado fica em /run: reinicio limpa e o alerta volta.
CHAVE=""; INTERVALO=60
while [ $# -gt 1 ]; do
  case "$1" in
    --chave)         CHAVE=$2; shift 2 ;;
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

TEXTO=${1:?uso: $0 [--chave K] [--intervalo-min N] "texto" | --testar-canal}

# RETRY com a MESMA regra do engine (src/services/whatsapp.js): a UAZAPI da 404 intermitente
# no /send/text ao resolver o chat, e hiberna devolvendo 503. Transitorio (404/408/429/5xx/sem
# resposta) merece nova tentativa; 400/401/403 e payload ou token invalido — repetir nao muda.
# PACIENCIA MAIOR QUE A DO ENGINE (v2.4). Medido em 28/08: o /send/text para GRUPO ficou
# ~15 min sem responder byte nenhum (6 tentativas de 20 a 60 s), enquanto GET /instance/status,
# POST /group/info com o MESMO jid e /send/text para NUMERO respondiam em ~1 s. Depois voltou
# sozinho, em 2,1 s. E a intermitencia conhecida da UAZAPI.
# Para uma mensagem de conversa, desistir rapido e correto — o TOM tenta de novo no proximo
# turno. Para ALERTA nao: a mensagem perdida e justamente a que avisaria que o backup parou.
# 5 tentativas com backoff 3/6/12/24s (~45 s no total) cabem folgado no cron e cobrem a
# janela curta. Se ainda assim falhar, `alerta=falhou` vai para o estado e a sentinela grita.
TENTATIVAS=5
for i in $(seq 1 "$TENTATIVAS"); do
  CORPO=$(printf '%s' "$TEXTO" | python3 -c 'import json,sys; print(json.dumps({"number": sys.argv[1], "text": sys.stdin.read(), "readchat": True}))' "$GRUPO" 2>/dev/null) \
    || CORPO=$(printf '{"number":"%s","text":"%s","readchat":true}' "$GRUPO" "$(printf '%s' "$TEXTO" | sed 's/\\/\\\\/g; s/"/\\"/g')")
  HTTP=$(curl -s -m 25 -o /tmp/.alertar.$$ -w '%{http_code}' \
         -X POST -H "token: $TOKEN" -H 'Content-Type: application/json' \
         -d "$CORPO" "$URL/send/text")
  RC=$?
  RESP=$(cat /tmp/.alertar.$$ 2>/dev/null); rm -f /tmp/.alertar.$$
  case "$HTTP" in
    200|201) echo "alertar: enviado (destino ${GRUPO:0:6}…)"
             [ -n "$CHAVE" ] && { date +%s > "$MARCA" 2>/dev/null; chmod 0600 "$MARCA" 2>/dev/null; }
             exit 0 ;;
    400|401|403) echo "alertar: FALHA definitiva HTTP $HTTP: $(cut -c1-200 <<<"$RESP" | sanitizar)" >&2; exit 1 ;;
    *) echo "alertar: tentativa $i/$TENTATIVAS falhou (http=${HTTP:-sem-resposta} curl=$RC): $(cut -c1-160 <<<"$RESP" | sanitizar)" >&2
       [ "$i" -lt "$TENTATIVAS" ] && sleep $(( 3 * (2 ** (i - 1)) )) ;;
  esac
done
echo "alertar: FALHA no envio apos $TENTATIVAS tentativas" >&2
exit 1
