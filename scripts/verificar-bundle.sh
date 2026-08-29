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
MODO=normal; ESTADO=""; ACEITA_INALTERADO=0; COMMIT=""; PROVA_MOTIVO=""
case "${1:-}" in
  --baseline)   MODO=baseline;   ESTADO=${2:?uso: --baseline <arquivo> [url]}; shift 2 ;;
  --pos-deploy) MODO=pos_deploy; ESTADO=${2:?uso: --pos-deploy <arquivo> [url]}; shift 2 ;;
  # `--conferir-esperados` responde a pergunta de SEGURANCA sem falar de deployment:
  # "o bundle servido agora tem exatamente os achados ja aprovados?". Existe porque o modo
  # normal sai 1 sempre que ha achado nao-allowlistado — e o P0-4 e um achado conhecido e
  # aceito. Sem este modo, o gate reprovaria todo deploy pelo problema que ja esta registrado,
  # que e a forma mais rapida de ensinar todo mundo a ignorar o gate.
  --conferir-esperados) MODO=conferir; shift ;;
  # PROVA DE DEPLOYMENT como contrato SEPARADO (laudo v2.5, bloqueador 2). Sozinho, responde
  # so "o que esta no ar e o build do commit X, READY?" -- sem olhar conteudo nenhum.
  --provar-deployment) MODO=provar; COMMIT=${2:?uso: --provar-deployment <sha> [url]}; shift 2 ;;
