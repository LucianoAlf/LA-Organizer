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
PROBLEMAS=0
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
indice_orfao() { # <path> -- rc 0 se o index guarda versao ausente do disco E do alvo
  local p=$1 im is md s1
  im=${IDX_MODO[$p]:-}; is=${IDX_SHA[$p]:-}
  [ -n "$im" ] || return 1
  [ "$im" = "${ALVO_MODO[$p]:-}" ] && [ "$is" = "${ALVO_SHA[$p]:-}" ] && return 1
  md=$(modo_disco "$p" 2>/dev/null) || return 1
  if [ -L "$p" ]; then s1=$(readlink -- "$p" | tr -d '\n' | git hash-object --stdin 2>/dev/null)
  else s1=$(git hash-object -- "$p" 2>/dev/null); fi
  [ "$im" = "$md" ] && [ "$is" = "$s1" ] && return 1
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
    0) if indice_orfao "$CAM"; then
         recusa "$CAM - o INDICE guarda versao ausente do disco E do alvo ($XY); o reset a apaga"
       else
         echo "    ok        $CAM ($XY, conteudo+tipo+modo identicos ao alvo; reset e no-op)"
       fi ;;
    1) recusa "$CAM - $MOTIVO em relacao ao alvo ($XY); o reset descartaria essa mudanca
              veja com: git diff $REF -- $CAM" ;;
    *) recusa "$CAM — nao consegui medir ($XY)" ;;
  esac
done < "$T/tracked.z"
echo "  rastreados nao-limpos: $NTRACK"

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
      1) recusa "$c - untracked que o reset VAI SOBRESCREVER ($MOTIVO)" ;;
      *) recusa "$c — untracked que colide e nao consegui medir" ;;
    esac
  done < "$T/colide.txt"
fi
echo "  untracked fora do alvo: $(( NUNT - NCOL )) — sobrevivem ao reset (medido)"

# --- 3. snapshot dos guardas: 18/18 ou nada ----------------------------------------------
if [ "$SNAP" = 1 ]; then
  if install -d -m 0700 "$DEST" 2>/dev/null; then
    PRESENTES=(); AUSENTES=()
    for g in "${GUARDAS[@]}"; do
      if [ -f "scripts/$g.sh" ]; then PRESENTES+=("scripts/$g.sh"); else AUSENTES+=("$g.sh"); fi
    done
    for d in "${DADOS[@]}"; do
      if [ -f "scripts/$d" ]; then PRESENTES+=("scripts/$d"); else AUSENTES+=("$d"); fi
    done
    # v2.1 aceitava snapshot parcial (bastava >=1 arquivo). Rollback com snapshot incompleto
    # restaura uma parte dos guardas e deixa o resto ausente — pior que nao restaurar, porque
    # PARECE que restaurou. Agora e 18/18 ou recusa.
    if [ "${#PRESENTES[@]}" -ne "$GUARDAS_ESPERADOS" ]; then
      recusa "snapshot incompleto: ${#PRESENTES[@]}/$GUARDAS_ESPERADOS guardas (faltam: ${AUSENTES[*]})"
    else
      TAR="$DEST/guardas-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
      if ( umask 0177; tar -czf "$TAR" --owner=0 --group=0 -- "${PRESENTES[@]}" 2>/dev/null ) \
         && [ -s "$TAR" ] && tar -tzf "$TAR" >/dev/null 2>&1 \
         && [ "$(tar -tzf "$TAR" | wc -l)" -eq "$GUARDAS_ESPERADOS" ]; then
        chmod 0600 "$TAR"
        echo "  snapshot: $TAR ($GUARDAS_ESPERADOS/$GUARDAS_ESPERADOS guardas)"
        if cp -f scripts/restaurar-guardas.sh "$DEST/restaurar-guardas.sh" 2>/dev/null; then
          # 0700, nao 0750: este arquivo mora DENTRO de /opt/backups, e a regra de contencao
          # daquela arvore e "nada legivel/executavel por grupo ou outros". Com 0750 ele
          # aparecia como artefato exposto — o proprio smoke pegou a contradicao. So root
          # roda isto, entao 0700 atende as duas coisas.
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
echo "== PREFLIGHT OK — reset liberado; rode pos-deploy-modos.sh logo depois =="
