#!/bin/bash
# preflight-deploy.sh — roda IMEDIATAMENTE antes de `git reset --hard <ref>`.
#
# v2.2 — REESCRITO. A v2.1 aprovava quatro situacoes em que o reset destroi trabalho.
# Reproduzido em laboratorio, cada uma com PREFLIGHT OK indevido:
#   a) rastreado DELETADO (` D`)      -> o reset restaura o arquivo e apaga a intencao
#   a2) rastreado ADICIONADO (`A `)   -> o reset DESCARTA o arquivo novo
#   b) UNTRACKED que existe no alvo   -> o reset SOBRESCREVE (eu mesmo provei isso e depois
#                                        escrevi um preflight que dizia "untracked nao bloqueia")
#   d) ZERO untracked                 -> `grep -c '^??'` sai 1 quando nao ha match, o `if`
#                                        falhava e ele RECUSAVA por erro de logica
# A raiz de (a),(a2) era filtrar so o estado `M`. A de (b) era eu ter generalizado
# "untracked sobrevive" a partir do teste em que o untracked NAO estava na arvore alvo.
#
# MODELO CORRETO — o reset --hard escreve tudo que existe na ARVORE ALVO, sem perguntar, e
# nao toca no que esta fora dela. Logo:
#   * qualquer caminho (rastreado OU untracked) que exista no alvo sera sobrescrito;
#     so passa se o disco JA for byte-identico ao alvo (reset vira no-op);
#   * rastreado ausente do disco, ou presente e ausente do alvo, e trabalho que some;
#   * untracked fora do alvo sobrevive — e o unico caso realmente informativo.
#
# Uso:  ./preflight-deploy.sh <ref-alvo> [--sem-snapshot]
# Fail-closed: nao conseguir MEDIR tambem recusa. Nenhuma contagem usa `grep -c`.

set -uo pipefail
REF=${1:?uso: $0 <ref-alvo> [--sem-snapshot]}
SNAP=1; [ "${2:-}" = "--sem-snapshot" ] && SNAP=0
# AQUI capturado ANTES do cd: depois dele, um $0 RELATIVO passa a resolver a partir do
# novo diretorio e `readlink -f` devolve um caminho que nao existe. Foi assim que este
# script disse "lib-guardas.sh ausente" com a lib ao lado dele.
AQUI="$(dirname "$(readlink -f "$0")")"
# Raiz do repo sobrescrevivel: permite MEDIR um repo (a VPS, por exemplo) sem antes
# instalar o script dentro dele. Medicao read-only nao devia exigir entrega previa.
REPO=${PREFLIGHT_REPO:-$AQUI/..}
cd "$REPO" || exit 2