esac
# --commit <sha>: obrigatorio no --pos-deploy. Sem ele nao ha o que provar, e o modo passa a
# devolver INDETERMINADO em vez de aprovar.
if [ "${1:-}" = "--commit" ]; then COMMIT=${2:?uso: --commit <sha>}; shift 2; fi
if [ "${1:-}" = "--aceitar-inalterado" ]; then ACEITA_INALTERADO=1; shift; fi
URL=${1:-https://la-organizer.vercel.app}
ALLOW="$(dirname "$(readlink -f "$0")")/bundle-allowlist.txt"
MIN_LEN=40

command -v curl >/dev/null || { echo "curl ausente"; exit 3; }
TMPD=$(mktemp -d /run/tom-bundle.XXXXXX 2>/dev/null || mktemp -d) || { echo "mktemp falhou"; exit 3; }
chmod 0700 "$TMPD"; trap 'rm -rf "$TMPD"' EXIT INT TERM

# PROVA DE DEPLOYMENT (laudo v2.5, bloqueador 2). Sao DOIS contratos, e a v2.5 misturava:
#
#   contrato de CONTEUDO    -- "o bundle servido tem exatamente os achados aprovados?"
#   contrato de DEPLOYMENT  -- "o bundle servido e o build do commit X, e esse deployment
#                              esta READY?"
#
# A v2.5 aprovava o segundo com evidencia do primeiro: bastava o bundle ter MUDADO e os
# achados baterem para sair "POS-DEPLOY APROVADO" e o auto-deploy escrever "Gate Vercel
# aprovado". Mas um bundle diferente com o mesmo conjunto de achados pode ser de OUTRO
# deployment -- rollback, promocao de preview, build de outro commit -- e a comparacao nao
# distingue. Aprovar "o deploy do commit X" com uma medida que nao menciona X e falso-verde.
#
# Agora a prova precisa vir de uma FONTE que nomeie o commit:
#   1. API da Vercel (VERCEL_TOKEN + projeto): deployment com meta.githubCommitSha == X e
#      readyState READY;
#   2. carimbo servido pelo proprio deployment (/version.json com {"commit":"..."} ou
#      <meta name="commit" content="...">).
# Nenhuma disponivel -> INDETERMINADO (rc 2). Nunca "aprovado".
# `x-vercel-id` NAO serve e nao e usado: e id de REQUISICAO, nao de deployment.
# sha do CONJUNTO de assets de uma URL arbitraria -- usado para amarrar o deployment ao que
# a URL publica serve. Reusa a caminhada ate ponto fixo, entao mede a mesma coisa que o
# scanner mede, e nao uma aproximacao.
sha_do_bundle_em() {  # <url> -> imprime o sha do conjunto
  local url=$1 salvo_url=$URL salvo_sha=$BUNDLE_SHA salvo_n=$N_ASSETS salvo_b=$BUNDLE_BYTES rc
  URL=$url
  baixar >/dev/null 2>&1; rc=$?
  local novo=$BUNDLE_SHA
  URL=$salvo_url; BUNDLE_SHA=$salvo_sha; N_ASSETS=$salvo_n; BUNDLE_BYTES=$salvo_b
  [ "$rc" = 0 ] || return 1
  printf '%s' "$novo"
}

provar_deployment() {  # <sha> -> 0 provado | 1 contradiz | 2 indeterminado
  local sha=$1 corpo cod achado curto
  PROVA_MOTIVO=""
  case "$sha" in [0-9a-f]*) : ;; *) PROVA_MOTIVO="sha invalido"; return 2 ;; esac
  [ "${#sha}" -ge 7 ] || { PROVA_MOTIVO="sha curto demais"; return 2; }
  curto=${sha:0:8}

  # --- fonte 1: API da Vercel ---------------------------------------------------------
  if [ -n "${VERCEL_TOKEN:-}" ] && [ -n "${VERCEL_PROJECT_ID:-}" ]; then
    # token em arquivo de config, nunca no argv (/proc/<pid>/cmdline e legivel por todos)
    local cfg="$TMPD/vercel.cfg"
    : > "$cfg"; chmod 0600 "$cfg"
    {
      # base sobrescrevivel SO para os testes com API falsa; em producao e a Vercel.
      printf 'url = "%s/v6/deployments?projectId=%s&state=READY&limit=%s%s"\n' \
             "${VERCEL_API_BASE:-https://api.vercel.com}" \
             "$VERCEL_PROJECT_ID" "${VERCEL_LIMITE:-30}" "${VERCEL_TEAM_ID:+&teamId=$VERCEL_TEAM_ID}"
      printf 'header = "Authorization: Bearer %s"\n' "$VERCEL_TOKEN"
      printf 'silent\nshow-error\n'
    } >> "$cfg"
    cod=$(curl -m 25 -o "$TMPD/vercel.json" -w '%{http_code}' -K "$cfg" 2>"$TMPD/vercel.err")
    rm -f "$cfg"
    if [ "$cod" != 200 ]; then
      PROVA_MOTIVO="API da Vercel respondeu HTTP ${cod:-sem-resposta}"
      return 2
    fi
    # PROVA DO QUE ESTA SERVIDO, nao de deployment historico (laudo v2.6, bloqueador 7).
    # A v2.6 aceitava QUALQUER deployment do commit com READY e target=production. Depois de
    # um rollback esse deployment continua existindo e continua READY -- mas a URL publica
    # serve outro. "Existe um deployment READY deste commit" nao e "este commit esta no ar".
    # Agora a lista vem ordenada e so o deployment de producao MAIS RECENTE conta; alem
    # disso o `url` dele e buscado e o conjunto de assets e comparado com o que a URL
    # publica serve. Se divergir, o alias aponta para outro build: INDETERMINADO.
    achado=$(python3 - "$TMPD/vercel.json" "$sha" <<'PYFIM'
import json, sys
try:
    d = json.load(open(sys.argv[1], encoding="utf-8", errors="replace"))
except Exception as e:
    print("ERRO json:%s" % type(e).__name__); raise SystemExit(0)
alvo = sys.argv[2].lower()
deps = [x for x in d.get("deployments", []) if (x.get("target") == "production")]
if not deps:
    print("SEM nenhum deployment de production na resposta"); raise SystemExit(0)
# o ATUAL de producao e o mais recente por createdAt (a API ja devolve assim, mas nao
# dependemos disso: ordenamos)
def quando(x):
    for k in ("createdAt", "created", "ready", "buildingAt"):
        v = x.get(k)
        if isinstance(v, (int, float)):
            return v
    return -1
deps.sort(key=quando, reverse=True)
atual = deps[0]
meta = atual.get("meta") or {}
sha_atual = str(meta.get("githubCommitSha") or meta.get("gitCommitSha") or "").lower()
estado = atual.get("readyState") or atual.get("state")
if not sha_atual:
    print("SEMSHA o deployment de producao atual nao declara commit"); raise SystemExit(0)
if not (sha_atual.startswith(alvo) or alvo.startswith(sha_atual)):
    print("OUTRO producao atual e %s (%s), nao o commit pedido" % (sha_atual[:8], estado))
    raise SystemExit(0)
if estado != "READY":
    print("NAOPRONTO producao atual e o commit pedido, mas esta %s" % estado); raise SystemExit(0)
print("ATUAL %s %s" % (atual.get("uid") or "-", atual.get("url") or "-"))
PYFIM
)
    case "$achado" in
      "ATUAL "*)
        # O deployment de producao ATUAL e o do commit e esta READY. Falta amarrar ao que a
        # URL publica realmente serve: se o alias apontar para outro build, o conjunto de
        # assets difere. Sem essa amarracao, "READY" ainda seria uma afirmacao sobre o
        # registro da Vercel, nao sobre o que o usuario recebe.
        local durl bsha
        durl=$(printf '%s' "$achado" | awk '{print $3}')
        case "$durl" in
          -|"") PROVA_MOTIVO="deployment atual de $curto esta READY, mas a API nao deu a URL dele para conferir o servido"; return 2 ;;
        esac
        # a API devolve `url` sem esquema; em teste o mock usa http em 127.0.0.1.
        case "$durl" in *://*) : ;; *) durl="${VERCEL_DEP_ESQUEMA:-https}://$durl" ;; esac
        bsha=$(sha_do_bundle_em "$durl") || {
          PROVA_MOTIVO="nao consegui ler o bundle do deployment $durl para comparar com o publico"; return 2; }
        if [ "$bsha" = "$BUNDLE_SHA" ]; then
          PROVA_MOTIVO="deployment $durl (commit $curto, READY, production atual) serve o MESMO conjunto de assets que a URL publica"
          return 0
        fi
        PROVA_MOTIVO="o deployment atual de $curto existe e esta READY, mas a URL publica serve OUTRO conjunto de assets (${BUNDLE_SHA:0:12} != ${bsha:0:12}) -- alias aponta para outro build"
        return 1 ;;
      "OUTRO "*)     PROVA_MOTIVO="o que esta em producao agora nao e $curto -- $achado"; return 1 ;;
      "NAOPRONTO"*)  PROVA_MOTIVO="$achado"; return 1 ;;
      "SEMSHA"*)     PROVA_MOTIVO="$achado"; return 2 ;;
      "SEM "*)       PROVA_MOTIVO="API da Vercel: $achado"; return 1 ;;
      *)             PROVA_MOTIVO="nao consegui interpretar a resposta da API ($achado)"; return 2 ;;
    esac
  fi

  # --- fonte 2: carimbo servido pelo proprio deployment --------------------------------
  cod=$(curl -sS -L -m 15 -o "$TMPD/versao.json" -w '%{http_code}' "${URL%/}/version.json" 2>/dev/null)
  if [ "$cod" = 200 ]; then
    corpo=$(sed -E 's/.*"commit"[[:space:]]*:[[:space:]]*"([0-9a-fA-F]+)".*/\1/' "$TMPD/versao.json" | tr 'A-F' 'a-f' | head -1)
    case "$corpo" in
      [0-9a-f]*)
        if [ "${corpo:0:8}" = "$curto" ]; then
          PROVA_MOTIVO="/version.json servido pelo deployment carimba o commit $curto"; return 0
        fi
        PROVA_MOTIVO="/version.json carimba ${corpo:0:8}, esperado $curto -- o que esta no ar e OUTRO build"
        return 1 ;;
    esac
  fi
  corpo=$(grep -oiE '<meta[^>]+name="commit"[^>]*content="[0-9a-fA-F]+"' "$TMPD/pagina.html" 2>/dev/null \
          | sed -E 's/.*content="([0-9a-fA-F]+)".*/\1/' | tr 'A-F' 'a-f' | head -1)
  case "$corpo" in
    [0-9a-f]*)
      if [ "${corpo:0:8}" = "$curto" ]; then
        PROVA_MOTIVO="<meta name=commit> na pagina carimba $curto"; return 0
      fi
      PROVA_MOTIVO="<meta name=commit> carimba ${corpo:0:8}, esperado $curto"; return 1 ;;
  esac

  PROVA_MOTIVO="sem fonte de prova: VERCEL_TOKEN/VERCEL_PROJECT_ID nao configurados neste host e o deployment nao carimba o commit (nem /version.json nem <meta name=commit>)"
  return 2
}

