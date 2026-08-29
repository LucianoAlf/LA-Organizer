#!/bin/bash
# Testes do canal de alerta contra um MOCK local. NENHUMA mensagem real e enviada.
#
# Cobre:
#   * sucesso semantico, HTTP 200 com erro, timeout, corpo nao-JSON, destino trocado;
#   * /proc/<pid>/cmdline durante o envio (segredo fora do argv);
#   * laudo v2.5, bloqueador 6 -- id de REQUISICAO com entrega falha, envelope sem status,
#     status desconhecido, JSON que nao e objeto;
#   * laudo v2.5, bloqueador 8 -- ISOLAMENTO: a suite nao pode tocar em /run/alertar-*, onde
#     moram as marcas anti-spam REAIS da sentinela e da varredura. A v2.5 fazia
#     `rm -f /run/alertar-*` sete vezes: rodar os testes zerava a supressao de producao e
#     podia colidir com um alerta em voo.

set -uo pipefail
AQUI="$(dirname "$(readlink -f "$0")")"
D=$(mktemp -d "${TMPDIR:-/tmp}/alertar-teste.XXXXXX")
# Porta EFEMERA: porta fixa colide com orfao da execucao anterior e o teste passa a medir
# outro servidor (foi assim que o teste do bundle deu 5 falsos "bypass").
PORTA=${PORTA_MOCK:-$(python3 -c "import socket;s=socket.socket();s.bind(('127.0.0.1',0));print(s.getsockname()[1]);s.close()")}
MARCAS="$D/marcas"; mkdir -p "$MARCAS"
P=0; F=0
ok()    { P=$((P+1)); printf '  ok    %s\n' "$1"; }
falhou(){ F=$((F+1)); printf '  FALHA %s\n' "$1"; }

# SENTINELA DE ISOLAMENTO. Fotografa /run/alertar-* ANTES. Se nao houver marca nenhuma a
# comparacao seria vacua -- entao o teste cria uma sentinela propria (nome que nao e hash de
# chave nenhuma, logo nao suprime alerta de ninguem) e a remove no fim.
SENT="/run/alertar-SENTINELA-DO-TESTE-$$"
FOTO_ANTES="$D/marcas-antes.txt"
ls -1 /run/alertar-* 2>/dev/null | LC_ALL=C sort > "$FOTO_ANTES" || true
if date +%s > "$SENT" 2>/dev/null; then TEM_SENT=1; printf '%s\n' "$SENT" >> "$FOTO_ANTES"
else TEM_SENT=0; fi
LC_ALL=C sort -o "$FOTO_ANTES" "$FOTO_ANTES"
limpar() {
  [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null
  [ "$TEM_SENT" = 1 ] && rm -f "$SENT" 2>/dev/null
  rm -rf "$D"                       # e SO isso: nada em /run alem da propria sentinela
}
trap limpar EXIT INT TERM

# --- .env falso: valores obviamente de teste, nenhum segredo real -------------------------
# O token de teste e CURTO de proposito (< 16 chars). O scan de secrets do pacote reprova
# `TOKEN=<16+ chars>` pela FORMA, e estava certo em reprovar o valor anterior. Encurtar o
# fixture e melhor do que abrir excecao no scanner: mantem o scanner estrito.
cat > "$D/env" <<EOF
UAZAPI_URL=http://127.0.0.1:$PORTA
UAZAPI_TOKEN=FAKE-TOKEN-XY
TOM_ALERTA_WA_JID=120363000000000001@g.us
EOF
chmod 600 "$D/env"
sed 's/000000001@/000000002@/' "$D/env" > "$D/env-outro"; chmod 600 "$D/env-outro"

# --- mock ---------------------------------------------------------------------------------
cat > "$D/mock.py" <<'PY'
import http.server, json, sys, time
MODO = sys.argv[1]
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _modo(self):
        try: return open(MODO).read().strip()
        except Exception: return "sucesso"
    def do_GET(self):  self._responder(self._modo(), True)
    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0)); corpo = self.rfile.read(n)
        open(MODO + '.ultimo-corpo', 'wb').write(corpo)
        open(MODO + '.ultimo-token', 'w').write(self.headers.get('token', ''))
        self._responder(self._modo(), False)
    def _responder(self, m, get):
        if m == 'timeout':
            time.sleep(20); return
        codigo = 200
        if get:
            corpo = json.dumps({"instance": {"status": "connected", "name": "MOCK"}})
        elif m == 'erro_semantico':
            corpo = json.dumps({"error": "chat not found", "status": 400})
        elif m == 'resposta_invalida':
            corpo = "<html>nao sou json</html>"
        elif m == 'http_401':
            corpo = json.dumps({"error": "unauthorized"}); codigo = 401
        # --- bloqueador 6: 200 com corpo que NAO prova entrega ---------------------------
        elif m == 'id_requisicao_falha':
            # id de REQUISICAO + entrega falha. Sem campo "error": a v2.5 aceitava.
            corpo = json.dumps({"id": "req_01H8XK4P2Q", "status": "failed",
                                "chatid": "120363000000000001@g.us"})
        elif m == 'envelope_id':
            corpo = json.dumps({"id": "req_01H8XK4P2Q"})
        elif m == 'status_desconhecido':
            corpo = json.dumps({"messageid": "MOCK-MSG-9", "status": "quantum_superposition",
                                "fromMe": True, "chatid": "120363000000000001@g.us"})
        elif m == 'nao_objeto':
            corpo = json.dumps([{"id": "MOCK-MSG-1", "status": "sent"}])
        elif m == 'erro_dentro_do_id':
            corpo = json.dumps({"messageid": "MOCK-MSG-1", "error": "number not on whatsapp"})
        else:
            # shape documentado de mensagem enviada
            corpo = json.dumps({"messageid": "MOCK-MSG-1", "id": "MOCK-MSG-1", "status": "PENDING",
                                "chatid": "120363000000000001@g.us", "fromMe": True,
                                "messageTimestamp": 1756400000, "messageType": "conversation"})
        b = corpo.encode(); self.send_response(codigo)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
