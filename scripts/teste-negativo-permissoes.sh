#!/bin/bash
# P0-3 v2.1 — Teste NEGATIVO de permissões, leitura E escrita.
#
# CORREÇÕES (#2):
#   - Modo --pos-aplicacao: alvo OBRIGATÓRIO ausente REPROVA (na v2 virava SKIP e o script
#     ainda saía 0 — verde vácuo com outro nome).
#   - Testa ESCRITA, não só leitura/listagem: gravar num diretório ou sobrescrever um
#     arquivo é tão grave quanto ler, e o grant do host permitia (modo 0664 = g+w).
#
# Uso:  ./teste-negativo-permissoes.sh <usuario> [--pos-aplicacao]
# Antes da contenção: espera-se VERMELHO. Depois: exige 0 FAIL e 0 SKIP obrigatório.

set -uo pipefail

# NIVEL: environment-controlled-write-probe (laudo v2.7, bloqueador 5).
# Esta bateria NAO e read-only: ela cria controle em /tmp, tenta `touch` dentro de
# /opt/backups/la-organizer e do diretorio vivo do CLI, e abre arquivos para sobrescrita.
# Se a permissao estiver errada, ela ESCREVE e depois remove -- e escrever em producao para
# provar que nao se pode escrever em producao e uma contradicao. Chamar isso de read-only,
# como a v2.7 fazia, era rotulo falso: quem le o total para de conferir.
# Ela continua valiosa (e o unico teste que mede a contencao no host de verdade), entao nao
# some -- sai do total padrao e passa a exigir gate explicito.
if [ "${PERMITIR_SONDA_ESCRITA:-0}" != "1" ]; then
  echo "== SONDA DE ESCRITA NAO AUTORIZADA =="
  echo "Esta bateria TENTA escrever em alvos de producao para provar que nao consegue."
  echo "Ela nao entra no total padrao. Para rodar conscientemente:"
  echo "   PERMITIR_SONDA_ESCRITA=1 $0 [usuario] [--pos-aplicacao|--final]"
  exit 3
fi
# DEFAULT DESCOBERTO (laudo v2.6, bloqueador 10). Exigir o argumento fazia o runner receber
# um crash sem contagem -- e a v2.6 classificava isso como "exige ambiente", ou seja, um
# teste que nao rodou saia como dispensa. Agora, sem argumento, o teste escolhe o primeiro
# usuario nao-root real do host. Se nao houver nenhum, ele ABORTA dizendo por que, e o
# runner reprova -- que e o resultado honesto de "nao consegui medir".
USUARIO=${1:-}
if [ -z "$USUARIO" ] || [ "${USUARIO#--}" != "$USUARIO" ]; then
  [ -n "$USUARIO" ] && set -- "" "$@"
  USUARIO=$(awk -F: '$3>=1000 && $3<65534 {print $1; exit}' /etc/passwd 2>/dev/null)
  [ -n "$USUARIO" ] || { echo "ABORTADO: nenhum usuario nao-root neste host para testar contra"; exit 2; }
  echo "(sem argumento: usando o usuario nao-root $USUARIO)"
fi
# #3: `db/` so existe DEPOIS do primeiro backup. Exigi-lo no passo pos-contencao fazia o
# teste reprovar por construcao. Tres modos: baseline (pre), --pos-aplicacao (pos-contencao,
# ainda sem backup) e --final (tudo tem que existir).
POS=0; FINAL=0
case "${2:-}" in
  --pos-aplicacao) POS=1 ;;
  --final)         POS=1; FINAL=1 ;;
esac
id "$USUARIO" >/dev/null 2>&1 || { echo "usuario $USUARIO nao existe"; exit 3; }
[ "$USUARIO" = root ] && { echo "root nao serve de sujeito"; exit 3; }
command -v sudo >/dev/null || { echo "sudo ausente: sem ele TODA sonda parece negada"; exit 3; }

