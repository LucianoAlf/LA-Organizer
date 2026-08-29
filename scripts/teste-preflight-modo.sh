#!/bin/bash
# Preflight: conteudo NAO basta - tipo e modo tambem (laudo v2.5, bloqueador 4).
# Repo descartavel; nao toca em producao.
#
# O falso-verde: um arquivo 0644 alterado para 0755 no disco tem os MESMOS BYTES do alvo.
# A v2.5 comparava so o sha256, dizia "identico ao alvo; reset e no-op" e liberava. O
# `git reset --hard` reescreve o modo junto com o conteudo, entao a mudanca sumia calada.
# Mesma classe: arquivo trocado por symlink cujo destino tem o conteudo esperado.

set -uo pipefail
AQUI="$(dirname "$(readlink -f "$0")")"
P=0; F=0
ok()    { P=$((P+1)); printf '  ok    %s\n' "$1"; }
falhou(){ F=$((F+1)); printf '  FALHA %s\n' "$1"; }
D=$(mktemp -d "${TMPDIR:-/tmp}/pfmodo.XXXXXX")
trap 'rm -rf "$D"' EXIT INT TERM

# core.fileMode: sem ele o git nao enxerga o bit de execucao e o teste nao mede nada.
git init -q -b main "$D/repo" 2>/dev/null
cd "$D/repo" || exit 2
git config user.email t@t; git config user.name t; git config core.fileMode true
mkdir -p scripts
# lib-guardas.sh vai junto: o preflight agora tira o inventario dela e falha fechado sem
# ela. Copiar so o preflight fazia todo caso sair rc=2 -- correto do ponto de vista do
# guarda, mas o teste deixava de medir o que se propoe a medir.
cp "$AQUI/lib-guardas.sh" scripts/ 2>/dev/null
cp "$AQUI/preflight-deploy.sh" scripts/ && chmod 0755 scripts/preflight-deploy.sh
printf 'conteudo estavel\n' > dado.txt      && chmod 0644 dado.txt
printf '#!/bin/sh\necho oi\n' > prog.sh     && chmod 0755 prog.sh
printf 'alvo do link\n' > destino.txt
git add -A >/dev/null 2>&1; git commit -qm base
ALVO=$(git rev-parse HEAD)

# Se o filesystem nao representa o bit de execucao, o teste seria vacuo: aborta em vez de
# dar verde. (Foi assim que uma assercao vazia passou despercebida na rodada anterior.)
if [ "$(git ls-tree "$ALVO" -- prog.sh | awk '{print $1}')" != 100755 ]; then
  echo "  ABORTADO: este filesystem nao guarda o bit de execucao (git gravou $(git ls-tree "$ALVO" -- prog.sh | awk '{print $1}'))"
  exit 2
fi

rodar() { ./scripts/preflight-deploy.sh "$ALVO" --sem-snapshot 2>&1; }
limpar_estado() { git reset --hard -q "$ALVO" >/dev/null 2>&1; git clean -qfd >/dev/null 2>&1; }

espera() { # <ok|recusa> <descricao> [trecho-esperado]
  local out rc; out=$(rodar); rc=$?
  if [ "$1" = ok ]; then
    [ "$rc" = 0 ] && ok "$2" || { falhou "$2 (rc=$rc)"; grep RECUSADO <<<"$out" | head -2 | sed 's/^/        /'; }
  else
    if [ "$rc" != 0 ] && { [ -z "${3:-}" ] || grep -q "$3" <<<"$out"; }; then
      ok "$2 -> $(grep -m1 RECUSADO <<<"$out" | sed 's/^ *//' | cut -c1-84)"
    else
      falhou "$2 (rc=$rc) $(grep -m1 'ok  *dado\|ok  *prog\|PREFLIGHT' <<<"$out" | sed 's/^ *//' | cut -c1-84)"
    fi
  fi
}

echo "== controle: arvore limpa aprova (senao o teste so sabe reprovar) =="
espera ok "arvore identica ao alvo passa"

echo "== 0644 -> 0755: MESMOS BYTES, modo diferente =="
chmod 0755 dado.txt
espera recusa "modo alterado no disco reprova" "MODO diferente"
limpar_estado

echo "== 0755 -> 0644: o caminho inverso (perder o +x mata cron calado) =="
chmod 0644 prog.sh
espera recusa "perda do bit de execucao reprova" "MODO diferente"
limpar_estado

echo "== arquivo -> symlink (conteudo do destino igual) =="
rm -f dado.txt && ln -s destino.txt dado.txt
espera recusa "troca de arquivo por symlink reprova" "TIPO diferente"
limpar_estado

echo "== symlink -> arquivo =="
git rm -q --cached dado.txt >/dev/null 2>&1 || true
limpar_estado
rm -f link.txt; ln -s destino.txt link.txt; git add link.txt >/dev/null 2>&1
git commit -qm "link" >/dev/null 2>&1
ALVO_LINK=$(git rev-parse HEAD)
rm -f link.txt && printf 'destino.txt' > link.txt   # blob de symlink = o caminho, sem \n
out=$(./scripts/preflight-deploy.sh "$ALVO_LINK" --sem-snapshot 2>&1); rc=$?
if [ "$rc" != 0 ] && grep -q "TIPO diferente" <<<"$out"; then
  ok "symlink virou arquivo com o MESMO blob e ainda assim reprova"
else
  falhou "symlink->arquivo passou (rc=$rc) — o blob e igual, so o tipo muda"
fi
git reset --hard -q "$ALVO" >/dev/null 2>&1; git clean -qfd >/dev/null 2>&1