# ThreadingHTTPServer: o cenario `timeout` dorme 20 s e, com servidor single-thread, a
# requisicao seguinte ficava na fila - o teste recebia http=000 por culpa do mock.
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[2])), H).serve_forever()
PY
echo sucesso > "$D/modo"
( exec python3 "$D/mock.py" "$D/modo" "$PORTA" ) & SRV=$!
SUBIU=0
for _ in $(seq 1 20); do
  curl -s -o /dev/null -m 2 "http://127.0.0.1:$PORTA/instance/status" && { SUBIU=1; break; }
  kill -0 "$SRV" 2>/dev/null || break
  sleep 0.5
done
[ "$SUBIU" = 1 ] || { echo "  ABORTADO: mock nao subiu na porta $PORTA"; exit 2; }

A="$AQUI/alertar.sh"
zerar()  { rm -f "$MARCAS"/alertar-* 2>/dev/null; }
marcas() { ls -1 "$MARCAS"/alertar-* 2>/dev/null | wc -l; }
rodar()  { TOM_ENV_FILE="${2:-$D/env}" ALERTAR_MARCA_DIR="$MARCAS" ALERTAR_TENTATIVAS=2 \
           ALERTAR_BACKOFF_SEG=1 ALERTAR_TIMEOUT_SEG="${3:-8}" "$A" "${@:4}" 2>&1; }

echo "== 1. sucesso semantico =="
echo sucesso > "$D/modo"; zerar
S=$(rodar . "$D/env" 8 --chave t1 --intervalo-min 60 "mensagem de teste"); RC=$?
grep -q 'entregue' <<<"$S" && [ "$RC" = 0 ] && ok "entrega confirmada (rc=0)" || falhou "esperava entrega: $S"
[ "$(marcas)" = 1 ] && ok "marca anti-spam gravada apos confirmacao" || falhou "marcas=$(marcas)"
ls "$MARCAS"/alertar-* 2>/dev/null | grep -q '120363' && falhou "nome da marca EXPOE o JID" || ok "nome da marca nao expoe o JID"

echo "== 2. HTTP 200 com erro semantico =="
echo erro_semantico > "$D/modo"; zerar
S=$(rodar . "$D/env" 8 --chave t2 --intervalo-min 60 "x"); RC=$?
[ "$RC" != 0 ] && ok "reprovou apesar do HTTP 200 (rc=$RC)" || falhou "aprovou erro semantico"
grep -q 'NAO confirma entrega' <<<"$S" && ok "motivo explicito na saida" || falhou "sem motivo: $S"
[ "$(marcas)" = 0 ] && ok "NAO gravou marca anti-spam" || falhou "gravou marca com erro semantico"

