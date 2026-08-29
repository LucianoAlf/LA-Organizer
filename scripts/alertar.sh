#!/bin/bash
# alertar.sh — canal de alerta EXTERNO dos guardas do safety gate. WhatsApp, via UAZAPI.
#
# POR QUE EXISTE: o host nao tem MTA nem MAILTO; tudo que o cron imprime morre no backup.log.
# A sentinela DETECTAVA a falha e ninguem era avisado — deteccao sem notificacao e meia
# vigilancia.
#
# POR QUE WHATSAPP E NAO TELEGRAM (28/08): a primeira versao usou o Telegram dos monitores de
# infra do host. Raciocinio errado — "existe canal neste servidor" nao e "existe canal que a
# pessoa OLHA". O TOM fala WhatsApp. Alerta que chega onde ninguem le e igual a nao ter
# alerta, com o agravante de parecer que tem.
#
# ---------------------------------------------------------------------------------------
# SEGREDO FORA DO argv (v2.5). A versao anterior passava token, destino e TEXTO na linha de
# comando do curl. `/proc/<pid>/cmdline` e legivel por qualquer usuario do host — e este host
# tem 8 contas. Durante cada envio, o token da instancia UAZAPI e o conteudo do alerta ficavam
# expostos a quem desse um `ps`. Agora tudo vai por `curl -K <config>`, com config e corpo em
# arquivos 0600 dentro de um diretorio 0700 em /run, criados sob `umask 077` e apagados no
# trap. O argv passa a conter apenas `-m N -o ... -w ... -K <caminho>`.
#
# SUCESSO SEMANTICO ESTRITO (v2.6). HTTP 200 nao e entrega, e `id` sozinho tambem nao:
# `{"id":"req_abc","status":"failed"}` era aceito como enviado. Agora o corpo e parseado como
# JSON e precisa ter o shape documentado de mensagem, com status de entrega conhecido.
# A marca anti-spam so e gravada depois disso, e mora em ALERTAR_MARCA_DIR (default /run).
#
# Uso:  ./alertar.sh [--chave K] [--intervalo-min N] "texto"   envia
#       ./alertar.sh --testar-canal                            so valida, NAO envia
# Env:  ALERTAR_URL_BASE  sobrescreve a URL (usado pelos testes com mock; nunca em producao)

set -uo pipefail
umask 077                      # tudo que este script criar nasce so para o dono
ENV_TOM=${TOM_ENV_FILE:-/opt/LA-Organizer/.env}

# Redige o que nunca deve aparecer: uuid (token da instancia), campo "token" de JSON, literal
# longo e JID/telefone. TODA saida da API passa por aqui antes de virar diagnostico.
sanitizar() {
  sed -E 's/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/<REDACTED>/g;
          s/("token"[[:space:]]*:[[:space:]]*")[^"]*/\1<REDACTED>/g;
          s/[A-Za-z0-9_-]{40,}/<REDACTED>/g;
          s/[0-9]{10,}(@[a-z.]+)?/<DESTINO>/g'
}

ler_env() {   # le UMA variavel, sem `source` e sem `eval`: o .env tem dezenas de segredos
  [ -r "$ENV_TOM" ] || { echo "alertar: $ENV_TOM ilegivel" >&2; return 1; }
  local v
  v=$(grep -m1 "^[[:space:]]*$1[[:space:]]*=" "$ENV_TOM" \
      | sed -E 's/^[^=]*=[[:space:]]*//; s/^["'"'"']//; s/["'"'"']$//' | tr -d '\r')
  [ -n "$v" ] || { echo "alertar: $1 ausente em $ENV_TOM" >&2; return 1; }
  printf '%s' "$v"
}

URL=${ALERTAR_URL_BASE:-$(ler_env UAZAPI_URL)} || exit 2
TOKEN=$(ler_env UAZAPI_TOKEN)                  || exit 2
GRUPO=$(ler_env TOM_ALERTA_WA_JID)             || exit 2
case "$GRUPO" in *@g.us|*@s.whatsapp.net) : ;;
  *) echo "alertar: TOM_ALERTA_WA_JID nao parece endereco de WhatsApp (esperado ...@g.us)" >&2; exit 2 ;;
esac
# Mascara usada em TODO diagnostico. O JID nunca e impresso inteiro.
DEST_MASC="...$(printf '%s' "$GRUPO" | tail -c 9)"

TMPD=$(mktemp -d /run/alertar.XXXXXX 2>/dev/null || mktemp -d) || { echo "alertar: mktemp falhou" >&2; exit 2; }
chmod 0700 "$TMPD"; trap 'rm -rf "$TMPD"' EXIT INT TERM

