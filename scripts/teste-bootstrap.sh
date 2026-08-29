#!/bin/bash
# Bootstrap do candidato a partir do layout v2.5 (laudo v2.6, bloqueador 3).
# NIVEL: integration-sandbox. Repo descartavel; nao toca em producao, /run real, crontab ou rede.
#
# O falso-verde: o auto-deploy carregava `/opt/LA-Organizer/scripts/lib-lock.sh` ANTES de
# transportar/aplicar o candidato -- arquivo que NAO existe no runtime v2.5 vivo. E o preflight
# inicial era o da arvore velha, nao o do candidato: o gate que decide se o candidato entra era
# o gate que o candidato veio substituir. O pre-requisito escondido era eu ter feito `scp` a mao.
#
# Este teste comeca com lib-lock.sh e lib-guardas.sh AUSENTES do runtime, como na v2.5.

set -uo pipefail
AQUI="$(dirname "$(readlink -f "$0")")"
BS="$AQUI/bootstrap-candidato.sh"
P=0; F=0
ok()    { P=$((P+1)); printf '  ok    %s\n' "$1"; }
falhou(){ F=$((F+1)); printf '  FALHA %s\n' "$1"; }
D=$(mktemp -d "${TMPDIR:-/tmp}/bootteste.XXXXXX")
trap 'rm -rf "$D"' EXIT INT TERM
export BOOTSTRAP_DEST="$D/run"
mkdir -p "$BOOTSTRAP_DEST"

# --- runtime "v2.5": sem lib-lock.sh, sem lib-guardas.sh ----------------------------------
git init -q -b main "$D/runtime" 2>/dev/null
cd "$D/runtime" || exit 2
git config user.email t@t; git config user.name t; git config core.fileMode true
mkdir -p scripts src
printf '#!/bin/sh\necho preflight VELHO da arvore viva\nexit 0\n' > scripts/preflight-deploy.sh
chmod +x scripts/preflight-deploy.sh
printf 'console.log(1);\n' > src/index.js
git add -A >/dev/null 2>&1; git update-index --chmod=+x scripts/preflight-deploy.sh
git commit -qm "runtime v2.5"
V25=$(git rev-parse HEAD)

echo "== o runtime comeca como a v2.5: sem as libs novas =="
[ ! -f scripts/lib-lock.sh ] && [ ! -f scripts/lib-guardas.sh ] && ok "lib-lock.sh e lib-guardas.sh AUSENTES no runtime" \
  || falhou "o teste nao partiu do layout v2.5"

# --- candidato: commit com as libs, SEM fazer checkout dele -------------------------------
git checkout -q -b candidato
cp "$AQUI/lib-lock.sh" scripts/ 2>/dev/null || printf 'lock_tomar(){ echo ADQUIRIDO; }\n' > scripts/lib-lock.sh
cp "$AQUI/lib-guardas.sh" scripts/ 2>/dev/null || printf 'GUARDAS=(x)\n' > scripts/lib-guardas.sh
printf '#!/bin/sh\necho preflight DO CANDIDATO\nexit 0\n' > scripts/preflight-deploy.sh
git add -A >/dev/null 2>&1
for f in lib-lock.sh lib-guardas.sh preflight-deploy.sh; do git update-index --chmod=+x "scripts/$f"; done
git commit -qm "candidato v2.7"
CAND=$(git rev-parse HEAD)
# volta o runtime para o estado v2.5: o candidato existe SO no banco de objetos
git checkout -q -f main
git branch -qD candidato 2>/dev/null; git update-ref refs/candidato/"$CAND" "$CAND"
[ ! -f scripts/lib-lock.sh ] && ok "worktree segue no estado v2.5 (candidato so em objeto)" \
  || falhou "o checkout trouxe o candidato para o disco"

HEAD_ANTES=$(git rev-parse HEAD)
ST_ANTES=$(git status --porcelain=v1 | md5sum)

echo "== bootstrap materializa o candidato FORA da worktree =="
S=$(bash "$BS" "$CAND" "$D/runtime" 2>&1); RC=$?
DIR=$(sed -n 's/^candidato=//p' <<<"$S" | head -1)
[ "$RC" = 0 ] && [ -n "$DIR" ] && ok "bootstrap rc=0 e imprimiu candidato=<dir>" || { falhou "rc=$RC: $(tail -2 <<<"$S")"; }
[ -f "$DIR/scripts/lib-lock.sh" ] && ok "lib-lock.sh materializado (nao existia no runtime)" || falhou "lib-lock.sh ausente no bootstrap"
[ -f "$DIR/scripts/lib-guardas.sh" ] && ok "lib-guardas.sh materializado" || falhou "lib-guardas.sh ausente"
grep -q 'DO CANDIDATO' "$DIR/scripts/preflight-deploy.sh" && ok "o preflight materializado e o DO CANDIDATO, nao o da arvore viva" \
  || falhou "materializou o preflight velho"

