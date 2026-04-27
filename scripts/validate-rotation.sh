#!/bin/bash
# scripts/validate-rotation.sh — Run on VPS after secrets rotation.
# Validates that the new credentials work end-to-end and prints masked evidence.
#
# Usage (from VPS):
#   cd /opt/LA-Organizer && bash scripts/validate-rotation.sh
#
# This script does NOT print full secret values. Hashes and last-4 only.

set -e
cd "$(dirname "$0")/.."

echo "=========================================================================="
echo "  ROTATION VALIDATION  — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "=========================================================================="
echo

# Mask helper: show first 6 + ... + last 4 chars (or hash for tokens)
mask() {
  local v="$1"
  if [[ -z "$v" ]]; then echo "(empty)"; return; fi
  local n=${#v}
  if [[ $n -lt 16 ]]; then echo "(short:$n chars)"; return; fi
  echo "${v:0:6}...${v: -4} (len=$n, sha256=$(echo -n "$v" | sha256sum | cut -c1-12))"
}

# Load env
set -a
source .env
set +a

echo "[1] Loaded credentials (masked):"
echo "    SUPABASE_URL                = $SUPABASE_URL"
echo "    SUPABASE_SERVICE_ROLE_KEY   = $(mask "$SUPABASE_SERVICE_ROLE_KEY")"
echo "    UAZAPI_URL                  = $UAZAPI_URL"
echo "    UAZAPI_TOKEN                = $(mask "$UAZAPI_TOKEN")"
echo

echo "[2] File permissions (.env should be 600):"
stat -c "    %a %U:%G %n" .env
echo

# ---------- Supabase ----------
echo "[3] Supabase: read test (GET /rest/v1/collaborators)"
http=$(curl -sS -o /tmp/sb_read -w "%{http_code}" \
  "$SUPABASE_URL/rest/v1/collaborators?select=id,full_name&limit=1" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")
echo "    HTTP $http"
if [[ "$http" != "200" ]]; then
  echo "    ❌ FAIL — body: $(head -c 200 /tmp/sb_read)"
  rm -f /tmp/sb_read
  exit 1
fi
rows=$(head -c 200 /tmp/sb_read)
rm -f /tmp/sb_read
echo "    ✅ ok (1 row available)"
echo

echo "[4] Supabase: write test (insert + delete in marker_logs)"
node -e "
const supabase = require('./src/supabase/client');
(async () => {
  const probeReason = 'rotation_probe_' + Date.now();
  const { data, error } = await supabase.from('marker_logs').insert({
    collaborator_id: '0576f4b6-183d-4cf1-980e-5c8d5da0177f',
    marker_type: 'PROVIDER',
    result: 'executed',
    reason: probeReason,
  }).select('id').single();
  if (error) { console.error('    INSERT err:', error.message); process.exit(1); }
  console.log('    INSERT ok id=' + String(data.id).slice(0, 8));
  const { error: dErr } = await supabase.from('marker_logs').delete().eq('id', data.id);
  if (dErr) { console.error('    DELETE err:', dErr.message); process.exit(1); }
  console.log('    DELETE ok');
  console.log('    ✅ write path operational');
})();
" || exit 1
echo

echo "[5] Supabase: ritual_logs read (last 3)"
node -e "
const supabase = require('./src/supabase/client');
(async () => {
  const { data, error } = await supabase.from('ritual_logs')
    .select('ritual_type,status,created_at').order('created_at', { ascending: false }).limit(3);
  if (error) { console.error('    err:', error.message); process.exit(1); }
  console.log('    rows: ' + (data || []).length);
  for (const r of (data || [])) console.log('      - ' + r.ritual_type + '/' + r.status + ' ' + r.created_at);
})();
" || exit 1
echo

# ---------- UAZAPI ----------
echo "[6] UAZAPI: instance/status"
http=$(curl -sS -o /tmp/uaz_status -w "%{http_code}" \
  "$UAZAPI_URL/instance/status" \
  -H "token: $UAZAPI_TOKEN")
echo "    HTTP $http"
if [[ "$http" != "200" ]]; then
  echo "    ❌ FAIL — body: $(head -c 200 /tmp/uaz_status)"
  rm -f /tmp/uaz_status
  exit 1
fi
# Parse status (don't print whole body — may contain token echo from server)
status=$(node -e "try { const j = JSON.parse(require('fs').readFileSync('/tmp/uaz_status','utf-8')); console.log(j.instance && j.instance.status); } catch(e) { console.log('parse_err'); }")
rm -f /tmp/uaz_status
echo "    instance.status = $status"
if [[ "$status" != "connected" ]]; then
  echo "    ⚠️  status not 'connected' — verify the QR pairing on UAZAPI panel"
fi
echo "    ✅ token authenticates"
echo

# ---------- TOM process ----------
echo "[7] PM2 process"
pm2 list 2>&1 | grep -E "tom" | sed 's/^/    /' | head -3
echo

echo "[8] Boot log shows new PROCESS START (last reload)"
pm2 logs tom --lines 50 --nostream 2>&1 | grep "PROCESS START" | tail -2 | sed 's/^/    /'
echo

# ---------- Stale references ----------
echo "[9] Grep for hardcoded secrets in code/docs (should be zero hits):"
hits=$(grep -rE "eyJ[A-Za-z0-9_-]{30,}|sb_secret_|service_role.*[a-zA-Z0-9]{40,}" \
  --include="*.js" --include="*.json" --include="*.sh" \
  . 2>/dev/null | grep -v "\.git/" | grep -v "node_modules" | wc -l)
echo "    hits: $hits"
[[ "$hits" -gt 0 ]] && echo "    ⚠️  review the above" || echo "    ✅ clean"
echo

# ---------- Logs leak check ----------
echo "[10] Recent log scan for leaked secrets:"
leaks=$(pm2 logs tom --lines 500 --nostream 2>&1 | grep -ciE "eyJ[A-Za-z0-9_-]{30,}|sb_secret_" || echo 0)
echo "    pm2 hits: $leaks"
[[ "$leaks" == "0" ]] && echo "    ✅ no leaks in pm2 logs" || echo "    ⚠️  review pm2 logs"
echo

echo "=========================================================================="
echo "  ✅ ROTATION VALIDATION COMPLETE"
echo "=========================================================================="
