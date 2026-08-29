#!/bin/bash
# Testes do canal de alerta contra um MOCK local. NENHUMA mensagem real e enviada.
#
# Cobre o que o laudo v2.4 exigiu: sucesso real, HTTP 200 com erro semantico, timeout,
# resposta invalida, destino trocado, e inspecao de /proc/<pid>/cmdline durante o envio.
#
# O mock le o modo de um arquivo, entao o mesmo servidor serve todos os cenarios.

set -uo pipefail
AQUI="$(dirname "$(readlink -f "$0")")"
D=$(mktemp -d /tmp/alertar-teste.XXXXXX); PORTA=${PORTA_MOCK:-8123}
P=0; F=0
ok()    { P=$((P+1)); printf '  ok    %s\n' "$1"; }
falhou(){ F=$((F+1)); printf '  FALHA %s\n' "$1"; }
limpar() { [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null; rm -rf "$D"; rm -f /run/alertar-* 2>/dev/null; }
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
cat > "$D/env-outro" <<EOF
UAZAPI_URL=http://127.0.0.1:$PORTA
UAZAPI_TOKEN=FAKE-TOKEN-XY
TOM_ALERTA_WA_JID=120363000000000002@g.us
EOF
chmod 600 "$D/env-outro"

# --- mock ---------------------------------------------------------------------------------
cat > "$D/mock.py" <<'PY'
import http.server, json, os, sys, time
MODO = sys.argv[1]
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _modo(self):
        try: return open(MODO).read().strip()
        except Exception: return "sucesso"
    def do_GET(self):
        self._responder(self._modo(), True)
    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0)); corpo = self.rfile.read(n)
        open(MODO + '.ultimo-corpo', 'wb').write(corpo)
        open(MODO + '.ultimo-token', 'w').write(self.headers.get('token', ''))
        self._responder(self._modo(), False)
    def _responder(self, m, get):
        if m == 'timeout':
            time.sleep(20); return
        if get:
            corpo = json.dumps({"instance": {"status": "connected", "name": "MOCK"}})
            self.send_response(200)
        elif m == 'erro_semantico':
            corpo = json.dumps({"error": "chat not found", "status": 400}); self.send_response(200)
        elif m == 'resposta_invalida':
            corpo = "<html>nao sou json</html>"; self.send_response(200)
        elif m == 'http_401':
            corpo = json.dumps({"error": "unauthorized"}); self.send_response(401)
        else:
            corpo = json.dumps({"id": "MOCK-MSG-1", "chatid": "120363000000000001@g.us", "fromMe": True})
            self.send_response(200)
        b = corpo.encode(); self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
# ThreadingHTTPServer: o cenario `timeout` dorme 30 s e, com servidor single-thread,
# a requisicao seguinte ficava na fila — o teste 7 recebia http=000 por culpa do mock.
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[2])), H).serve_forever()
PY
echo sucesso > "$D/modo"
python3 "$D/mock.py" "$D/modo" "$PORTA" & SRV=$!
for _ in $(seq 1 10); do curl -s -o /dev/null "http://127.0.0.1:$PORTA/instance/status" && break; sleep 0.5; done

A="$AQUI/alertar.sh"
rodar() { TOM_ENV_FILE="${2:-$D/env}" ALERTAR_TENTATIVAS=2 ALERTAR_BACKOFF_SEG=1 \
          ALERTAR_TIMEOUT_SEG="${3:-8}" "$A" "${@:4}" 2>&1; }

echo "== 1. sucesso semantico =="
echo sucesso > "$D/modo"; rm -f /run/alertar-*
S=$(rodar . "$D/env" 8 --chave t1 --intervalo-min 60 "mensagem de teste"); RC=$?
grep -q 'entregue' <<<"$S" && [ "$RC" = 0 ] && ok "entrega confirmada (rc=0)" || falhou "esperava entrega: $S"
MARCAS=$(ls /run/alertar-* 2>/dev/null | wc -l)
[ "$MARCAS" = 1 ] && ok "marca anti-spam gravada apos confirmacao" || falhou "marcas=$MARCAS"
ls /run/alertar-* 2>/dev/null | grep -q '120363' && falhou "nome da marca EXPOE o JID" || ok "nome da marca nao expoe o JID"

echo "== 2. HTTP 200 com erro semantico =="
echo erro_semantico > "$D/modo"; rm -f /run/alertar-*
S=$(rodar . "$D/env" 8 --chave t2 --intervalo-min 60 "x"); RC=$?
[ "$RC" != 0 ] && ok "reprovou apesar do HTTP 200 (rc=$RC)" || falhou "aprovou erro semantico"
grep -q 'NAO confirma entrega' <<<"$S" && ok "motivo explicito na saida" || falhou "sem motivo: $S"
[ "$(ls /run/alertar-* 2>/dev/null | wc -l)" = 0 ] && ok "NAO gravou marca anti-spam" || falhou "gravou marca com erro semantico"

