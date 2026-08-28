#!/bin/bash
# preflight-deploy.sh — roda IMEDIATAMENTE antes de `git reset --hard <ref>`.
#
# POR QUE EXISTE (laudo v2, bloqueador 4): o pacote mediu o worktree sujo uma vez e a
# medida envelheceu (18.277 -> 18.303 untracked entre a coleta e a auditoria). Inventario
# de ontem nao autoriza reset de hoje. E o risco real nao e o untracked — `reset --hard`
# nao mexe em untracked fora da arvore alvo (medido) — e o RASTREADO modificado: se um
# arquivo rastreado tiver trabalho local que nao esta no commit alvo, o reset o apaga em
# silencio. Foi o que quase aconteceu com docs/ops/PEDIDOS-DE-PRODUTO.md.
#
# CRITERIO: todo arquivo rastreado-modificado precisa ser IDENTICO ao blob do alvo. Se for
# identico, o reset e no-op para ele. Se divergir, ha trabalho local nao commitado e o
# preflight RECUSA — quem decide descartar e uma pessoa, nunca o deploy.
#
# Efeito colateral util: guarda um tarball dos scripts de guarda ANTES do reset, para que o
# rollback tenha de onde reinstala-los (ver restaurar-guardas.sh).
#
# Uso:  ./preflight-deploy.sh origin/main        -> confere e faz snapshot; exit 0 libera
#       ./preflight-deploy.sh origin/main --sem-snapshot
#
# Sai != 0 em qualquer duvida. Fail-closed: nao conseguir MEDIR tambem recusa.

set -uo pipefail
REF=${1:?uso: $0 <ref-alvo> [--sem-snapshot]}
SNAP=1; [ "${2:-}" = "--sem-snapshot" ] && SNAP=0
cd "$(dirname "$(readlink -f "$0")")/.." || exit 2

GUARDAS=(alertar backup-db backup-secrets check-backup conter-permissoes lib-baseline-queries
         lib-pgconn patch-crontab pos-deploy-modos restaurar-modos restore-drill
         smoke-pos-aplicacao teste-negativo-dataapi teste-negativo-permissoes verificar-bundle)
DEST=/opt/backups/la-organizer/guardas
PROBLEMAS=0

echo "== preflight para $REF =="
git rev-parse --verify "$REF^{commit}" >/dev/null 2>&1 || { echo "FATAL: ref $REF nao existe (fez fetch?)" >&2; exit 2; }
echo "  alvo: $(git rev-parse --short "$REF")  atual: $(git rev-parse --short HEAD)"

# --- 1. rastreados modificados: identicos ao alvo, ou recusa -----------------------------
MOD=$(git status --porcelain=v1 --untracked-files=no | awk '$1 ~ /M/ {print $2}')
if [ -z "$MOD" ]; then
  echo "  rastreados modificados: nenhum"
else
  echo "  rastreados modificados: $(printf '%s\n' "$MOD" | wc -l)"
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    if ! ALVO=$(git cat-file blob "$REF:$f" 2>/dev/null | sha256sum | cut -d' ' -f1); then
      echo "    RECUSADO  $f — nao existe no alvo; o reset o APAGARIA"; PROBLEMAS=$((PROBLEMAS+1)); continue
    fi
    if ! VIVO=$(sha256sum "$f" 2>/dev/null | cut -d' ' -f1) || [ -z "$VIVO" ]; then
      echo "    RECUSADO  $f — nao consegui medir o arquivo vivo"; PROBLEMAS=$((PROBLEMAS+1)); continue
    fi
    if [ "$VIVO" = "$ALVO" ]; then
      echo "    ok        $f (identico ao alvo; reset e no-op)"
    else
      echo "    RECUSADO  $f — DIVERGE do alvo; ha trabalho local que o reset descartaria"
      echo "              vivo=$VIVO"
      echo "              alvo=$ALVO"
      echo "              veja com: git diff -- $f"
      PROBLEMAS=$((PROBLEMAS+1))
    fi
  done <<< "$MOD"
fi

# --- 2. untracked: informativo, com a razao de ser informativo ---------------------------
if UNT=$(git status --porcelain=v1 -uall 2>/dev/null | grep -c '^??'); then
  echo "  untracked: $UNT caminho(s) — preservados pelo reset (medido), nao bloqueiam"
else
  echo "  RECUSADO: nao consegui contar untracked"; PROBLEMAS=$((PROBLEMAS+1))
fi

# --- 3. snapshot dos guardas, para o rollback ter de onde restaurar ----------------------
if [ "$SNAP" = 1 ]; then
  if install -d -m 0700 "$DEST" 2>/dev/null; then
    TAR="$DEST/guardas-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
    PRESENTES=(); for g in "${GUARDAS[@]}"; do [ -f "scripts/$g.sh" ] && PRESENTES+=("scripts/$g.sh"); done
    PRESENTES+=(scripts/bundle-allowlist.txt)
    if tar -czf "$TAR" --owner=0 --group=0 -- "${PRESENTES[@]}" 2>/dev/null && [ -s "$TAR" ]; then
      chmod 0600 "$TAR"
      echo "  snapshot dos guardas: $TAR ($(tar -tzf "$TAR" | wc -l) arquivos)"
    else
      echo "  RECUSADO: nao consegui gravar o snapshot dos guardas em $TAR"; PROBLEMAS=$((PROBLEMAS+1))
    fi
  else
    echo "  RECUSADO: nao consegui criar $DEST"; PROBLEMAS=$((PROBLEMAS+1))
  fi
fi

echo
if [ "$PROBLEMAS" -gt 0 ]; then
  echo "== PREFLIGHT REPROVADO ($PROBLEMAS problema(s)) — NAO rode o reset =="
  exit 1
fi
echo "== PREFLIGHT OK — reset liberado; rode pos-deploy-modos.sh logo depois =="