echo "== 3. timeout =="
echo timeout > "$D/modo"; zerar
S=$(rodar . "$D/env" 3 --chave t3 --intervalo-min 60 "x"); RC=$?
[ "$RC" != 0 ] && ok "reprovou no timeout (rc=$RC)" || falhou "aprovou timeout"
[ "$(marcas)" = 0 ] && ok "NAO gravou marca no timeout" || falhou "gravou marca"

echo "== 4. resposta invalida (nao-JSON) =="
echo resposta_invalida > "$D/modo"; zerar
S=$(rodar . "$D/env" 8 --chave t4 --intervalo-min 60 "x"); RC=$?
[ "$RC" != 0 ] && ok "reprovou resposta invalida (rc=$RC)" || falhou "aprovou resposta invalida"

echo "== 5. BLOQUEADOR 6: HTTP 200 com id de REQUISICAO e entrega falha =="
# O caso do laudo. Nao ha campo "error"; ha um `id` e um `status: failed`. A v2.5 lia so
# "tem id? nao tem error? entao entregou" e gravava a marca -- silenciando os proximos.
echo id_requisicao_falha > "$D/modo"; zerar
S=$(rodar . "$D/env" 8 --chave t5 --intervalo-min 60 "x"); RC=$?
[ "$RC" != 0 ] && ok "reprovou id+status=failed (rc=$RC)" || falhou "ACEITOU entrega falha como enviada"
grep -qi "status .failed." <<<"$S" && ok "motivo nomeia o status recusado" || falhou "motivo nao diz qual status: $(head -1 <<<"$S")"
[ "$(marcas)" = 0 ] && ok "NAO gravou marca (nao silencia o proximo alerta)" || falhou "gravou marca com entrega falha"

echo "== 6. envelope so com id, sem status e sem cara de mensagem =="
echo envelope_id > "$D/modo"; zerar
S=$(rodar . "$D/env" 8 --chave t6 --intervalo-min 60 "x"); RC=$?
[ "$RC" != 0 ] && ok "reprovou envelope ambiguo (rc=$RC)" || falhou "aceitou id pelado como entrega"

echo "== 7. status DESCONHECIDO reprova (fail-closed, nao fail-open) =="
echo status_desconhecido > "$D/modo"; zerar
S=$(rodar . "$D/env" 8 --chave t7 --intervalo-min 60 "x"); RC=$?
[ "$RC" != 0 ] && ok "status fora da lista reprova (rc=$RC)" || falhou "status desconhecido passou"

echo "== 8. JSON valido que NAO e objeto =="
echo nao_objeto > "$D/modo"; zerar
S=$(rodar . "$D/env" 8 --chave t8 --intervalo-min 60 "x"); RC=$?
[ "$RC" != 0 ] && ok "array JSON reprova (rc=$RC)" || falhou "aceitou array como resposta de envio"

echo "== 9. erro convivendo com messageid valido =="
echo erro_dentro_do_id > "$D/modo"; zerar
S=$(rodar . "$D/env" 8 --chave t9 --intervalo-min 60 "x"); RC=$?
[ "$RC" != 0 ] && ok "messageid + error reprova (rc=$RC)" || falhou "id venceu o campo de erro"

echo "== 10. destino trocado nao herda supressao =="
echo sucesso > "$D/modo"; zerar
rodar . "$D/env" 8 --chave t10 --intervalo-min 60 "primeira" >/dev/null
S=$(rodar . "$D/env" 8 --chave t10 --intervalo-min 60 "segunda")
grep -q 'suprimido' <<<"$S" && ok "mesmo destino: suprimido" || falhou "deveria suprimir: $S"
S=$(rodar . "$D/env-outro" 8 --chave t10 --intervalo-min 60 "outra caixa")
grep -q 'entregue' <<<"$S" && ok "destino DIFERENTE: entregue (nao herdou)" || falhou "herdou supressao: $S"