# INVENTARIO VEM DA LIB, nao de copia local: duas listas do mesmo fato divergem com o tempo,
# e foi o que aconteceu entre este arquivo e pos-deploy-modos.sh.
LIBG="$AQUI/lib-guardas.sh"
[ -r "$LIBG" ] || { echo "FATAL: lib-guardas.sh ausente em $LIBG" >&2; exit 2; }
# shellcheck disable=SC1090
. "$LIBG"
GUARDAS_ESPERADOS=$(( ${#GUARDAS[@]} + ${#DADOS[@]} ))
DEST=${GUARDAS_DIR:-/opt/backups/la-organizer/guardas}
PROBLEMAS=0; MANIF_USADOS=0
T=$(mktemp -d /run/preflight.XXXXXX 2>/dev/null || mktemp -d) || { echo "FATAL: mktemp" >&2; exit 2; }
chmod 0700 "$T"; trap 'rm -rf "$T"' EXIT INT TERM

recusa() { echo "    RECUSADO  $1"; PROBLEMAS=$((PROBLEMAS+1)); }

echo "== preflight para $REF =="
git rev-parse --verify "$REF^{commit}" >/dev/null 2>&1 || { echo "FATAL: ref $REF nao existe (fez fetch?)" >&2; exit 2; }
echo "  alvo: $(git rev-parse --short "$REF")  atual: $(git rev-parse --short HEAD)"

# Arvore alvo inteira - com MODO, nao so nome. O reset --hard escreve conteudo E modo E tipo.
# `git ls-tree -r -z` da "<modo> <tipo> <sha>\t<caminho>" por entrada.
git ls-tree -r "$REF" -z 2>/dev/null > "$T/alvo.z" \
  || { echo "FATAL: nao consegui listar a arvore de $REF" >&2; exit 2; }
[ -s "$T/alvo.z" ] || { echo "FATAL: arvore de $REF veio vazia" >&2; exit 2; }
declare -A ALVO_MODO ALVO_SHA
while IFS= read -r -d '' linha; do
  meta=${linha%%$'\t'*}; cam=${linha#*$'\t'}
  # shellcheck disable=SC2086
  set -- $meta
  ALVO_MODO["$cam"]=$1; ALVO_SHA["$cam"]=$3
  printf '%s\n' "$cam" >> "$T/alvo.raw"
# SEM PIPELINE. `done < ... | sort` poe o while inteiro num SUBSHELL e os arrays
# associativos morrem com ele: ALVO_MODO voltaria VAZIA e igual_alvo cairia no rc=2 de
# todo caminho. E a mesma armadilha do contador em subshell que ja deu falso-verde aqui.
done < "$T/alvo.z"
LC_ALL=C sort "$T/alvo.raw" -o "$T/alvo.txt" 2>/dev/null
[ -s "$T/alvo.txt" ] || { echo "FATAL: nao consegui indexar a arvore de $REF" >&2; exit 2; }
echo "  arvore alvo: $(wc -l < "$T/alvo.txt") arquivo(s), com modo e tipo"

no_alvo() { LC_ALL=C grep -qxF -- "$1" "$T/alvo.txt"; }

# MODO E TIPO DO DISCO no vocabulario do git (laudo v2.5, bloqueador 4). A v2.5 comparava so
# BYTES: um arquivo 0644 que virou 0755 no disco era declarado "identico ao alvo; reset e
# no-op" e o `git reset --hard` desfazia a mudanca de modo em silencio. O mesmo valia para
# arquivo trocado por symlink apontando para conteudo igual.
# 100644 arquivo | 100755 executavel | 120000 symlink | 040000 diretorio | ? nao mede
modo_disco() { # <path>
  local p=$1 perm
  [ -L "$p" ] && { echo 120000; return 0; }
  [ -d "$p" ] && { echo 040000; return 0; }
  [ -f "$p" ] || { echo '?'; return 1; }
  perm=$(stat -c%a -- "$p" 2>/dev/null) || { echo '?'; return 1; }
  # git so guarda 100644 ou 100755: o que importa e o bit de execucao do DONO.
  case "$perm" in
    ?[0-7][0-7]) case "${perm:0:1}" in 1|3|5|7) echo 100755 ;; *) echo 100644 ;; esac ;;
    [0-7][0-7])  echo 100644 ;;
    *)           case "$perm" in *7??|*5??|*3??|*1??) echo 100755 ;; *) echo 100644 ;; esac ;;
  esac
}
# CONTEUDO no vocabulario do git: para symlink, o blob e o ALVO do link (sem \n final).
sha_disco() { # <path>
  local p=$1
  if [ -L "$p" ]; then readlink -- "$p" 2>/dev/null | tr -d '\n' | sha256sum | cut -d' ' -f1
  elif [ -f "$p" ]; then sha256sum -- "$p" 2>/dev/null | cut -d' ' -f1
  else return 1; fi
}
sha_alvo() { git cat-file blob "$REF:$1" 2>/dev/null | sha256sum | cut -d' ' -f1; }

# DISCO x ALVO em conteudo, tipo E modo.
#   rc 0 = identico nos tres (o reset e no-op de verdade)
#   rc 1 = diverge, e MOTIVO diz em que
#   rc 2 = nao consegui medir
# MANIFESTO DE ORIGEM (laudo v2.7, bloqueador 1). Divergencia operacional CONHECIDA e aceita
# so por caminho + sha256 + modo EXATOS. Um byte fora, um modo fora, um caminho a mais: recusa.
# Sem manifesto legivel, nada e aceito por esta via -- a ausencia do arquivo nao afrouxa nada.
MANIFESTO_ORIGEM=${PREFLIGHT_MANIFESTO:-$AQUI/manifesto-origem-v25.txt}
MANIF_MOTIVO=""
declare -A ORIG_SHA ORIG_MODO
if [ -r "$MANIFESTO_ORIGEM" ]; then
  while read -r h m c; do
    case "$h" in ''|\#*) continue ;; esac
    [ -n "$c" ] || continue
    ORIG_SHA["$c"]=$h; ORIG_MODO["$c"]=$m
  done < "$MANIFESTO_ORIGEM"
