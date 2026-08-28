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
cd "$(dirname "$(readlink -f "$0")")/.." || exit 2

GUARDAS=(alertar backup-db backup-secrets check-backup conter-permissoes lib-baseline-queries
         lib-pgconn patch-crontab pos-deploy-modos preflight-deploy restaurar-guardas
         restaurar-modos restore-drill smoke-pos-aplicacao teste-negativo-dataapi
         teste-negativo-permissoes verificar-bundle)
GUARDAS_ESPERADOS=$(( ${#GUARDAS[@]} + 1 ))   # +1 = bundle-allowlist.txt
DEST=${GUARDAS_DIR:-/opt/backups/la-organizer/guardas}
PROBLEMAS=0
T=$(mktemp -d /run/preflight.XXXXXX 2>/dev/null || mktemp -d) || { echo "FATAL: mktemp" >&2; exit 2; }
chmod 0700 "$T"; trap 'rm -rf "$T"' EXIT INT TERM

recusa() { echo "    RECUSADO  $1"; PROBLEMAS=$((PROBLEMAS+1)); }

echo "== preflight para $REF =="
git rev-parse --verify "$REF^{commit}" >/dev/null 2>&1 || { echo "FATAL: ref $REF nao existe (fez fetch?)" >&2; exit 2; }
echo "  alvo: $(git rev-parse --short "$REF")  atual: $(git rev-parse --short HEAD)"

# Arvore alvo inteira, ordenada — e o conjunto do que o reset vai escrever.
git ls-tree -r "$REF" --name-only -z 2>/dev/null | tr '\0' '\n' | LC_ALL=C sort > "$T/alvo.txt" \
  || { echo "FATAL: nao consegui listar a arvore de $REF" >&2; exit 2; }
[ -s "$T/alvo.txt" ] || { echo "FATAL: arvore de $REF veio vazia" >&2; exit 2; }
echo "  arvore alvo: $(wc -l < "$T/alvo.txt") arquivo(s)"

no_alvo()   { LC_ALL=C grep -qxF -- "$1" "$T/alvo.txt"; }
igual_alvo(){ # <path> — disco byte-identico ao blob do alvo?
  local d a
  d=$(sha256sum -- "$1" 2>/dev/null | cut -d' ' -f1) || return 2
  [ -n "$d" ] || return 2
  a=$(git cat-file blob "$REF:$1" 2>/dev/null | sha256sum | cut -d' ' -f1) || return 2
  [ "$d" = "$a" ]
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
    0) echo "    ok        $CAM ($XY, identico ao alvo; reset e no-op)" ;;
    1) recusa "$CAM — DIVERGE do alvo ($XY); ha trabalho local que o reset descartaria
              veja com: git diff $REF -- $CAM" ;;
    *) recusa "$CAM — nao consegui medir ($XY)" ;;
  esac
done < "$T/tracked.z"
echo "  rastreados nao-limpos: $NTRACK"

# --- 2. UNTRACKED que COLIDE com a arvore alvo -------------------------------------------
# Este e o caso que a v2.1 ignorava. Sao exatamente os arquivos entregues por scp antes de
# serem commitados: se ja forem identicos, o reset e no-op; se divergirem, o reset apaga.
git status --porcelain=v1 -z -uall 2>/dev/null | tr '\0' '\n' \
  | sed -n 's/^?? //p' | LC_ALL=C sort > "$T/unt.txt" || true
NUNT=$(wc -l < "$T/unt.txt")            # wc -l, nunca grep -c: zero e resultado valido
LC_ALL=C comm -12 "$T/alvo.txt" "$T/unt.txt" > "$T/colide.txt"
NCOL=$(wc -l < "$T/colide.txt")
echo "  untracked: $NUNT total, $NCOL colidem com a arvore alvo"
if [ "$NCOL" -gt 0 ]; then
  while IFS= read -r c; do
    [ -n "$c" ] || continue
    igual_alvo "$c"; rc=$?
    case $rc in
      0) echo "    ok        $c (untracked identico ao alvo; reset e no-op)" ;;
      1) recusa "$c — untracked que o reset VAI SOBRESCREVER com conteudo diferente" ;;
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
    if [ -f scripts/bundle-allowlist.txt ]; then PRESENTES+=(scripts/bundle-allowlist.txt)
    else AUSENTES+=(bundle-allowlist.txt); fi
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
