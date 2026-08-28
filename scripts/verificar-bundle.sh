#!/bin/bash
# P0-4 v2.4 — Detector de segredo no bundle público. SÓ LÊ. NUNCA imprime valor.
#
# CORREÇÃO (bloqueador #7): a v2.3 procurava só o nome `x-internal-secret`. Renomear o
# header — ou embutir outro segredo por outro caminho — passaria batido. O teste media o
# SINTOMA que eu conhecia, não a CLASSE do problema.
#
# Desenho: extrai todos os literais de string longos e de alta entropia do bundle e
# compara contra uma ALLOWLIST POR SHA-256. Assim:
#   * um segredo novo, com nome novo, é pego — porque o que dispara é a forma do literal,
#     não o rótulo ao lado dele;
#   * nada é impresso: o relatório mostra tamanho, entropia e os 12 primeiros hex do
#     sha256. Para classificar um achado, compara-se o hash — nunca o valor;
#   * a allowlist é explícita e versionada, então "aceitar" um literal é uma decisão
#     registrada, não um efeito colateral.
#
# ALLOWLIST (arquivo, uma linha `sha256  # motivo`): por padrão
# ./bundle-allowlist.txt ao lado do script. Vazia = tudo que aparecer é achado.
#
# A anon key do Supabase é pública POR DESENHO e deve ser allowlistada explicitamente —
# com a ressalva de que ela só é inofensiva enquanto a RLS estiver correta (é o P0-1a).
#
# Uso: ./verificar-bundle.sh [url]                     (default: producao)
#      ./verificar-bundle.sh --baseline <arq> [url]    grava o estado ANTES do deploy
#      ./verificar-bundle.sh --pos-deploy <arq> [url]  espera o deploy e COMPARA com o estado
#
# MODO PÓS-DEPLOY (laudo v2, bloqueador 6). Dizer "fonte e lockfile iguais, logo o bundle sai
# igual" é provável, não provado — e "provavelmente" não é veredito de segurança. O modo
# --pos-deploy fecha isso empiricamente:
#   1. --baseline grava, ANTES do push: nome do asset, sha256 do bundle e o CONJUNTO de
#      hashes dos achados não-allowlistados (hoje: exatamente 1, o P0-4 conhecido);
#   2. --pos-deploy fica reconsultando a URL até o bundle mudar ou estourar o tempo;
#   3. compara os conjuntos. Aprova só se os achados forem EXATAMENTE os do baseline.
#      Achado novo reprova. Achado que sumiu é reportado (é notícia boa, mas é mudança).
# Se o bundle não mudar dentro da janela, isso não é falha: é a prova de que o rebuild de
# fonte inalterada produziu byte idêntico. O relatório diz qual dos dois aconteceu.
#
# Saída: exit 0 se todo literal encontrado estiver na allowlist; 1 caso contrário.
# No modo --pos-deploy: exit 0 se o conjunto de achados for idêntico ao baseline.

set -uo pipefail
MODO=normal; ESTADO=""
case "${1:-}" in
  --baseline)   MODO=baseline;   ESTADO=${2:?uso: --baseline <arquivo> [url]}; shift 2 ;;
  --pos-deploy) MODO=pos_deploy; ESTADO=${2:?uso: --pos-deploy <arquivo> [url]}; shift 2 ;;
