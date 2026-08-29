#!/bin/bash
# Testes do detector de segredo contra bundles SINTETICOS servidos localmente.
# Nenhuma requisicao a producao; nenhum segredo real -- os "segredos" sao gerados na hora.
#
# Cobre o laudo v2.4 (formato do segredo):
#   1. sem DIGITO   2. pontuacao !#%   3. template literal (crase)   4. chunk lazy
# E o laudo v2.5, bloqueador 3 (ALCANCE do caminhamento):
#   5. SIBLING `./chunk.js` -- sem `assets/` no caminho, que era o que a regex exigia;
#   6. cadeia de QUATRO niveis com o segredo so no ultimo (a v2.5 parava em 3 rodadas);
#   7. referencia root-relative `assets/x.js` (formato do mapa de preload do Vite);
#   8. referencia JS que NAO resolve -> reprova (nao da para dizer nada sobre o que nao leu);
#   9. limite atingido -> FALHA declarada, nunca parada silenciosa.

set -uo pipefail
AQUI="$(dirname "$(readlink -f "$0")")"
D=$(mktemp -d "${TMPDIR:-/tmp}/bundle-teste.XXXXXX")
P=0; F=0
ok()    { P=$((P+1)); printf '  ok    %s\n' "$1"; }
falhou(){ F=$((F+1)); printf '  FALHA %s\n' "$1"; }
SRV=""; SRV2=""
limpar(){ [ -n "$SRV" ] && kill "$SRV" 2>/dev/null; [ -n "$SRV2" ] && kill "$SRV2" 2>/dev/null; rm -rf "$D"; }
trap limpar EXIT INT TERM
porta_livre(){ python3 -c "import socket;s=socket.socket();s.bind(('127.0.0.1',0));print(s.getsockname()[1]);s.close()"; }

# --- segredos sinteticos, um por cenario ---------------------------------------------------
S_SEM_DIGITO='QwErTyUiOpAsDfGhJkLzXcVbNmQwErTyUiOpAsDfGhJkLzXcVbNm'
S_PONTUACAO='Xk7!qZ#2mP%vB9nJ4wR8tL1yH6cF3dS5gA0eU!zQ#xM%oI7kV2pN9bT4jY8rW1sD6'
S_TEMPLATE='Tp9Lm2Qx7Vz4Bn6Kc1Rj8Wd3Hy5Ff0Gs2Nu4Aa7Ee9Ii1Oo3Uu5'
S_LAZY='Lz8Kq3Wm5Rt7Yn2Bv4Cx6Zd9Fg1Hj0Pl3Sk5Aa8Ee2Ii4Oo6Uu7'
S_SIBLING='Sb4Nv7Mq2Xr9Tk5Wz1Cd8Hj3Fy6Gp0Lu4Aa9Ee3Ii7Oo1Uu6Zz2'
S_NIVEL4='N4d7Rk2Vp9Xm4Bt6Jq1Cw8Hz3Fs5Gy0Lv7Aa2Ee8Ii5Oo9Uu3Kk1'
S_ROOTREL='Rr6Tv3Yb8Nm1Qx5Zk9Wd2Hp7Fj4Gc0Ls8Aa6Ee1Ii9Oo4Uu2Vv7'

mkdir -p "$D/www/assets"
W="$D/www/assets"
# index: sibling SEM `assets/` (o formato real do Vite), root-relative, e lazy classico
{
  printf 'const a="%s";\n' "$S_SEM_DIGITO"
  printf 'const b="%s";\n' "$S_PONTUACAO"
  printf 'const c=`%s`;\n' "$S_TEMPLATE"
  printf 'const l=()=>import("./lazy-Xk9.js");\n'
  printf 'const s=()=>import("./sibling-Aa1.js");\n'
  printf 'const mapa={"pagina":"assets/rootrel-Bb2.js"};\n'
  for i in $(seq 1 9000); do echo "// enchimento para o bundle ter tamanho de app"; done
} > "$W/index-mock.js"
printf 'export const d="%s";\n' "$S_LAZY"    > "$W/lazy-Xk9.js"
# CADEIA DE 4 NIVEIS: index(1) -> sibling(2) -> n3(3) -> n4(4). Segredo SO no ultimo.
{ printf 'export const e="%s";\n' "$S_SIBLING"
  printf 'const p=()=>import("./nivel3-Cc3.js");\n'; } > "$W/sibling-Aa1.js"
printf 'const q=()=>import("./nivel4-Dd4.js");\nexport const x=1;\n' > "$W/nivel3-Cc3.js"
printf 'export const segredo="%s";\n' "$S_NIVEL4" > "$W/nivel4-Dd4.js"
printf 'export const r="%s";\n' "$S_ROOTREL"      > "$W/rootrel-Bb2.js"
printf '<html><script type="module" src="/assets/index-mock.js"></script></html>' > "$D/www/index.html"

# bundle IRMAO com uma referencia que nao resolve
cp -r "$D/www" "$D/www-quebrado"
printf 'const z=()=>import("./nao-existe-Zz9.js");\n' >> "$D/www-quebrado/assets/index-mock.js"