# =============================================================================
# CONTROLE POSITIVO (#7 da revisao) — obrigatorio ANTES de qualquer asserção negativa.
# Se `sudo -u` falhar por infraestrutura (sudo quebrado, usuario sem shell, PAM negando),
# todas as tentativas retornam erro e o teste inteiro vira PASS: um verde que so prova que
# a sonda nao roda. Aqui provamos primeiro que o usuario CONSEGUE ler algo publico e
# CONSEGUE escrever no proprio /tmp. Se o controle falhar, o teste ABORTA — nao aprova.
# =============================================================================
echo "== controle positivo (a sonda funciona?) =="
CTRL=0
if sudo -u "$USUARIO" head -c 1 /etc/hostname >/dev/null 2>&1
then echo "PASS  controle: $USUARIO LE /etc/hostname (mundo-legivel)"
else echo "FALHA controle: $USUARIO nao leu /etc/hostname — a sonda nao funciona"; CTRL=1; fi
CTRL_TMP="/tmp/.ctrl-$USUARIO-$$"
if sudo -u "$USUARIO" sh -c "printf x > '$CTRL_TMP'" 2>/dev/null && [ -s "$CTRL_TMP" ]
then echo "PASS  controle: $USUARIO ESCREVE em /tmp"; rm -f "$CTRL_TMP"
else echo "FALHA controle: $USUARIO nao escreveu em /tmp — a sonda nao funciona"; CTRL=1; rm -f "$CTRL_TMP" 2>/dev/null; fi
[ "$CTRL" -eq 0 ] || { echo "ABORTADO: sem controle positivo, qualquer 'acesso negado' e inconclusivo."; exit 3; }


RAIZ_BKP=/opt/backups/la-organizer
FALHAS=0; PASSOU=0; SKIP_OK=0; SKIP_RUIM=0
# A VPS roda em UTC e o backup nasce as 06h UTC: mirar em "hoje" faz o teste pular
# espuriamente entre 00h e 06h. Mira-se no diretorio de backup MAIS RECENTE que existe.
ULTIMO_BKP=$(ls -1d "$RAIZ_BKP"/2[0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9] 2>/dev/null | tail -1)

ausente() { # descricao, obrigatorio(0/1)
  if [ "$2" = 1 ] && [ "$POS" = 1 ]; then
    echo "FAIL  alvo OBRIGATORIO ausente pos-aplicacao: $1"; FALHAS=$((FALHAS+1))
  else
    echo "SKIP  alvo inexistente: $1"
    [ "$2" = 1 ] && SKIP_RUIM=$((SKIP_RUIM+1)) || SKIP_OK=$((SKIP_OK+1))
  fi
}
nega_leitura() { # desc, caminho, obrigatorio
  [ -n "$2" ] && [ -e "$2" ] || { ausente "$1" "$3"; return; }
  if sudo -u "$USUARIO" head -c 1 "$2" >/dev/null 2>&1
  then echo "FAIL  $USUARIO LE: $1"; FALHAS=$((FALHAS+1))
  else echo "PASS  $USUARIO nao le: $1"; PASSOU=$((PASSOU+1)); fi
}
nega_listagem() { # desc, dir, obrigatorio
  [ -n "$2" ] && [ -d "$2" ] || { ausente "$1" "$3"; return; }
  if sudo -u "$USUARIO" ls "$2" >/dev/null 2>&1
  then echo "FAIL  $USUARIO LISTA: $1"; FALHAS=$((FALHAS+1))
  else echo "PASS  $USUARIO nao lista: $1"; PASSOU=$((PASSOU+1)); fi
}
nega_escrita_dir() { # desc, dir, obrigatorio
  [ -n "$2" ] && [ -d "$2" ] || { ausente "$1" "$3"; return; }
  local alvo="$2/.probe-$USUARIO-$$"
  if sudo -u "$USUARIO" touch "$alvo" 2>/dev/null; then
    echo "FAIL  $USUARIO ESCREVE em: $1"; FALHAS=$((FALHAS+1))
    rm -f "$alvo" 2>/dev/null   # limpa o que o teste criou
  else
    echo "PASS  $USUARIO nao escreve em: $1"; PASSOU=$((PASSOU+1))
  fi
}
nega_sobrescrita() { # desc, arquivo, obrigatorio
  [ -n "$2" ] && [ -f "$2" ] || { ausente "$1" "$3"; return; }
  # append de string vazia: nao altera conteudo, mas exige permissao de escrita.
  if sudo -u "$USUARIO" sh -c ": >> '$2'" 2>/dev/null
  then echo "FAIL  $USUARIO SOBRESCREVE: $1"; FALHAS=$((FALHAS+1))
  else echo "PASS  $USUARIO nao sobrescreve: $1"; PASSOU=$((PASSOU+1)); fi
}

