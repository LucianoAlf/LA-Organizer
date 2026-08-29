#!/bin/bash
# Ciclo de modos NAO pode se autotravar (laudo v2.6, bloqueador 1).
# Repo descartavel; nao toca em producao, em /run, em crontab nem na rede.
#
# O falso-verde: `pos-deploy-modos.sh` punha 0750 em 15 guardas que o git guardava como
# 100644. O preflight SEGUINTE -- que passou a comparar modo na v2.6 -- recusava esses mesmos
# 15 por "MODO diferente (disco 100755, alvo 100644)". Ou seja: o estado que o pos-deploy
# PRODUZ era rejeitado pelo gate que roda logo depois. Isso nao e rigor, e deadlock.
#
# A fonte canonica de modo passa a ser o GIT (lib-guardas.sh: modo_git_canonico). O disco
# vivo usa 0750/0640 por contencao, e os dois mapeiam para o mesmo modo git, porque o git so
# guarda o bit de execucao do dono.

set -uo pipefail
AQUI="$(dirname "$(readlink -f "$0")")"
P=0; F=0
ok()    { P=$((P+1)); printf '  ok    %s\n' "$1"; }
falhou(){ F=$((F+1)); printf '  FALHA %s\n' "$1"; }
D=$(mktemp -d "${TMPDIR:-/tmp}/modocanon.XXXXXX")
trap 'rm -rf "$D"' EXIT INT TERM

# shellcheck disable=SC1090
. "$AQUI/lib-guardas.sh" || { echo "  ABORTADO: lib-guardas.sh nao carrega"; exit 2; }

echo "== o contrato existe e e consultavel =="
[ "$(modo_git_canonico scripts/alertar.sh)" = 100755 ] && ok "guarda .sh -> 100755" || falhou "guarda nao mapeia para 100755"
[ "$(modo_git_canonico scripts/bundle-allowlist.txt)" = 100644 ] && ok "dado -> 100644" || falhou "dado nao mapeia para 100644"
modo_git_canonico scripts/nao-e-guarda.sh >/dev/null 2>&1 && falhou "arquivo fora do inventario recebeu modo canonico" \
  || ok "arquivo fora do inventario nao tem modo canonico (rc!=0)"

# --- repo de laboratorio ------------------------------------------------------------------
git init -q -b main "$D/repo" 2>/dev/null
cd "$D/repo" || exit 2
git config user.email t@t; git config user.name t; git config core.fileMode true
mkdir -p scripts
# so o necessario para o preflight e o pos-deploy-modos rodarem
for f in lib-guardas.sh preflight-deploy.sh pos-deploy-modos.sh; do cp "$AQUI/$f" scripts/; done
# stubs para todo guarda declarado, para o inventario fechar
# shellcheck disable=SC2154
for g in "${GUARDAS[@]}"; do
  [ -f "scripts/$g.sh" ] || printf '#!/bin/sh\n# stub de laboratorio\nexit 0\n' > "scripts/$g.sh"
done
for d in "${DADOS[@]}"; do printf '# stub\n' > "scripts/$d"; done
git add -A >/dev/null 2>&1
# aplica o modo CANONICO no indice, que e o que o pacote entrega
for g in "${GUARDAS[@]}"; do git update-index --chmod=+x "scripts/$g.sh"; done
git commit -qm base
ALVO=$(git rev-parse HEAD)

if [ "$(git ls-tree "$ALVO" -- scripts/alertar.sh | awk '{print $1}')" != 100755 ]; then
  echo "  ABORTADO: este filesystem nao guarda o bit de execucao"; exit 2
fi

echo "== a arvore entregue respeita o contrato =="
FORA=$(modos_fora_do_contrato "$ALVO"); RC=$?
if [ "$RC" = 2 ]; then falhou "nao consegui medir os modos (git ausente)"
elif [ -z "$FORA" ]; then ok "todos os ${#GUARDAS[@]} guardas e ${#DADOS[@]} dados no modo canonico"
else falhou "$(printf '%s' "$FORA" | wc -l) caminho(s) fora do contrato:"; printf '%s\n' "$FORA" | head -4 | sed 's/^/        /'; fi

