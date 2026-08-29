#!/bin/bash
# TRANSICAO END-TO-END v2.5 -> candidato (laudo v2.7, bloqueador 1).
# NIVEL: integration-sandbox. Repo descartavel; nao toca em producao, /run real, crontab ou rede.
#
# Os testes das pecas passavam e a TRANSICAO nao acontecia. Reproducao independente, partindo
# de um v2.5 limpo:
#     snapshot incompleto: 28/41 guardas -> PREFLIGHT REPROVADO
# O snapshot de rollback era montado olhando a worktree VELHA mas exigindo o inventario NOVO --
# 13 arquivos que so nascem DEPOIS do reset. Ou seja, o primeiro deploy nunca chegava ao reset.
#
# Este teste faz o caminho inteiro, na ordem real:
#   runtime v2.5 (sem lib-lock, lib-guardas, runner e testes novos)
#     -> bootstrap por stdin, com nonce de turno
#     -> preflight COM snapshot
#     -> reset para o candidato
#     -> pos-deploy-modos
#     -> SEGUNDO preflight, que precisa ficar verde
# E reproduz o estado vivo de verdade: guardas v2.5 divergentes entregues por scp, tres
# trabalhos vivos preservados, e scripts legados 0750 no disco com 100644 no git.

set -uo pipefail
AQUI="$(dirname "$(readlink -f "$0")")"
P=0; F=0
ok()    { P=$((P+1)); printf '  ok    %s\n' "$1"; }
falhou(){ F=$((F+1)); printf '  FALHA %s\n' "$1"; }
D=$(mktemp -d "${TMPDIR:-/tmp}/e2e28.XXXXXX")
trap 'rm -rf "$D"' EXIT INT TERM
export BOOTSTRAP_DEST="$D/run"; mkdir -p "$BOOTSTRAP_DEST"
GUARDAS_DIR="$D/guardas"; export GUARDAS_DIR

# shellcheck disable=SC1090
. "$AQUI/lib-guardas.sh" || { echo "  ABORTADO: lib-guardas.sh nao carrega"; exit 2; }
TODOS=("${GUARDAS[@]}")
# o "v2.5" nao tem estes -- sao exatamente os que nascem no reset
NOVOS=(lib-lock lib-guardas rodar-baterias bootstrap-candidato teste-lock-dono teste-modo-canonico
       teste-bootstrap teste-vercel-prova teste-cron-canonico teste-preflight-modo
       teste-sequence-iscalled teste-ambiente-isolamento teste-e2e-transicao)
eh_novo() { case " ${NOVOS[*]} " in *" $1 "*) return 0 ;; esac; return 1; }

R="$D/runtime"
git init -q -b main "$R" 2>/dev/null
cd "$R" || exit 2
git config user.email t@t; git config user.name t; git config core.fileMode true
mkdir -p scripts src/rituals docs/ops

# ---------- commit v2.5: inventario PARCIAL, modos como o git guardava ---------------------
for g in "${TODOS[@]}"; do
  eh_novo "$g" && continue
  if [ -f "$AQUI/$g.sh" ]; then cp "$AQUI/$g.sh" "scripts/$g.sh"; else printf '#!/bin/sh\nexit 0\n' > "scripts/$g.sh"; fi
done
for d in "${DADOS[@]}"; do
  [ "$d" = manifesto-origem-v25.txt ] && continue
  if [ -f "$AQUI/$d" ]; then cp "$AQUI/$d" "scripts/$d"; else printf '# stub\n' > "scripts/$d"; fi
done
for l in deploy diag-claude push-and-deploy; do printf '#!/bin/sh\n# legado\nexit 0\n' > "scripts/$l.sh"; done
printf 'console.log("index v2.5");\n' > src/index.js
printf 'console.log("dispatcher v2.5");\n' > src/rituals/dispatcher.js
printf '# pedidos\n' > docs/ops/PEDIDOS-DE-PRODUTO.md
git add -A >/dev/null 2>&1
# no v2.5 os legados sao 100644 no git (Windows commitou sem +x) e os guardas tambem
git commit -qm "v2.5"
V25=$(git rev-parse HEAD)

