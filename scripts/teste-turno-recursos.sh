#!/bin/bash
# libLock acompanha o tip final, e o turno limpa exatamente o que criou.
# (laudo v2.8, bloqueadores 3 e 4)
# NIVEL: integration-sandbox. Repo e diretorios descartaveis; nao toca em producao, /run real,
# crontab nem rede.
#
# Bloqueador 3: na v2.8 o $candDir era refeito quando o tip mudava (commit, rebase, deploy_sha),
# mas $libLock ficava no tip INICIAL -- heartbeat e liberacao continuavam usando a lib antiga.
# Procurar a string "libLock" no .ps1 nao prova nada: e preciso simular
# tipBoot != tip pos-rebase != deploySha e provar que cada fase usa a lib do SHA vigente.
#
# Bloqueador 4: o dossie dizia que o diretorio de bootstrap era limpo no `finally`, mas o
# `finally` so soltava o lock. O fluxo cria ate tres diretorios e deixa refs para tras.

set -uo pipefail
AQUI="$(dirname "$(readlink -f "$0")")"
BS="$AQUI/bootstrap-candidato.sh"
P=0; F=0
ok()    { P=$((P+1)); printf '  ok    %s\n' "$1"; }
falhou(){ F=$((F+1)); printf '  FALHA %s\n' "$1"; }
D=$(mktemp -d "${TMPDIR:-/tmp}/turno29.XXXXXX")
trap 'rm -rf "$D"' EXIT INT TERM
export BOOTSTRAP_DEST="$D/run"; mkdir -p "$BOOTSTRAP_DEST"

R="$D/repo"
git init -q -b main "$R" 2>/dev/null
cd "$R" || exit 2
git config user.email t@t; git config user.name t; git config core.fileMode true
mkdir -p scripts

# tres versoes da MESMA lib, cada uma se identificando. E assim que da para saber qual delas
# uma fase carregou -- sem isso, "usa a lib do candidato" seria afirmacao sem medida.
lib_de() { printf '#!/bin/bash\nFASE_DA_LIB=%s\nlock_tomar(){ echo "ADQUIRIDO por %s"; }\nlock_heartbeat(){ echo "VIVO por %s"; }\nlock_soltar(){ echo "SOLTO por %s"; }\n' "$1" "$1" "$1" "$1"; }

lib_de BOOT > scripts/lib-lock.sh
git add -A >/dev/null 2>&1; git update-index --chmod=+x scripts/lib-lock.sh
git commit -qm "tipBoot"; SHA_BOOT=$(git rev-parse HEAD)

lib_de POS-REBASE > scripts/lib-lock.sh
git add -A >/dev/null 2>&1; git commit -qm "tip pos-rebase"; SHA_TIP=$(git rev-parse HEAD)

lib_de DEPLOY > scripts/lib-lock.sh
git add -A >/dev/null 2>&1; git commit -qm "deploy_sha"; SHA_DEPLOY=$(git rev-parse HEAD)

echo "== tres SHAs distintos, tres libs distintas =="
if [ "$SHA_BOOT" != "$SHA_TIP" ] && [ "$SHA_TIP" != "$SHA_DEPLOY" ]; then
  ok "tipBoot=${SHA_BOOT:0:8} != tip=${SHA_TIP:0:8} != deploySha=${SHA_DEPLOY:0:8}"
else
  falhou "os tres SHAs nao ficaram distintos -- o teste nao mede o bloqueador"
fi

# Espelha o fluxo do .ps1: Materializar-Candidato fixa candDir E libLock juntos.
NONCE=turno-um
materializar() {   # <sha> -> ecoa dir; fixa CAND_DIR e LIB_LOCK
  local sha=$1 out dir
  out=$(BOOTSTRAP_NONCE="$NONCE" bash "$BS" "$sha" "$R" 2>&1) || { echo ""; return 1; }
  dir=$(sed -n 's/^candidato=//p' <<<"$out" | head -1)
  [ -n "$dir" ] || { echo ""; return 1; }
  CAND_DIR=$dir
  LIB_LOCK="$dir/scripts/lib-lock.sh"
  DIRS_DO_TURNO="$DIRS_DO_TURNO $dir"
  printf '%s' "$dir"
}
DIRS_DO_TURNO=""
fase() { ( . "$LIB_LOCK"; "$1" ); }