echo "== exclusao de rastreado (regressao: ja era coberto, tem que continuar) =="
rm -f dado.txt
espera recusa "arquivo apagado no disco reprova" "apagado no disco"
limpar_estado

echo "== untracked que colide: mesmo conteudo, modo diferente =="
git rm -q dado.txt >/dev/null 2>&1; git commit -qm "sem dado" >/dev/null 2>&1
ALVO_SEM=$(git rev-parse HEAD)
git checkout -q "$ALVO" -- . 2>/dev/null
git reset -q "$ALVO_SEM" 2>/dev/null   # dado.txt volta ao disco como UNTRACKED
chmod 0755 dado.txt 2>/dev/null
out=$(./scripts/preflight-deploy.sh "$ALVO" --sem-snapshot 2>&1); rc=$?
if [ "$rc" != 0 ] && grep -q "MODO diferente" <<<"$out"; then
  ok "untracked com modo divergente do alvo reprova"
else
  falhou "untracked so com modo diferente passou (rc=$rc)"
fi
git reset --hard -q "$ALVO" >/dev/null 2>&1; git clean -qfd >/dev/null 2>&1

echo "== BLOQUEADOR 1 (laudo v2.8): intencao STAGED nao pode ser apagada =="
# `git rm --cached x` + recriar o arquivo deixa `D  x` + `?? x`. A v2.8 olhava so o DISCO,
# via conteudo identico ao alvo e aprovava -- mas o `reset --hard` reescreve o INDICE: a
# entrada volta e a delecao staged some. Conteudo igual no disco nao transforma alteracao
# staged em no-op.
limpar_estado
printf 'conteudo estavel\n' > staged.txt; chmod 0644 staged.txt
git add staged.txt >/dev/null 2>&1; git commit -qm "arquivo para os casos staged"
ALVO_S=$(git rev-parse HEAD)

echo "-- caso a: delecao staged com o arquivo RECRIADO identico ao alvo --"
git rm --cached -q staged.txt
git show "$ALVO_S:staged.txt" > staged.txt
S=$(./scripts/preflight-deploy.sh "$ALVO_S" --sem-snapshot 2>&1); RC=$?
if [ "$RC" != 0 ] && grep -q 'intencao STAGED' <<<"$S"; then
  ok "delecao staged + arquivo identico ao alvo REPROVA (rc=$RC)"
else
  falhou "delecao staged passou (rc=$RC) -- o reset apagaria a intencao"
fi
grep -q 'git restore --staged' <<<"$S" && ok "diz como desfazer a intencao, se ela nao for boa" \
  || falhou "recusa sem dizer o caminho de saida"

echo "-- caso b: delecao staged SEM o arquivo no disco --"
rm -f staged.txt
S=$(./scripts/preflight-deploy.sh "$ALVO_S" --sem-snapshot 2>&1); RC=$?
[ "$RC" != 0 ] && ok "delecao staged sem arquivo no disco REPROVA (rc=$RC)" \
  || falhou "passou sem o arquivo (rc=$RC)"
git reset -q HEAD -- staged.txt 2>/dev/null; git checkout -q -- staged.txt 2>/dev/null

echo "-- caso c: modificado SO no disco e identico ao candidato --"
# aqui nao ha estado staged: o index e igual a HEAD. O reset atualiza o index para o alvo e
# nada se perde -- recusar isso e o que travava a transicao.
limpar_estado
git checkout -q -f "$ALVO_S" 2>/dev/null
S=$(./scripts/preflight-deploy.sh "$ALVO_S" --sem-snapshot 2>&1); RC=$?
[ "$RC" = 0 ] && ok "indice limpo + disco identico ao alvo passa (rc=0)" || { falhou "rc=$RC"; grep RECUSADO <<<"$S" | head -2 | sed 's/^/        /'; }

echo "-- caso d: alteracao staged que JA e igual ao alvo --"
# staged, mas o index ja carrega exatamente o que o alvo tem: o reset e no-op para ele.
printf 'versao nova\n' > staged.txt; git add staged.txt >/dev/null 2>&1
git commit -qm "alvo com a versao nova" >/dev/null 2>&1
ALVO_N=$(git rev-parse HEAD)
git reset -q --soft HEAD~1          # volta HEAD, mantendo o index na versao nova
S=$(./scripts/preflight-deploy.sh "$ALVO_N" --sem-snapshot 2>&1); RC=$?
if [ "$RC" = 0 ] && grep -q 'staged, mas ja identico ao alvo' <<<"$S"; then
  ok "staged igual ao alvo passa e e declarado como no-op do indice"
else
  falhou "rc=$RC: staged igual ao alvo deveria passar"
  grep RECUSADO <<<"$S" | head -2 | sed 's/^/        /'
fi
git reset -q --hard "$ALVO_N" 2>/dev/null

echo "-- caso e: adicao staged de arquivo que NAO existe no alvo --"
limpar_estado
printf 'trabalho novo\n' > novo-staged.txt; git add novo-staged.txt >/dev/null 2>&1
S=$(./scripts/preflight-deploy.sh "$ALVO" --sem-snapshot 2>&1); RC=$?
[ "$RC" != 0 ] && grep -q 'novo-staged.txt' <<<"$S" && ok "adicao staged ausente do alvo REPROVA (o reset a descarta)" \
  || falhou "adicao staged passou (rc=$RC)"
git rm -q --cached novo-staged.txt >/dev/null 2>&1; rm -f novo-staged.txt
limpar_estado

echo
echo "== $P passaram, $F falharam =="
[ "$F" -eq 0 ]