# ---------- commit candidato: inventario COMPLETO + modo canonico -------------------------
git checkout -q -b candidato
for g in "${TODOS[@]}"; do
  if [ -f "$AQUI/$g.sh" ]; then cp "$AQUI/$g.sh" "scripts/$g.sh"; else printf '#!/bin/sh\nexit 0\n' > "scripts/$g.sh"; fi
done
for d in "${DADOS[@]}"; do
  # o manifesto TAMBEM esta no inventario do candidato: o pos-deploy-modos exige tudo que
  # o inventario declara, entao ele precisa nascer no reset como qualquer outro dado.
  if [ -f "$AQUI/$d" ]; then cp "$AQUI/$d" "scripts/$d"; else printf '# stub\n' > "scripts/$d"; fi
done
# os tres trabalhos vivos entram no candidato exatamente como estao no disco vivo
printf 'console.log("index COM o trabalho vivo");\n' > src/index.js
printf 'console.log("dispatcher COM o trabalho vivo");\n' > src/rituals/dispatcher.js
printf '# pedidos\n# linha do trabalho vivo\n' > docs/ops/PEDIDOS-DE-PRODUTO.md
git add -A >/dev/null 2>&1
for g in "${TODOS[@]}"; do git update-index --chmod=+x "scripts/$g.sh"; done
for l in deploy diag-claude push-and-deploy; do git update-index --chmod=+x "scripts/$l.sh"; done
git commit -qm "candidato v2.8"
CAND=$(git rev-parse HEAD)
git checkout -q -f main; git branch -qD candidato 2>/dev/null
git update-ref refs/bootstrap/"$CAND" "$CAND"

if [ "$(git ls-tree "$CAND" -- scripts/alertar.sh | awk '{print $1}')" != 100755 ]; then
  echo "  ABORTADO: filesystem nao guarda o bit de execucao"; exit 2
fi

# ---------- reproduz o ESTADO VIVO ---------------------------------------------------------
# guardas v2.5 entregues por scp: conteudo divergente do candidato, rastreados
for g in alertar check-backup verificar-bundle; do
  printf '#!/bin/sh\n# entregue por scp na rodada v2.5\nexit 0\n' > "scripts/$g.sh"
  chmod 0750 "scripts/$g.sh"
done
# legados: 0750 no disco, 100644 no git v2.5
for l in deploy diag-claude push-and-deploy; do chmod 0750 "scripts/$l.sh"; done
# os tres trabalhos vivos: no disco JA sao o que o candidato tem
printf 'console.log("index COM o trabalho vivo");\n' > src/index.js
printf 'console.log("dispatcher COM o trabalho vivo");\n' > src/rituals/dispatcher.js
printf '# pedidos\n# linha do trabalho vivo\n' > docs/ops/PEDIDOS-DE-PRODUTO.md

echo "== o runtime parte do layout v2.5 =="
AUSENTES=0; for g in "${NOVOS[@]}"; do [ -f "scripts/$g.sh" ] || AUSENTES=$((AUSENTES+1)); done
[ "$AUSENTES" -ge 10 ] && ok "$AUSENTES guarda(s) do candidato AUSENTES no runtime (como na v2.5)" \
  || falhou "so $AUSENTES ausentes -- o teste nao parte do estado v2.5"
[ ! -f scripts/lib-lock.sh ] && ok "lib-lock.sh ausente" || falhou "lib-lock.sh presente"
[ ! -f scripts/lib-guardas.sh ] && ok "lib-guardas.sh ausente" || falhou "lib-guardas.sh presente"

