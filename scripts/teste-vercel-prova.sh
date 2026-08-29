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
SITE=""; SITE2=""; API=""
limpar(){ for pid in "$SITE" "$SITE2" "$API"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null; done; rm -rf "$D"; }
trap limpar EXIT INT TERM
porta_livre(){ python3 -c "import socket;s=socket.socket();s.bind(('127.0.0.1',0));print(s.getsockname()[1]);s.close()"; }

# FIXTURES DERIVADAS, nao constantes (laudo v2.6, bloqueador 10). Escritas a mao, eram dois
# literais de 40 hex -- e o scanner de secrets do proprio pacote as reportava como "hex longo
# solto". Estava certo em reportar: pela FORMA sao indistinguiveis de um segredo. A saida
# nao e abrir excecao no scanner (allowlist ampla enfraquece o gate para todo mundo); e nao
# ter o literal. Derivadas de uma frase legivel, continuam sendo sha validos de 40 hex.
SHA=$(printf %s "fixture-commit-do-teste-A" | sha1sum | cut -c1-40)
OUTRO=$(printf %s "fixture-commit-do-teste-B" | sha1sum | cut -c1-40)

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
PORTA_SITE = sys.argv[3]
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        c = open(CEN).read().strip()
        if not self.headers.get('Authorization', '').startswith('Bearer '):
            self.send_response(401); b = b'{}'
        else:
            sha = open(CEN + '.sha').read().strip()
            outro = "0" * 40
            url_ok = "127.0.0.1:%s" % PORTA_SITE            # serve o MESMO bundle da URL publica
            url_outro = "127.0.0.1:%s" % sys.argv[4]        # serve um bundle DIFERENTE
            if c == 'atual_ready':
                deps = [{"uid": "dpl_novo", "readyState": "READY", "target": "production",
                         "createdAt": 200, "url": url_ok, "meta": {"githubCommitSha": sha}}]
            elif c == 'historico':
                # o commit pedido TEM deployment READY em production... mas producao foi
                # revertida para outro commit, que e o mais recente.
                deps = [{"uid": "dpl_velho", "readyState": "READY", "target": "production",
                         "createdAt": 100, "url": url_ok, "meta": {"githubCommitSha": sha}},
                        {"uid": "dpl_rollback", "readyState": "READY", "target": "production",
                         "createdAt": 300, "url": url_outro, "meta": {"githubCommitSha": outro}}]
            elif c == 'alias_outro':
                # producao atual e o commit pedido, READY -- mas o alias publico serve outro build
                deps = [{"uid": "dpl_x", "readyState": "READY", "target": "production",
                         "createdAt": 200, "url": url_outro, "meta": {"githubCommitSha": sha}}]
            elif c == 'sem_url':
                deps = [{"uid": "dpl_sem", "readyState": "READY", "target": "production",
                         "createdAt": 200, "meta": {"githubCommitSha": sha}}]
            elif c == 'building':
                deps = [{"uid": "dpl_bld", "readyState": "BUILDING", "target": "production",
                         "createdAt": 200, "url": url_ok, "meta": {"githubCommitSha": sha}}]
            elif c == 'so_preview':
                deps = [{"uid": "dpl_prev", "readyState": "READY", "target": "preview",
                         "createdAt": 200, "url": url_ok, "meta": {"githubCommitSha": sha}}]
            else:
                deps = []
            self.send_response(200); b = json.dumps({"deployments": deps}).encode()
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[2])), H).serve_forever()
PY
echo vazio > "$D/cenario"; echo "$SHA" > "$D/cenario.sha"

# segundo site: mesmo formato, conteudo DIFERENTE. E o "outro build" para o qual o alias
# pode estar apontando depois de um rollback.
mkdir -p "$D/www2/assets"
{ printf 'const app="OUTRO BUILD";
'
  for i in $(seq 1 9000); do echo "// enchimento do outro build"; done
} > "$D/www2/assets/index-outro.js"
printf '<html><script type="module" src="/assets/index-outro.js"></script></html>' > "$D/www2/index.html"
PS2=$(porta_livre); ( cd "$D/www2" && exec python3 -m http.server "$PS2" >/dev/null 2>&1 ) & SITE2=$!
PS=$(porta_livre); ( cd "$D/www" && exec python3 -m http.server "$PS" >/dev/null 2>&1 ) & SITE=$!
PA=$(porta_livre); ( exec python3 "$D/api.py" "$D/cenario" "$PA" "$PS" "$PS2" >/dev/null 2>&1 ) & API=$!
for _ in $(seq 1 20); do curl -s -o /dev/null -m 2 "http://127.0.0.1:$PS/" && break; sleep 0.5; done
for _ in $(seq 1 20); do curl -s -o /dev/null -m 2 "http://127.0.0.1:$PS2/" && break; sleep 0.5; done
for _ in $(seq 1 20); do curl -s -o /dev/null -m 2 "http://127.0.0.1:$PA/v6/deployments" && break; sleep 0.5; done
U="http://127.0.0.1:$PS"
com_api(){ VERCEL_API_BASE="http://127.0.0.1:$PA" VERCEL_DEP_ESQUEMA=http VERCEL_TOKEN=fake-token VERCEL_PROJECT_ID=prj_teste "$@"; }

