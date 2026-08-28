#!/bin/bash
# P0-3 v2.4 — Contenção de permissões. DRY-RUN por padrão; só age com --aplicar.
#
# CORREÇÕES v2.3 -> v2.4 (bloqueador #6):
#   * FAIL-CLOSED: o retorno do `chmod` deixa de ser ignorado. Se um único chmod falhar,
#     o script reprova — antes ele seguia e o relatório final podia mascarar.
#   * BIT x DE GRUPO/OUTROS ENTRA NA MEDIDA. A v2.3 media só r e w. Um diretório 711 não
#     era contado como exposto, mas é ATRAVESSÁVEL: outro usuário entra e lê o que houver
#     dentro com nome conhecido. Agora `expostos()` inclui g=x e o=x.
#
# Herdado da v2.3: contador FORA de subshell (o bug do `$( )`), 4 raízes validadas por
# realpath + dono, pai /opt/backups não tocado, `chmod go-rwx` preservando o +x do dono.
#
# NÃO APAGA NADA.

set -uo pipefail

RAIZ_BACKUP=/opt/backups/la-organizer
RAIZES_CLI=(/opt/LA-Organizer/.claude-tom /opt/LA-Organizer/.claude-tom-w0 /opt/LA-Organizer/.claude-tom-w1)
# 5a raiz, descoberta DEPOIS da primeira aplicacao (28/08): /opt/LA-Organizer/logs estava
# em drwxrwxr-x com 5 arquivos 664, 61 MB — inclusive tom-out.log (48 MB) com conteudo de
# conversa e 1 chave de API do Google em texto no tom-error.log. Achei por acaso, checando
# se a migration tinha gerado erro de permissao. Fechar backup e transcripts e deixar o log
# aberto seria fechar a porta e esquecer a janela.
# Seguro: `lsof` confirma que so root mantem esses arquivos abertos, e cron e pm2 sao root.
RAIZ_LOGS=/opt/LA-Organizer/logs
TODAS=("$RAIZ_BACKUP" "${RAIZES_CLI[@]}" "$RAIZ_LOGS")
DONO_ESPERADO=root

RAIZES_FALTANDO=0
CHMOD_FALHOU=0
RAIZ_VALIDADA=""

APLICAR=0; VARRER=0
case "${1:-}" in
  --aplicar) APLICAR=1 ;;
  # --varrer: modo BARATO e idempotente. Só toca o que ESTÁ exposto agora, em vez de
  # reaplicar em 50 mil entradas. Existe porque a contenção NÃO se sustenta sozinha: o CLI
  # do Claude cria arquivo novo com o umask 022 do root, e um arquivo de sessão nasceu 644
  # dois minutos depois da primeira aplicação. A correção de RAIZ é o umask do processo —
  # isto é o curativo enquanto aquela não for decidida e testada.
  --varrer)  VARRER=1 ;;
esac

