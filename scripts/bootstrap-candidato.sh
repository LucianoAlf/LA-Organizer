#!/bin/bash
# bootstrap-candidato.sh -- materializa os scripts do CANDIDATO fora da worktree viva.
#
# LAUDO v2.6, BLOQUEADOR 3. O auto-deploy carregava
# `/opt/LA-Organizer/scripts/lib-lock.sh` ANTES de transportar/aplicar o candidato -- e esse
# arquivo nao existe no runtime v2.5 que esta vivo. Pior: o preflight inicial era o da arvore
# VELHA, nao o do candidato. Ou seja, o gate que decide se o candidato pode entrar era o gate
# que o candidato veio substituir, e o pre-requisito escondido era eu ter feito `scp` a mao.
#
# COMO ISTO NAO TEM O MESMO PROBLEMA: este arquivo nao precisa existir na VPS. O auto-deploy
# manda o CONTEUDO dele pelo stdin do ssh (`ssh tom "bash -s -- <sha>" < bootstrap-candidato.sh`).
# O unico pre-requisito e o que a v2.5 ja tem: bash, git, tar, sha256sum.
#
# O QUE FAZ:
#   1. confere que o objeto <sha> existe no repo (nao o busca da rede);
#   2. extrai `scripts/` daquele commit para /run/tom-cand-<sha>/ -- FORA da worktree viva,
#      sem tocar em HEAD, no indice, no disco do repo ou em qualquer ref;
#   3. reconfere CADA arquivo extraido contra o blob id da arvore do commit;
#   4. imprime o diretorio. Qualquer divergencia: apaga tudo e falha.
#
# Uso:  bash bootstrap-candidato.sh <sha> [repo]   (repo default: /opt/LA-Organizer)
# Saida: `candidato=<dir>` na ultima linha, em caso de sucesso.

set -uo pipefail
# --verificar <dir> <sha> [repo]: reconfere um diretorio ja materializado, sem extrair nada.
MODO=materializar; VERIF_DIR=""
if [ "${1:-}" = "--verificar" ]; then MODO=verificar; VERIF_DIR=${2:?uso: --verificar <dir> <sha>}; shift 2; fi
SHA=${1:?uso: $0 <sha-de-40> [repo]}
REPO=${2:-/opt/LA-Organizer}
DEST_BASE=${BOOTSTRAP_DEST:-/run}

case "$SHA" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) : ;;
  *) echo "FATAL: sha invalido: $SHA" >&2; exit 2 ;;
esac
[ "${#SHA}" = 40 ] || { echo "FATAL: exijo sha de 40 hex (recebi ${#SHA})" >&2; exit 2; }
[ -d "$REPO/.git" ] || { echo "FATAL: $REPO nao e repo git" >&2; exit 2; }
cd "$REPO" || exit 2

# O objeto precisa JA estar aqui. Este script nao busca nada da rede: quem transporta e o
# `git push` do candidato, que acontece antes e e conferido.
git cat-file -e "$SHA^{commit}" 2>/dev/null || {
  echo "FATAL: o commit $SHA nao existe no repo local -- transporte o candidato antes" >&2; exit 3; }

if [ "$MODO" = materializar ]; then
DEST="$DEST_BASE/tom-cand-$SHA"
rm -rf "$DEST"
mkdir -p "$DEST" || { echo "FATAL: nao consegui criar $DEST" >&2; exit 2; }
chmod 0700 "$DEST"

# `git archive` le do banco de objetos: nao mexe em HEAD, indice, worktree nem refs.
if ! git archive --format=tar "$SHA" scripts/ 2>/dev/null | tar -x -C "$DEST" 2>/dev/null; then
  rm -rf "$DEST"; echo "FATAL: nao consegui extrair scripts/ de $SHA" >&2; exit 2
fi
[ -d "$DEST/scripts" ] || { rm -rf "$DEST"; echo "FATAL: extracao nao produziu scripts/" >&2; exit 2; }
fi

# CONFERENCIA ARQUIVO A ARQUIVO contra o blob id da arvore. Sem isto, "extrai e usa" confiaria
# no tar; com isto, qualquer byte diferente do commit reprova o bootstrap inteiro.
ESP=$(mktemp "${TMPDIR:-/tmp}/bootesp.XXXXXX"); OBT=$(mktemp "${TMPDIR:-/tmp}/bootobt.XXXXXX")
trap 'rm -f "$ESP" "$OBT"' EXIT INT TERM

# Conferencia reutilizavel: o modo --verificar chama a mesma funcao, para que "esta
# integro?" seja perguntavel a qualquer momento e nao so no instante da extracao.
conferir_contra_arvore() {   # <dir> <sha> -> rc 0 integro | 1 diverge
  local dir=$1 sha=$2
  git ls-tree -r "$sha" -- scripts/ | awk '{print $3"  "$4}' | LC_ALL=C sort > "$ESP"
  ( cd "$dir" && find scripts -type f | LC_ALL=C sort | while IFS= read -r f; do
      printf '%s  %s
' "$(git hash-object -- "$f")" "$f"
    done ) | LC_ALL=C sort > "$OBT"
  diff -q "$ESP" "$OBT" >/dev/null 2>&1 && return 0
  echo "  divergencia entre o extraido e a arvore de ${sha:0:8}:" >&2
  diff "$ESP" "$OBT" | head -10 | sed 's/^/    /' >&2
  return 1
}

if [ "$MODO" = verificar ]; then
  [ -d "$VERIF_DIR/scripts" ] || { echo "FATAL: $VERIF_DIR nao tem scripts/" >&2; exit 2; }
  if conferir_contra_arvore "$VERIF_DIR" "$SHA"; then
    echo "integro: $(wc -l < "$ESP") arquivo(s) batem com a arvore de ${SHA:0:8}"; exit 0
  fi
  echo "FATAL: $VERIF_DIR NAO corresponde a ${SHA:0:8}" >&2; exit 1
fi

if ! conferir_contra_arvore "$DEST" "$SHA"; then
  echo "FATAL: o que foi extraido NAO bate com a arvore de $SHA" >&2
  rm -rf "$DEST"; exit 1
fi

N=$(wc -l < "$ESP")
# Modo: o candidato precisa poder RODAR de dentro do diretorio de bootstrap. O bit de execucao
# vem da arvore (100755), e a contencao (0750) e aplicada aqui para nao expor nada em /run.
while IFS= read -r linha; do
  cam=${linha#*  }
  m=$(git ls-tree "$SHA" -- "$cam" | awk '{print $1}')
  case "$m" in
    100755) chmod 0750 "$DEST/$cam" ;;
    *)      chmod 0640 "$DEST/$cam" ;;
  esac
done < "$ESP"

echo "bootstrap: $N arquivo(s) de scripts/ conferidos contra a arvore de ${SHA:0:8}"
echo "candidato=$DEST"