echo "== $URL =="
# Baixar virou funcao porque o modo --pos-deploy precisa reconsultar ate o bundle mudar.
# v2.2 (laudo bloqueador 6): o download nao exigia HTTP 200 nem verificava o que voltou.
# Uma pagina de erro da Vercel, um 404 ou um HTML de manutencao entrariam como "bundle" —
# e um "bundle" que nao contem literal nenhum sairia com ZERO achados, ou seja: verde.
# Agora: --fail, codigo 200 obrigatorio nas duas requisicoes, e o corpo tem que parecer JS.
baixar() {
  local html cod rodada inicio novos
  cod=$(curl --fail -sS -L -m 20 -o "$TMPD/pagina.html" -w '%{http_code}' "$URL" 2>"$TMPD/curl.err") \
    || { echo "FALHA: pagina nao respondeu (curl: $(head -1 "$TMPD/curl.err" | cut -c1-120))"; return 1; }
  [ "$cod" = 200 ] || { echo "FALHA: pagina respondeu HTTP $cod (esperado 200)"; return 1; }
  html=$(cat "$TMPD/pagina.html")

  rm -rf "$TMPD/assets"; mkdir -p "$TMPD/assets"
  : > "$TMPD/fila.txt"; : > "$TMPD/vistos.txt"; : > "$TMPD/sembarra.txt"; : > "$TMPD/dirs.txt"; : > "$TMPD/sembarra.resolvida"; : > "$TMPD/fila-bare.txt"; : > "$TMPD/mapa.txt"
  grep -oE '/assets/[A-Za-z0-9_.@-]+\.js' <<<"$html" | LC_ALL=C sort -u >> "$TMPD/fila.txt"
  ASSET=$(head -1 "$TMPD/fila.txt")
  [ -n "$ASSET" ] || { echo "FALHA: a pagina nao referencia nenhum /assets/*.js"; return 1; }

  # NOME LOCAL SEM COLISAO (laudo v2.6, bloqueador 5). Antes o caminho era achatado com
  # `tr / _`: `assets/a/b_c.js` e `assets/a_b/c.js` viravam O MESMO arquivo local. O
  # Alfredo reproduziu com o segredo no SEGUNDO -- o primeiro ocupava o nome, o segundo era
  # descartado por "ja baixei", e o scanner saia verde sem nunca ter lido o segredo.
  # Agora o nome vem do sha256 do CAMINHO (injetivo por construcao) e um mapa explicito
  # guarda quem e quem, para o relatorio continuar legivel.
  local_de() {
    local p=$1 h
    h=$(printf %s "$p" | sha256sum | cut -c1-32)
    printf '%s/assets/a%s.js' "$TMPD" "$h"
  }
  registrar_mapa() {   # <caminho no site>
    printf '%s  %s
' "$(basename "$(local_de "$1")")" "$1" >> "$TMPD/mapa.txt"
  }

  baixar_um() { # <caminho absoluto no site>  -> rc 0 baixou | 1 erro duro | 2 nao existe (404)
    local a=$1 dest cod ct
    dest=$(local_de "$a")
    [ -s "$dest" ] && return 0
    cod=$(curl -sS -L -m 90 -o "$dest" -D "$TMPD/hdr.txt" -w '%{http_code}' "${URL%/}$a" 2>"$TMPD/curl.err")
    case "$cod" in
      200) : ;;
      404) rm -f "$dest"; return 2 ;;
      '' ) rm -f "$dest"; echo "  FALHA: $a sem resposta (curl: $(head -1 "$TMPD/curl.err" | cut -c1-90))"; return 1 ;;
      *  ) rm -f "$dest"; echo "  FALHA: $a respondeu HTTP $cod"; return 1 ;;
    esac
    ct=$(grep -i '^content-type:' "$TMPD/hdr.txt" | tail -1 | tr -d "\r")
    case "$ct" in *javascript*|*ecmascript*) : ;;
      *) echo "  FALHA: content-type inesperado em $a: ${ct:-ausente}"; return 1 ;; esac
    head -c 200 "$dest" | grep -qiE '<!doctype|<html' && { echo "  FALHA: $a veio como HTML (pagina de erro)"; return 1; }
    printf '%s\n' "$(dirname "$a")/" >> "$TMPD/dirs.txt"
    registrar_mapa "$a"
    return 0
  }

  # EXTRACAO DE REFERENCIAS (laudo v2.5, bloqueador 3).
  # A v2.5 casava `(\./|/)?assets/<nome>.js` -- exigia o literal `assets/` no meio. Medido no
  # bundle de producao em 29/08: a pagina referencia UM asset (o index) e ele carrega os
  # outros como `./XxxPage-hash.js`, sibling, SEM `assets/` no caminho. Resultado: o scanner
  # varria 1 arquivo de 76 referencias e chamava isso de "bundle varrido".
  # Agora extrai QUALQUER string entre aspas terminada em .js e resolve por regra de caminho:
  #   /x.js        -> absoluto
  #   ./x.js       -> relativo ao diretorio de QUEM referenciou
  #   ../x.js      -> um nivel acima
  #   assets/x.js  -> relativo a raiz do site (e o formato do mapa de preload do Vite)
  #   x.js         -> nao e caminho; vai para a lista SEM BARRA (ver adiante)
  # Medido: 75 referencias com barra, 75 resolvem 200; 1 sem barra (`Node.js`, prosa).
  extrair_refs() { # <arquivo local> <dir do referrer, com / no fim>
    grep -oE "[\"'\`][^\"'\`]{1,200}\.js[\"'\`]" "$1" 2>/dev/null \
      | sed -E "s/^.//; s/.\$//" | LC_ALL=C sort -u | while IFS= read -r r; do
      case "$r" in
        *://*|*' '*|'') continue ;;                 # URL de outro host ou prosa com espaco
        /*)    printf '%s\n' "$r" ;;
        ./*)   printf '%s%s\n' "$2" "${r#./}" ;;
        ../*)  printf '/%s\n' "${r#../}" ;;
        */*)   printf '/%s\n' "$r" ;;
        *)     printf '%s\n' "$r" >> "$TMPD/sembarra.txt" ;;
      esac
    done
  }

  # PONTO FIXO com limites EXPLICITOS. A v2.5 parava em 3 rodadas: a rodada 3 baixava o
  # nivel 3 e ENFILEIRAVA o nivel 4 sem nunca baixa-lo -- segredo no quarto chunk passava
  # verde, e o relatorio nao dizia que havia parado no meio. Aqui a unica saida normal e a
  # fila esvaziar; qualquer limite atingido e FALHA declarada, nunca silencio.
  MAX_ASSETS=${BUNDLE_MAX_ASSETS:-300}
  MAX_BYTES=${BUNDLE_MAX_BYTES:-83886080}
  MAX_SEG=${BUNDLE_MAX_SEG:-600}
  MAX_RODADAS=${BUNDLE_MAX_RODADAS:-60}
  inicio=$(date +%s); rodada=0
  : > "$TMPD/naoresolvidas.txt"
  while [ -s "$TMPD/fila.txt" ]; do
    rodada=$((rodada+1))
    if [ "$rodada" -gt "$MAX_RODADAS" ]; then
      echo "FALHA: limite de $MAX_RODADAS rodadas atingido com $(wc -l < "$TMPD/fila.txt") referencia(s) na fila"; return 1; fi
    if [ $(( $(date +%s) - inicio )) -gt "$MAX_SEG" ]; then
      echo "FALHA: limite de ${MAX_SEG}s atingido com $(wc -l < "$TMPD/fila.txt") referencia(s) na fila"; return 1; fi
    mv "$TMPD/fila.txt" "$TMPD/rodando.txt"; : > "$TMPD/fila.txt"
    novos=0
    while IFS= read -r a; do
      [ -n "$a" ] || continue
      LC_ALL=C grep -qxF -- "$a" "$TMPD/vistos.txt" && continue
      printf '%s\n' "$a" >> "$TMPD/vistos.txt"
      if [ "$(wc -l < "$TMPD/vistos.txt")" -gt "$MAX_ASSETS" ]; then
        echo "FALHA: mais de $MAX_ASSETS assets -- recusando varrer isso como bundle"; return 1; fi
      baixar_um "$a"; rc=$?
      case $rc in
        0) novos=$((novos+1)) ;;
        # REFERENCIA NAO RESOLVIDA REPROVA. Um 404 num caminho citado pelo proprio bundle
        # significa que ha codigo que o scanner nao leu -- e "nao li" nunca pode sair como
        # "nao tem segredo". Vai para a lista e o scan termina reprovado.
        2) printf '%s\n' "$a" >> "$TMPD/naoresolvidas.txt" ;;
        *) return 1 ;;
      esac
      extrair_refs "$(local_de "$a")" "$(dirname "$a")/" >> "$TMPD/fila.txt"
    done < "$TMPD/rodando.txt"
    LC_ALL=C sort -u -o "$TMPD/fila.txt" "$TMPD/fila.txt"
    # BARE-NAME VOLTA PARA A CAMINHADA (laudo v2.6, bloqueador 5). Strings terminadas em
    # .js sem barra nenhuma (`Node.js` e o caso real) nao sao caminho, mas podem ser: o
    # bundler as vezes cita o chunk so pelo nome. A v2.6 resolvia essas DEPOIS do ponto
    # fixo -- baixava e escaneava o arquivo, mas nunca extraia as referencias DELE. Um
    # filho mais fundo ficava invisivel. Agora a resolucao acontece DENTRO da rodada e o
    # que resolve entra na fila como qualquer outro asset.
    if [ -s "$TMPD/sembarra.txt" ]; then
      LC_ALL=C sort -u -o "$TMPD/sembarra.txt" "$TMPD/sembarra.txt"
      LC_ALL=C sort -u -o "$TMPD/dirs.txt" "$TMPD/dirs.txt"
      : > "$TMPD/sembarra.pendente"
      while IFS= read -r r; do
        [ -n "$r" ] || continue
        LC_ALL=C grep -qxF -- "$r" "$TMPD/sembarra.resolvida" 2>/dev/null && continue
        achou=0
        while IFS= read -r d; do
          [ -n "$d" ] || continue
          LC_ALL=C grep -qxF -- "$d$r" "$TMPD/vistos.txt" && { achou=1; break; }
          if baixar_um "$d$r"; then
            achou=1
            printf '%s
