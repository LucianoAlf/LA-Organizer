#!/bin/bash
# Smoke pós-aplicação v2.2. Só LÊ.
#
# CORREÇÕES v2.1 -> v2.2:
#   #3  As fases estavam quebradas: `--fase backup` NÃO verificava backup (a condição só
#       rodava em ddl/final). Agora cada verificação declara a partir de qual fase vale, e
#       o gate é uma comparação de ordem, não uma lista de casos.
#   #6  O PWA deixou de ser adivinhado. `curl http://127.0.0.1/` batia no vhost DEFAULT do
#       nginx (`server_name _`), que não é o PWA: os vhosts são la-os, tom e ig-webhook, e
#       /var/www/la-os é OUTRA aplicação (29 bundles, zero referência a Supabase).
#       O PWA do LA-Organizer NÃO é servido por esta VPS. Portanto a URL tem que ser
#       informada (--pwa-url) e, sem ela, a verificação é SKIP declarado — nunca um verde.
#       Quando informada, o bundle é baixado e REPROVA se contiver o segredo interno.
#
# Uso: ./smoke-pos-aplicacao.sh --fase {contencao|backup|ddl|reconciliacao|p0_4|final}
#
# FASE `reconciliacao` (v2.2, laudo bloqueador 5): o runbook mandava rodar `--fase final`
# depois do deploy, mas `final` inclui o gate do P0-4 — que REPROVA por desenho enquanto o
# segredo continuar no bundle. Runbook que manda rodar um teste fadado a falhar ensina a
# ignorar o resultado, e ai o teste nao vale mais nada.
# `reconciliacao` roda tudo (TOM de pe, suite, golden, contencao, backup, DDL) e para ANTES
# do gate do P0-4. `p0_4`/`final` continuam existindo para quando o P0-4 estiver fechado.

set -uo pipefail
FASE=final
# #4: a URL de producao e CONHECIDA (confirmada 200 em 2026-08-28). Deixa de ser opcional:
# na fase final, ausencia dela REPROVA em vez de virar SKIP com exit 0.
PWA_URL_PADRAO=https://la-organizer.vercel.app
PWA_URL="$PWA_URL_PADRAO"
while [ $# -gt 0 ]; do
  case "$1" in
    --fase)    FASE=${2:?}; shift 2 ;;
    --pwa-url) PWA_URL=${2:?}; shift 2 ;;
    *) echo "argumento desconhecido: $1" >&2; exit 2 ;;
  esac
done

RAIZ=/opt/LA-Organizer
RAIZ_BKP=/opt/backups/la-organizer
FALHAS=0; PULADOS=0
ok()    { echo "PASS  $1"; }
falha() { echo "FALHA $1"; FALHAS=$((FALHAS+1)); }
pula()  { echo "SKIP  $1"; PULADOS=$((PULADOS+1)); }

# Ordem das fases. `desde <fase>` responde: esta verificacao ja vale na fase atual?
ordem() { case "$1" in contencao) echo 1;; backup) echo 2;; ddl) echo 3;; reconciliacao) echo 4;; p0_4) echo 5;; final) echo 6;; *) echo 99;; esac; }
ATUAL=$(ordem "$FASE"); [ "$ATUAL" = 99 ] && { echo "fase invalida: $FASE" >&2; exit 2; }
desde() { [ "$ATUAL" -ge "$(ordem "$1")" ]; }

echo "== smoke fase=$FASE =="

echo "-- 1. TOM de pe --"
if pm2 jlist 2>/dev/null | grep -q '"name":"tom"'; then
  ST=$(pm2 jlist | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const p=JSON.parse(d).find(x=>x.name==="tom");console.log(p.pm2_env.status)})')
  [ "$ST" = online ] && ok "processo tom: online" || falha "processo tom: $ST"
else falha "processo tom ausente no pm2"; fi

echo "-- 2. CLI do TOM continua executavel (a contencao nao pode ter quebrado o +x) --"
EXEC=$(find "$RAIZ"/.claude-tom* -type f -perm -u=x 2>/dev/null | wc -l)
[ "$EXEC" -ge 29 ] && ok "executaveis do dono preservados: $EXEC" || falha "executaveis caíram para $EXEC (esperado >= 29)"

