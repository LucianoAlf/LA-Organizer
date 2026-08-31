#!/bin/bash
# Bateria do CONTADOR da varredura de permissoes (`conter-permissoes.sh --varrer`).
#
# POR QUE EXISTE (achado 31/08): o laco de convergencia fazia `total=$((total + restante))`
# a CADA passada. `restante` e o que AINDA esta exposto no inicio da passada -- ou seja, o
# que NAO foi corrigido. Somar isso ao contador de "corrigidos" faz o numero CRESCER quanto
# mais o guard FALHA: 4 arquivos irreparaveis viravam `corrigidos=16`. Pior, o bloco inicial
# somava `n` mesmo quando o chmod daquele lote falhava. Um contador que sobe quando a
# correcao nao acontece nao e cosmetico: e um numero que MENTE na direcao tranquilizadora.
#
# COMO TESTA: copia do script com as raizes redirecionadas para um sandbox descartavel, e
# um arquivo `chattr +i` para reproduzir a NAO-CONVERGENCIA (o chmod falha de verdade, que
# e a unica condicao em que a inflacao aparece). Nada de producao e tocado -- nem /run, nem
# /tmp real, nem as 5 raizes vivas -- entao nenhum alarme do cron dispara por causa daqui.
set -uo pipefail

AQUI=$(dirname "$(readlink -f "$0")")
ORIG="$AQUI/conter-permissoes.sh"
P=0; F=0
ok()    { P=$((P+1)); printf '  ok    %s\n' "$1"; }
falha() { F=$((F+1)); printf '  FALHA %s\n' "$1"; }

[ -r "$ORIG" ]            || { echo "ABORTADO: $ORIG ilegivel"; exit 2; }
[ "$(id -u)" = 0 ]        || { echo "ABORTADO: precisa de root para reproduzir o guard"; exit 2; }
command -v chattr >/dev/null || { echo "ABORTADO: chattr ausente; sem ele nao ha arquivo irreparavel"; exit 2; }

S=$(mktemp -d) || { echo "ABORTADO: mktemp -d falhou"; exit 2; }
# O guard RECUSA raiz cujo realpath difere do caminho -- se o $TMPDIR for symlink, todas as
# raizes do sandbox seriam recusadas e a bateria ficaria verde sem medir nada.
[ "$(realpath "$S")" = "$S" ] || { echo "ABORTADO: $S resolve para outro caminho"; rm -rf "$S"; exit 2; }
limpar() { chattr -R -i "$S" 2>/dev/null; rm -rf "$S"; }
trap limpar EXIT INT TERM

# ---------------------------------------------------------------------------
# copia com as raizes redirecionadas. A aritmetica sob teste fica BYTE A BYTE
# igual; so as constantes de caminho mudam. Se alguma substituicao nao pegar, a
# bateria ABORTA -- copia meio-redirecionada mediria producao sem avisar.
# ---------------------------------------------------------------------------
COPIA="$S/conter.sh"
sed -e "s|/opt/backups/la-organizer|$S/backup|g"     -e "s|/opt/LA-Organizer/.claude-tom|$S/cli|g"     -e "s|/opt/LA-Organizer/logs|$S/logs|g"     -e "s|find /tmp -maxdepth 1|find $S/tmp -maxdepth 1|g"     -e "s|mktemp /run/varrer|mktemp $S/varrer|g"     "$ORIG" > "$COPIA" || { echo "ABORTADO: sed falhou"; exit 2; }
chmod 0700 "$COPIA"
# CANAL DE ALERTA NEUTRALIZADO EXPLICITAMENTE (31/08). `conter-permissoes.sh` resolve o
# alertador por `dirname "$0"`, entao a copia no sandbox ja nao alcancava o de producao -- mas
# isso era garantia por ACIDENTE: bastava alguem passar a resolver por caminho absoluto e a
# bateria voltaria a mandar WhatsApp de verdade. Foi exatamente o que aconteceu com a
# teste-sentinela-timeline, que gritava 11 alertas REAIS por rodada. Aqui o alertar falso fica
# do lado da copia e a asseracao no fim prova que o grito foi capturado, nao enviado.
cat > "$S/alertar.sh" <<'ALERTAFALSO'
#!/bin/bash
printf '%s
' "$*" >> "${ALERTAS_CAPTURADOS:?ALERTAS_CAPTURADOS nao definido}"
ALERTAFALSO
chmod 0700 "$S/alertar.sh"
export ALERTAS_CAPTURADOS="$S/alertas-capturados.txt"; : > "$ALERTAS_CAPTURADOS"
conferir_sub() { # <descricao> <minimo> <padrao>
  # OCORRENCIAS, nao linhas: as 3 raizes do CLI vivem todas na MESMA linha, entao
  # grep -c devolvia 1 e a bateria abortava achando que a substituicao nao pegou.
  local n; n=$(grep -o -- "$3" "$COPIA" 2>/dev/null | grep -c . || true)
  [ "${n:-0}" -ge "$2" ] || { echo "ABORTADO: substituicao nao pegou ($1): $n < $2"; exit 2; }
}
conferir_sub "raiz de backup"   1 "$S/backup"
conferir_sub "raizes do CLI"    3 "$S/cli"
conferir_sub "raiz de logs"     1 "$S/logs"
conferir_sub "tmp do engine"    3 "find $S/tmp -maxdepth 1"
conferir_sub "tmperr"           1 "mktemp $S/varrer"
grep -q "find /tmp -maxdepth 1" "$COPIA" && { echo "ABORTADO: sobrou /tmp real na copia"; exit 2; }
grep -q "/opt/LA-Organizer/logs" "$COPIA" && { echo "ABORTADO: sobrou raiz viva na copia"; exit 2; }

