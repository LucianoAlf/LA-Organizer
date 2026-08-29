#!/bin/bash
# Isolamento das baterias contra o estado VIVO (laudo v2.6, bloqueador 10).
# NIVEL: environment-read-only. Este teste SO LE o estado vivo -- nunca escreve nele.
#
# Ele existe porque a prova de "a suite nao suja o host" nao pode morar dentro da suite: na
# v2.6, o teste do alerta CRIAVA um arquivo em /run para provar que nao mexia em /run. Aqui a
# ordem e outra: fotografa o vivo, roda as baterias de sandbox, e fotografa de novo.
#
# Superficies observadas (todas por leitura):
#   /run/alertar-*                       marcas anti-spam reais
#   crontab do root                      linhas agendadas
#   /opt/backups/la-organizer/crontab    backups de crontab (um .bak novo vira bomba no revert)
#   /opt/LA-Organizer  (git status)      worktree de producao

set -uo pipefail
AQUI="$(dirname "$(readlink -f "$0")")"
P=0; F=0
ok()    { P=$((P+1)); printf '  ok    %s\n' "$1"; }
falhou(){ F=$((F+1)); printf '  FALHA %s\n' "$1"; }
D=$(mktemp -d "${TMPDIR:-/tmp}/isolamento.XXXXXX")
trap 'rm -rf "$D"' EXIT INT TERM

REPO_VIVO=${REPO_VIVO:-/opt/LA-Organizer}
BKP_CRON=${BKP_CRON:-/opt/backups/la-organizer/crontab}

foto() {  # <sufixo>
  ls -1 /run/alertar-* 2>/dev/null | LC_ALL=C sort > "$D/run.$1" || true
  crontab -l 2>/dev/null | LC_ALL=C sort > "$D/cron.$1" || true
  ls -1 "$BKP_CRON" 2>/dev/null | LC_ALL=C sort > "$D/bkp.$1" || true
  ( cd "$REPO_VIVO" 2>/dev/null && git status --porcelain=v1 -uno 2>/dev/null | LC_ALL=C sort ) > "$D/git.$1" || true
}

echo "== fotografando o estado vivo ANTES =="
foto antes
for s in run cron bkp git; do
  printf '  %-5s %s linha(s)\n' "$s" "$(wc -l < "$D/$s.antes")"
done
# assercao vacua e o que esta frente existe para nao ter: se nao ha NADA para observar em
# nenhuma superficie, este teste nao pode se declarar verde.
TOTAL=$(cat "$D"/*.antes 2>/dev/null | wc -l)
[ "$TOTAL" -gt 0 ] && ok "ha $TOTAL linha(s) de estado vivo para observar (comparacao nao e vacua)" \
  || falhou "nenhum estado vivo observavel -- a comparacao seria vacua"

echo "== rodando as baterias de sandbox que mais chegam perto do vivo =="
for t in teste-alertar-mock.sh teste-cron-canonico.sh; do
  if [ -x "$AQUI/$t" ] || [ -r "$AQUI/$t" ]; then
    bash "$AQUI/$t" > "$D/$t.out" 2>&1
    printf '  rodou %-28s -> %s\n' "$t" "$(grep -oE '== [0-9]+ passaram, [0-9]+ falharam ==' "$D/$t.out" | tail -1)"
  else
    falhou "$t nao encontrado -- nao da para medir isolamento do que nao rodou"
  fi
done

echo "== fotografando DEPOIS =="
foto depois
comparar() {  # <chave> <descricao>
  if diff -q "$D/$1.antes" "$D/$1.depois" >/dev/null 2>&1; then
    ok "$2 intacto ($(wc -l < "$D/$1.antes") linha(s))"
  else
    falhou "$2 MUDOU durante as baterias:"
    diff "$D/$1.antes" "$D/$1.depois" | head -5 | sed 's/^/        /'
  fi
}
comparar run  "/run/alertar-* (marcas anti-spam reais)"
comparar cron "crontab do root"
comparar bkp  "$BKP_CRON (backups de crontab)"
comparar git  "worktree de $REPO_VIVO"

echo "== e este teste tambem nao escreveu nada =="
[ -z "$(ls -1 /run/alertar-* 2>/dev/null | LC_ALL=C sort | LC_ALL=C comm -13 "$D/run.antes" - )" ] \
  && ok "nenhuma marca nova em /run criada por este teste" || falhou "este teste criou marca em /run"

echo
echo "== $P passaram, $F falharam =="
[ "$F" -eq 0 ]