fi
origem_conhecida() {  # <path> -> rc 0 se o disco bate EXATAMENTE com uma linha do manifesto
  # `local p=$1 esp_h=${ORIG_SHA[$p]...}` usa $p no MESMO `local` que o declara: com `set -u`
  # isso e "unbound variable". Ja me pegou antes; por isso as declaracoes vao separadas.
  local p=$1 esp_h esp_m h m
  esp_h=${ORIG_SHA[$p]:-}; esp_m=${ORIG_MODO[$p]:-}
  MANIF_MOTIVO=""
  [ -n "$esp_h" ] || return 1
  [ -f "$p" ] || { MANIF_MOTIVO="manifesto cita $p, mas o disco nao tem arquivo regular"; return 1; }
  h=$(sha256sum -- "$p" 2>/dev/null | cut -d' ' -f1)
  m=$(stat -c%a -- "$p" 2>/dev/null)
  if [ "$h" != "$esp_h" ]; then MANIF_MOTIVO="conteudo difere do manifesto de origem"; return 1; fi
  if [ "$m" != "$esp_m" ]; then MANIF_MOTIVO="modo $m difere do manifesto de origem ($esp_m)"; return 1; fi
  return 0
}

MOTIVO=""
igual_alvo(){ # <path>
  local p=$1 md ms ma sa
  MOTIVO=""
  md=$(modo_disco "$p") || return 2
  ma=${ALVO_MODO[$p]:-}
  [ -n "$ma" ] || return 2
  if [ "$md" != "$ma" ]; then
    case "$md$ma" in
      *120000*|*040000*) MOTIVO="TIPO diferente (disco $md, alvo $ma)" ;;
      *)                 MOTIVO="MODO diferente (disco $md, alvo $ma)" ;;
    esac
    return 1
  fi
  ms=$(sha_disco "$p") || return 2
  [ -n "$ms" ] || return 2
  sa=$(sha_alvo "$p")  || return 2
  [ -n "$sa" ] || return 2
  [ "$ms" = "$sa" ] || { MOTIVO="CONTEUDO diferente"; return 1; }
  return 0
}

# INDICE. O reset --hard tambem reescreve o index, entao trabalho que existe SO la (staged e
# depois desfeito no disco) some sem rastro. Comparar index x alvo em TODO caminho reprovaria
# qualquer deploy normal - o index deve mesmo virar o alvo. O que nao pode sumir e o que o
# index guarda e nao existe nem no disco nem no alvo.
declare -A IDX_MODO IDX_SHA
while IFS= read -r -d '' linha; do
  meta=${linha%%$'\t'*}; cam=${linha#*$'\t'}
  # shellcheck disable=SC2086
  set -- $meta
  IDX_MODO["$cam"]=$1; IDX_SHA["$cam"]=$2
done < <(git ls-files -s -z 2>/dev/null)
indice_orfao() { # <path> -- rc 0 so quando o INDICE guarda TRABALHO que some no reset
  # REGRA CORRIGIDA (laudo v2.7, bloqueador 1). A versao anterior perguntava "o index difere
  # do disco E do alvo?" e com isso acusava dois casos inocentes:
  #   * indice desatualizado por MODO (legado 0750 no disco, 100644 no index): nada se perde,
  #     o conteudo e o mesmo nas tres pontas e o reset so atualiza o index;
  #   * arquivo modificado no disco (` M`): o index guarda a versao de HEAD, que e justamente
  #     a que o reset deve substituir. Chamar isso de "trabalho que some" trava a transicao.
  # Trabalho staged de verdade tem index DIFERENTE de HEAD. E so isso que pode sumir.
  local p=$1 im is hs s1
  im=${IDX_MODO[$p]:-}; is=${IDX_SHA[$p]:-}
  [ -n "$is" ] || return 1
  # index igual ao alvo: o reset e no-op para ele
  [ "$is" = "${ALVO_SHA[$p]:-}" ] && return 1
  # index igual a HEAD: nada foi staged; e so index desatualizado
  hs=$(git rev-parse "HEAD:$p" 2>/dev/null)
  [ -n "$hs" ] && [ "$is" = "$hs" ] && return 1
  # index igual ao disco: o conteudo existe fora do index, entao nao some
  if [ -L "$p" ]; then s1=$(readlink -- "$p" | tr -d '
' | git hash-object --stdin 2>/dev/null)
  else s1=$(git hash-object -- "$p" 2>/dev/null); fi
  [ -n "$s1" ] && [ "$is" = "$s1" ] && return 1
  return 0
}

# --- 1. RASTREADOS em qualquer estado != limpo -------------------------------------------
# -z evita a citacao de porcelain (paths com espaco/acentos vinham quebrados).
git status --porcelain=v1 -z --untracked-files=no > "$T/tracked.z" 2>/dev/null \
  || { echo "FATAL: git status falhou" >&2; exit 2; }
NTRACK=0
while IFS= read -r -d '' entrada; do
  XY=${entrada:0:2}; CAM=${entrada:3}
  # renomeado/copiado consome um campo extra (o nome antigo)
  ANTIGO=""
  case "$XY" in R*|C*|*R|*C) IFS= read -r -d '' ANTIGO || true ;; esac
  NTRACK=$((NTRACK+1))
  case "$XY" in
    \?\?*) continue ;;
    U*|*U|DD|AA) recusa "$CAM — conflito de merge ($XY); resolva antes de qualquer reset"; continue ;;
  esac
  if [ ! -e "$CAM" ]; then
    if no_alvo "$CAM"; then recusa "$CAM — apagado no disco ($XY); o reset o RESTAURARIA, desfazendo a exclusao"
    else recusa "$CAM — apagado no disco ($XY) e ausente do alvo"; fi
    continue
  fi
  if ! no_alvo "$CAM"; then
    recusa "$CAM — existe no disco ($XY) mas NAO no alvo; o reset o DESCARTARIA"; continue
  fi
  igual_alvo "$CAM"; rc=$?
  case $rc in
    0) echo "    ok        $CAM ($XY, conteudo+tipo+modo identicos ao alvo; reset e no-op)" ;;
    1) if origem_conhecida "$CAM"; then
         echo "    ok        $CAM ($XY, divergencia de ORIGEM conhecida: sha+modo batem com o manifesto v2.5)"
         MANIF_USADOS=$((MANIF_USADOS+1))
       else
         recusa "$CAM - $MOTIVO em relacao ao alvo ($XY)${MANIF_MOTIVO:+; manifesto: $MANIF_MOTIVO}; o reset descartaria essa mudanca"
       fi ;;
    *) recusa "$CAM — nao consegui medir ($XY)" ;;
  esac