# ---------- manifesto de origem: gerado do estado vivo, caminho+sha+modo ------------------
MANIF="$D/manifesto-origem.txt"
{ echo "# manifesto de origem do laboratorio"
  for g in alertar check-backup verificar-bundle; do
    printf '%s  %s  %s\n' "$(sha256sum "scripts/$g.sh" | cut -d' ' -f1)" "$(stat -c%a "scripts/$g.sh")" "scripts/$g.sh"
  done
} > "$MANIF"
export PREFLIGHT_MANIFESTO="$MANIF"

echo "== 1. BOOTSTRAP por stdin, com nonce de turno =="
NONCE_A=turno-alfa
S=$(BOOTSTRAP_NONCE="$NONCE_A" bash "$AQUI/bootstrap-candidato.sh" "$CAND" "$R" 2>&1); RC=$?
DIR=$(sed -n 's/^candidato=//p' <<<"$S" | head -1)
[ "$RC" = 0 ] && [ -n "$DIR" ] && ok "bootstrap rc=0 -> $(basename "$DIR")" || { falhou "rc=$RC: $(tail -2 <<<"$S")"; }
case "$DIR" in *"-$NONCE_A") ok "diretorio carrega o nonce do turno" ;; *) falhou "diretorio sem nonce: $DIR" ;; esac
[ -f "$DIR/scripts/lib-guardas.sh" ] && ok "inventario NOVO materializado fora da worktree" || falhou "lib-guardas.sh nao veio"

echo "== 2. dois turnos do MESMO sha nao se atrapalham (bloqueador 6) =="
S2=$(BOOTSTRAP_NONCE=turno-beta bash "$AQUI/bootstrap-candidato.sh" "$CAND" "$R" 2>&1)
DIR2=$(sed -n 's/^candidato=//p' <<<"$S2" | head -1)
[ -n "$DIR2" ] && [ "$DIR2" != "$DIR" ] && ok "segundo turno usa diretorio DISTINTO" || falhou "os dois turnos colidiram"
[ -f "$DIR/scripts/lib-lock.sh" ] && ok "o diretorio do primeiro turno sobreviveu ao segundo" \
  || falhou "o segundo turno apagou a lib que o primeiro usa nos heartbeats"
rm -rf "$DIR2"

echo "== 3. PREFLIGHT COM SNAPSHOT contra o candidato (era aqui que travava) =="
OUT="$D/pf1.out"
PREFLIGHT_REPO="$R" bash "$DIR/scripts/preflight-deploy.sh" "$CAND" > "$OUT" 2>&1; RC=$?
if [ "$RC" = 0 ]; then
  ok "primeiro preflight PASSOU (rc=0)"
else
  falhou "primeiro preflight rc=$RC -- a transicao ainda trava"
  grep RECUSADO "$OUT" | head -4 | sed 's/^/        /'
fi
grep -q 'nascem no reset' "$OUT" && ok "declara quais guardas nascem no reset (em vez de exigi-los)" \
  || falhou "nao declarou os que nascem no reset"
grep -qE 'snapshot: .*guardas existentes preservados' "$OUT" && ok "snapshot preservou o conjunto EXISTENTE" \
  || falhou "snapshot nao registrou o conjunto existente"
N_MANIF=$(grep -c 'divergencia de ORIGEM conhecida' "$OUT" || true)
[ "$N_MANIF" = 3 ] && ok "3 guardas v2.5 aceitos pelo manifesto (sha+modo exatos)" || falhou "$N_MANIF aceitos pelo manifesto, esperado 3"
grep -q 'aceito(s) pelo manifesto de origem' "$OUT" && ok "o relatorio diz quantos vieram do manifesto" || falhou "aceite silencioso pelo manifesto"

echo "== 4. RESET para o candidato + modos =="
git reset --hard -q "$CAND"
bash "$DIR/scripts/pos-deploy-modos.sh" > "$D/modos.out" 2>&1; RC=$?
[ "$RC" = 0 ] && ok "pos-deploy-modos rc=0 ($(tail -1 "$D/modos.out" | cut -c1-56))" || { falhou "pos-modos rc=$RC"; tail -2 "$D/modos.out" | sed 's/^/        /'; }