echo "== 1. sem fonte de prova: INDETERMINADO, nunca aprovado =="
S=$(env -u VERCEL_TOKEN -u VERCEL_PROJECT_ID "$VB" --provar-deployment "$SHA" "$U" 2>&1); RC=$?
[ "$RC" = 2 ] && ok "rc=2 (indeterminado)" || falhou "rc=$RC, esperado 2"
grep -q 'INDETERMINADO' <<<"$S" && ok "diz INDETERMINADO" || falhou "nao disse indeterminado: $S"
grep -q 'PROVADO:' <<<"$S" && falhou "afirmou prova sem fonte" || ok "nao afirma prova nenhuma"
grep -qi 'VERCEL_TOKEN' <<<"$S" && ok "diz o que falta para provar" || falhou "nao diz o que falta"

echo "== 2. API da Vercel: READY em production prova =="
echo atual_ready > "$D/cenario"
S=$(com_api "$VB" --provar-deployment "$SHA" "$U" 2>&1); RC=$?
[ "$RC" = 0 ] && grep -q 'DEPLOYMENT PROVADO' <<<"$S" && ok "rc=0 e PROVADO" || falhou "rc=$RC: $(head -2 <<<"$S" | tail -1)"

echo "== 3. READY mas em PREVIEW nao prova producao =="
echo so_preview > "$D/cenario"
S=$(com_api "$VB" --provar-deployment "$SHA" "$U" 2>&1); RC=$?
[ "$RC" = 1 ] && ok "rc=1 (contradiz): preview nao e producao" || falhou "rc=$RC aceitou preview como producao"

echo "== 4. deployment do commit existe mas esta BUILDING =="
echo building > "$D/cenario"
S=$(com_api "$VB" --provar-deployment "$SHA" "$U" 2>&1); RC=$?
[ "$RC" = 1 ] && ok "rc=1: existe mas nao esta READY" || falhou "rc=$RC aprovou build em andamento"

echo "== 5. producao READY, mas de OUTRO commit =="
echo historico > "$D/cenario"
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

echo "== BLOQUEADOR 7: deployment HISTORICO READY nao prova o que esta servido =="
# commit A tem deployment READY em production (createdAt 100); producao foi revertida para
# B (createdAt 300). A v2.6 aceitava o de A e dizia PROVADO.
echo historico > "$D/cenario"
S=$(com_api "$VB" --provar-deployment "$SHA" "$U" 2>&1); RC=$?
[ "$RC" = 1 ] && ok "deployment historico do commit NAO prova (rc=1)" || falhou "rc=$RC aceitou deployment historico"
grep -q "PROVADO" <<<"$S" && falhou "escreveu PROVADO com producao revertida" || ok "nao afirma prova apos rollback"

echo "== producao atual e o commit, e o alias serve o MESMO bundle =="
echo atual_ready > "$D/cenario"
S=$(com_api "$VB" --provar-deployment "$SHA" "$U" 2>&1); RC=$?
if [ "$RC" = 0 ] && grep -q "MESMO conjunto" <<<"$S"; then ok "prova amarrada ao conteudo servido (rc=0)"; else falhou "rc=$RC: $(tail -1 <<<"$S")"; fi

echo "== producao atual e o commit, mas o ALIAS serve outro build =="
echo alias_outro > "$D/cenario"
S=$(com_api "$VB" --provar-deployment "$SHA" "$U" 2>&1); RC=$?
[ "$RC" = 1 ] && ok "READY do commit + alias apontando para outro build REPROVA (rc=1)" || falhou "rc=$RC"
grep -q "OUTRO conjunto" <<<"$S" && ok "diz que a URL publica serve outro conjunto" || falhou "sem o motivo"

echo "== API sem a URL do deployment: INDETERMINADO, nao aprovado =="
echo sem_url > "$D/cenario"
S=$(com_api "$VB" --provar-deployment "$SHA" "$U" 2>&1); RC=$?
[ "$RC" = 2 ] && ok "sem URL para conferir o servido -> indeterminado (rc=2)" || falhou "rc=$RC sem URL"

echo "== 7. --pos-deploy: conteudo igual NAO basta =="
# baseline com sha impossivel -> o bundle "mudou"; achados dos dois lados sao zero, entao o
# contrato de CONTEUDO passa. Na v2.5 isso ja saia 0 e virava "Gate Vercel aprovado".
# sha impossivel CONSTRUIDO: forca "o bundle mudou" sem escrever constante hex longa.
ZEROS64=$(printf '0%.0s' $(seq 1 64))
cat > "$D/baseline.txt" <<EOF
ts=2026-08-29T00:00:00-03:00
url=$U
asset=/assets/index-mock.js
bundle_sha=$ZEROS64
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

echo atual_ready > "$D/cenario"
S=$(com_api env BUNDLE_ESPERA_SEG=1 BUNDLE_PASSO_SEG=1 "$VB" --pos-deploy "$D/baseline.txt" --commit "$SHA" "$U" 2>&1); RC=$?
[ "$RC" = 0 ] && grep -q 'POS-DEPLOY APROVADO' <<<"$S" && ok "conteudo + prova = APROVADO (rc=0)" || falhou "rc=$RC com prova disponivel: $(tail -1 <<<"$S")"

echo historico > "$D/cenario"
S=$(com_api env BUNDLE_ESPERA_SEG=1 BUNDLE_PASSO_SEG=1 "$VB" --pos-deploy "$D/baseline.txt" --commit "$SHA" "$U" 2>&1); RC=$?
[ "$RC" = 1 ] && ok "conteudo ok + deployment de outro commit = REPROVADO" || falhou "rc=$RC com deployment alheio"

echo
echo "== $P passaram, $F falharam =="
[ "$F" -eq 0 ]