echo "== BLOQUEADOR 3: cada fase usa a lib do SHA VIGENTE =="
materializar "$SHA_BOOT" >/dev/null
S=$(fase lock_tomar)
if grep -q 'por BOOT' <<<"$S"; then ok "aquisicao usa a lib do tipBoot ($S)"; else falhou "aquisicao usou '$S'"; fi

materializar "$SHA_TIP" >/dev/null
S=$(fase lock_heartbeat)
if grep -q 'por POS-REBASE' <<<"$S"; then ok "heartbeat pos-rebase usa a lib do tip novo ($S)"
else falhou "heartbeat usou a lib ERRADA: '$S' -- e exatamente o bloqueador"; fi

materializar "$SHA_DEPLOY" >/dev/null
S=$(fase lock_heartbeat)
if grep -q 'por DEPLOY' <<<"$S"; then ok "heartbeat no deploy_sha usa a lib do deploy_sha ($S)"
else falhou "heartbeat usou '$S'"; fi
S=$(fase lock_soltar)
if grep -q 'por DEPLOY' <<<"$S"; then ok "liberacao usa a lib do SHA final ($S)"
else falhou "liberacao usou '$S'"; fi

# o diretorio e a lib correspondem ao SHA literal vigente
case "$CAND_DIR" in *"$SHA_DEPLOY-$NONCE") ok "o diretorio carrega o SHA literal final e o nonce do turno" ;;
  *) falhou "diretorio nao corresponde ao SHA final: $CAND_DIR" ;; esac
if bash "$BS" --verificar "$CAND_DIR" "$SHA_DEPLOY" "$R" >/dev/null 2>&1; then
  ok "o conteudo do diretorio bate com a arvore do SHA final"
else falhou "o diretorio nao corresponde a arvore do SHA final"; fi

echo "== estrutura: so UM lugar atribui libLock, e e o mesmo que atribui candDir =="
PS1="$AQUI/auto-deploy.ps1"
if [ -r "$PS1" ]; then
  N_LIB=$(grep -cE '^\s*\$(script:)?libLock\s*=' "$PS1" || true)
  N_CAND=$(grep -cE '^\s*\$script:candDir\s*=' "$PS1" || true)
  if [ "$N_LIB" = 1 ] && [ "$N_CAND" = 1 ]; then
    ok "uma unica atribuicao de cada (libLock=$N_LIB, candDir=$N_CAND) -- nao ha como divergirem"
  else
    falhou "atribuicoes espalhadas (libLock=$N_LIB, candDir=$N_CAND): podem divergir de novo"
  fi
  L_LIB=$(grep -nE '^\s*\$script:libLock\s*=' "$PS1" | head -1 | cut -d: -f1)
  L_FUN=$(grep -n '^function Materializar-Candidato' "$PS1" | head -1 | cut -d: -f1)
  L_FIM=$(awk -v i="${L_FUN:-0}" 'NR>i && /^}/ {print NR; exit}' "$PS1")
  if [ -n "$L_LIB" ] && [ -n "$L_FUN" ] && [ "$L_LIB" -gt "$L_FUN" ] && [ "$L_LIB" -lt "${L_FIM:-0}" ]; then
    ok "a atribuicao de libLock mora DENTRO de Materializar-Candidato (linha $L_LIB)"
  else
    falhou "libLock atribuido fora da funcao (linha ${L_LIB:-nenhuma}; funcao ${L_FUN:-?}..${L_FIM:-?})"
  fi
else
  falhou "auto-deploy.ps1 nao encontrado"
fi

echo "== BLOQUEADOR 4: o turno limpa exatamente o que criou =="
N_DIRS=$(printf '%s\n' $DIRS_DO_TURNO | grep -c . || true)
[ "$N_DIRS" = 3 ] && ok "o turno registrou os 3 diretorios que criou" || falhou "$N_DIRS diretorio(s) registrados, esperado 3"
VIVOS=0; for d in $DIRS_DO_TURNO; do [ -d "$d" ] && VIVOS=$((VIVOS+1)); done
[ "$VIVOS" = 3 ] && ok "os 3 existem antes da limpeza" || falhou "$VIVOS de 3 existem"

