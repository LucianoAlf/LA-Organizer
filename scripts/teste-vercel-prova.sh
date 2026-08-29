#!/bin/bash
# Gate da Vercel: conteudo e deployment sao contratos SEPARADOS (laudo v2.5, bloqueador 2).
# Tudo contra mocks locais: nenhuma chamada a Vercel, nenhum deploy.
#
# O falso-verde: `--pos-deploy` aprovava qualquer bundle DIFERENTE cujo conjunto de achados
# batesse com o baseline -- e um bundle diferente com os mesmos achados pode ser de outro
# deployment (rollback, promocao de preview, build de outro commit). A comparacao de conteudo
# nao menciona commit nenhum, entao nunca poderia responder "o deployment do commit X esta
# READY". A v2.5 respondia mesmo assim, e o auto-deploy escrevia "Gate Vercel aprovado".

set -uo pipefail
AQUI="$(dirname "$(readlink -f "$0")")"
VB="$AQUI/verificar-bundle.sh"
D=$(mktemp -d "${TMPDIR:-/tmp}/vercelprova.XXXXXX")
P=0; F=0
ok()    { P=$((P+1)); printf '  ok    %s\n' "$1"; }
falhou(){ F=$((F+1)); printf '  FALHA %s\n' "$1"; }
SITE=""; API=""
limpar(){ [ -n "$SITE" ] && kill "$SITE" 2>/dev/null; [ -n "$API" ] && kill "$API" 2>/dev/null; rm -rf "$D"; }
trap limpar EXIT INT TERM
porta_livre(){ python3 -c "import socket;s=socket.socket();s.bind(('127.0.0.1',0));print(s.getsockname()[1]);s.close()"; }

SHA=1f2e3d4c5b6a798877665544332211aabbccddee
OUTRO=99887766554433221100ffeeddccbbaa99887766

# --- site sintetico: bundle limpo, sem literal de alta entropia --------------------------
mkdir -p "$D/www/assets"
{ printf 'const app="ola";\n'
  for i in $(seq 1 9000); do echo "// enchimento para o bundle ter tamanho de app"; done
} > "$D/www/assets/index-mock.js"
printf '<html><script type="module" src="/assets/index-mock.js"></script></html>' > "$D/www/index.html"

# --- API falsa da Vercel: le o cenario de um arquivo ------------------------------------
cat > "$D/api.py" <<'PY'
import http.server, json, sys
CEN = sys.argv[1]
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        c = open(CEN).read().strip()
        auth = self.headers.get('Authorization', '')
        if not auth.startswith('Bearer '):
            self.send_response(401); b = b'{}'
        else:
            sha = open(CEN + '.sha').read().strip()
            if c == 'ready_prod':
                d = {"deployments": [{"uid": "dpl_ok", "readyState": "READY", "target": "production",
                                      "meta": {"githubCommitSha": sha}}]}
            elif c == 'ready_preview':
                d = {"deployments": [{"uid": "dpl_prev", "readyState": "READY", "target": "preview",
                                      "meta": {"githubCommitSha": sha}}]}
            elif c == 'building':
                d = {"deployments": [{"uid": "dpl_bld", "readyState": "BUILDING", "target": "production",
                                      "meta": {"githubCommitSha": sha}}]}
            elif c == 'outro_commit':
                d = {"deployments": [{"uid": "dpl_x", "readyState": "READY", "target": "production",
                                      "meta": {"githubCommitSha": "0000000000000000000000000000000000000000"}}]}
            else:
                d = {"deployments": []}
            self.send_response(200); b = json.dumps(d).encode()
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[2])), H).serve_forever()
PY
echo vazio > "$D/cenario"; echo "$SHA" > "$D/cenario.sha"

PS=$(porta_livre); ( cd "$D/www" && exec python3 -m http.server "$PS" >/dev/null 2>&1 ) & SITE=$!
PA=$(porta_livre); ( exec python3 "$D/api.py" "$D/cenario" "$PA" >/dev/null 2>&1 ) & API=$!
for _ in $(seq 1 20); do curl -s -o /dev/null -m 2 "http://127.0.0.1:$PS/" && break; sleep 0.5; done
for _ in $(seq 1 20); do curl -s -o /dev/null -m 2 "http://127.0.0.1:$PA/v6/deployments" && break; sleep 0.5; done
U="http://127.0.0.1:$PS"
SEM_PROVA="VERCEL_TOKEN= VERCEL_PROJECT_ID="
com_api(){ VERCEL_API_BASE="http://127.0.0.1:$PA" VERCEL_TOKEN=fake-token VERCEL_PROJECT_ID=prj_teste "$@"; }

echo "== 1. sem fonte de prova: INDETERMINADO, nunca aprovado =="
S=$(env -u VERCEL_TOKEN -u VERCEL_PROJECT_ID "$VB" --provar-deployment "$SHA" "$U" 2>&1); RC=$?
[ "$RC" = 2 ] && ok "rc=2 (indeterminado)" || falhou "rc=$RC, esperado 2"
grep -q 'INDETERMINADO' <<<"$S" && ok "diz INDETERMINADO" || falhou "nao disse indeterminado: $S"
grep -q 'PROVADO:' <<<"$S" && falhou "afirmou prova sem fonte" || ok "nao afirma prova nenhuma"
grep -qi 'VERCEL_TOKEN' <<<"$S" && ok "diz o que falta para provar" || falhou "nao diz o que falta"