esac
URL=${1:-https://la-organizer.vercel.app}
ALLOW="$(dirname "$(readlink -f "$0")")/bundle-allowlist.txt"
MIN_LEN=40

command -v curl >/dev/null || { echo "curl ausente"; exit 3; }
TMPD=$(mktemp -d /run/tom-bundle.XXXXXX 2>/dev/null || mktemp -d) || { echo "mktemp falhou"; exit 3; }
chmod 0700 "$TMPD"; trap 'rm -rf "$TMPD"' EXIT INT TERM

echo "== $URL =="
# Baixar virou funcao porque o modo --pos-deploy precisa reconsultar ate o bundle mudar.
baixar() {
  local html
  html=$(curl -sL -m 20 "$URL") || { echo "FALHA: nao consegui baixar a pagina"; return 1; }
  ASSET=$(grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' <<<"$html" | head -1)
  [ -n "$ASSET" ] || { echo "FALHA: a pagina nao referencia bundle"; return 1; }
  curl -sL -m 90 "${URL%/}$ASSET" -o "$TMPD/bundle.js" || { echo "FALHA: bundle nao baixou"; return 1; }
  BUNDLE_SHA=$(sha256sum "$TMPD/bundle.js" | cut -d' ' -f1)
  BUNDLE_BYTES=$(stat -c%s "$TMPD/bundle.js")
  return 0
}
baixar || exit 1

# --pos-deploy: espera o rebuild da Vercel chegar. Se o bundle NAO mudar dentro da janela,
# isso nao e erro — e a prova empirica de que o rebuild de fonte inalterada saiu identico.
# O relatorio distingue os dois casos em vez de assumir qualquer um deles.
if [ "$MODO" = pos_deploy ]; then
  [ -r "$ESTADO" ] || { echo "FALHA: baseline $ESTADO ilegivel — rode --baseline ANTES do push"; exit 3; }
  SHA_BASE=$(sed -n 's/^bundle_sha=//p' "$ESTADO" | head -1)
  ASSET_BASE=$(sed -n 's/^asset=//p' "$ESTADO" | head -1)
  ESPERA=${BUNDLE_ESPERA_SEG:-600}; PASSO=${BUNDLE_PASSO_SEG:-30}; T=0
  echo "aguardando rebuild (ate ${ESPERA}s): baseline asset=$ASSET_BASE sha=${SHA_BASE:0:12}…"
  while [ "$BUNDLE_SHA" = "$SHA_BASE" ] && [ "$T" -lt "$ESPERA" ]; do
    sleep "$PASSO"; T=$((T+PASSO))
    baixar || { echo "FALHA: perdi a URL durante a espera"; exit 1; }
  done
  if [ "$BUNDLE_SHA" = "$SHA_BASE" ]; then
    MUDOU=nao
    echo "bundle INALTERADO apos ${T}s — rebuild de fonte inalterada saiu byte identico (esperado)"
  else
    MUDOU=sim
    echo "bundle MUDOU apos ${T}s: asset $ASSET_BASE -> $ASSET"
  fi
fi

echo "bundle: $ASSET ($BUNDLE_BYTES bytes, sha256=${BUNDLE_SHA:0:12}…)"

# Entropia de Shannon por caractere. Segredo real fica acima de ~3.5; texto/ids repetitivos ficam abaixo.
entropia() {
  awk '{
    n=length($0); if(n==0){print 0; next}
    delete f; for(i=1;i<=n;i++){c=substr($0,i,1); f[c]++}
    e=0; for(c in f){p=f[c]/n; e-=p*log(p)/log(2)}
    printf "%.2f\n", e
  }' <<<"$1"
}

# Literais entre aspas simples ou duplas, alfabeto base64url + ponto (pega JWT tambem).
grep -oE "[\"'][A-Za-z0-9_./+=-]{$MIN_LEN,400}[\"']" "$TMPD/bundle.js" \
  | sed -E "s/^[\"']//; s/[\"']$//" | LC_ALL=C sort -u > "$TMPD/lit.txt"

TOTAL=$(wc -l < "$TMPD/lit.txt")
echo "literais candidatos (>= $MIN_LEN chars): $TOTAL"

[ -r "$ALLOW" ] || { echo "AVISO: allowlist ausente em $ALLOW — todo literal sera reportado"; : > "$TMPD/allow"; }
[ -r "$ALLOW" ] && grep -oE '^[a-f0-9]{64}' "$ALLOW" > "$TMPD/allow" 2>/dev/null || true

ACHADOS=0; PERMITIDOS=0; IGNORADOS=0
while IFS= read -r lit; do
  [ -n "$lit" ] || continue
  # ruido conhecido: caminhos, mime types, base64 de fonte/imagem, sourcemap
  case "$lit" in
    */*|*.js|*.css|*.woff*|*.png|*.svg|data:*|http*) IGNORADOS=$((IGNORADOS+1)); continue ;;
  esac
  ENT=$(entropia "$lit")
  # abaixo de 3.5 bits/char nao tem cara de segredo (texto, enum, id sequencial)
  awk -v e="$ENT" 'BEGIN{exit !(e<3.5)}' && { IGNORADOS=$((IGNORADOS+1)); continue; }
  H=$(printf '%s' "$lit" | sha256sum | cut -d' ' -f1)
  if grep -qx "$H" "$TMPD/allow" 2>/dev/null; then
    PERMITIDOS=$((PERMITIDOS+1))
    printf '  ok         len=%-4s entropia=%s sha256=%s… (na allowlist)\n' "${#lit}" "$ENT" "${H:0:12}"
  else
    ACHADOS=$((ACHADOS+1))
    echo "$H" >> "$TMPD/achados.txt"
    printf '  ACHADO     len=%-4s entropia=%s sha256=%s… <- literal de alta entropia NAO allowlistado\n' "${#lit}" "$ENT" "${H:0:12}"
  fi
done < "$TMPD/lit.txt"
touch "$TMPD/achados.txt"; LC_ALL=C sort -u -o "$TMPD/achados.txt" "$TMPD/achados.txt"

echo "-- referencias a headers de autenticacao no bundle (informativo) --"
for h in x-internal-secret authorization apikey x-api-key; do
  N=$(grep -o "$h" "$TMPD/bundle.js" | wc -l)
  [ "$N" -gt 0 ] && echo "  $h: $N referencia(s)"
done

echo "== $ACHADOS achado(s), $PERMITIDOS permitido(s), $IGNORADOS ignorado(s) por ruido/entropia =="

# --baseline: congela o estado ANTES do push, para o pos-deploy ter contra o que comparar.
if [ "$MODO" = baseline ]; then
  {
    echo "ts=$(date -Iseconds)"
    echo "url=$URL"
    echo "asset=$ASSET"
    echo "bundle_sha=$BUNDLE_SHA"
    echo "achados=$ACHADOS"
    sed 's/^/achado=/' "$TMPD/achados.txt"
  } > "$ESTADO" 2>/dev/null
  grep -q '^bundle_sha=' "$ESTADO" 2>/dev/null || { echo "FALHA: nao consegui gravar o baseline em $ESTADO"; exit 3; }
  chmod 0600 "$ESTADO" 2>/dev/null
  echo "== baseline gravado em $ESTADO ($ACHADOS achado(s) conhecido(s)) =="
  exit 0
fi

# --pos-deploy: o veredito NAO e "zero achados" (o P0-4 segue aberto, e sabemos disso).
# O veredito e "exatamente os achados que ja conheciamos, nenhum novo".
if [ "$MODO" = pos_deploy ]; then
  sed -n 's/^achado=//p' "$ESTADO" | LC_ALL=C sort -u > "$TMPD/base-achados.txt"
  NOVOS=$(LC_ALL=C comm -13 "$TMPD/base-achados.txt" "$TMPD/achados.txt" | grep -c . || true)
  SUMIRAM=$(LC_ALL=C comm -23 "$TMPD/base-achados.txt" "$TMPD/achados.txt" | grep -c . || true)
  echo "-- comparacao com o baseline --"
  echo "   bundle mudou: $MUDOU"
  echo "   achados no baseline: $(grep -c . "$TMPD/base-achados.txt" || echo 0)   agora: $ACHADOS"
  [ "$SUMIRAM" -gt 0 ] && { echo "   $SUMIRAM achado(s) DESAPARECERAM (mudanca — confirme se foi intencional):";
                            LC_ALL=C comm -23 "$TMPD/base-achados.txt" "$TMPD/achados.txt" | sed 's/^/     sumiu  /' | cut -c1-26; }
  if [ "$NOVOS" -gt 0 ]; then
    echo "   $NOVOS achado(s) NOVO(S) — literal de alta entropia que nao existia antes:"
    LC_ALL=C comm -13 "$TMPD/base-achados.txt" "$TMPD/achados.txt" | sed 's/^/     NOVO   /' | cut -c1-26
    echo "== POS-DEPLOY REPROVADO: o deploy introduziu literal novo no bundle publico =="
    exit 1
  fi
  echo "== POS-DEPLOY APROVADO: exatamente os achados conhecidos, nenhum novo =="
  echo "   (o P0-4 continua ABERTO — este teste prova que o deploy nao PIOROU, nao que esta resolvido)"
  exit 0
fi

if [ "$ACHADOS" -gt 0 ]; then
  echo "   Para classificar um achado SEM expor o valor: confira o sha256 contra a origem"
  echo "   (ex.: printf %s \"\$VALOR\" | sha256sum) e, se for publico por desenho, adicione"
  echo "   o hash em $ALLOW com o motivo escrito."
  exit 1
fi
exit 0