subir(){ # <diretorio> <porta> -> imprime pid
  ( cd "$1" && exec python3 -m http.server "$2" >/dev/null 2>&1 ) &
  echo $!
}
esperar(){ # <porta> <pid>
  for _ in $(seq 1 20); do
    curl -s -o /dev/null -m 2 "http://127.0.0.1:$1/" && return 0
    kill -0 "$2" 2>/dev/null || return 1
    sleep 0.5
  done; return 1
}
PORTA=$(porta_livre);  SRV=$(subir "$D/www" "$PORTA")
PORTA2=$(porta_livre); SRV2=$(subir "$D/www-quebrado" "$PORTA2")
esperar "$PORTA" "$SRV"   || { echo "  ABORTADO: servidor 1 nao subiu"; exit 2; }
esperar "$PORTA2" "$SRV2" || { echo "  ABORTADO: servidor 2 nao subiu"; exit 2; }
# confirma que quem responde e o NOSSO servidor, nao um vizinho. Sem pipe para `head`: com
# `set -o pipefail` o head fecha o cano, o curl morre de SIGPIPE e o pipeline sai != 0.
AMOSTRA=$(curl -s -m 3 "http://127.0.0.1:$PORTA/assets/index-mock.js" 2>/dev/null | head -c 60)
case "$AMOSTRA" in *'const a='*) : ;;
  *) echo "  ABORTADO: a porta $PORTA responde, mas nao com o bundle deste teste"; exit 2 ;; esac

SAIDA=$("$AQUI/verificar-bundle.sh" "http://127.0.0.1:$PORTA" 2>&1)
RC=$?
echo "$SAIDA" | grep -E 'assets:|candidatos|achado\(s\)' | sed 's/^/  /'

verifica() { # <nome> <valor>
  local nome=$1 val=$2 h
  h=$(printf '%s' "$val" | sha256sum | cut -c1-12)
  if grep -q "$h" <<<"$SAIDA"; then ok "$nome detectado (sha $h)"
  else falhou "$nome NAO detectado (sha $h) -- bypass aberto"; fi
}
verifica "segredo SEM DIGITO"          "$S_SEM_DIGITO"
verifica "segredo com pontuacao !#%"   "$S_PONTUACAO"
verifica "segredo em TEMPLATE LITERAL" "$S_TEMPLATE"
verifica "segredo em CHUNK LAZY"       "$S_LAZY"
verifica "segredo em SIBLING ./x.js"   "$S_SIBLING"
verifica "segredo no NIVEL 4 da cadeia" "$S_NIVEL4"
verifica "segredo em ref root-relative" "$S_ROOTREL"

grep -q 'assets: 6 ' <<<"$SAIDA" && ok "varreu os 6 assets ate o ponto fixo" \
  || falhou "nao chegou ao ponto fixo: $(grep -o 'assets: [0-9]*' <<<"$SAIDA")"
grep -qE 'em [0-9]+ rodada' <<<"$SAIDA" && ok "relatorio diz em quantas rodadas fechou" \
  || falhou "relatorio nao informa as rodadas"
[ "$RC" != 0 ] && ok "exit != 0 com segredo no bundle (rc=$RC)" || falhou "aprovou bundle com segredo"

VAZOU=0
for v in "$S_SEM_DIGITO" "$S_PONTUACAO" "$S_TEMPLATE" "$S_LAZY" "$S_SIBLING" "$S_NIVEL4" "$S_ROOTREL"; do
  grep -qF "$v" <<<"$SAIDA" && VAZOU=$((VAZOU+1))
done
[ "$VAZOU" = 0 ] && ok "nenhum valor impresso no relatorio" || falhou "$VAZOU valor(es) vazaram na saida"

echo "== referencia JS que nao resolve REPROVA =="
S2=$("$AQUI/verificar-bundle.sh" "http://127.0.0.1:$PORTA2" 2>&1); RC2=$?
if [ "$RC2" != 0 ] && grep -q 'NAO resolvem' <<<"$S2"; then
  ok "404 em referencia citada pelo bundle reprova (rc=$RC2)"
else
  falhou "referencia quebrada passou (rc=$RC2): $(grep -m1 'assets:' <<<"$S2")"
fi
grep -q 'nao-existe-Zz9' <<<"$S2" && ok "o relatorio nomeia a referencia que faltou" \
  || falhou "nao disse QUAL referencia nao resolveu"

echo "== limite atingido e FALHA declarada, nunca parada silenciosa =="
# Com 2 rodadas a cadeia de 4 niveis nao fecha. A v2.5 simplesmente parava e seguia para o
# veredito -- o segredo do nivel 4 saia como "nenhum achado". Agora tem que reprovar dizendo.
S3=$(BUNDLE_MAX_RODADAS=2 "$AQUI/verificar-bundle.sh" "http://127.0.0.1:$PORTA" 2>&1); RC3=$?
if [ "$RC3" != 0 ] && grep -q 'limite de 2 rodadas' <<<"$S3"; then
  ok "para no limite REPROVANDO e dizendo quantas ficaram na fila"
else
  falhou "limite de rodadas nao virou falha declarada (rc=$RC3)"
fi
S4=$(BUNDLE_MAX_ASSETS=3 "$AQUI/verificar-bundle.sh" "http://127.0.0.1:$PORTA" 2>&1); RC4=$?
if [ "$RC4" != 0 ] && grep -q 'mais de 3 assets' <<<"$S4"; then
  ok "limite de assets tambem reprova declarando"
else
  falhou "limite de assets nao virou falha declarada (rc=$RC4)"
fi

echo
echo "== $P passaram, $F falharam =="
[ "$F" -eq 0 ]