# Config do curl: url, headers e corpo saem do argv e vao para arquivo 0600.
escrever_config() {  # <rota> [arquivo_corpo]
  local cfg="$TMPD/curl.cfg"
  : > "$cfg"; chmod 0600 "$cfg"
  {
    printf 'url = "%s%s"\n' "${URL%/}" "$1"
    printf 'header = "token: %s"\n' "$TOKEN"
    printf 'silent\nshow-error\n'
    if [ -n "${2:-}" ]; then
      printf 'header = "Content-Type: application/json"\n'
      printf 'data-binary = "@%s"\n' "$2"
    fi
  } >> "$cfg"
  printf '%s' "$cfg"
}

if [ "${1:-}" = "--testar-canal" ]; then
  CFG=$(escrever_config /instance/status)
  HTTP=$(curl -m 15 -o "$TMPD/st.json" -w '%{http_code}' -K "$CFG" 2>"$TMPD/err")
  ST=$(sed -E 's/.*"status"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/' "$TMPD/st.json" 2>/dev/null)
  NOME=$(sed -E 's/.*"name"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/' "$TMPD/st.json" 2>/dev/null)
  if [ "$HTTP" = 200 ] && [ "$ST" = connected ]; then
    echo "alertar: instancia CONECTADA ($NOME)"
    echo "alertar: destino=$DEST_MASC"
    echo "alertar: NENHUMA mensagem foi enviada"
    exit 0
  fi
  echo "alertar: canal REPROVADO (http=${HTTP:-sem-resposta} status=${ST:-?}): $(cut -c1-160 "$TMPD/st.json" 2>/dev/null | sanitizar)" >&2
  exit 1
fi

# ANTI-SPAM por CHAVE + DESTINO. A varredura roda a cada 15 min e a sentinela de hora em hora:
# uma falha persistente viraria ~120 mensagens/dia num grupo de pessoas, e alerta que satura
# vira alerta ignorado. O nome da marca e o hash de (chave|destino): trocar o destino NAO
# herda a supressao do destino antigo, e o JID nao aparece em /run para quem listar.
CHAVE=""; INTERVALO=60
while [ $# -gt 1 ]; do
  case "$1" in
    --chave)         CHAVE=$2; shift 2 ;;
    --intervalo-min) INTERVALO=$2; shift 2 ;;
    *) break ;;
  esac
done
MARCA=""
if [ -n "$CHAVE" ]; then
  ID=$(printf '%s|%s' "$CHAVE" "$GRUPO" | sha256sum | cut -c1-16)
  # NAMESPACE INJETAVEL (laudo v2.5, bloqueador 8). Com o caminho fixo em /run, o teste do
  # canal so conseguia limpar o proprio estado com `rm -f /run/alertar-*` -- que apaga TAMBEM
  # as marcas anti-spam REAIS da sentinela e da varredura. Rodar a bateria de testes zerava a
  # supressao de producao e podia colidir com um alerta em voo. Teste que mexe no estado vivo
  # nao e teste: e um efeito colateral com nome de verificacao.
  MARCA="${ALERTAR_MARCA_DIR:-/run}/alertar-$ID"
  [ -d "${ALERTAR_MARCA_DIR:-/run}" ] || { echo "alertar: ALERTAR_MARCA_DIR inexistente" >&2; exit 2; }
  if [ -f "$MARCA" ]; then
    ULT=$(cat "$MARCA" 2>/dev/null || echo 0)
    MIN=$(( ( $(date +%s) - ${ULT:-0} ) / 60 ))
    if [ "$MIN" -lt "$INTERVALO" ]; then
      echo "alertar: suprimido (mesmo assunto ha ${MIN} min, intervalo ${INTERVALO})"; exit 0
    fi
  fi
fi

TEXTO=${1:?uso: $0 [--chave K] [--intervalo-min N] "texto" | --testar-canal}

# Corpo em ARQUIVO, nunca no argv. python3 escapa JSON corretamente; sem ele, fallback que
# escapa barra, aspas e quebras de linha.
CORPO="$TMPD/body.json"; : > "$CORPO"; chmod 0600 "$CORPO"
if command -v python3 >/dev/null 2>&1; then
  printf '%s' "$TEXTO" | python3 -c 'import json,sys; sys.stdout.write(json.dumps({"number": sys.argv[1], "text": sys.stdin.read(), "readchat": True}))' "$GRUPO" > "$CORPO" 2>/dev/null