echo "-- 3. service_role ainda le as 5 tabelas --"
cd "$RAIZ" || exit 3
for t in event_category_leaders voice_message_log webhook_queue task_classifications pf_transactions_bkp_20260716_rose; do
  R=$(node --env-file=.env -e "require('./src/supabase/client').from('$t').select('*',{count:'exact',head:true}).then(r=>console.log(r.error?'ERRO:'+r.error.message:'ok:'+r.count))" 2>/dev/null | head -1)
  case "$R" in ok:*) ok "service_role le $t ($R)" ;; *) falha "service_role NAO le $t ($R)" ;; esac
done

echo "-- 4. suite canonica: os 3 vermelhos sao os 3 CONHECIDOS, por arquivo --"
SAIDA=$(node --env-file=.env --test $(find src -name '*.test.js') 2>&1)
FAIL=$(grep -c '^not ok' <<<"$SAIDA")
# A linha `not ok` traz so o NOME do teste; o arquivo aparece na linha `location:` logo
# abaixo. A v2.4 grepava o arquivo na linha errada e reprovava sempre — assercao no campo
# errado, o mesmo defeito que essa suite inteira existe para pegar.
# Por NOME (v2.4, laudo bloqueador 5): contar vermelhos dentro de um ARQUIVO deixava passar
# regressao nova naquele mesmo arquivo. A lista de nomes conhecidos e versionada ao lado.
CONHECIDOS="$RAIZ/scripts/suite-vermelhos-conhecidos.txt"
if [ ! -r "$CONHECIDOS" ]; then
  falha "lista de vermelhos conhecidos ausente ($CONHECIDOS) — sem ela nao da para reconhecer os vermelhos"
  NOMES=-1
else
  grep -v '^#' "$CONHECIDOS" | grep -v '^[[:space:]]*$' | LC_ALL=C sort -u > /tmp/.conhecidos.$$
  grep '^not ok' <<<"$SAIDA" | sed -E 's/^not ok [0-9]+ - //' | LC_ALL=C sort -u > /tmp/.vermelhos.$$
  DESCONHECIDOS=$(LC_ALL=C comm -13 /tmp/.conhecidos.$$ /tmp/.vermelhos.$$ | grep -c . || true)
  NOMES=$(( FAIL - DESCONHECIDOS ))
  [ "$DESCONHECIDOS" -gt 0 ] && { echo "  vermelhos NAO reconhecidos:"; LC_ALL=C comm -13 /tmp/.conhecidos.$$ /tmp/.vermelhos.$$ | sed 's/^/    /' | head -6; }
  rm -f /tmp/.conhecidos.$$ /tmp/.vermelhos.$$
fi
echo "  fail=$FAIL  deles reconhecidos pelo nome=$NOMES"
# v2.3 (laudo bloqueador 4): este gate exigia EXATAMENTE 3 enquanto o gate pre-restart do
# auto-deploy aceita 0 de proposito. Dois gates com regras diferentes sobre a mesma suite se
# contradizem: se os 3 ficarem verdes (basta TEST_COLLAB_ID no ambiente), o primeiro aprova e
# este forca rollback. Regra unica, identica a de la: todo vermelho em system-loadout, no
# maximo 3.
if [ "$FAIL" -eq "$NOMES" ] && [ "$FAIL" -le 3 ]; then
  ok "$FAIL vermelho(s), todos reconhecidos pelo nome (falta TEST_COLLAB_ID)"
else
  falha "vermelhos fora dos conhecidos: fail=$FAIL, reconhecidos=$NOMES"; grep -A3 '^not ok' <<<"$SAIDA" | head -12
fi

echo "-- 5. golden do Mapa com TEST_COLLAB_ID: exige 0 falhas --"
ID=$(node --env-file=.env -e "require('./src/supabase/client').from('collaborators').select('id').eq('is_active',true).limit(1).single().then(r=>console.log(r.data?r.data.id:''))" 2>/dev/null | head -1)
if [ -n "$ID" ]; then
  G=$(TEST_COLLAB_ID="$ID" node --env-file=.env --test src/prompts/system-loadout.test.js 2>&1 | grep -E '^# (pass|fail)' | tr '\n' ' ')
  case "$G" in *"# fail 0"*) ok "golden do Mapa: $G" ;; *) falha "golden do Mapa: $G" ;; esac
else falha "nao consegui resolver um collaborator ativo para o golden"; fi