done < "$T/tracked.z"
echo "  rastreados nao-limpos: $NTRACK"

# --- 1b. INTENCAO STAGED -------------------------------------------------------------------
# LAUDO v2.8, BLOQUEADOR 1: `git rm --cached x` + recriar o arquivo deixava `D  x` + `?? x`,
# o disco era identico ao alvo e o preflight aprovava -- mas o reset reescreve o INDICE e a
# delecao staged sumia.
#
# LAUDO v2.9, BLOQUEADOR 1: a correcao usava `git diff --cached --name-only HEAD`, e com a
# DETECCAO DE RENAME ligada isso devolve so o DESTINO do par -- `old.txt -> new.txt` aparece
# como `new.txt`, o lado removido some do inventario, e um rename staged era apagado pelo
# reset com o preflight verde. Reproduzido: HEAD com old, alvo com old+new identicos, rename
# staged, rc=0.
#
# O VEREDITO agora vem de comparacoes de ARVORE INTEIRA, que nao passam por parser de nomes
# nem por deteccao de rename -- nao ha lado a esconder:
#   indice == HEAD                        -> nao ha intencao staged; nada a proteger
#   indice != HEAD  e  indice == ALVO     -> o reset e no-op para o indice: passa
#   indice != HEAD  e  indice != ALVO     -> o reset apaga intencao: RECUSA
# O inventario por caminho continua existindo, mas so para DIAGNOSTICO, e com --no-renames,
# que lista origem E destino.
if git rev-parse --verify HEAD >/dev/null 2>&1; then
  git diff --cached --quiet --no-renames HEAD 2>/dev/null; RC_SG=$?
  case "$RC_SG" in
    0) echo "  intencao staged: nenhuma (indice identico a HEAD)" ;;
    1)
      git diff --cached --quiet --no-renames "$REF" 2>/dev/null; RC_SA=$?
      case "$RC_SA" in
        0) echo "  intencao staged: presente, mas o INDICE INTEIRO ja e igual ao alvo (reset e no-op para o indice)" ;;
        1)
          # diagnostico por caminho: origem e destino, sem deteccao de rename
          git diff --cached --name-only -z --no-renames HEAD > "$T/staged.z" 2>/dev/null; RC_LS=$?
          if [ "$RC_LS" -ne 0 ]; then
            echo "FATAL: git diff --cached --no-renames falhou (rc=$RC_LS) -- sem inventario, o reset nao pode ser liberado" >&2
            exit 2
          fi
          NSTAGED=0
          while IFS= read -r -d '' cam; do
            [ -n "$cam" ] || continue
            NSTAGED=$((NSTAGED+1))
            im=${IDX_MODO[$cam]:-}; is=${IDX_SHA[$cam]:-}
            am=${ALVO_MODO[$cam]:-}; as=${ALVO_SHA[$cam]:-}
            if [ "$im" = "$am" ] && [ "$is" = "$as" ]; then
              echo "    ok        $cam (staged, mas este caminho ja e igual ao alvo)"
            else
              recusa "$cam - intencao STAGED que o reset apaga (indice: ${im:-AUSENTE} ${is:0:7}; alvo: ${am:-AUSENTE} ${as:0:7})
              se a intencao e boa, commite-a; se nao e, desfaca com: git restore --staged -- $cam"
            fi
          done < "$T/staged.z"
          echo "  intencao staged: $NSTAGED caminho(s) com indice != HEAD (inventario --no-renames)"
          # SANIDADE CORRETA: com indice != HEAD (RC_SG=1), o inventario --no-renames tem
          # que listar pelo menos um caminho. Vazio aqui = inventario cego, e cego reprova.
          # (Comparar indice vs ALVO inteiro NAO serve como recusa: num deploy normal o
          #  indice difere do alvo em todos os arquivos que o deploy muda -- por isso a
          #  comparacao de arvore e so o ATALHO de aprovacao do caso RC_SA=0.)
          if [ "$NSTAGED" -eq 0 ]; then
            recusa "indice difere de HEAD mas o inventario staged voltou vazio -- inventario cego; fail-closed"
          fi
          ;;
        *) echo "FATAL: git diff --cached contra o alvo falhou (rc=$RC_SA)" >&2; exit 2 ;;
      esac
      ;;
    *) echo "FATAL: git diff --cached contra HEAD falhou (rc=$RC_SG)" >&2; exit 2 ;;
  esac