echo "== e NAO toca no runtime vivo =="
[ ! -f scripts/lib-lock.sh ] && ok "worktree viva continua sem lib-lock.sh" || falhou "o bootstrap escreveu na worktree"
[ "$(git rev-parse HEAD)" = "$HEAD_ANTES" ] && ok "HEAD inalterado" || falhou "o bootstrap moveu HEAD"
[ "$(git status --porcelain=v1 | md5sum)" = "$ST_ANTES" ] && ok "git status identico (indice e disco intactos)" || falhou "o bootstrap sujou o repo"
grep -q 'DO CANDIDATO' scripts/preflight-deploy.sh && falhou "o preflight da worktree foi substituido" \
  || ok "o preflight da worktree continua sendo o velho"

echo "== o candidato materializado RODA de onde esta =="
SAIDA=$("$DIR/scripts/preflight-deploy.sh" 2>&1); RC=$?
[ "$RC" = 0 ] && grep -q 'DO CANDIDATO' <<<"$SAIDA" && ok "preflight do candidato executa a partir do bootstrap" \
  || falhou "nao consegui executar do diretorio de bootstrap (rc=$RC)"
# shellcheck disable=SC1090
if . "$DIR/scripts/lib-lock.sh" 2>/dev/null && command -v lock_tomar >/dev/null 2>&1; then
  ok "lib-lock.sh do candidato carrega (era o arquivo que faltava na v2.5)"
else
  falhou "nao consegui carregar a lib do candidato"
fi

echo "== modo e contencao =="
M=$(stat -c%a "$DIR/scripts/lib-lock.sh")
[ "$M" = 750 ] && ok "guarda materializado em 0750 (nada exposto em /run)" || falhou "modo do materializado: $M"
MD=$(stat -c%a "$DIR")
[ "$MD" = 700 ] && ok "diretorio de bootstrap em 0700" || falhou "diretorio em $MD"

echo "== integridade: adulterar o materializado REPROVA =="
S=$(bash "$BS" --verificar "$DIR" "$CAND" "$D/runtime" 2>&1); RC=$?
[ "$RC" = 0 ] && ok "--verificar aprova o diretorio integro" || falhou "rc=$RC no diretorio integro"
printf '# adulterado\n' >> "$DIR/scripts/lib-lock.sh"
S=$(bash "$BS" --verificar "$DIR" "$CAND" "$D/runtime" 2>&1); RC=$?
[ "$RC" != 0 ] && ok "--verificar detecta adulteracao (rc=$RC)" || falhou "adulteracao passou"
grep -q 'lib-lock.sh' <<<"$S" && ok "diz QUAL arquivo divergiu" || falhou "nao nomeia o arquivo adulterado"

echo "== sha inexistente no repo NAO e buscado da rede: falha fechada =="
# 40 zeros CONSTRUIDOS, nao escritos: constante hex longa e indistinguivel de segredo
# pela forma, e o scanner do pacote a reportava (com razao).
ZEROS40=$(printf '0%.0s' $(seq 1 40))
S=$(bash "$BS" "$ZEROS40" "$D/runtime" 2>&1); RC=$?
[ "$RC" = 3 ] && ok "commit ausente reprova com rc=3 (transporte antes)" || falhou "rc=$RC para sha inexistente"
S=$(bash "$BS" naoehsha "$D/runtime" 2>&1); RC=$?
[ "$RC" = 2 ] && ok "sha malformado reprova com rc=2" || falhou "rc=$RC para sha malformado"

echo "== o auto-deploy usa o bootstrap, e nao a arvore viva =="
PS1="$AQUI/auto-deploy.ps1"
if [ -r "$PS1" ]; then
  grep -q 'bootstrap-candidato.sh' "$PS1" && ok "auto-deploy invoca o bootstrap" || falhou "auto-deploy nao invoca o bootstrap"
  grep -q 'bash -s --' "$PS1" && ok "manda o script pelo stdin (nao exige que exista na VPS)" \
    || falhou "o bootstrap depende de o arquivo ja estar na VPS"
  grep -qE '\$candDir' "$PS1" && ok "usa o diretorio do candidato nas etapas seguintes" \
    || falhou "nao usa o diretorio materializado"
  L_LIB=$(grep -n 'libLock = ' "$PS1" | head -1 | cut -d: -f1)
  grep -qE 'libLock *= *"\$candDir' "$PS1" && ok "a lib de lock vem do candidato, nao de /opt" \
    || falhou "libLock ainda aponta para a arvore viva (linha ${L_LIB:-?})"
else
  falhou "auto-deploy.ps1 nao encontrado"
fi

echo
echo "== $P passaram, $F falharam =="
[ "$F" -eq 0 ]