if [ "$VARRER" = 1 ]; then
  # FAIL-CLOSED (revisão da v2.4): a versão anterior fazia `continue` mudo quando a raiz
  # sumia, resolvia para outro caminho ou trocava de dono, e engolia o retorno do chmod com
  # `2>/dev/null`. Rodando de 15 em 15 minutos no cron, isso significava um scanner que
  # podia parar de proteger e continuar saindo 0 — silêncio que parece saúde.
  # Agora cada desvio vira PROBLEMA contado, e qualquer problema derruba o exit code.
  # FAIL-CLOSED DE VERDADE (laudo, item 1): `find ... 2>/dev/null | wc -l` transformava
  # QUALQUER erro em zero — um diretório ilegível, um I/O error, um mount sumido viravam
  # "nada exposto aqui". Num scanner de segurança, erro engolido é a pior resposta possível:
  # parece saúde. Agora o stderr do find é capturado e qualquer linha vira `problemas`.
  ERR_FIND=""
  contar() {
    local saida rc
    saida=$(find "$1" \( -perm -g=r -o -perm -o=r -o -perm -g=w -o -perm -o=w -o -perm -g=x -o -perm -o=x \) 2>"$TMPERR")
    rc=$?
    if [ "$rc" -ne 0 ] || [ -s "$TMPERR" ]; then
      ERR_FIND="$(head -1 "$TMPERR")"
      echo "[varrer] find falhou em $1 (rc=$rc): ${ERR_FIND:0:120}" >&2
      return 1
    fi
    printf '%s\n' "$saida" | grep -c . || true
  }
  TMPERR=$(mktemp /run/varrer.XXXXXX 2>/dev/null || mktemp) || { echo "[varrer] mktemp falhou" >&2; exit 1; }
  chmod 0600 "$TMPERR"; trap 'rm -f "$TMPERR"' EXIT INT TERM
  total=0; problemas=0
  for r in "${TODAS[@]}"; do
    if [ ! -d "$r" ]; then echo "[varrer] AUSENTE: $r" >&2; problemas=$((problemas+1)); continue; fi
    real=$(realpath "$r" 2>/dev/null) || { echo "[varrer] realpath falhou: $r" >&2; problemas=$((problemas+1)); continue; }
    if [ "$real" != "$r" ]; then echo "[varrer] RECUSADO (symlink?): $r -> $real" >&2; problemas=$((problemas+1)); continue; fi
    if [ "$(stat -c%U "$real")" != "$DONO_ESPERADO" ]; then
      echo "[varrer] RECUSADO (dono != $DONO_ESPERADO): $real" >&2; problemas=$((problemas+1)); continue
    fi
    if ! n=$(contar "$real"); then problemas=$((problemas+1)); continue; fi
    if [ "$n" -gt 0 ]; then
      if ! find "$real" \( -perm -g=r -o -perm -o=r -o -perm -g=w -o -perm -o=w -o -perm -g=x -o -perm -o=x \) -exec chmod go-rwx {} +; then
        echo "[varrer] chmod retornou erro em $real" >&2; problemas=$((problemas+1))
      fi
      total=$((total + n))
    fi
  done

  # Temporarios do engine em /tmp: `tom-sysprompt-*.txt` carrega o prompt COMPLETO com o
  # contexto do colaborador. Escopo estreito e a prova contra symlink: `-type f` com find -P
  # (padrao) e falso para link simbolico, entao nenhum link plantado por outro usuario
  # redireciona o chmod. `-user root` fecha o resto.
  if ntmp=$(find /tmp -maxdepth 1 -name 'tom-*' -type f -user root \( -perm -g=r -o -perm -o=r -o -perm -g=w -o -perm -o=w \) 2>"$TMPERR" | { grep -c . || true; }) && [ ! -s "$TMPERR" ]; then :
  else echo "[varrer] find em /tmp falhou: $(head -1 "$TMPERR" | cut -c1-120)" >&2; problemas=$((problemas+1)); ntmp=0; fi
  if [ "$ntmp" -gt 0 ]; then
    if find /tmp -maxdepth 1 -name 'tom-*' -type f -user root -exec chmod go-rwx {} +; then
      total=$((total + ntmp))
    else echo "[varrer] chmod retornou erro em /tmp/tom-*" >&2; problemas=$((problemas+1)); fi
  fi

  # CONVERGÊNCIA, não uma foto só (achado de 28/08). A versão anterior contava uma vez
  # depois de corrigir e reprovava se sobrasse qualquer coisa — mas um processo que escreve
  # DURANTE a varredura cria arquivo entre a correção e a contagem, e o scanner reprovava
  # sozinho: 3 execuções seguidas com `corrigidos=0 restante=1`, sempre em :00/:15/:30, que
  # são justamente os minutos em que o dispatcher (*/5) colide com a varredura (*/15).
  #
  # A causa-raiz daquele caso foi corrigida (o dispatcher ganhou `process.umask`), mas a
  # corrida é estrutural: sempre haverá uma janela entre corrigir e conferir. Então o
  # critério passa a ser CONVERGIR: tenta até 3 passadas; o que reaparece é corrigido na
  # passada seguinte. Só reprova o que RESISTE — exposição persistente, não corrida.
  # Continua fail-closed: se não convergir, o exit é 1 e o cron grita.
  restante=0; passadas=0
  for passada in 1 2 3; do
    passadas=$passada
    restante=0
    for r in "${TODAS[@]}"; do
      if [ -d "$r" ]; then
        if c=$(contar "$r"); then restante=$(( restante + c )); else problemas=$((problemas+1)); fi
      fi
    done
    if nt=$(find /tmp -maxdepth 1 -name 'tom-*' -type f -user root \( -perm -g=r -o -perm -o=r -o -perm -g=w -o -perm -o=w \) 2>"$TMPERR" | { grep -c . || true; }) && [ ! -s "$TMPERR" ]; then
      restante=$(( restante + nt ))
    else problemas=$((problemas+1)); fi
    [ "$restante" -eq 0 ] && break
    # ainda há exposto: corrige e mede de novo
    for r in "${TODAS[@]}"; do
      [ -d "$r" ] || continue
      find "$r" \( -perm -g=r -o -perm -o=r -o -perm -g=w -o -perm -o=w -o -perm -g=x -o -perm -o=x \) -exec chmod go-rwx {} + 2>"$TMPERR"         || { echo "[varrer] chmod da passada falhou em $r: $(head -1 "$TMPERR" | cut -c1-120)" >&2; problemas=$((problemas+1)); }
    done
    find /tmp -maxdepth 1 -name 'tom-*' -type f -user root -exec chmod go-rwx {} + 2>"$TMPERR"       || { echo "[varrer] chmod da passada falhou em /tmp: $(head -1 "$TMPERR" | cut -c1-120)" >&2; problemas=$((problemas+1)); }
    total=$((total + restante))
  done

  echo "[conter --varrer] corrigidos=$total restante=$restante problemas=$problemas passadas=$passadas"

  # CANAL DE ALARME (laudo, item 1). Eu tinha escrito que "o cron grita sozinho" — está
  # errado: não há MTA nem MAILTO neste host, então cron não notifica ninguém. Um scanner
  # que reprova morria em silêncio dentro do backup.log.
  # Sem canal externo, a saída é deixar o estado em arquivo e fazer a SENTINELA horária —
  # que já existe e já é consultada — reprovar quando este arquivo estiver ruim ou velho.
  # Não é notificação ativa; é detecção garantida. Notificação externa (webhook/WhatsApp) é
  # decisão do Alf, e está anotada como pendente.
  ESTADO=/opt/backups/la-organizer/varredura-status
  {
    echo "ts=$(date -Iseconds)"
    echo "epoch=$(date +%s)"
    echo "veredito=$([ "$restante" -eq 0 ] && [ "$problemas" -eq 0 ] && echo ok || echo falha)"
    echo "restante=$restante"
    echo "problemas=$problemas"
    echo "passadas=$passadas"
    echo "corrigidos=$total"
  } > "$ESTADO" 2>"$TMPERR"

  # FALSO-VERDE 2 (laudo v2): antes isto era `> "$ESTADO" 2>/dev/null && chmod 0600`. Se a
  # gravacao falhasse (disco cheio, permissao), o `&&` curto-circuitava e o script saia 0
  # dizendo "varredura ok" — sobre um estado que ninguem conseguiu escrever. A sentinela so
  # perceberia 45 min depois, pela idade. Agora a gravacao e VERIFICADA relendo o arquivo:
  # sem `veredito=` de volta no disco, a varredura REPROVA.
  if ! grep -q '^veredito=' "$ESTADO" 2>/dev/null; then
    echo "[conter --varrer] FALHA: nao consegui gravar/reler $ESTADO: $(head -1 "$TMPERR" | cut -c1-120)" >&2
    problemas=$((problemas+1)); restante=$((restante+1))
  else
    chmod 0600 "$ESTADO" 2>/dev/null || echo "[conter --varrer] aviso: chmod 0600 falhou em $ESTADO" >&2
  fi

  if [ "$restante" -eq 0 ] && [ "$problemas" -eq 0 ]; then exit 0; fi

  # Alerta EXTERNO. A sentinela detecta, mas quem avisa e isto.
  # FALSO-VERDE 3 (laudo v2): antes era `[ -x "$A" ] && "$A" ... >/dev/null 2>&1`, que joga
  # fora saida E codigo de retorno. Alerta que falha calado e pior que nao ter alerta: a
  # gente acha que esta coberto. Agora o resultado do envio e registrado NO PROPRIO estado,
  # onde a sentinela horaria le — assim "nao consegui avisar" tambem vira sinal.
  ALERTAR="$(dirname "$(readlink -f "$0")")/alertar.sh"
  if [ ! -x "$ALERTAR" ]; then
    echo "[conter --varrer] ALERTA INDISPONIVEL: $ALERTAR ausente ou sem +x" >&2
    echo "alerta=indisponivel" >> "$ESTADO" 2>/dev/null
  elif SAIDA=$("$ALERTAR" --chave varredura-permissoes --intervalo-min 60       "TOM: varredura de permissoes REPROVOU (restante=$restante problemas=$problemas passadas=$passadas) em $(hostname)" 2>&1); then
    case "$SAIDA" in
      *suprimido*) echo "alerta=suprimido" >> "$ESTADO" 2>/dev/null ;;
      *)           echo "alerta=enviado"   >> "$ESTADO" 2>/dev/null ;;
    esac
  else
    echo "[conter --varrer] ALERTA FALHOU: $(printf '%s' "$SAIDA" | head -1 | cut -c1-160)" >&2
    echo "alerta=falhou" >> "$ESTADO" 2>/dev/null
  fi
  exit 1