else
  echo "  intencao staged: repo sem HEAD, nada a comparar"
fi

# --- 2. UNTRACKED que COLIDE com a arvore alvo -------------------------------------------
# Este e o caso que a v2.1 ignorava. Sao exatamente os arquivos entregues por scp antes de
# serem commitados: se ja forem identicos, o reset e no-op; se divergirem, o reset apaga.
# FAIL-OPEN (laudo v2.3, bloqueador 1): era `... | sed ... > unt.txt || true`. O `|| true`
# valia para o PIPELINE INTEIRO, entao um `git status` que falhasse deixava unt.txt vazio e o
# preflight concluia "0 untracked, nada colide, PREFLIGHT OK, exit 0". Reproduzido pelo Alf
# fazendo o git status sair 42. Fail-open no gate que existe para impedir perda de trabalho.
# Agora o status vai para arquivo com o retorno CONFERIDO, e so depois e filtrado.
git status --porcelain=v1 -z -uall > "$T/status.z" 2>"$T/status.err"; RC_ST=$?
if [ "$RC_ST" -ne 0 ]; then
  # o rc tem que ser capturado ANTES de qualquer outro comando: dentro do `if`, `$?` ja e o
  # resultado do proprio teste, e a mensagem saia sempre "rc=0" — erro reportado como sucesso.
  echo "FATAL: git status -uall falhou (rc=$RC_ST): $(head -1 "$T/status.err" | cut -c1-140)" >&2
  echo "       sem inventario confiavel de untracked, o reset nao pode ser liberado" >&2
  exit 2
