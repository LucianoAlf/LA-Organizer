#!/bin/bash
# Testes do detector de segredo contra um bundle SINTETICO servido localmente.
# Nenhuma requisicao a producao; nenhum segredo real usado — os "segredos" aqui sao gerados
# na hora e obviamente falsos.
#
# Cobre o que o laudo v2.4 exigiu como negativo:
#   1. segredo SEM DIGITO            (a premissa falsa que a v2.4 usava para filtrar)
#   2. segredo com pontuacao !#%     (o bypass do alfabeto estreito)
#   3. segredo em TEMPLATE LITERAL   (crase, que nao era delimitador)
#   4. segredo em CHUNK LAZY         (so alcancavel seguindo referencia dentro do bundle)

set -uo pipefail
AQUI="$(dirname "$(readlink -f "$0")")"
D=$(mktemp -d /tmp/bundle-teste.XXXXXX)
# Porta LIVRE escolhida na hora, em vez de fixa: a porta fixa colidia com orfao da execucao
# anterior e, logo depois de matar o orfao, ficava em TIME_WAIT — o servidor nao subia e o
# teste acusava "bypass" que nao existia. Porta efemera elimina a classe inteira.
PORTA=${PORTA_MOCK_BUNDLE:-$(python3 -c "import socket;s=socket.socket();s.bind((\"127.0.0.1\",0));print(s.getsockname()[1]);s.close()")}
P=0; F=0
ok()    { P=$((P+1)); printf '  ok    %s\n' "$1"; }
falhou(){ F=$((F+1)); printf '  FALHA %s\n' "$1"; }
limpar(){ [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null; rm -rf "$D"; }
trap limpar EXIT INT TERM

mkdir -p "$D/www/assets"

# Segredos sinteticos, um por cenario. Todos com >= 40 chars e entropia alta.
S_SEM_DIGITO='QwErTyUiOpAsDfGhJkLzXcVbNmQwErTyUiOpAsDfGhJkLzXcVbNm'
S_PONTUACAO='Xk7!qZ#2mP%vB9nJ4wR8tL1yH6cF3dS5gA0eU!zQ#xM%oI7kV2pN9bT4jY8rW1sD6'
S_TEMPLATE='Tp9Lm2Qx7Vz4Bn6Kc1Rj8Wd3Hy5Ff0Gs2Nu4Aa7Ee9Ii1Oo3Uu5'
S_LAZY='Lz8Kq3Wm5Rt7Yn2Bv4Cx6Zd9Fg1Hj0Pl3Sk5Aa8Ee2Ii4Oo6Uu7'

# index referencia o chunk lazy SO por dentro do JS — quem le apenas o HTML nao o encontra.
{
  printf 'const a="%s";\n' "$S_SEM_DIGITO"
  printf 'const b="%s";\n' "$S_PONTUACAO"
  printf 'const c=`%s`;\n' "$S_TEMPLATE"
  printf 'const carregar=()=>import("./assets/lazy-Xk9.js");\n'
  for i in $(seq 1 9000); do echo "// enchimento para o bundle ter tamanho de app"; done
} > "$D/www/assets/index-mock.js"
{
  printf 'export const d="%s";\n' "$S_LAZY"
  for i in $(seq 1 200); do echo "// chunk lazy"; done
} > "$D/www/assets/lazy-Xk9.js"
printf '<html><script type="module" src="/assets/index-mock.js"></script></html>' > "$D/www/index.html"

# `exec` para que $! seja o PID do python, e nao o do subshell: sem isso o trap matava o
# subshell e deixava o servidor orfao. Na execucao seguinte, o servidor VELHO (servindo um
# diretorio ja apagado) atendia na porta e o teste media outro bundle — 5 falsos negativos
# que pareciam bypass do detector. Teste que nao percebe estar falando com o servidor errado
# nao esta testando nada.
( cd "$D/www" && exec python3 -m http.server "$PORTA" >/dev/null 2>&1 ) & SRV=$!
SUBIU=0
for _ in $(seq 1 20); do
  curl -s -o /dev/null -m 2 "http://127.0.0.1:$PORTA/" && { SUBIU=1; break; }
  kill -0 "$SRV" 2>/dev/null || break
  sleep 0.5
done
[ "$SUBIU" = 1 ] || { echo "  ABORTADO: o servidor de teste nao subiu na porta $PORTA"; exit 2; }
# confirma que quem responde e o NOSSO servidor, nao um vizinho
# Sem pipe para `head`: com `set -o pipefail`, o head fecha o cano, o curl morre de SIGPIPE e
# o status do PIPELINE inteiro fica != 0 mesmo com o grep casando. O teste abortava por um
# detalhe do proprio harness, nao por defeito do detector.
AMOSTRA=$(curl -s -m 3 "http://127.0.0.1:$PORTA/assets/index-mock.js" 2>/dev/null | head -c 60)
case "$AMOSTRA" in
  *'const a='*) : ;;
  *) echo "  ABORTADO: a porta $PORTA responde, mas nao com o bundle deste teste"; exit 2 ;;
esac

SAIDA=$("$AQUI/verificar-bundle.sh" "http://127.0.0.1:$PORTA" 2>&1)
RC=$?
echo "$SAIDA" | grep -E 'assets:|candidatos|achado\(s\)' | sed 's/^/  /'

# Cada segredo tem que aparecer como ACHADO, identificado pelo sha256.
verifica() { # <nome> <valor>
  local nome=$1 val=$2 h
  h=$(printf '%s' "$val" | sha256sum | cut -c1-12)
  if grep -q "$h" <<<"$SAIDA"; then ok "$nome detectado (sha $h)"
  else falhou "$nome NAO detectado (sha $h) — bypass aberto"; fi
}
verifica "segredo SEM DIGITO"        "$S_SEM_DIGITO"
verifica "segredo com pontuacao !#%" "$S_PONTUACAO"
verifica "segredo em TEMPLATE LITERAL" "$S_TEMPLATE"
verifica "segredo em CHUNK LAZY"     "$S_LAZY"

grep -q 'assets: 2 ' <<<"$SAIDA" && ok "varreu os 2 assets (index + chunk lazy)" \
  || falhou "nao varreu o chunk lazy: $(grep -o 'assets: [0-9]*' <<<"$SAIDA")"
[ "$RC" != 0 ] && ok "exit != 0 com segredo no bundle (rc=$RC)" || falhou "aprovou bundle com segredo"

# Nenhum valor pode ter vazado no relatorio.
VAZOU=0
for v in "$S_SEM_DIGITO" "$S_PONTUACAO" "$S_TEMPLATE" "$S_LAZY"; do
  grep -qF "$v" <<<"$SAIDA" && VAZOU=$((VAZOU+1))
done
[ "$VAZOU" = 0 ] && ok "nenhum valor impresso no relatorio" || falhou "$VAZOU valor(es) vazaram na saida"

echo
echo "== $P passaram, $F falharam =="
[ "$F" -eq 0 ]