echo "-- 6. contencao de permissoes (5 raizes do TOM) --"
if desde contencao; then
  # #3: a v2.3 fazia `[ -d "$r" ] || continue` e uma raiz obrigatoria que sumisse era
  # simplesmente pulada — o mesmo verde vacuo que o script de contencao ja tinha corrigido.
  TOT=0; AUSENTES=0; MEDIU_ERRADO=0
  FERR=$(mktemp /run/smoke-find.XXXXXX 2>/dev/null || mktemp)
  chmod 0600 "$FERR" 2>/dev/null
  # 5 raizes, nao 4 (laudo v2.3): `logs/` estava fora daqui mas DENTRO da varredura — 61 MB
  # de log operacional, com conteudo de conversa. O smoke aprovava contencao sem olhar
  # justamente a raiz que originou o incidente.
  for r in "$RAIZ_BKP" "$RAIZ"/.claude-tom "$RAIZ"/.claude-tom-w0 "$RAIZ"/.claude-tom-w1 "$RAIZ"/logs; do
    if [ ! -d "$r" ]; then echo "      AUSENTE (obrigatoria): $r"; AUSENTES=$((AUSENTES+1)); continue; fi
    # inclui o bit x de grupo/outros: diretorio 711 nao lista, mas e ATRAVESSAVEL.
    # FALSO-VERDE (laudo v2): com `2>/dev/null` um diretorio ilegivel produzia zero linhas,
    # e zero linhas era lido como "nada exposto". Erro de medicao virava aprovacao. Agora o
    # stderr do find e capturado e qualquer ruido reprova a fase.
    : > "$FERR"
    N=$(find "$r" \( -perm -g=r -o -perm -o=r -o -perm -g=w -o -perm -o=w -o -perm -g=x -o -perm -o=x \) 2>"$FERR" | wc -l)
    if [ "${PIPESTATUS[0]}" -ne 0 ] || [ -s "$FERR" ]; then
      echo "      MEDICAO FALHOU em $r: $(head -1 "$FERR" | cut -c1-120)"
      MEDIU_ERRADO=$((MEDIU_ERRADO+1))
    fi
    TOT=$(( TOT + N ))
  done
  rm -f "$FERR"
  [ "$MEDIU_ERRADO" -eq 0 ] || falha "$MEDIU_ERRADO medicao(oes) de exposicao falharam — a contagem nao vale"
  [ "$AUSENTES" -eq 0 ] || falha "$AUSENTES raiz(es) obrigatoria(s) ausente(s)"
  [ "$TOT" -eq 0 ] && [ "$AUSENTES" -eq 0 ] && ok "0 artefatos expostos (r/w/x) nas 5 raizes"     || { [ "$TOT" -gt 0 ] && falha "$TOT artefato(s) ainda exposto(s)"; }
else pula "contencao (fase anterior)"; fi

echo "-- 7. backup valido e conferido --"
if desde backup; then
  if [ -x "$RAIZ/scripts/check-backup.sh" ]; then
    "$RAIZ/scripts/check-backup.sh" >/dev/null 2>&1 && ok "sentinela aprovou" || falha "sentinela reprovou"
  else falha "check-backup.sh nao instalado"; fi
else pula "backup (ainda nao existe nesta fase)"; fi

echo "-- 8. Data API: anon e authenticated negados --"
if desde ddl; then
  if [ -x "$RAIZ/scripts/teste-negativo-dataapi.sh" ]; then
    "$RAIZ/scripts/teste-negativo-dataapi.sh" >/dev/null 2>&1 && ok "anon/authenticated negados" || falha "acesso publico ainda existe"
  else falha "teste-negativo-dataapi.sh nao instalado"; fi
else pula "Data API (migration ainda nao aplicada)"; fi

echo "-- 9. PWA de producao + segredo no bundle (P0-4) --"
if desde p0_4; then
  if [ -x "$RAIZ/scripts/verificar-bundle.sh" ]; then
    if "$RAIZ/scripts/verificar-bundle.sh" "$PWA_URL" > /tmp/.vb.$$ 2>&1
    then ok "bundle publico sem literal de alta entropia fora da allowlist"
    else falha "verificar-bundle reprovou (P0-4 aberto): $(grep -c ACHADO /tmp/.vb.$$ 2>/dev/null) achado(s)"; fi
    sed 's/^/      /' /tmp/.vb.$$ | head -14; rm -f /tmp/.vb.$$
  else falha "verificar-bundle.sh nao instalado"; fi