fi
if [ ! -s "$CORPO" ]; then
  printf '{"number":"%s","text":"%s","readchat":true}' "$GRUPO" \
    "$(printf '%s' "$TEXTO" | sed 's/\\/\\\\/g; s/"/\\"/g' | awk '{printf "%s%s", (NR>1?"\\n":""), $0}')" > "$CORPO"
fi

# ACEITACAO NAO E ENTREGA (laudo v2.6, bloqueador 8). A v2.6 tratava `queued`/`pending` como
# entregue, aceitava o booleano `true` como status e so olhava campos de erro no TOPO -- entao
# um corpo com `id`, `status:"sent"` e `data.error` passava como enviado.
#
# Tres contratos separados agora:
#   ENTREGUE  -> sent/delivered/delivery_ack/read/played. Mensagem saiu; marca anti-spam LONGA.
#   ACEITO    -> pending/queued/accepted/server_ack/scheduled. A plataforma recebeu, ninguem
#                confirmou entrega. Vale como tentativa bem-sucedida, mas a marca e CURTA
#                (ALERTAR_INTERVALO_ACEITO min): se a mensagem morrer na fila, o proximo alerta
#                do mesmo assunto sai logo, em vez de ficar suprimido por uma hora.
#   qualquer outro (inclusive booleano e desconhecido) -> REPROVA.
# Erro e procurado RECURSIVAMENTE: `data.error`, `result.errors[0]`, o que for.
ALERTAR_STATUS_ENTREGUE=${ALERTAR_STATUS_ENTREGUE:-sent,delivered,delivery_ack,read,played}
ALERTAR_STATUS_ACEITO=${ALERTAR_STATUS_ACEITO:-pending,queued,accepted,server_ack,scheduled}
ALERTAR_INTERVALO_ACEITO=${ALERTAR_INTERVALO_ACEITO:-5}
RESP_MOTIVO=""; RESP_CLASSE=""
resposta_ok() {  # <arquivo> -> rc 0 e RESP_CLASSE em {ENTREGUE, ACEITO}
  local f=$1 saida rc
  RESP_CLASSE=""
  if ! command -v python3 >/dev/null 2>&1; then
    RESP_MOTIVO="python3 ausente: sem parser nao ha verificacao estrita"; return 1
  fi
  saida=$(python3 - "$f" "$ALERTAR_STATUS_ENTREGUE" "$ALERTAR_STATUS_ACEITO" <<'PYFIM'
import json, sys

CHAVES_ERRO = ("error", "erro", "errors", "message_error", "errormessage",
               "error_message", "errordetail", "failure", "failed_reason")

def procurar_erro(o, caminho="corpo"):
    """Erro em QUALQUER profundidade. A v2.6 so olhava o topo, entao `data.error` passava."""
    if isinstance(o, dict):
        for k, v in o.items():
            if k.lower() in CHAVES_ERRO and v not in (None, "", False, [], {}, 0):
                return "%s.%s" % (caminho, k)
        for k, v in o.items():
            r = procurar_erro(v, "%s.%s" % (caminho, k))
            if r:
                return r
    elif isinstance(o, list):
        for i, v in enumerate(o):
            r = procurar_erro(v, "%s[%d]" % (caminho, i))
            if r:
                return r
    return None

try:
    with open(sys.argv[1], encoding="utf-8", errors="replace") as fh:
        d = json.load(fh)
except Exception as e:
    print("REPROVA corpo nao e JSON valido (%s)" % type(e).__name__); raise SystemExit(1)
if not isinstance(d, dict):
    print("REPROVA corpo JSON nao e objeto (%s)" % type(d).__name__); raise SystemExit(1)

onde = procurar_erro(d)
if onde:
    print("REPROVA campo de erro presente em %s" % onde); raise SystemExit(1)

def sub(k, kk):
    v = d.get(k)
    return v.get(kk) if isinstance(v, dict) else None

cands = [d.get("messageid"), d.get("id"), d.get("message_id"),
         sub("key", "id"), sub("message", "id"), sub("data", "id")]
mid = next((c for c in cands if isinstance(c, str) and len(c) >= 4), None)
if not mid:
    print("REPROVA sem id de mensagem no corpo"); raise SystemExit(1)

entregue = {s.strip().lower() for s in sys.argv[2].split(",") if s.strip()}
aceito = {s.strip().lower() for s in sys.argv[3].split(",") if s.strip()}
st = d.get("status", d.get("Status"))

if isinstance(st, bool):
    # `true` nao diz NADA sobre entrega: e a forma mais barata de um envelope parecer sucesso.
    print("REPROVA status booleano (%s) nao e estado de entrega" % st); raise SystemExit(1)

if st is not None:
    s = str(st).strip().lower()
    if s in entregue:
        print("ENTREGUE status=%s" % s); raise SystemExit(0)
    if s in aceito:
        print("ACEITO status=%s (plataforma aceitou; entrega NAO confirmada)" % s); raise SystemExit(0)
    print("REPROVA status '%s' fora das listas de entrega e de aceite" % s[:40]); raise SystemExit(1)

schema = ("fromMe", "fromme", "chatid", "chatId", "messageTimestamp", "owner",
          "sender", "messageType", "type", "isGroup", "wasSentByApi")
sinais = [k for k in schema if k in d]
if len(sinais) < 2:
    print("REPROVA corpo sem status e sem cara de mensagem (%d campo(s) do schema)" % len(sinais))
    raise SystemExit(1)
# sem status explicito, o maximo honesto e ACEITO: nada no corpo afirma entrega.
print("ACEITO sem status, %d campos do schema (entrega NAO confirmada)" % len(sinais))
raise SystemExit(0)
PYFIM
)
  rc=$?
  RESP_MOTIVO=${saida#* }
  case "$saida" in
    ENTREGUE*) RESP_CLASSE=ENTREGUE ;;
    ACEITO*)   RESP_CLASSE=ACEITO ;;
    *)         RESP_CLASSE="" ;;
  esac
  return $rc
}