fi

[ "$APLICAR" = 1 ] && echo "== APLICANDO ==" || echo "== DRY-RUN (nada alterado) =="

validar_raiz() {   # NAO ecoa: escreve em RAIZ_VALIDADA. Sem $( ), o contador global vive.
  local esperado=$1 real dono
  RAIZ_VALIDADA=""
  if [ ! -d "$esperado" ]; then
    echo "[conter] AUSENTE: $esperado" >&2; RAIZES_FALTANDO=$((RAIZES_FALTANDO+1)); return 1
  fi
  real=$(realpath "$esperado" 2>/dev/null) || {
    echo "[conter] RECUSADO: realpath falhou em $esperado" >&2; RAIZES_FALTANDO=$((RAIZES_FALTANDO+1)); return 1; }
  if [ "$real" != "$esperado" ]; then
    echo "[conter] RECUSADO: $esperado resolve para $real (symlink?)" >&2; RAIZES_FALTANDO=$((RAIZES_FALTANDO+1)); return 1
  fi
  dono=$(stat -c%U "$real")
  if [ "$dono" != "$DONO_ESPERADO" ]; then
    echo "[conter] RECUSADO: $real pertence a $dono, esperado $DONO_ESPERADO" >&2; RAIZES_FALTANDO=$((RAIZES_FALTANDO+1)); return 1
  fi
  RAIZ_VALIDADA=$real
  return 0
}