RAIZES=("$S/backup" "$S/cli" "$S/cli-w0" "$S/cli-w1" "$S/logs" "$S/tmp")
montar() {
  chattr -R -i "${RAIZES[@]}" 2>/dev/null
  rm -rf "${RAIZES[@]}"
  mkdir -m 0700 -p "${RAIZES[@]}"
}
campo() { grep -o "$1=[0-9]*" <<<"$2" | head -1 | cut -d= -f2; }
SAIDA=""
rodar() { SAIDA=$("$COPIA" --varrer 2>/dev/null | grep 'conter --varrer'); }
espera() { # <descricao> <corrigidos|-> <restante|-> <problemas|->
  local d=$1 c=$2 r=$3 p=$4 got_c got_r got_p
  got_c=$(campo corrigidos "$SAIDA"); got_r=$(campo restante "$SAIDA"); got_p=$(campo problemas "$SAIDA")
  local erro=""
  [ "$c" = - ] || [ "$got_c" = "$c" ] || erro="$erro corrigidos=$got_c(esp $c)"
  [ "$r" = - ] || [ "$got_r" = "$r" ] || erro="$erro restante=$got_r(esp $r)"
  [ "$p" = - ] || [ "$got_p" = "$p" ] || erro="$erro problemas=$got_p(esp $p)"
  if [ -z "$erro" ]; then ok "$d"; else falha "$d --$erro"; fi
}

echo "== convergencia: o contador conta o que REALMENTE foi corrigido =="
montar; : > "$S/logs/a"; : > "$S/logs/b"; : > "$S/logs/c"; chmod 0644 "$S/logs/a" "$S/logs/b" "$S/logs/c"
rodar; espera "3 arquivos 0644 corrigidos -> corrigidos=3" 3 0 0
montar; rodar; espera "arvore ja limpa -> corrigidos=0" 0 0 0

echo "== NAO-convergencia: contador nao pode subir quando o guard FALHA =="
montar; : > "$S/logs/travado"; chmod 0644 "$S/logs/travado"; chattr +i "$S/logs/travado"
rodar; espera "1 irreparavel -> corrigidos=0, nao 4" 0 1 -
montar; : > "$S/logs/travado"; chmod 0644 "$S/logs/travado"; chattr +i "$S/logs/travado"
: > "$S/logs/x"; : > "$S/logs/y"; : > "$S/logs/z"; chmod 0644 "$S/logs/x" "$S/logs/y" "$S/logs/z"
rodar; espera "3 corrigiveis + 1 travado -> corrigidos=3, nao 7" 3 1 -

echo "== nao-regressao da medicao (o filtro de symlink de 31/08) =="
montar; mkdir -m 0755 "$S/logs/aberto"
rodar; espera "diretorio 0755 continua sendo detectado" 1 0 0
montar; ln -s /etc/hostname "$S/logs/link"
rodar; espera "symlink nao conta e nao reprova" 0 0 0

echo "== o grito do guard nao pode sair do sandbox =="
if [ -s "$ALERTAS_CAPTURADOS" ]; then
  ok "os $(grep -c . "$ALERTAS_CAPTURADOS") alerta(s) foram para o canal FALSO -- producao intocada"
else
  falha "zero alertas capturados: os cenarios com restante>0 tinham que gritar em algum lugar"
fi

echo
echo "== $P passaram, $F falharam =="
[ "$F" -eq 0 ]