' "$d$r" >> "$TMPD/vistos.txt"
            printf '%s
' "$d$r" >> "$TMPD/fila-bare.txt"
            break
          fi
        done < "$TMPD/dirs.txt"
        if [ "$achou" = 1 ]; then printf '%s
' "$r" >> "$TMPD/sembarra.resolvida"
        else printf '%s
' "$r" >> "$TMPD/sembarra.pendente"; fi
      done < "$TMPD/sembarra.txt"
      mv -f "$TMPD/sembarra.pendente" "$TMPD/sembarra.txt"
      # o que resolveu vira asset de verdade: extrai referencias e volta para a fila
      if [ -s "$TMPD/fila-bare.txt" ]; then
        while IFS= read -r a2; do
          [ -n "$a2" ] || continue
          extrair_refs "$(local_de "$a2")" "$(dirname "$a2")/" >> "$TMPD/fila.txt"
        done < "$TMPD/fila-bare.txt"
        : > "$TMPD/fila-bare.txt"
        LC_ALL=C sort -u -o "$TMPD/fila.txt" "$TMPD/fila.txt"
      fi
    fi
    BUNDLE_BYTES=$(cat "$TMPD/assets"/*.js 2>/dev/null | wc -c)
    if [ "${BUNDLE_BYTES:-0}" -gt "$MAX_BYTES" ]; then
      echo "FALHA: bundle passou de $MAX_BYTES bytes -- recusando continuar"; return 1; fi
  done


  if [ -s "$TMPD/naoresolvidas.txt" ]; then
    echo "FALHA: $(wc -l < "$TMPD/naoresolvidas.txt") referencia(s) JS citada(s) no bundle NAO resolvem (404):"
    sed 's/^/    /' "$TMPD/naoresolvidas.txt" | head -20
    echo "       ha codigo publico que o scanner nao conseguiu ler; nao da para afirmar nada sobre ele"
    return 1
  fi

  N_ASSETS=$(ls -1 "$TMPD/assets"/*.js 2>/dev/null | wc -l)
  [ "$N_ASSETS" -ge 1 ] || { echo "FALHA: nenhum asset baixado"; return 1; }
  BUNDLE_BYTES=$(cat "$TMPD/assets"/*.js | wc -c)
  [ "${BUNDLE_BYTES:-0}" -gt 100000 ] || { echo "FALHA: $BUNDLE_BYTES bytes no total - pequeno demais para ser o app"; return 1; }
  # sha do CONJUNTO (nome+hash de cada asset, ordenado): assim "o bundle mudou" cobre
  # qualquer chunk, nao so o principal.
  BUNDLE_SHA=$(for f in "$TMPD/assets"/*.js; do printf '%s %s\n' "$(basename "$f")" "$(sha256sum "$f" | cut -d" " -f1)"; done | LC_ALL=C sort | sha256sum | cut -d' ' -f1)
  RODADAS=$rodada
  VERCEL_ID=$(grep -i '^x-vercel-id:' "$TMPD/hdr.txt" | tail -1 | tr -d "\r" | cut -c1-80)
  SERVIDO_EM=$(grep -i '^date:' "$TMPD/hdr.txt" | tail -1 | tr -d "\r")
  return 0
}

baixar || exit 1

# --provar-deployment: SO o contrato de deployment. Nao olha literal nenhum.
if [ "$MODO" = provar ]; then
  provar_deployment "$COMMIT"; RCP=$?
  case $RCP in
    0) echo "== DEPLOYMENT PROVADO: $PROVA_MOTIVO =="; exit 0 ;;
    1) echo "== DEPLOYMENT CONTRADIZ O COMMIT: $PROVA_MOTIVO =="; exit 1 ;;
    *) echo "== DEPLOYMENT INDETERMINADO: $PROVA_MOTIVO =="; exit 2 ;;
  esac
fi

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

echo "assets: $N_ASSETS arquivo(s) JS em ${RODADAS:-?} rodada(s) ate ponto fixo, $BUNDLE_BYTES bytes, sha256 do conjunto=${BUNDLE_SHA:0:12}..."
echo "        $(cut -d' ' -f3- "$TMPD/mapa.txt" 2>/dev/null | LC_ALL=C sort | tr '
' ' ')"

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
# CRASE incluida (v2.5): template literal e string como qualquer outra e pode carregar
# segredo. Medido: incluir a crase nao muda a contagem de candidatos neste bundle (22 -> 22),
# entao o custo e zero e a cobertura cresce.
cat "$TMPD/assets"/*.js 2>/dev/null \
  | grep -oE "[\"'\`][$ALFABETO]{$MIN_LEN,400}[\"'\`]" \
  | sed -E "s/^[\"'\`]//; s/[\"'\`]$//" | LC_ALL=C sort -u > "$TMPD/lit.txt"

TOTAL=$(wc -l < "$TMPD/lit.txt")
echo "literais candidatos (>= $MIN_LEN chars): $TOTAL"

[ -r "$ALLOW" ] || { echo "AVISO: allowlist ausente em $ALLOW — todo literal sera reportado"; : > "$TMPD/allow"; }
[ -r "$ALLOW" ] && grep -oE '^[a-f0-9]{64}' "$ALLOW" > "$TMPD/allow" 2>/dev/null || true

ACHADOS=0; PERMITIDOS=0; IGNORADOS=0
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

echo "== $ACHADOS achado(s), $PERMITIDOS permitido(s), $IGNORADOS ignorado(s) por ruido/entropia =="

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
  # mesma publicacao atomica dos outros escritores: o baseline do bundle e prova como
  # qualquer outra, e pela metade vira referencia errada no --pos-deploy.
  LIBPUB="$(dirname "$(readlink -f "$0")")/lib-publicar.sh"
  if [ -r "$LIBPUB" ]; then
    # shellcheck disable=SC1090
    . "$LIBPUB"
    publicar_atomico "$ESTADO" '^bundle_sha=' 0600       || { echo "FALHA ao publicar o baseline: $PUBLICAR_MOTIVO"; exit 3; }
  else
    rm -f "$ESTADO.parcial"; echo "FALHA: lib-publicar.sh ausente"; exit 3
  fi
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
  # CONTEUDO OK -- e so isso. A pergunta do deployment ainda nao foi respondida.
  echo "-- conteudo: conjunto de achados IDENTICO ao aprovado ($ACHADOS), bundle mudou=$MUDOU --"
  echo "   (o P0-4 continua ABERTO -- este teste prova que o deploy nao PIOROU, nao que esta resolvido)"
  # E AQUI a v2.5 saia 0. Bundle diferente com os mesmos achados pode ser de OUTRO
  # deployment (rollback, promocao de preview, build de outro commit): a comparacao de
  # conteudo nao menciona commit nenhum, entao nao pode responder por ele.
  if [ -z "$COMMIT" ]; then
    echo "== POS-DEPLOY INDETERMINADO: conteudo aprovado, mas nenhum commit foi informado =="
    echo "   rode com --commit <sha> para que o gate tenha o que provar."
    exit 2
  fi
  provar_deployment "$COMMIT"; RCP=$?
  case $RCP in
    0) echo "== POS-DEPLOY APROVADO: conteudo conferido E deployment provado -- $PROVA_MOTIVO =="; exit 0 ;;
    1) echo "== POS-DEPLOY REPROVADO: o que esta no ar nao e o deployment do commit pedido =="
       echo "   $PROVA_MOTIVO"; exit 1 ;;
    *) echo "== POS-DEPLOY INDETERMINADO: conteudo aprovado, deployment NAO PROVADO =="
       echo "   $PROVA_MOTIVO"
       echo "   Nao estou declarando o deploy verificado. Confirme no painel da Vercel que o"
       echo "   deployment do commit ${COMMIT:0:8} esta READY, ou configure VERCEL_TOKEN/VERCEL_PROJECT_ID."
       exit 2 ;;
  esac
fi

# --conferir-esperados: conjunto de achados IGUAL ao aprovado, nos dois sentidos.
if [ "$MODO" = conferir ]; then
  ESPERADOS="$(dirname "$(readlink -f "$0")")/bundle-esperados.txt"
  [ -r "$ESPERADOS" ] || { echo "FALHA: $ESPERADOS ilegivel"; exit 3; }
  grep -oE '^[a-f0-9]{64}' "$ESPERADOS" | LC_ALL=C sort -u > "$TMPD/esp.txt"
  NOVOS_C=$(LC_ALL=C comm -13 "$TMPD/esp.txt" "$TMPD/achados.txt" | grep -c . || true)
  SUMIU_C=$(LC_ALL=C comm -23 "$TMPD/esp.txt" "$TMPD/achados.txt" | grep -c . || true)
  echo "-- conferencia contra os achados aprovados --"
  echo "   aprovados: $(wc -l < "$TMPD/esp.txt")   encontrados: $ACHADOS"
  if [ "$NOVOS_C" -gt 0 ]; then
    echo "   $NOVOS_C achado(s) NOVO(S) no bundle publico:"
    LC_ALL=C comm -13 "$TMPD/esp.txt" "$TMPD/achados.txt" | cut -c1-14 | sed 's/^/     /'
    echo "== REPROVADO: literal nao aprovado no bundle publico =="; exit 1
  fi
  if [ "$SUMIU_C" -gt 0 ]; then
    echo "   $SUMIU_C achado(s) aprovado(s) DESAPARECEU:"
    LC_ALL=C comm -23 "$TMPD/esp.txt" "$TMPD/achados.txt" | cut -c1-14 | sed 's/^/     /'
    echo "== REPROVADO: se foi corrigido, atualize bundle-esperados.txt; se nao, o detector leu outro arquivo =="
    exit 1
  fi
  echo "== APROVADO: exatamente os $ACHADOS achado(s) aprovado(s), nenhum a mais nem a menos =="
  exit 0
fi

if [ "$ACHADOS" -gt 0 ]; then
  echo "   Para classificar um achado SEM expor o valor: confira o sha256 contra a origem"
  echo "   (ex.: printf %s \"\$VALOR\" | sha256sum) e, se for publico por desenho, adicione"
  echo "   o hash em $ALLOW com o motivo escrito."
  exit 1
fi
exit 0