# #6: r, w E x de grupo/outros. Diretorio 711 nao vaza listagem, mas e atravessavel —
# quem souber o nome do arquivo entra e le. Traversal e exposicao.
#
# FAIL-CLOSED tambem aqui (laudo, item 2): o modo --varrer ja tinha sido corrigido, mas o
# caminho normal (--aplicar) continuava com `2>/dev/null | wc -l` — o mesmo defeito, no
# script que faz a contencao COMPLETA. Corrigir um e deixar o outro seria fechar a porta
# e esquecer a janela, de novo. Erro de leitura agora conta como MEDIDA_FALHOU e reprova.
# ARMADILHA DO SUBSHELL, DE NOVO (laudo v2, bloqueador 3). Eu ja tinha caido nela no
# `validar_raiz` e reintroduzi aqui: estas duas funcoes SAO chamadas dentro de `$( )`
# (`e=$(expostos "$r")`), logo rodam em subshell. Um `MEDIDA_FALHOU=$((...+1))` la dentro
# morre com o subshell e o gate da aplicacao lia SEMPRE zero — falso-verde perfeito: a
# medicao falhava, a contagem virava 0, e "0 expostos" era declarado como sucesso.
#
# Funcao que precisa ECOAR um valor nao pode manter contador em variavel. O contador vira
# ARQUIVO: cada falha acrescenta uma linha, e o pai conta as linhas. Arquivo atravessa
# subshell; variavel nao.
ERRTMP=$(mktemp /run/conter.XXXXXX 2>/dev/null || mktemp) || { echo "[conter] mktemp falhou" >&2; exit 1; }
FALHASF=$(mktemp /run/conter-falhas.XXXXXX 2>/dev/null || mktemp) || { echo "[conter] mktemp falhou" >&2; exit 1; }
chmod 0600 "$ERRTMP" "$FALHASF"; trap 'rm -f "$ERRTMP" "$FALHASF"' EXIT INT TERM

# Le o contador. Se nem isso der certo, devolve numero alto: falha de leitura NUNCA vira zero.
medidas_falhas() { wc -l < "$FALHASF" 2>/dev/null || echo 9999; }

expostos() {
  local saida rc
  saida=$(find "$1" \( -perm -g=r -o -perm -o=r -o -perm -g=w -o -perm -o=w -o -perm -g=x -o -perm -o=x \) 2>"$ERRTMP")
  rc=$?
  if [ "$rc" -ne 0 ] || [ -s "$ERRTMP" ]; then
    echo "[conter] MEDIDA FALHOU em $1 (rc=$rc): $(head -1 "$ERRTMP" | cut -c1-120)" >&2
    echo "expostos $1 rc=$rc" >> "$FALHASF"; echo 0; return
  fi
  printf '%s\n' "$saida" | grep -c . || true
}
executaveis() {
  local saida rc
  saida=$(find "$1" -type f -perm -u=x 2>"$ERRTMP")
  rc=$?
  if [ "$rc" -ne 0 ] || [ -s "$ERRTMP" ]; then
    echo "[conter] MEDIDA FALHOU (executaveis) em $1 (rc=$rc): $(head -1 "$ERRTMP" | cut -c1-120)" >&2
    echo "executaveis $1 rc=$rc" >> "$FALHASF"; echo 0; return
  fi
  printf '%s\n' "$saida" | grep -c . || true
}

