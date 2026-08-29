#!/bin/bash
# lib-guardas.sh -- FONTE UNICA do inventario de guardas do safety gate.
#
# Existia uma lista em preflight-deploy.sh (o que entra no snapshot de rollback) e outra em
# pos-deploy-modos.sh (o que recebe 0750/0640 depois do reset). Elas divergiram: os seis
# guardas novos da v2.6 entraram na primeira e nao na segunda, entao um `git reset --hard`
# os deixaria em 0644 -- legiveis por todas as 8 contas do host -- e o gate de modos sairia
# "ok" contando so os antigos. Contencao que decai enquanto o medidor diz que esta tudo bem.
#
# Duas listas do mesmo fato divergem com o tempo; uma lista so, nao.

# Scripts (viram scripts/<nome>.sh, modo 0750)
GUARDAS=(alertar bootstrap-candidato backup-db backup-secrets check-backup conter-permissoes lib-baseline-queries
         lib-guardas lib-lock lib-pgconn lib-publicar lib-seq-compare patch-crontab
         pos-deploy-modos preflight-deploy restaurar-guardas restaurar-modos restore-drill
         rodar-baterias smoke-pos-aplicacao teste-alertar-mock teste-bundle-mock
         teste-ambiente-isolamento teste-bootstrap teste-cron-canonico teste-deploy-lock-sha teste-lock-dono teste-negativo-dataapi
         teste-negativo-permissoes teste-preflight-modo teste-publicar
         teste-sentinela-timeline teste-seq-compare teste-modo-canonico teste-sequence-iscalled teste-vercel-prova verificar-bundle)

# Dados (caminho relativo a scripts/, modo 0640)
DADOS=(baterias-niveis.txt bundle-allowlist.txt bundle-esperados.txt suite-vermelhos-conhecidos.txt
      )

# Guarda novo que ninguem lembrou de listar e o modo de falha real desta lib. Qualquer
# scripts/{lib,teste}-*.sh fora do inventario e reportado por quem chamar esta funcao.
guardas_nao_listados() {  # <dir-do-repo> -> imprime os arquivos faltantes
  local raiz=${1:-.} f n
  for f in "$raiz"/scripts/lib-*.sh "$raiz"/scripts/teste-*.sh; do
    [ -e "$f" ] || continue
    n=$(basename "$f" .sh)
    case " ${GUARDAS[*]} " in *" $n "*) : ;; *) printf '%s\n' "scripts/$n.sh" ;; esac
  done
}

# MODO CANONICO (laudo v2.6, bloqueador 1). O ciclo se autotravava: `pos-deploy-modos.sh`
# punha 0750 em 15 guardas que o git guardava como 100644, e o preflight SEGUINTE recusava
# esses mesmos 15 por "MODO diferente". Estado que o pos-deploy produz e o preflight rejeita
# nao e um gate: e um deadlock com aparencia de rigor.
#
# A fonte canonica passa a ser o GIT. Guarda executavel e 100755 na arvore; dado e 100644.
# O disco vivo usa 0750/0640 (contencao), e ambos mapeiam para o mesmo modo git porque o que
# o git guarda e so o bit de execucao do dono. Assim as tres pontas concordam:
#   git 100755  <->  disco 0750  <->  preflight ok
#   git 100644  <->  disco 0640  <->  preflight ok
modo_git_canonico() {   # <caminho relativo ao repo> -> 100755 | 100644 | ""
  local p=$1 n
  case "$p" in
    scripts/*.sh)
      n=$(basename "$p" .sh)
      case " ${GUARDAS[*]} " in *" $n "*) echo 100755; return 0 ;; esac ;;
    scripts/*)
      n=$(basename "$p")
      case " ${DADOS[*]} " in *" $n "*) echo 100644; return 0 ;; esac ;;
  esac
  echo ""; return 1
}

# Divergencia entre o modo canonico e o que a arvore REALMENTE guarda. Imprime uma linha por
# caminho fora do contrato. Sem `git`, devolve rc 2 (nao consegui medir) em vez de "ok".
modos_fora_do_contrato() {  # [ref, default HEAD]
  local ref=${1:-HEAD} p esperado real
  command -v git >/dev/null 2>&1 || return 2
  for p in $(printf 'scripts/%s.sh\n' "${GUARDAS[@]}"; printf 'scripts/%s\n' "${DADOS[@]}"); do
    esperado=$(modo_git_canonico "$p") || continue
    real=$(git ls-tree "$ref" -- "$p" 2>/dev/null | awk '{print $1}')
    [ -n "$real" ] || { printf '%s AUSENTE_NA_ARVORE esperado=%s\n' "$p" "$esperado"; continue; }
    [ "$real" = "$esperado" ] || printf '%s arvore=%s esperado=%s\n' "$p" "$real" "$esperado"
  done
  return 0
}