echo "== O BLOQUEADOR: deploy simulado -> pos-modos -> preflight no MESMO commit =="
# simula o que o deploy faz: checkout limpo (git aplica 100644/100755), depois pos-modos
# (0750/0640), depois o preflight contra o MESMO commit.
git checkout -q -f "$ALVO"
./scripts/pos-deploy-modos.sh > "$D/modos.out" 2>&1; RC_M=$?
[ "$RC_M" = 0 ] && ok "pos-deploy-modos rc=0 ($(tail -1 "$D/modos.out" | cut -c1-64))" \
  || { falhou "pos-deploy-modos rc=$RC_M"; tail -2 "$D/modos.out" | sed 's/^/        /'; }
# o disco agora esta 0750/0640: e exatamente o estado que o preflight vai encontrar
MODOS_DISCO=$(stat -c%a scripts/alertar.sh scripts/bundle-allowlist.txt 2>/dev/null | tr '\n' ' ')
[ "$MODOS_DISCO" = "750 640 " ] && ok "disco ficou 0750/0640 (contencao aplicada)" || falhou "disco ficou: $MODOS_DISCO"
./scripts/preflight-deploy.sh "$ALVO" --sem-snapshot > "$D/pf.out" 2>&1; RC_P=$?
if [ "$RC_P" = 0 ]; then
  ok "preflight seguinte contra o MESMO commit: rc=0 (o ciclo fecha)"
else
  falhou "preflight rc=$RC_P -- o ciclo continua se autotravando"
  grep RECUSADO "$D/pf.out" | head -3 | sed 's/^/        /'
fi
NMODO=$(grep -c 'MODO diferente' "$D/pf.out" || true)
[ "$NMODO" = 0 ] && ok "zero recusas por MODO (a v2.6 tinha 15)" || falhou "$NMODO recusa(s) por MODO"

echo "== reproducao do estado da v2.6: guardas em 100644 =="
# Sem isto o teste nao prova que MEDE o bloqueador -- so que o estado novo passa. Aqui o
# estado ANTIGO e remontado no mesmo laboratorio e tem que reprovar.
git checkout -q -b v26 "$ALVO"
for g in "${GUARDAS[@]}"; do git update-index --chmod=-x "scripts/$g.sh"; done
git commit -qm "estado v2.6: guardas como 100644"
V26=$(git rev-parse HEAD)
git checkout -q -f "$V26"
# PRIMEIRA consequencia, ainda mais crua que a recusa de modo: com os guardas em 100644, o
# proprio pos-deploy-modos.sh chega do reset SEM permissao de execucao. rc=126 = "nao e
# executavel". O passo que existe para consertar os modos e a primeira vitima deles.
./scripts/pos-deploy-modos.sh > "$D/modos26.out" 2>&1; RC_EXEC=$?
[ "$RC_EXEC" = 126 ] && ok "no estado v2.6 o proprio pos-deploy-modos chega sem +x (rc=126)" \
  || falhou "esperava rc=126 de script nao executavel, veio $RC_EXEC"
# SEGUNDA consequencia: invocado por `bash` (contornando o bit), ele aplica 0750 e o
# preflight seguinte recusa esses mesmos caminhos. E o autotravamento do laudo.
bash ./scripts/pos-deploy-modos.sh > "$D/modos26.out" 2>&1; RC_M26=$?
bash ./scripts/preflight-deploy.sh "$V26" --sem-snapshot > "$D/pf26.out" 2>&1; RC_P26=$?
N26=$(grep -c "MODO diferente" "$D/pf26.out" || true)
if [ "$RC_M26" = 0 ] && [ "$RC_P26" != 0 ] && [ "$N26" -ge 15 ]; then
  ok "autotravamento reproduzido: pos-modos rc=0, preflight rc=$RC_P26, $N26 recusas por MODO"
else
  falhou "nao reproduzi o autotravamento (pos-modos=$RC_M26 preflight=$RC_P26 modos=$N26)"
fi
git checkout -q -f "$ALVO" 2>/dev/null; git branch -qD v26 2>/dev/null

echo "== e o inverso: modo fora do contrato TEM que reprovar =="
# se alguem commitar um guarda como 100644 de novo, o contrato precisa gritar.
git update-index --chmod=-x scripts/teste-publicar.sh
git commit -qm "regressao: guarda volta a 100644"
RUIM=$(git rev-parse HEAD)
FORA=$(modos_fora_do_contrato "$RUIM")
grep -q 'teste-publicar.sh' <<<"$FORA" && ok "contrato detecta guarda que voltou a 100644" \
  || falhou "regressao de modo passou despercebida"
git checkout -q -f "$ALVO" 2>/dev/null

echo
echo "== $P passaram, $F falharam =="
[ "$F" -eq 0 ]