echo "== 11. /proc/<pid>/cmdline durante o envio =="
# Usa o modo `timeout` de proposito: com o mock respondendo na hora, o curl vive ~10 ms e o
# teste nao conseguia captura-lo -- e um "token ausente" sobre um processo que nunca foi
# inspecionado e verde vazio. Segurando a resposta, o curl fica vivo e da para ler /proc.
echo timeout > "$D/modo"; zerar
TOM_ENV_FILE="$D/env" ALERTAR_MARCA_DIR="$MARCAS" ALERTAR_TENTATIVAS=1 ALERTAR_TIMEOUT_SEG=10 \
  "$A" --chave t11 --intervalo-min 60 "TEXTO-SECRETO-DO-ALERTA" >/dev/null 2>&1 &
BG=$!
ACHOU_TOKEN=0; ACHOU_TEXTO=0; ACHOU_JID=0; VIU_CURL=0; CMDLINE=""
for _ in $(seq 1 100); do
  for pid in $(pgrep -f 'curl' 2>/dev/null); do
    CMD=$(tr -d '\000' < "/proc/$pid/cmdline" 2>/dev/null; echo) || continue
    case "$CMD" in *alertar*|*curl*) : ;; *) continue ;; esac
    case "$CMD" in *"$D"*|*alertar*) VIU_CURL=1; CMDLINE="$CMD" ;; *) continue ;; esac
    case "$CMD" in *FAKE-TOKEN*)    ACHOU_TOKEN=1 ;; esac
    case "$CMD" in *TEXTO-SECRETO*) ACHOU_TEXTO=1 ;; esac
    case "$CMD" in *120363000000*)  ACHOU_JID=1 ;; esac
  done
  [ "$VIU_CURL" = 1 ] && break
  sleep 0.1
done
kill "$BG" 2>/dev/null; wait "$BG" 2>/dev/null
if [ "$VIU_CURL" = 1 ]; then
  ok "curl capturado vivo; cmdline=[$(printf '%s' "$CMDLINE" | cut -c1-64)...]"
  [ "$ACHOU_TOKEN" = 0 ] && ok "token AUSENTE do cmdline"             || falhou "TOKEN visivel no cmdline"
  [ "$ACHOU_TEXTO" = 0 ] && ok "texto da mensagem AUSENTE do cmdline" || falhou "TEXTO visivel no cmdline"
  [ "$ACHOU_JID"   = 0 ] && ok "destino AUSENTE do cmdline"           || falhou "JID visivel no cmdline"
else
  falhou "nao capturei o curl vivo -- teste INCONCLUSIVO, nao conte como aprovado"
fi

echo "== 12. --testar-canal nao envia =="
echo sucesso > "$D/modo"; rm -f "$D/modo.ultimo-corpo"
S=$(TOM_ENV_FILE="$D/env" ALERTAR_MARCA_DIR="$MARCAS" "$A" --testar-canal 2>&1); RC=$?
[ "$RC" = 0 ] && grep -q 'NENHUMA mensagem' <<<"$S" && ok "validou sem enviar" || falhou "testar-canal: $S"
[ ! -f "$D/modo.ultimo-corpo" ] && ok "nenhum POST chegou ao mock" || falhou "houve POST no --testar-canal"
grep -q '120363000000000001' <<<"$S" && falhou "destino impresso inteiro" || ok "destino mascarado na saida"

echo "== 13. BLOQUEADOR 8: a suite nao tocou nas marcas REAIS de /run =="
ls -1 /run/alertar-* 2>/dev/null | LC_ALL=C sort > "$D/marcas-depois.txt" || true
if [ "$TEM_SENT" = 0 ]; then
  falhou "nao consegui criar sentinela em /run -- a comparacao seria vacua, nao conte como aprovado"
elif diff -q "$FOTO_ANTES" "$D/marcas-depois.txt" >/dev/null 2>&1; then
  ok "as $(wc -l < "$FOTO_ANTES") marca(s) de /run continuam exatamente como antes"
else
  falhou "a suite mexeu em /run/alertar-*: $(diff "$FOTO_ANTES" "$D/marcas-depois.txt" | head -3 | tr '\n' ' ')"
fi
[ -d "$MARCAS" ] && ok "as marcas do teste ficaram no diretorio injetado, fora de /run" \
                 || falhou "diretorio de marcas do teste sumiu"

echo
echo "== $P passaram, $F falharam =="
[ "$F" -eq 0 ]