else
  # Antes da fase p0_4 o segredo AINDA ESTA la por definicao — cobrar aqui seria exigir que
  # o gate terminasse verde antes do incidente ser tratado. Mas a URL tem que responder.
  C=$(curl -sL -o /dev/null -w '%{http_code}' -m 20 "$PWA_URL" 2>/dev/null || echo 000)
  [ "$C" = 200 ] && ok "PWA responde HTTP 200 (verificacao do segredo fica para a fase p0_4)"     || falha "PWA em $PWA_URL devolveu HTTP $C"
fi

echo "== $FALHAS falha(s), $PULADOS pulado(s) =="

# ARTEFATO DURÁVEL (achado do laudo): antes o resultado do smoke só existia no terminal de
# quem rodou — no dia seguinte não havia como provar que aquela fase passou, nem contra qual
# commit. Agora cada execução deixa arquivo datado e uma linha na telemetria.
ATESTADOS=/opt/backups/la-organizer/smoke
if install -d -m 0700 "$ATESTADOS" 2>/dev/null; then
  A="$ATESTADOS/smoke-$(date -u +%Y%m%dT%H%M%SZ)-$FASE.txt"
  {
    echo "fase=$FASE"
    echo "ts=$(date -Iseconds)"
    echo "veredito=$([ "$FALHAS" -eq 0 ] && echo aprovado || echo reprovado)"
    echo "falhas=$FALHAS"
    echo "pulados=$PULADOS"
    # O commit sozinho MENTE quando o runtime está dirty (laudo, item 4): o atestado dizia
    # `commit=38f4e1d5` enquanto testava código enviado por scp que não está nesse commit.
    # Registrar o estado do working tree e o md5 dos arquivos que estão REALMENTE rodando
    # torna o atestado verificável — é o hash, não o commit, que identifica o que foi testado.
    echo "commit=$(git -C "$RAIZ" rev-parse --short HEAD 2>/dev/null || echo desconhecido)"
    echo "working_tree=$(git -C "$RAIZ" status --porcelain src/ 2>/dev/null | grep -c . | sed 's/^0$/limpo/;s/^[1-9].*/dirty/')"
    echo "dirty_em_src=$(git -C "$RAIZ" status --porcelain src/ 2>/dev/null | awk '{print $2}' | tr '\n' ',' | sed 's/,$//')"
    echo "md5_index=$(md5sum "$RAIZ/src/index.js" 2>/dev/null | cut -c1-12)"
    echo "md5_dispatcher=$(md5sum "$RAIZ/src/rituals/dispatcher.js" 2>/dev/null | cut -c1-12)"
    echo "tom_pid=$(pm2 jlist 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).find(x=>x.name==="tom").pid)}catch(e){console.log("?")}})')"
    echo "host=$(hostname)"
  } > "$A.parcial" 2>/dev/null
  LIBPUB="$RAIZ/scripts/lib-publicar.sh"
  if [ -r "$LIBPUB" ]; then
    # shellcheck disable=SC1090
    . "$LIBPUB"
    if publicar_atomico "$A" '^veredito=' 0600; then echo "atestado: $A"
    else falha "nao consegui publicar o atestado: $PUBLICAR_MOTIVO"; fi
  else
    rm -f "$A.parcial"; falha "lib-publicar.sh ausente — atestado nao publicado"
  fi
  T=/opt/backups/la-organizer/db/runs.jsonl
  [ -w "$T" ] && printf '{"ts":"%s","evento":"smoke","fase":"%s","status":"%s","falhas":%s,"pulados":%s}\n' \
    "$(date -Iseconds)" "$FASE" "$([ "$FALHAS" -eq 0 ] && echo aprovado || echo reprovado)" "$FALHAS" "$PULADOS" >> "$T"
else
  # O `install -d` falhando levava embora atestado E telemetria de uma vez, em silencio,
  # e o smoke ainda saia 0. Sem diretorio de atestado nao ha prova nenhuma da execucao.
  falha "nao consegui criar/acessar $ATESTADOS — sem atestado e sem telemetria desta fase"
fi

exit $(( FALHAS > 0 ? 1 : 0 ))
