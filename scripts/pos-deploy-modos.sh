#!/bin/bash
# pos-deploy-modos.sh — reaplica os modos de contencao DEPOIS do `git reset --hard`.
#
# POR QUE EXISTE (bloqueador #3 do laudo, provado em repo descartavel):
#   git so sabe gravar 100644 ou 100755. O vivo e 0750 (scripts) e 0640 (dados).
#   Um `git reset --hard` sobrescreve o untracked SEM RECUSAR e grava o modo do indice
#   modulado pelo umask do deploy (0022):
#       entrada 100644 -> 0644  => o script PERDE o +x e o cron morre calado
#       entrada 100755 -> 0755  => o script roda, mas fica LEGIVEL PARA TODOS (reexpoe)
#   Nenhum dos dois e o estado desejado. Logo: o modo NAO pode vir do git. Vem daqui.
#
#   Prova do comportamento (2026-08-28, /tmp descartavel na VPS):
#       antes : modo=750 status=?? ; reset --hard: OK, nao recusou
#       depois: modo=644 executavel=NAO ; conteudo substituido pelo do commit
#
# ORDEM NO DEPLOY (obrigatoria):
#   git reset --hard origin/main  ->  ESTE SCRIPT  ->  pm2 restart tom
#   Ele e commitado 100755 justamente para sobreviver executavel ao reset e conseguir
#   corrigir a si mesmo por ultimo.
#
# Idempotente. Fail-closed: se qualquer alvo ficar fora do esperado, sai != 0.

set -uo pipefail
# AQUI capturado ANTES do cd: depois dele, um $0 RELATIVO passa a resolver a partir do
# novo diretorio e `readlink -f` devolve um caminho que nao existe. Foi assim que este
# script disse "lib-guardas.sh ausente" com a lib ao lado dele.
AQUI="$(dirname "$(readlink -f "$0")")"
cd "$AQUI/.." || exit 2

# MESMA FONTE do preflight (laudo v2.5, licao do bloqueador 9 aplicada aqui): a lista de
# guardas era duplicada e ficou para tras. Os seis guardas novos da v2.6 entrariam no
# snapshot de rollback e NAO receberiam 0750 -- voltariam 0644 no reset, legiveis pelas 8
# contas do host, com o gate de modos dizendo "ok" por contar so os antigos.
LIBG="$AQUI/lib-guardas.sh"
[ -r "$LIBG" ] || { echo "pos-deploy-modos: FATAL: lib-guardas.sh ausente" >&2; exit 2; }
# shellcheck disable=SC1090
. "$LIBG"
EXEC750=(); for g in "${GUARDAS[@]}"; do EXEC750+=("scripts/$g.sh"); done
DADO640=(); for d in "${DADOS[@]}"; do DADO640+=("scripts/$d"); done
# guarda novo que ninguem listou: reprova aqui, alto, em vez de decair em silencio.
FORA=$(guardas_nao_listados "$(pwd)")
if [ -n "$FORA" ]; then
  echo "pos-deploy-modos: FATAL: guarda(s) fora do inventario de lib-guardas.sh:" >&2
  printf %s "$FORA" | sed "s/^/    /" >&2
  exit 1
fi

FALHAS=0
aplicar() { # <modo> <arquivo>
  if [ ! -e "$2" ]; then
    echo "pos-deploy-modos: AUSENTE $2" >&2; FALHAS=$((FALHAS+1)); return
  fi
  chmod "$1" "$2" || { echo "pos-deploy-modos: chmod $1 falhou em $2" >&2; FALHAS=$((FALHAS+1)); return; }
  local real; real=$(stat -c '%a' "$2" 2>/dev/null)
  if [ "$real" != "${1#0}" ] && [ "$real" != "$1" ]; then
    echo "pos-deploy-modos: $2 ficou $real, esperado $1" >&2; FALHAS=$((FALHAS+1))
  fi
}

for f in "${EXEC750[@]}"; do aplicar 0750 "$f"; done
for f in "${DADO640[@]}"; do aplicar 0640 "$f"; done

# Este script tambem: por ultimo, para nao perder o +x no meio do proprio trabalho.
aplicar 0750 scripts/pos-deploy-modos.sh

# Conferencia final independente do chmod: ninguem alem do dono pode ler/gravar/executar.
# ESCOPO: so os arquivos QUE ESTE PACOTE ENTREGA. A primeira versao varria scripts/*.sh
# inteiro e reprovava por causa de 9 scripts antigos do repo (deploy.sh, replay-lab-*,
# selftest-mutante.sh...) que sempre foram 644/755 e ja estao publicos no proprio git.
# Contencao alheia a este pacote nao e deste script decidir — e questao separada.
ABERTOS=$(find "${EXEC750[@]}" "${DADO640[@]}" scripts/pos-deploy-modos.sh \
          -maxdepth 0 -perm /o=rwx -printf '%M %p\n' 2>/dev/null)
if [ -n "$ABERTOS" ]; then
  echo "pos-deploy-modos: AINDA ABERTO PARA 'other':" >&2
  echo "$ABERTOS" >&2
  FALHAS=$((FALHAS+1))
fi

if [ "$FALHAS" -gt 0 ]; then
  echo "pos-deploy-modos: REPROVADO ($FALHAS problema(s)) — NAO reinicie o TOM antes de resolver" >&2
  exit 1
fi
echo "pos-deploy-modos: ok — ${#EXEC750[@]} executaveis em 0750, ${#DADO640[@]} dado em 0640, nada aberto para other"