echo "== 5. SEGUNDO preflight, no mesmo commit: tem que ficar verde =="
OUT2="$D/pf2.out"
PREFLIGHT_REPO="$R" bash "./scripts/preflight-deploy.sh" "$CAND" --sem-snapshot > "$OUT2" 2>&1; RC=$?
if [ "$RC" = 0 ]; then
  ok "segundo preflight PASSOU (rc=0) -- o ciclo fecha de ponta a ponta"
else
  falhou "segundo preflight rc=$RC"
  grep RECUSADO "$OUT2" | head -4 | sed 's/^/        /'
fi
[ "$(grep -c 'MODO diferente' "$OUT2" || true)" = 0 ] && ok "zero recusas por MODO depois do pos-modos" || falhou "recusas por MODO no segundo preflight"

echo "== 6. e o rigor nao caiu: adulterar reprova =="
git checkout -q -f "$V25" 2>/dev/null
for g in alertar check-backup verificar-bundle; do
  printf '#!/bin/sh\n# entregue por scp na rodada v2.5\nexit 0\n' > "scripts/$g.sh"; chmod 0750 "scripts/$g.sh"
done
printf 'console.log("index COM o trabalho vivo");\n' > src/index.js
printf 'console.log("dispatcher COM o trabalho vivo");\n' > src/rituals/dispatcher.js
printf '# pedidos\n# linha do trabalho vivo\n' > docs/ops/PEDIDOS-DE-PRODUTO.md
for l in deploy diag-claude push-and-deploy; do chmod 0750 "scripts/$l.sh"; done
PREFLIGHT_REPO="$R" bash "$DIR/scripts/preflight-deploy.sh" "$CAND" --sem-snapshot >/dev/null 2>&1
[ $? = 0 ] && ok "estado vivo remontado passa de novo (controle)" || falhou "nao consegui remontar o estado vivo"

printf '# UM BYTE A MAIS\n' >> scripts/alertar.sh
PREFLIGHT_REPO="$R" bash "$DIR/scripts/preflight-deploy.sh" "$CAND" --sem-snapshot > "$D/pf3.out" 2>&1; RC=$?
[ "$RC" != 0 ] && grep -q 'alertar.sh' "$D/pf3.out" && ok "guarda v2.5 adulterado REPROVA (nao esta no manifesto)" \
  || falhou "adulteracao de guarda v2.5 passou (rc=$RC)"
grep -q 'manifesto: conteudo difere' "$D/pf3.out" && ok "diz que o manifesto de origem nao cobre aquele conteudo" \
  || falhou "nao explica por que o manifesto nao cobriu"
printf '#!/bin/sh\n# entregue por scp na rodada v2.5\nexit 0\n' > scripts/alertar.sh; chmod 0750 scripts/alertar.sh

chmod 0700 scripts/check-backup.sh
PREFLIGHT_REPO="$R" bash "$DIR/scripts/preflight-deploy.sh" "$CAND" --sem-snapshot > "$D/pf4.out" 2>&1; RC=$?
[ "$RC" != 0 ] && ok "MODO fora do manifesto tambem reprova (0700 != 0750)" || falhou "modo divergente passou"
chmod 0750 scripts/check-backup.sh

printf 'console.log("ALGUEM MEXEU");\n' > src/index.js
PREFLIGHT_REPO="$R" bash "$DIR/scripts/preflight-deploy.sh" "$CAND" --sem-snapshot > "$D/pf5.out" 2>&1; RC=$?
[ "$RC" != 0 ] && grep -q 'src/index.js' "$D/pf5.out" && ok "trabalho vivo DIFERENTE do candidato reprova" \
  || falhou "trabalho vivo divergente passou (rc=$RC)"

echo
echo "== $P passaram, $F falharam =="
[ "$F" -eq 0 ]