# segundo turno, MESMO sha, nonce diferente: nada dele pode ser tocado
NONCE_OUTRO=turno-dois
OUT2=$(BOOTSTRAP_NONCE="$NONCE_OUTRO" bash "$BS" "$SHA_DEPLOY" "$R" 2>&1)
DIR_OUTRO=$(sed -n 's/^candidato=//p' <<<"$OUT2" | head -1)
[ -n "$DIR_OUTRO" ] && [ "$DIR_OUTRO" != "$CAND_DIR" ] && ok "o outro turno tem diretorio proprio do MESMO sha" \
  || falhou "os dois turnos colidiram ($DIR_OUTRO)"

# limpeza do turno UM: caminho completo, um a um, nunca glob
for d in $DIRS_DO_TURNO; do
  case "$d" in
    "$BOOTSTRAP_DEST"/tom-cand-????????????????????????????????????????-"$NONCE") rm -rf -- "$d" ;;
    *) falhou "diretorio com nome inesperado, nao removido: $d" ;;
  esac
done
RESTOU=0; for d in $DIRS_DO_TURNO; do [ -d "$d" ] && RESTOU=$((RESTOU+1)); done
[ "$RESTOU" = 0 ] && ok "zero diretorio residual do proprio turno" || falhou "$RESTOU diretorio(s) do turno sobraram"
[ -d "$DIR_OUTRO" ] && ok "o diretorio do OUTRO turno continua intacto" || falhou "a limpeza apagou recurso alheio"
[ -f "$DIR_OUTRO/scripts/lib-lock.sh" ] && ok "a lib que o outro turno usa nos heartbeats sobreviveu" \
  || falhou "a limpeza removeu a lib do outro turno"
rm -rf "$DIR_OUTRO"

echo "== o padrao de nome recusa recurso alheio =="
# a mesma guarda do .ps1: caminho fora do formato nao e removido
FORA="$BOOTSTRAP_DEST/tom-cand-nao-e-sha"
mkdir -p "$FORA"
case "$FORA" in
  "$BOOTSTRAP_DEST"/tom-cand-????????????????????????????????????????-*) falhou "nome invalido casou o padrao" ;;
  *) ok "caminho fora do formato <sha40>-<nonce> nao casa o padrao de limpeza" ;;
esac
rm -rf "$FORA"

echo "== e o .ps1 limpa no finally, sem glob =="
if [ -r "$PS1" ]; then
  A=$(grep -n '^finally {' "$PS1" | head -1 | cut -d: -f1)
  TRECHO=$(awk -v i="$A" 'NR>=i' "$PS1")
  grep -q 'recursosDir' <<<"$TRECHO" && ok "o finally percorre os diretorios registrados" || falhou "finally nao limpa diretorios"
  grep -q 'recursosRef' <<<"$TRECHO" && ok "o finally percorre as refs registradas" || falhou "finally nao limpa refs"
  # so CODIGO: a linha que explica por que glob e errado nao e glob. Contar comentario como
  # codigo e a forma mais facil de um teste estrutural virar ruido -- ja me pegou antes.
  if grep -vE '^\s*#' "$PS1" | grep -qE 'rm -rf .*tom-cand-\*'; then falhou "ha glob amplo na limpeza"; else ok "nenhum glob amplo na limpeza (comentarios nao contam)"; fi
  grep -q 'LIMPEZA INCOMPLETA' <<<"$TRECHO" && ok "falha de limpeza e reportada sem mascarar o veredito" \
    || falhou "falha de limpeza silenciosa"
  grep -q 'Soltar-LockDeploy' <<<"$TRECHO" && ok "o lock continua sendo solto no finally" || falhou "finally deixou de soltar o lock"
fi

echo
echo "== $P passaram, $F falharam =="
[ "$F" -eq 0 ]