echo "== 3. timeout =="
echo timeout > "$D/modo"; rm -f /run/alertar-*
S=$(rodar . "$D/env" 3 --chave t3 --intervalo-min 60 "x"); RC=$?
[ "$RC" != 0 ] && ok "reprovou no timeout (rc=$RC)" || falhou "aprovou timeout"
[ "$(ls /run/alertar-* 2>/dev/null | wc -l)" = 0 ] && ok "NAO gravou marca no timeout" || falhou "gravou marca"

echo "== 4. resposta invalida (nao-JSON) =="
echo resposta_invalida > "$D/modo"; rm -f /run/alertar-*
S=$(rodar . "$D/env" 8 --chave t4 --intervalo-min 60 "x"); RC=$?
[ "$RC" != 0 ] && ok "reprovou resposta invalida (rc=$RC)" || falhou "aprovou resposta invalida"

echo "== 5. destino trocado nao herda supressao =="
echo sucesso > "$D/modo"; rm -f /run/alertar-*
rodar . "$D/env" 8 --chave t5 --intervalo-min 60 "primeira" >/dev/null
S=$(rodar . "$D/env" 8 --chave t5 --intervalo-min 60 "segunda")
grep -q 'suprimido' <<<"$S" && ok "mesmo destino: suprimido" || falhou "deveria suprimir: $S"
S=$(rodar . "$D/env-outro" 8 --chave t5 --intervalo-min 60 "outra caixa")
grep -q 'entregue' <<<"$S" && ok "destino DIFERENTE: entregue (nao herdou)" || falhou "herdou supressao: $S"

echo "== 6. /proc/<pid>/cmdline durante o envio =="
# Usa o modo `timeout` de proposito: com o mock respondendo na hora, o curl vive ~10 ms e o
# teste nao conseguia captura-lo — e um "token ausente" sobre um processo que nunca foi
# inspecionado e verde vazio. Segurando a resposta, o curl fica vivo e da para ler /proc.
echo timeout > "$D/modo"; rm -f /run/alertar-*
TOM_ENV_FILE="$D/env" ALERTAR_TENTATIVAS=1 ALERTAR_TIMEOUT_SEG=10 "$A" --chave t6 --intervalo-min 60 "TEXTO-SECRETO-DO-ALERTA" >/dev/null 2>&1 &
BG=$!
ACHOU_TOKEN=0; ACHOU_TEXTO=0; ACHOU_JID=0; VIU_CURL=0; CMDLINE=""
for _ in $(seq 1 100); do
  for pid in $(pgrep -f 'curl' 2>/dev/null); do
    CMD=$(tr -d '\000' < "/proc/$pid/cmdline" 2>/dev/null; echo) || continue
    case "$CMD" in *alertar*|*curl*) : ;; *) continue ;; esac
    case "$CMD" in *"$D"*|*alertar*) VIU_CURL=1; CMDLINE="$CMD" ;; *) continue ;; esac
    case "$CMD" in *FAKE-TOKEN*)    ACHOU_TOKEN=1 ;; esac
    case "$CMD" in *TEXTO-SECRETO*)  ACHOU_TEXTO=1 ;; esac
    case "$CMD" in *120363000000*)   ACHOU_JID=1 ;; esac
  done
  [ "$VIU_CURL" = 1 ] && break
  sleep 0.1
done
kill "$BG" 2>/dev/null; wait "$BG" 2>/dev/null
if [ "$VIU_CURL" = 1 ]; then
  ok "curl capturado vivo; cmdline=[$(printf '%s' "$CMDLINE" | cut -c1-70)...]"
  [ "$ACHOU_TOKEN" = 0 ] && ok "token AUSENTE do cmdline"            || falhou "TOKEN visivel no cmdline"
  [ "$ACHOU_TEXTO" = 0 ] && ok "texto da mensagem AUSENTE do cmdline" || falhou "TEXTO visivel no cmdline"
  [ "$ACHOU_JID"   = 0 ] && ok "destino AUSENTE do cmdline"           || falhou "JID visivel no cmdline"
else
  falhou "nao capturei o curl vivo — teste INCONCLUSIVO, nao conte como aprovado"
fi

echo "== 7. --testar-canal nao envia =="
echo sucesso > "$D/modo"; rm -f "$D/modo.ultimo-corpo"
S=$(TOM_ENV_FILE="$D/env" "$A" --testar-canal 2>&1); RC=$?
[ "$RC" = 0 ] && grep -q 'NENHUMA mensagem' <<<"$S" && ok "validou sem enviar" || falhou "testar-canal: $S"
[ ! -f "$D/modo.ultimo-corpo" ] && ok "nenhum POST chegou ao mock" || falhou "houve POST no --testar-canal"
grep -q '120363000000000001' <<<"$S" && falhou "destino impresso inteiro" || ok "destino mascarado na saida"

echo
echo "== $P passaram, $F falharam =="
[ "$F" -eq 0 ]