echo "== 2. API da Vercel: READY em production prova =="
echo ready_prod > "$D/cenario"
S=$(com_api "$VB" --provar-deployment "$SHA" "$U" 2>&1); RC=$?
[ "$RC" = 0 ] && grep -q 'DEPLOYMENT PROVADO' <<<"$S" && ok "rc=0 e PROVADO" || falhou "rc=$RC: $(head -2 <<<"$S" | tail -1)"

echo "== 3. READY mas em PREVIEW nao prova producao =="
echo ready_preview > "$D/cenario"
S=$(com_api "$VB" --provar-deployment "$SHA" "$U" 2>&1); RC=$?
[ "$RC" = 1 ] && ok "rc=1 (contradiz): preview nao e producao" || falhou "rc=$RC aceitou preview como producao"

echo "== 4. deployment do commit existe mas esta BUILDING =="
echo building > "$D/cenario"
S=$(com_api "$VB" --provar-deployment "$SHA" "$U" 2>&1); RC=$?
[ "$RC" = 1 ] && ok "rc=1: existe mas nao esta READY" || falhou "rc=$RC aprovou build em andamento"

echo "== 5. producao READY, mas de OUTRO commit =="
echo outro_commit > "$D/cenario"
S=$(com_api "$VB" --provar-deployment "$SHA" "$U" 2>&1); RC=$?
[ "$RC" = 1 ] && ok "rc=1: o que esta no ar e outro commit" || falhou "rc=$RC nao percebeu commit diferente"

echo "== 6. carimbo /version.json servido pelo proprio deployment =="
echo vazio > "$D/cenario"
printf '{"commit":"%s"}' "$SHA" > "$D/www/version.json"
S=$(env -u VERCEL_TOKEN -u VERCEL_PROJECT_ID "$VB" --provar-deployment "$SHA" "$U" 2>&1); RC=$?
[ "$RC" = 0 ] && grep -q 'version.json' <<<"$S" && ok "carimbo do proprio deployment prova" || falhou "rc=$RC: $(tail -1 <<<"$S")"
printf '{"commit":"%s"}' "$OUTRO" > "$D/www/version.json"
S=$(env -u VERCEL_TOKEN -u VERCEL_PROJECT_ID "$VB" --provar-deployment "$SHA" "$U" 2>&1); RC=$?
[ "$RC" = 1 ] && ok "carimbo de OUTRO build reprova (o caso do rollback)" || falhou "rc=$RC aceitou carimbo divergente"
rm -f "$D/www/version.json"

echo "== 7. --pos-deploy: conteudo igual NAO basta =="
# baseline com sha impossivel -> o bundle "mudou"; achados dos dois lados sao zero, entao o
# contrato de CONTEUDO passa. Na v2.5 isso ja saia 0 e virava "Gate Vercel aprovado".
cat > "$D/baseline.txt" <<EOF
ts=2026-08-29T00:00:00-03:00
url=$U
asset=/assets/index-mock.js
bundle_sha=0000000000000000000000000000000000000000000000000000000000000000
achados=0
EOF
S=$(env -u VERCEL_TOKEN -u VERCEL_PROJECT_ID BUNDLE_ESPERA_SEG=1 BUNDLE_PASSO_SEG=1 \
      "$VB" --pos-deploy "$D/baseline.txt" "$U" 2>&1); RC=$?
[ "$RC" = 2 ] && ok "sem --commit: INDETERMINADO (rc=2), nao aprovado" || falhou "rc=$RC sem commit informado"
grep -q 'POS-DEPLOY APROVADO' <<<"$S" && falhou "escreveu APROVADO sem prova" || ok "nao escreve APROVADO sem prova"

S=$(env -u VERCEL_TOKEN -u VERCEL_PROJECT_ID BUNDLE_ESPERA_SEG=1 BUNDLE_PASSO_SEG=1 \
      "$VB" --pos-deploy "$D/baseline.txt" --commit "$SHA" "$U" 2>&1); RC=$?
[ "$RC" = 2 ] && ok "com --commit e sem fonte de prova: ainda INDETERMINADO" || falhou "rc=$RC"
grep -q 'conteudo aprovado' <<<"$S" && ok "separa os dois vereditos na saida" || falhou "nao separou conteudo de deployment"

echo ready_prod > "$D/cenario"
S=$(com_api env BUNDLE_ESPERA_SEG=1 BUNDLE_PASSO_SEG=1 "$VB" --pos-deploy "$D/baseline.txt" --commit "$SHA" "$U" 2>&1); RC=$?
[ "$RC" = 0 ] && grep -q 'POS-DEPLOY APROVADO' <<<"$S" && ok "conteudo + prova = APROVADO (rc=0)" || falhou "rc=$RC com prova disponivel: $(tail -1 <<<"$S")"

echo outro_commit > "$D/cenario"
S=$(com_api env BUNDLE_ESPERA_SEG=1 BUNDLE_PASSO_SEG=1 "$VB" --pos-deploy "$D/baseline.txt" --commit "$SHA" "$U" 2>&1); RC=$?
[ "$RC" = 1 ] && ok "conteudo ok + deployment de outro commit = REPROVADO" || falhou "rc=$RC com deployment alheio"

echo
echo "== $P passaram, $F falharam =="
[ "$F" -eq 0 ]
