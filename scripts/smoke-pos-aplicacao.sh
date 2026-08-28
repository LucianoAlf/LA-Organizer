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
# Uso: ./smoke-pos-aplicacao.sh --fase {contencao|backup|ddl|p0_4|final} [--pwa-url https://...]

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
ordem() { case "$1" in contencao) echo 1;; backup) echo 2;; ddl) echo 3;; p0_4) echo 4;; final) echo 5;; *) echo 99;; esac; }
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
NOMES=$(grep -A3 '^not ok' <<<"$SAIDA" | grep -c "system-loadout.test.js")
echo "  fail=$FAIL  deles com location em system-loadout=$NOMES"
if [ "$FAIL" = 3 ] && [ "$NOMES" = 3 ]; then ok "so os 3 vermelhos conhecidos (system-loadout, falta TEST_COLLAB_ID)"
else falha "vermelhos inesperados: fail=$FAIL, em system-loadout=$NOMES"; grep -A3 '^not ok' <<<"$SAIDA" | head -12; fi

echo "-- 5. golden do Mapa com TEST_COLLAB_ID: exige 0 falhas --"
ID=$(node --env-file=.env -e "require('./src/supabase/client').from('collaborators').select('id').eq('is_active',true).limit(1).single().then(r=>console.log(r.data?r.data.id:''))" 2>/dev/null | head -1)
if [ -n "$ID" ]; then
  G=$(TEST_COLLAB_ID="$ID" node --env-file=.env --test src/prompts/system-loadout.test.js 2>&1 | grep -E '^# (pass|fail)' | tr '\n' ' ')
  case "$G" in *"# fail 0"*) ok "golden do Mapa: $G" ;; *) falha "golden do Mapa: $G" ;; esac
else falha "nao consegui resolver um collaborator ativo para o golden"; fi

echo "-- 6. contencao de permissoes (4 raizes do TOM) --"
if desde contencao; then
  # #3: a v2.3 fazia `[ -d "$r" ] || continue` e uma raiz obrigatoria que sumisse era
  # simplesmente pulada — o mesmo verde vacuo que o script de contencao ja tinha corrigido.
  TOT=0; AUSENTES=0
  for r in "$RAIZ_BKP" "$RAIZ"/.claude-tom "$RAIZ"/.claude-tom-w0 "$RAIZ"/.claude-tom-w1; do
    if [ ! -d "$r" ]; then echo "      AUSENTE (obrigatoria): $r"; AUSENTES=$((AUSENTES+1)); continue; fi
    # inclui o bit x de grupo/outros: diretorio 711 nao lista, mas e ATRAVESSAVEL.
    TOT=$(( TOT + $(find "$r" \( -perm -g=r -o -perm -o=r -o -perm -g=w -o -perm -o=w -o -perm -g=x -o -perm -o=x \) 2>/dev/null | wc -l) ))
  done
  [ "$AUSENTES" -eq 0 ] || falha "$AUSENTES raiz(es) obrigatoria(s) ausente(s)"
  [ "$TOT" -eq 0 ] && [ "$AUSENTES" -eq 0 ] && ok "0 artefatos expostos (r/w/x) nas 4 raizes"     || { [ "$TOT" -gt 0 ] && falha "$TOT artefato(s) ainda exposto(s)"; }
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
  } > "$A" 2>/dev/null && chmod 0600 "$A" && echo "atestado: $A"
  T=/opt/backups/la-organizer/db/runs.jsonl
  [ -w "$T" ] && printf '{"ts":"%s","evento":"smoke","fase":"%s","status":"%s","falhas":%s,"pulados":%s}\n' \
    "$(date -Iseconds)" "$FASE" "$([ "$FALHAS" -eq 0 ] && echo aprovado || echo reprovado)" "$FALHAS" "$PULADOS" >> "$T"
fi

exit $(( FALHAS > 0 ? 1 : 0 ))
