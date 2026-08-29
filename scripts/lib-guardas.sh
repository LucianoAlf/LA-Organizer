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
GUARDAS=(alertar backup-db backup-secrets check-backup conter-permissoes lib-baseline-queries
         lib-guardas lib-lock lib-pgconn lib-publicar lib-seq-compare patch-crontab
         pos-deploy-modos preflight-deploy restaurar-guardas restaurar-modos restore-drill
         rodar-baterias smoke-pos-aplicacao teste-alertar-mock teste-bundle-mock
         teste-cron-canonico teste-deploy-lock-sha teste-lock-dono teste-negativo-dataapi
         teste-negativo-permissoes teste-preflight-modo teste-publicar
         teste-sentinela-timeline teste-seq-compare teste-vercel-prova verificar-bundle)

# Dados (caminho relativo a scripts/, modo 0640)
DADOS=(bundle-allowlist.txt bundle-esperados.txt suite-vermelhos-conhecidos.txt
       baterias-ambiente.txt)

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