BAK_CRED=$(ls -1 /opt/LA-Organizer/.claude-tom/.claude/.credentials.json.bak.* 2>/dev/null | head -1)
TRANSCRIPT=$(find "$RAIZ_BKP" -name '*.jsonl' -type f 2>/dev/null | head -1)
CLAUDE_JSON=$(find "$RAIZ_BKP" -name '.claude.json' -type f 2>/dev/null | head -1)

echo "== teste negativo como $USUARIO $([ "$POS" = 1 ] && echo '(POS-APLICACAO)') =="
echo "-- leitura e listagem --"
nega_listagem  "arvore de backup do TOM"      "$RAIZ_BKP"                                    1
nega_listagem  "backup do dia"                "$ULTIMO_BKP"                                  1
nega_listagem  "dumps do banco"               "$RAIZ_BKP/db"                                 "$FINAL"
nega_listagem  "transcripts do CLI"           /opt/LA-Organizer/.claude-tom/.claude/projects 1
nega_listagem  "worktree paralela w0"          /opt/LA-Organizer/.claude-tom-w0               1
nega_listagem  "worktree paralela w1"          /opt/LA-Organizer/.claude-tom-w1               1
nega_leitura   ".env do backup"               "${ULTIMO_BKP:+$ULTIMO_BKP/.env}"              1
nega_leitura   "credencial do backup"         "${ULTIMO_BKP:+$ULTIMO_BKP/credentials.json}"  "$FINAL"
nega_leitura   "credencial viva na origem"    /opt/LA-Organizer/.claude-tom/.claude/.credentials.json 1
nega_leitura   "copia .bak de credencial"     "$BAK_CRED"                                    0
nega_leitura   "transcript de sessao"         "$TRANSCRIPT"                                  0
nega_leitura   ".claude.json do backup"       "$CLAUDE_JSON"                                 0
echo "-- escrita --"
nega_escrita_dir  "arvore de backup do TOM"   "$RAIZ_BKP"                                    1
nega_escrita_dir  "dir do CLI"                /opt/LA-Organizer/.claude-tom/.claude          1
nega_sobrescrita  "copia .bak de credencial"  "$BAK_CRED"                                    0
nega_sobrescrita  "transcript de sessao"      "$TRANSCRIPT"                                  0

echo "== $PASSOU pass, $FALHAS falha(s), $((SKIP_OK+SKIP_RUIM)) skip =="
# ALVO OBRIGATORIO AUSENTE NUNCA TERMINA VERDE (laudo v2.7, bloqueador 5). SKIP_RUIM era so
# um AVISO impresso: a bateria saia 0 e o runner a contava como aprovada. "Nao consegui
# medir o alvo obrigatorio" e inconclusivo, e inconclusivo nao e verde.
if [ "$SKIP_RUIM" -gt 0 ]; then
  echo "   INCONCLUSIVO: $SKIP_RUIM skip em alvo OBRIGATORIO -- nao da para afirmar contencao" >&2
  exit 1
fi
exit $(( FALHAS > 0 ? 1 : 0 ))
