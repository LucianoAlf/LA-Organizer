#!/bin/bash
# Testes do lock de deploy e do alvo imutavel. Repo descartavel; nao toca em producao.
#
# Cobre o laudo v2.4, bloqueador 4:
#   * mover a ref DEPOIS da verificacao nao muda o SHA medido nem o aplicado;
#   * duas reconciliacoes concorrentes nao entram na janela ao mesmo tempo;
#   * lock orfao expira em vez de travar o deploy para sempre.
# E o bloqueador de encoding que ja me pegou duas vezes: nao-ASCII em STRING de .ps1.

set -uo pipefail
AQUI="$(dirname "$(readlink -f "$0")")"
P=0; F=0
ok()    { P=$((P+1)); printf '  ok    %s\n' "$1"; }
falhou(){ F=$((F+1)); printf '  FALHA %s\n' "$1"; }

echo "== 1. alvo imutavel: mover a ref nao muda o SHA medido =="
D=$(mktemp -d /tmp/lockteste.XXXXXX)
(
  cd "$D" && git init -q -b main up && cd up && git config user.email t@t && git config user.name t
  mkdir -p scripts && cp "$AQUI/preflight-deploy.sh" scripts/ && chmod +x scripts/preflight-deploy.sh
  echo base > base.txt && git add -A && git commit -qm c1
  echo v1 > alvo.txt && git add alvo.txt && git commit -qm "c2 (candidato bom)"
  BOM=$(git rev-parse HEAD)
  echo v2-RUIM > alvo.txt && git add alvo.txt && git commit -qm "c3 (candidato ruim)"
  RUIM=$(git rev-parse HEAD)
  git update-ref refs/candidato/movel "$BOM"
  git checkout -q "$BOM"
  # cenario: alguem verificou a ref (apontava para BOM) e, entre a verificacao e a medicao,
  # a ref foi movida para RUIM.
  git update-ref refs/candidato/movel "$RUIM"
  ./scripts/preflight-deploy.sh refs/candidato/movel --sem-snapshot > "$D/o1" 2>&1
  ./scripts/preflight-deploy.sh "$BOM" --sem-snapshot > "$D/o2" 2>&1
  M1=$(sed -n 's/^  alvo: \([0-9a-f]\{7,\}\).*/\1/p' "$D/o1")
  M2=$(sed -n 's/^  alvo: \([0-9a-f]\{7,\}\).*/\1/p' "$D/o2")
  printf '%s %s\n' "${M1:-VAZIO}" "${M2:-VAZIO}" > "$D/res2"
  printf '%s %s\n' "$BOM" "$RUIM" > "$D/res"
)
read -r BOM RUIM < "$D/res"; read -r M1 M2 < "$D/res2"
# ASSERCAO NAO-VACUA: a primeira versao deste teste comparava $M2 (vazio) com ${BOM:0:0}
# (tambem vazio) e passava. Verde sobre medicao que nunca aconteceu e o defeito que esta
# frente inteira existe para nao ter. Medida vazia agora e FALHA, nunca "igual a vazio".
if [ -z "$M1" ] || [ "$M1" = VAZIO ]; then falhou "nao consegui medir pelo nome da ref"; sed -n '1,3p' "$D/o1" | sed 's/^/        /'
elif [ "$M1" = "${RUIM:0:${#M1}}" ]; then ok "medindo pelo NOME da ref: seguiu o objeto trocado ($M1 = ruim)"
else falhou "nome da ref mediu $M1, esperado ${RUIM:0:${#M1}}"; fi
if [ -z "$M2" ] || [ "$M2" = VAZIO ]; then falhou "nao consegui medir pelo SHA literal"; sed -n '1,3p' "$D/o2" | sed 's/^/        /'
elif [ "$M2" = "${BOM:0:${#M2}}" ]; then ok "medindo pelo SHA literal: imune ao movimento ($M2 = bom)"
else falhou "SHA literal mediu $M2, esperado ${BOM:0:${#M2}}"; fi
if [ -n "$M1" ] && [ -n "$M2" ] && [ "$M1" != VAZIO ] && [ "$M2" != VAZIO ] && [ "$M1" != "$M2" ]; then
  ok "as duas formas medem alvos DIFERENTES — e exatamente esse o bloqueador"
else
  falhou "as duas formas nao se distinguiram (m1=$M1 m2=$M2); o teste nao prova nada"
fi
rm -rf "$D"

echo "== 2. lock de deploy =="
# O protocolo do lock saiu daqui: virou scripts/lib-lock.sh e tem bateria propria em
# teste-lock-dono.sh, que cobre o que este bloco nao cobria -- o perdedor apagando o lock do
# dono. Manter uma segunda versao do mesmo teste, mais fraca, so criaria a chance de as duas
# discordarem. Aqui fica so a conferencia de que a lib existe e e a fonte do protocolo.
if [ -r "$AQUI/lib-lock.sh" ]; then
  ok "lib-lock.sh presente (protocolo testado em teste-lock-dono.sh)"
else
  falhou "lib-lock.sh ausente -- o lock voltaria a ser mkdir/rm -rf inline"
fi

echo "== 3. auto-deploy.ps1 sem nao-ASCII em codigo =="
# PowerShell 5.1 le .ps1 sem BOM como ANSI: um travessao dentro de STRING vira bytes que
# incluem aspas e o parse quebra inteiro. Em COMENTARIO e inofensivo (o parser pula).
# Ja aconteceu duas vezes nesta frente — por isso virou teste.
PS1="$AQUI/auto-deploy.ps1"
if [ -r "$PS1" ]; then
  RUINS=$(grep -n '[^ -~]' "$PS1" | grep -vE ':[[:space:]]*#' | wc -l)
  [ "$RUINS" -eq 0 ] && ok "nenhuma linha de codigo com nao-ASCII" \
    || { falhou "$RUINS linha(s) de codigo com nao-ASCII:"; grep -n '[^ -~]' "$PS1" | grep -vE ':[[:space:]]*#' | cut -c1-100 | sed 's/^/        /'; }
else
  falhou "auto-deploy.ps1 nao encontrado em $PS1"
fi

echo
echo "== $P passaram, $F falharam =="
[ "$F" -eq 0 ]