fi
tr '\0' '\n' < "$T/status.z" | sed -n 's/^?? //p' | LC_ALL=C sort > "$T/unt.txt"
NUNT=$(wc -l < "$T/unt.txt")            # wc -l, nunca grep -c: zero e resultado valido
LC_ALL=C comm -12 "$T/alvo.txt" "$T/unt.txt" > "$T/colide.txt"
NCOL=$(wc -l < "$T/colide.txt")
echo "  untracked: $NUNT total, $NCOL colidem com a arvore alvo"
if [ "$NCOL" -gt 0 ]; then
  while IFS= read -r c; do
    [ -n "$c" ] || continue
    igual_alvo "$c"; rc=$?
    case $rc in
      0) echo "    ok        $c (untracked com conteudo+tipo+modo identicos ao alvo; reset e no-op)" ;;
      1) if origem_conhecida "$c"; then
           echo "    ok        $c (untracked, divergencia de ORIGEM conhecida pelo manifesto v2.5)"
           MANIF_USADOS=$((MANIF_USADOS+1))
         else
           recusa "$c - untracked que o reset VAI SOBRESCREVER ($MOTIVO)${MANIF_MOTIVO:+; manifesto: $MANIF_MOTIVO}"
         fi ;;
      *) recusa "$c — untracked que colide e nao consegui medir" ;;
    esac
  done < "$T/colide.txt"
fi
echo "  untracked fora do alvo: $(( NUNT - NCOL )) — sobrevivem ao reset (medido)"

# --- 3. snapshot dos guardas: o que EXISTE AGORA, integralmente -----------------------------
# LAUDO v2.7, BLOQUEADOR 1. O snapshot exigia o inventario do CANDIDATO na worktree VELHA:
#   snapshot incompleto: 28/41 guardas -> PREFLIGHT REPROVADO
# Ou seja, o primeiro deploy nunca chegava ao reset, porque 13 arquivos so nascem DEPOIS dele.
# O snapshot serve para RESTAURAR o estado atual num rollback. Logo o conjunto correto e o que
# existe agora -- exigir arquivo que ainda nao existe nao protege nada, so trava a transicao.
# O rigor continua: tudo que EXISTE tem que entrar, e o tar e reconferido item a item. O que
# ainda nao existe e listado como "nasce no reset", que e informacao, nao falha.
if [ "$SNAP" = 1 ]; then
  if install -d -m 0700 "$DEST" 2>/dev/null; then
    PRESENTES=(); NASCEM=()
    for g in "${GUARDAS[@]}"; do
      if [ -f "scripts/$g.sh" ]; then PRESENTES+=("scripts/$g.sh"); else NASCEM+=("$g.sh"); fi
    done
    for d in "${DADOS[@]}"; do
      if [ -f "scripts/$d" ]; then PRESENTES+=("scripts/$d"); else NASCEM+=("$d"); fi
    done
    if [ "${#PRESENTES[@]}" -eq 0 ]; then
      recusa "nenhum guarda presente na arvore viva -- nao ha o que preservar, e isso nao e normal"
    else
      TAR="$DEST/guardas-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
      if ( umask 0177; tar -czf "$TAR" --owner=0 --group=0 -- "${PRESENTES[@]}" 2>/dev/null ) \
         && [ -s "$TAR" ] && tar -tzf "$TAR" >/dev/null 2>&1 \
         && [ "$(tar -tzf "$TAR" | wc -l)" -eq "${#PRESENTES[@]}" ]; then
        chmod 0600 "$TAR"
        echo "  snapshot: $TAR (${#PRESENTES[@]}/${#PRESENTES[@]} guardas existentes preservados)"
        [ "${#NASCEM[@]}" -gt 0 ] && echo "  nascem no reset (nao ha o que preservar): ${#NASCEM[@]} -- ${NASCEM[*]}"
        if cp -f scripts/restaurar-guardas.sh "$DEST/restaurar-guardas.sh" 2>/dev/null; then
          # 0700, nao 0750: este arquivo mora DENTRO de /opt/backups, e a regra de contencao
          # daquela arvore e "nada legivel/executavel por grupo ou outros".
          chmod 0700 "$DEST/restaurar-guardas.sh"
          echo "  restaurador fora do repo: $DEST/restaurar-guardas.sh"
        else
          recusa "nao consegui copiar o restaurador para $DEST"
        fi
      else
        rm -f "$TAR"
        recusa "nao consegui gravar/validar o snapshot em $TAR (parcial removido)"
      fi
    fi
  else
    recusa "nao consegui criar $DEST"
  fi
fi

echo
if [ "$PROBLEMAS" -gt 0 ]; then
  echo "== PREFLIGHT REPROVADO ($PROBLEMAS problema(s)) — NAO rode o reset =="
  exit 1
fi
[ "$MANIF_USADOS" -gt 0 ] && echo "  $MANIF_USADOS caminho(s) aceito(s) pelo manifesto de origem v2.5 (sha+modo exatos)"
echo "== PREFLIGHT OK — reset liberado; rode pos-deploy-modos.sh logo depois =="