# RETRY mais paciente que o do engine: medido em 28/08, o /send/text para grupo ficou ~15 min
# sem responder e depois voltou em 2,1 s (intermitencia da UAZAPI). Para conversa, desistir
# rapido e correto — o TOM tenta no proximo turno. Para alerta nao: a mensagem perdida e
# justamente a que avisaria que o backup parou.
TENTATIVAS=${ALERTAR_TENTATIVAS:-5}
ESPERA_BASE=${ALERTAR_BACKOFF_SEG:-3}
CFG=$(escrever_config /send/text "$CORPO")
for i in $(seq 1 "$TENTATIVAS"); do
  HTTP=$(curl -m "${ALERTAR_TIMEOUT_SEG:-25}" -o "$TMPD/resp.json" -w '%{http_code}' -K "$CFG" 2>"$TMPD/err")
  RC=$?
  case "$HTTP" in
    200|201)
      if resposta_ok "$TMPD/resp.json"; then
        # MARCA CURTA PARA "ACEITO" (laudo v2.6, bloqueador 8). Gravar a marca longa apos um
        # `queued` silencia o assunto por uma hora com base numa mensagem que ainda pode
        # morrer na fila. Entrega confirmada -> marca longa; so aceite -> marca curta.
        if [ -n "$MARCA" ]; then
          if [ "$RESP_CLASSE" = ENTREGUE ]; then
            date +%s > "$MARCA" 2>/dev/null
          else
            # recua o carimbo para que a supressao dure so ALERTAR_INTERVALO_ACEITO minutos
            echo $(( $(date +%s) - (INTERVALO - ALERTAR_INTERVALO_ACEITO) * 60 )) > "$MARCA" 2>/dev/null
          fi
          chmod 0600 "$MARCA" 2>/dev/null
        fi
        if [ "$RESP_CLASSE" = ENTREGUE ]; then
          echo "alertar: ENTREGUE (destino $DEST_MASC; $RESP_MOTIVO)"
        else
          echo "alertar: ACEITO pela plataforma, entrega NAO confirmada (destino $DEST_MASC; $RESP_MOTIVO)"
          echo "alertar: supressao curta de ${ALERTAR_INTERVALO_ACEITO} min -- se nao chegar, o proximo alerta sai logo" >&2
        fi
        exit 0
      fi
      echo "alertar: HTTP $HTTP mas a resposta NAO confirma entrega ($RESP_MOTIVO): $(cut -c1-200 "$TMPD/resp.json" | sanitizar)" >&2
      ;;
    400|401|403)
      echo "alertar: FALHA definitiva HTTP $HTTP: $(cut -c1-200 "$TMPD/resp.json" 2>/dev/null | sanitizar)" >&2
      exit 1 ;;
    *)
      echo "alertar: tentativa $i/$TENTATIVAS (http=${HTTP:-sem-resposta} curl=$RC): $(head -c 160 "$TMPD/err" 2>/dev/null | sanitizar)" >&2 ;;
  esac
  [ "$i" -lt "$TENTATIVAS" ] && sleep $(( ESPERA_BASE * (2 ** (i - 1)) ))
done
echo "alertar: FALHA — $TENTATIVAS tentativas sem entrega confirmada (destino $DEST_MASC)" >&2
exit 1