relatorio() {
  local rot=$1 te=0 tx=0 e x
  echo "--- $rot ---"
  for r in "${TODAS[@]}"; do
    if [ ! -d "$r" ]; then printf '  %-38s AUSENTE\n' "$r"; continue; fi
    e=$(expostos "$r"); x=$(executaveis "$r"); te=$((te+e)); tx=$((tx+x))
    printf '  %-38s expostos(rwx g/o): %-7s executaveis do dono: %s\n' "$r" "$e" "$x"
  done
  printf '  %-38s expostos: %-19s executaveis: %s\n' "TOTAL" "$te" "$tx"
  printf '  %-38s modo: %s (NAO tocado)\n' "/opt/backups (pai)" "$(stat -c%a /opt/backups 2>/dev/null || echo n/a)"
  TOTAL_EXPOSTOS=$te; TOTAL_EXEC=$tx
}

relatorio ANTES
EXEC_ANTES=$TOTAL_EXEC

for raiz in "${TODAS[@]}"; do
  if validar_raiz "$raiz"; then
    echo "[conter] raiz validada: $RAIZ_VALIDADA"
    if [ "$APLICAR" = 1 ]; then
      # #6: fail-closed. Cada chmod e verificado.
      if ! chmod -R go-rwx "$RAIZ_VALIDADA"; then
        echo "[conter] FALHA: chmod -R go-rwx retornou erro em $RAIZ_VALIDADA" >&2; CHMOD_FALHOU=$((CHMOD_FALHOU+1))
      fi
      if ! chmod go-rwx "$RAIZ_VALIDADA"; then
        echo "[conter] FALHA: chmod go-rwx retornou erro na raiz $RAIZ_VALIDADA" >&2; CHMOD_FALHOU=$((CHMOD_FALHOU+1))
      fi
    else
      echo "  [dry-run] chmod -R go-rwx ($(find "$RAIZ_VALIDADA" 2>/dev/null | wc -l) entradas); bits do dono preservados"
    fi
  fi
done

relatorio DEPOIS

MEDIDA_FALHOU=$(medidas_falhas)   # lido do ARQUIVO, ja fora de qualquer subshell

if [ "$APLICAR" = 1 ]; then
  ERRO=0
  [ "$RAIZES_FALTANDO" -eq 0 ] || { echo "FALHA: $RAIZES_FALTANDO raiz(es) ausente(s)/invalida(s)"; ERRO=1; }
  [ "$CHMOD_FALHOU"   -eq 0 ] || { echo "FALHA: $CHMOD_FALHOU chmod(s) retornaram erro"; ERRO=1; }
  [ "$MEDIDA_FALHOU"  -eq 0 ] || { echo "FALHA: $MEDIDA_FALHOU medicao(oes) de permissao falharam — contagem NAO e confiavel"; ERRO=1; }
  [ "$TOTAL_EXPOSTOS" -eq 0 ] || { echo "FALHA: $TOTAL_EXPOSTOS artefato(s) ainda exposto(s) a grupo/outros"; ERRO=1; }
  [ "$TOTAL_EXEC" -eq "$EXEC_ANTES" ] || { echo "FALHA: executaveis do dono mudaram de $EXEC_ANTES para $TOTAL_EXEC"; ERRO=1; }
  if [ "$ERRO" -eq 0 ]; then
    echo "== contencao confirmada: 0 expostos (r/w/x), $TOTAL_EXEC executaveis intactos, 0 chmod com erro =="
  else exit 1; fi
else
  [ "$RAIZES_FALTANDO" -eq 0 ] || echo "ATENCAO: $RAIZES_FALTANDO raiz(es) ausente(s)/invalida(s) — com --aplicar isto REPROVA"
  [ "$MEDIDA_FALHOU" -eq 0 ] || echo "ATENCAO: $MEDIDA_FALHOU medicao(oes) falharam — com --aplicar isto REPROVA"
  echo "== nada alterado. rode com --aplicar apos autorizacao do Alf =="
fi
