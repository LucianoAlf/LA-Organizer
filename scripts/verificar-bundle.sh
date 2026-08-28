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
MODO=normal; ESTADO=""; ACEITA_INALTERADO=0
case "${1:-}" in
  --baseline)   MODO=baseline;   ESTADO=${2:?uso: --baseline <arquivo> [url]}; shift 2 ;;
  --pos-deploy) MODO=pos_deploy; ESTADO=${2:?uso: --pos-deploy <arquivo> [url]}; shift 2 ;;
esac
if [ "${1:-}" = "--aceitar-inalterado" ]; then ACEITA_INALTERADO=1; shift; fi
URL=${1:-https://la-organizer.vercel.app}
ALLOW="$(dirname "$(readlink -f "$0")")/bundle-allowlist.txt"
MIN_LEN=40

command -v curl >/dev/null || { echo "curl ausente"; exit 3; }
TMPD=$(mktemp -d /run/tom-bundle.XXXXXX 2>/dev/null || mktemp -d) || { echo "mktemp falhou"; exit 3; }
chmod 0700 "$TMPD"; trap 'rm -rf "$TMPD"' EXIT INT TERM

echo "== $URL =="
# Baixar virou funcao porque o modo --pos-deploy precisa reconsultar ate o bundle mudar.
# v2.2 (laudo bloqueador 6): o download nao exigia HTTP 200 nem verificava o que voltou.
# Uma pagina de erro da Vercel, um 404 ou um HTML de manutencao entrariam como "bundle" —
# e um "bundle" que nao contem literal nenhum sairia com ZERO achados, ou seja: verde.
# Agora: --fail, codigo 200 obrigatorio nas duas requisicoes, e o corpo tem que parecer JS.
baixar() {
  local html cod ct nome url_asset rodada novos
  cod=$(curl --fail -sS -L -m 20 -o "$TMPD/pagina.html" -w '%{http_code}' "$URL" 2>"$TMPD/curl.err")     || { echo "FALHA: pagina nao respondeu (curl: $(head -1 "$TMPD/curl.err" | cut -c1-120))"; return 1; }
  [ "$cod" = 200 ] || { echo "FALHA: pagina respondeu HTTP $cod (esperado 200)"; return 1; }
  html=$(cat "$TMPD/pagina.html")

  rm -rf "$TMPD/assets"; mkdir -p "$TMPD/assets"
  : > "$TMPD/lista-assets.txt"
  # TODOS os assets JS da pagina, nao so o primeiro (laudo v2.3, bloqueador 7). Ler so
  # `index-*.js` deixava os chunks lazy inteiros fora da varredura — e e exatamente neles que
  # mora codigo de rota que carrega sob demanda.
  grep -oE '/assets/[A-Za-z0-9_.-]+\.js' <<<"$html" | LC_ALL=C sort -u >> "$TMPD/lista-assets.txt"
  ASSET=$(head -1 "$TMPD/lista-assets.txt")
  [ -n "$ASSET" ] || { echo "FALHA: a pagina nao referencia nenhum /assets/*.js"; return 1; }

  baixar_um() { # <caminho-do-asset>
    local a=$1 dest cod ct
    dest="$TMPD/assets/$(basename "$a")"
    [ -s "$dest" ] && return 0
    cod=$(curl --fail -sS -L -m 90 -o "$dest" -D "$TMPD/hdr.txt" -w '%{http_code}' "${URL%/}$a" 2>"$TMPD/curl.err") || return 1
    [ "$cod" = 200 ] || { echo "  FALHA: $a respondeu HTTP $cod"; return 1; }
    ct=$(grep -i '^content-type:' "$TMPD/hdr.txt" | tail -1 | tr -d "\r")
    case "$ct" in *javascript*|*ecmascript*) : ;;
      *) echo "  FALHA: content-type inesperado em $a: ${ct:-ausente}"; return 1 ;; esac
    head -c 200 "$dest" | grep -qiE '<!doctype|<html' && { echo "  FALHA: $a veio como HTML (pagina de erro)"; return 1; }
    return 0
  }

  # Rodadas: um chunk pode referenciar outro. Limite alto o suficiente para o app e baixo o
  # suficiente para nao virar crawler.
  for rodada in 1 2 3; do
    novos=0
    while IFS= read -r a; do
      [ -n "$a" ] || continue
      [ -s "$TMPD/assets/$(basename "$a")" ] && continue
      baixar_um "$a" || return 1
      novos=$((novos+1))
    done < "$TMPD/lista-assets.txt"
    # nomes de chunk citados DENTRO dos assets ja baixados
    cat "$TMPD/assets"/*.js 2>/dev/null       | grep -oE '(\./|/)?assets/[A-Za-z0-9_.-]+\.js'       | sed -E 's#^\./#/#; s#^assets/#/assets/#' | LC_ALL=C sort -u > "$TMPD/refs.txt"
    LC_ALL=C sort -u "$TMPD/lista-assets.txt" "$TMPD/refs.txt" -o "$TMPD/lista-assets.txt"
    [ "$novos" -eq 0 ] && break
    [ "$(wc -l < "$TMPD/lista-assets.txt")" -gt 60 ] && { echo "FALHA: mais de 60 assets — recusando varrer isso como bundle"; return 1; }
  done

  N_ASSETS=$(ls -1 "$TMPD/assets"/*.js 2>/dev/null | wc -l)
  [ "$N_ASSETS" -ge 1 ] || { echo "FALHA: nenhum asset baixado"; return 1; }
  BUNDLE_BYTES=$(cat "$TMPD/assets"/*.js | wc -c)
  [ "${BUNDLE_BYTES:-0}" -gt 100000 ] || { echo "FALHA: $BUNDLE_BYTES bytes no total — pequeno demais para ser o app"; return 1; }
  # sha do CONJUNTO (nome+hash de cada asset, ordenado): assim "o bundle mudou" cobre
  # qualquer chunk, nao so o principal.
  BUNDLE_SHA=$(for f in "$TMPD/assets"/*.js; do printf '%s %s\n' "$(basename "$f")" "$(sha256sum "$f" | cut -d" " -f1)"; done | LC_ALL=C sort | sha256sum | cut -d' ' -f1)
  VERCEL_ID=$(grep -i '^x-vercel-id:' "$TMPD/hdr.txt" | tail -1 | tr -d "\r" | cut -c1-80)
  SERVIDO_EM=$(grep -i '^date:' "$TMPD/hdr.txt" | tail -1 | tr -d "\r")
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
    echo "bundle INALTERADO apos ${T}s (asset $ASSET, servido em ${SERVIDO_EM:-?}, ${VERCEL_ID:-?})"
  else
    MUDOU=sim
    echo "bundle MUDOU apos ${T}s: asset $ASSET_BASE -> $ASSET"
  fi
fi

echo "assets: $N_ASSETS arquivo(s) JS, $BUNDLE_BYTES bytes no total, sha256 do conjunto=${BUNDLE_SHA:0:12}…"
echo "        $(ls -1 "$TMPD/assets" | tr "
" " ")"

# Entropia de Shannon por caractere. Segredo real fica acima de ~3.5; texto/ids repetitivos ficam abaixo.
entropia() {
  awk '{
    n=length($0); if(n==0){print 0; next}
    delete f; for(i=1;i<=n;i++){c=substr($0,i,1); f[c]++}
    e=0; for(c in f){p=f[c]/n; e-=p*log(p)/log(2)}
    printf "%.2f\n", e
  }' <<<"$1"
}

# Literais entre aspas, em TODOS os assets (laudo v2.3, bloqueador 7).
#
# ALFABETO — tentei primeiro "qualquer coisa entre aspas que nao seja aspa nem espaco", para
# nao perder segredo com pontuacao incomum. MEDIDO em producao: 2.040 literais, dos quais
# 2.027 eram fragmentos de codigo minificado (`&&!!t.value,p=h&&U_(t.value)`) — JS minificado
# nao tem espacos, entao qualquer trecho entre duas aspas NAO RELACIONADAS casa. O detector
# foi de 1 achado para 2.679. Detector que grita 2.679 vezes nao e lido: vira ruido, que e a
# forma mais eficiente de nao detectar coisa nenhuma.
# Entao o alfabeto e o de CREDENCIAL — hex, base64, base64url, JWT, DSN: alfanumerico mais
# `_ . : + / = ~ -`. Cobre todo formato de segredo que este projeto usa ou usaria, e o `/`
# continua dentro (o bypass do laudo era a regra de FORMA, corrigida abaixo, nao o alfabeto).
# LIMITE HONESTO: segredo com caractere fora desse conjunto (`#`, `!`, `%`) nao seria
# extraido. Para investigar um caso assim sem editar codigo: exporte BUNDLE_ALFABETO.
# ALFABETO (v2.4, laudo bloqueador 4). A v2.3 usava so o alfabeto de credencial
# `A-Za-z0-9_.:+/=~-` e o Alf furou com um literal de 71 chars, entropia 5,44, contendo
# `!`, `#` e `%`: zero candidatos, verde. Segredo NAO e obrigado a caber no alfabeto que eu
# imaginei para ele.
# A versao "tudo entre aspas" tambem nao serve: JS minificado nao tem espacos, entao trechos
# entre aspas NAO RELACIONADAS casam e o detector foi para 2.679 achados (ruido = cegueira).
# O meio-termo MEDIDO: alfabeto largo MENOS os caracteres de ESTRUTURA de codigo
# — ( ) [ ] { } ; , < > & | \ e crase. Credencial praticamente nunca os usa; codigo
# minificado nao vive sem eles.
#   credencial (v2.3)        -> 18 candidatos, NAO pega o sintetico do laudo
#   tudo menos aspa/espaco   -> 2.040 candidatos (2.027 sao codigo)
#   sem estrutura de codigo  -> 23 candidatos, PEGA o sintetico   <- este
ALFABETO=${BUNDLE_ALFABETO:-A-Za-z0-9_.:+/=~!#$%*?@^-}
cat "$TMPD/assets"/*.js 2>/dev/null \
  | grep -oE "[\"'][$ALFABETO]{$MIN_LEN,400}[\"']" \
  | sed -E "s/^[\"']//; s/[\"']$//" | LC_ALL=C sort -u > "$TMPD/lit.txt"

TOTAL=$(wc -l < "$TMPD/lit.txt")
echo "literais candidatos (>= $MIN_LEN chars): $TOTAL"

[ -r "$ALLOW" ] || { echo "AVISO: allowlist ausente em $ALLOW — todo literal sera reportado"; : > "$TMPD/allow"; }
[ -r "$ALLOW" ] && grep -oE '^[a-f0-9]{64}' "$ALLOW" > "$TMPD/allow" 2>/dev/null || true

ACHADOS=0; PERMITIDOS=0; IGNORADOS=0; SEM_DIGITO=0
while IFS= read -r lit; do
  [ -n "$lit" ] || continue
  # ORDEM INVERTIDA (laudo v2.3, bloqueador 7). Antes a heuristica de FORMA vinha primeiro e
  # o padrao `*/*` descartava qualquer literal contendo barra — e `/` faz parte do alfabeto
  # base64. Bastava o segredo ter uma barra para nunca chegar a ser examinado: bypass de uma
  # linha, no detector que existe justamente para nao depender do formato do segredo.
  # Agora a ENTROPIA decide quem pode ser vetado por forma:
  #   >= 4.5  -> alta demais para caminho/mime/enum; nenhuma regra de forma pode veta-lo
  #   <  3.5  -> texto, enum, id sequencial: ruido
  #   entre   -> ai sim as regras de forma valem
  # SEM DIGITO = nao e credencial (v2.4). Ampliar o alfabeto para pegar `!#%` trouxe de volta
  # 3 fragmentos de codigo minificado (`Interaction.hover.active=!1,e.axisInt`) que passaram a
  # casar por nao terem parenteses. Todos com a mesma assinatura: ZERO digitos.
  # Segredo gerado por maquina sempre tem digito — hex, base64, base64url, JWT e UUID nao
  # existem sem eles. LIMITE HONESTO: uma senha escolhida por humano so com letras escaparia;
  # nao e o formato de nenhum segredo deste projeto, e o custo de nao ter a regra e um
  # detector barulhento, que e como se perde a deteccao de verdade.
  case "$lit" in *[0-9]*) : ;;
    *) SEM_DIGITO=$((SEM_DIGITO+1)); IGNORADOS=$((IGNORADOS+1)); continue ;;
  esac
  ENT=$(entropia "$lit")
  if awk -v e="$ENT" 'BEGIN{exit !(e<3.5)}'; then IGNORADOS=$((IGNORADOS+1)); continue; fi
  if awk -v e="$ENT" 'BEGIN{exit !(e<4.5)}'; then
    case "$lit" in
      /*|./*|data:*|http*|*.js|*.css|*.woff*|*.png|*.svg|*.map|*/*/*)
        IGNORADOS=$((IGNORADOS+1)); continue ;;
    esac
  fi
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
  N=$(cat "$TMPD/assets"/*.js 2>/dev/null | grep -o "$h" | wc -l)
  [ "$N" -gt 0 ] && echo "  $h: $N referencia(s)"
done

echo "== $ACHADOS achado(s), $PERMITIDOS permitido(s), $IGNORADOS ignorado(s) por ruido/entropia (destes, $SEM_DIGITO sem nenhum digito) =="

# --baseline: congela o estado ANTES do push, para o pos-deploy ter contra o que comparar.
if [ "$MODO" = baseline ]; then
  # GUARD (laudo v2.3, bloqueador 3). Sem isto o baseline CANONIZAVA segredo novo: bastava um
  # literal desconhecido entrar antes do baseline para ele virar "conhecido", e o --pos-deploy
  # depois aprovava por igualdade. O detector passaria a proteger justamente o que deveria
  # denunciar. O conjunto de achados tem que ser EXATAMENTE o aprovado em bundle-esperados.txt.
  ESPERADOS="$(dirname "$(readlink -f "$0")")/bundle-esperados.txt"
  if [ ! -r "$ESPERADOS" ]; then
    echo "FALHA: $ESPERADOS ilegivel — sem a lista de achados aprovados nao ha baseline confiavel"; exit 3
  fi
  grep -oE '^[a-f0-9]{64}' "$ESPERADOS" | LC_ALL=C sort -u > "$TMPD/esperados.txt"
  NOVOS_B=$(LC_ALL=C comm -13 "$TMPD/esperados.txt" "$TMPD/achados.txt" | grep -c . || true)
  SUMIU_B=$(LC_ALL=C comm -23 "$TMPD/esperados.txt" "$TMPD/achados.txt" | grep -c . || true)
  if [ "$NOVOS_B" -gt 0 ] || [ "$SUMIU_B" -gt 0 ]; then
    echo "== BASELINE RECUSADO: o bundle atual nao bate com os achados aprovados =="
    [ "$NOVOS_B" -gt 0 ] && { echo "   $NOVOS_B achado(s) NAO aprovado(s) — classifique antes de tirar baseline:";
                              LC_ALL=C comm -13 "$TMPD/esperados.txt" "$TMPD/achados.txt" | cut -c1-14 | sed 's/^/     /'; }
    [ "$SUMIU_B" -gt 0 ] && { echo "   $SUMIU_B achado(s) aprovado(s) DESAPARECEU — se foi corrigido, atualize $(basename "$ESPERADOS"):";
                              LC_ALL=C comm -23 "$TMPD/esperados.txt" "$TMPD/achados.txt" | cut -c1-14 | sed 's/^/     /'; }
    exit 1
  fi
  {
    echo "ts=$(date -Iseconds)"
    echo "url=$URL"
    echo "asset=$ASSET"
    echo "bundle_sha=$BUNDLE_SHA"
    echo "bundle_bytes=$BUNDLE_BYTES"
    echo "vercel_id=${VERCEL_ID:-}"
    echo "servido_em=${SERVIDO_EM:-}"
    echo "achados=$ACHADOS"
    sed 's/^/achado=/' "$TMPD/achados.txt"
  } > "$ESTADO.parcial" 2>/dev/null
  # gravacao atomica: baseline pela metade viraria referencia errada no pos-deploy
  grep -q '^bundle_sha=' "$ESTADO.parcial" 2>/dev/null || { rm -f "$ESTADO.parcial"; echo "FALHA: nao consegui gravar o baseline em $ESTADO"; exit 3; }
  chmod 0600 "$ESTADO.parcial" 2>/dev/null
  mv -f "$ESTADO.parcial" "$ESTADO" 2>/dev/null || { rm -f "$ESTADO.parcial"; echo "FALHA: nao consegui publicar o baseline em $ESTADO"; exit 3; }
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
  echo "   achados no baseline: $(wc -l < "$TMPD/base-achados.txt")   agora: $ACHADOS"

  # v2.2 (laudo bloqueador 6): a v2.1 APROVAVA com o bundle inalterado — e eu confirmei que
  # ela aprova mesmo sem deploy nenhum ter acontecido. Isso e falso-verde: "nada mudou" pode
  # significar "o rebuild saiu identico" OU "o build ainda nao terminou" OU "o push nem
  # disparou build". O teste nao distingue, entao nao pode afirmar.
  # Bundle inalterado passa a ser INDETERMINADO (exit 2), nao aprovado. Quem confirmou pelo
  # painel que o deployment esta READY e que o conteudo e mesmo identico usa
  # --aceitar-inalterado, e ai a afirmacao tem dono.
  if [ "$MUDOU" = nao ] && [ "$ACEITA_INALTERADO" != 1 ]; then
    echo "== POS-DEPLOY INDETERMINADO: o bundle servido e o MESMO do baseline =="
    echo "   Isso nao prova que o build terminou — prova apenas que nada novo chegou ate aqui."
    echo "   Confirme no painel da Vercel que o deployment esta READY e entao:"
    echo "     - se o conteudo for mesmo identico: rode de novo com --aceitar-inalterado"
    echo "     - se ainda estiver buildando: aumente BUNDLE_ESPERA_SEG e rode de novo"
    exit 2
  fi
  [ "$SUMIRAM" -gt 0 ] && { echo "   $SUMIRAM achado(s) DESAPARECERAM (mudanca — confirme se foi intencional):";
                            LC_ALL=C comm -23 "$TMPD/base-achados.txt" "$TMPD/achados.txt" | sed 's/^/     sumiu  /' | cut -c1-26; }
  if [ "$NOVOS" -gt 0 ]; then
    echo "   $NOVOS achado(s) NOVO(S) — literal de alta entropia que nao existia antes:"
    LC_ALL=C comm -13 "$TMPD/base-achados.txt" "$TMPD/achados.txt" | sed 's/^/     NOVO   /' | cut -c1-26
    echo "== POS-DEPLOY REPROVADO: o deploy introduziu literal novo no bundle publico =="
    exit 1
  fi
  # "nenhum achado novo" nao basta: se o conjunto ESVAZIOU sem ninguem ter consertado o P0-4,
  # a leitura mais provavel nao e "o segredo saiu" e sim "eu li o arquivo errado". Exigir o
  # conjunto EXATO — igualdade nos dois sentidos — e o que fecha isso.
  if [ "$SUMIRAM" -gt 0 ]; then
    echo "== POS-DEPLOY REPROVADO: achado conhecido DESAPARECEU sem correcao declarada =="
    echo "   Ou o P0-4 foi corrigido (e o baseline precisa ser refeito), ou o detector leu"
    echo "   outro arquivo. Nos dois casos o resultado nao pode ser lido como aprovacao."
    exit 1
  fi
  echo "== POS-DEPLOY APROVADO: conjunto de achados IDENTICO ao baseline ($ACHADOS), bundle mudou=$MUDOU =="
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
