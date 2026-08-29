#!/bin/bash
# Testes da publicacao atomica. Sem docker, sem banco, sem rede.
. "$(dirname "$(readlink -f "$0")")/lib-publicar.sh"
D=$(mktemp -d); P=0; F=0
res() { if [ "$1" = "$2" ]; then P=$((P+1)); printf '  ok    %-50s rc=%s\n' "$3" "$1"
        else F=$((F+1)); printf '  FALHA %-50s rc=%s (esperado %s) %s\n' "$3" "$1" "$2" "$PUBLICAR_MOTIVO"; fi; }

printf 'veredito=aprovado\n' > "$D/a.txt.parcial"
publicar_atomico "$D/a.txt" '^veredito=' 0600; res $? 0 "publica normal"
[ -f "$D/a.txt" ] && [ "$(stat -c %a "$D/a.txt")" = 600 ] && P=$((P+1)) && echo "  ok    destino e arquivo regular 0600" || { F=$((F+1)); echo "  FALHA destino/modo"; }

mkdir -p "$D/b.txt"; printf 'veredito=aprovado\n' > "$D/b.txt.parcial"
publicar_atomico "$D/b.txt" '^veredito=' 0600; res $? 1 "destino ja e DIRETORIO"
[ ! -e "$D/b.txt/b.txt.parcial" ] && [ ! -e "$D/b.txt.parcial" ] && P=$((P+1)) && echo "  ok    nao moveu para dentro nem deixou parcial" || { F=$((F+1)); echo "  FALHA sujeira deixada"; }

printf 'coisa qualquer\n' > "$D/c.txt.parcial"
publicar_atomico "$D/c.txt" '^veredito=' 0600; res $? 1 "parcial sem o marcador"
[ ! -e "$D/c.txt" ] && [ ! -e "$D/c.txt.parcial" ] && P=$((P+1)) && echo "  ok    nao publicou e limpou o parcial" || { F=$((F+1)); echo "  FALHA publicou sem marcador"; }

publicar_atomico "$D/d.txt" '^veredito=' 0600; res $? 1 "parcial ausente"

ln -s /etc/hostname "$D/e.txt"; printf 'veredito=x\n' > "$D/e.txt.parcial"
publicar_atomico "$D/e.txt" '^veredito=' 0600; res $? 1 "destino e symlink"

printf 'veredito=aprovado\n' > "$D/f.txt.parcial"
publicar_atomico "$D/f.txt" '^veredito=' 0640; res $? 0 "modo alternativo 0640"
[ "$(stat -c %a "$D/f.txt")" = 640 ] && P=$((P+1)) && echo "  ok    modo 0640 aplicado" || { F=$((F+1)); echo "  FALHA modo"; }

rm -rf "$D"
echo; echo "== $P passaram, $F falharam =="; [ "$F" -eq 0 ]
