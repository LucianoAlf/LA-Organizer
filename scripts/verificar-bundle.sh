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
# Uso: ./verificar-bundle.sh [url]        (default: producao)
# Saída: exit 0 se todo literal encontrado estiver na allowlist; 1 caso contrário.

set -uo pipefail
URL=${1:-https://la-organizer.vercel.app}
ALLOW="$(dirname "$(readlink -f "$0")")/bundle-allowlist.txt"
MIN_LEN=40

command -v curl >/dev/null || { echo "curl ausente"; exit 3; }
TMPD=$(mktemp -d /run/tom-bundle.XXXXXX 2>/dev/null || mktemp -d) || { echo "mktemp falhou"; exit 3; }
chmod 0700 "$TMPD"; trap 'rm -rf "$TMPD"' EXIT INT TERM

echo "== $URL =="
HTML=$(curl -sL -m 20 "$URL") || { echo "FALHA: nao consegui baixar a pagina"; exit 1; }
ASSET=$(grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' <<<"$HTML" | head -1)
[ -n "$ASSET" ] || { echo "FALHA: a pagina nao referencia bundle"; exit 1; }
curl -sL -m 90 "${URL%/}$ASSET" -o "$TMPD/bundle.js" || { echo "FALHA: bundle nao baixou"; exit 1; }
echo "bundle: $ASSET ($(stat -c%s "$TMPD/bundle.js") bytes)"

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
    printf '  ACHADO     len=%-4s entropia=%s sha256=%s… <- literal de alta entropia NAO allowlistado\n' "${#lit}" "$ENT" "${H:0:12}"
  fi
done < "$TMPD/lit.txt"

echo "-- referencias a headers de autenticacao no bundle (informativo) --"
for h in x-internal-secret authorization apikey x-api-key; do
  N=$(grep -o "$h" "$TMPD/bundle.js" | wc -l)
  [ "$N" -gt 0 ] && echo "  $h: $N referencia(s)"
done

echo "== $ACHADOS achado(s), $PERMITIDOS permitido(s), $IGNORADOS ignorado(s) por ruido/entropia =="
if [ "$ACHADOS" -gt 0 ]; then
  echo "   Para classificar um achado SEM expor o valor: confira o sha256 contra a origem"
  echo "   (ex.: printf %s \"\$VALOR\" | sha256sum) e, se for publico por desenho, adicione"
  echo "   o hash em $ALLOW com o motivo escrito."
  exit 1
fi
exit 0
