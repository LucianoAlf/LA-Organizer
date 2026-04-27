# Secrets Audit — Sprint de Resiliência (Bloco 2)

Data: 2026-04-27.

## Severity: 🔴 HIGH — secrets exposed in public GitHub history

The repo `https://github.com/LucianoAlf/LA-Organizer` is **public** (HTTP 200 on `api.github.com/repos/...`). Commit `3ad52f5` ("feat: motor TOM completo") contains a full `.env` file. **The values currently in production are identical to the values in that historical commit** (verified by SHA256 hash comparison of every key — all 8 hashes match).

## Findings

### F1 — Production secrets in git history (CRITICAL)

| Key | Value matches `3ad52f5` | Severity if leaked |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | YES | 🔴 Full DB read/write, bypasses RLS |
| `UAZAPI_TOKEN` | YES | 🔴 Can send WhatsApp on behalf of LA Music |
| `SUPABASE_URL` | YES | 🟡 Not secret per se but identifies project |
| `UAZAPI_URL` | YES | 🟡 Endpoint, plus instance identifier |
| `TOM_PHONE` | YES | 🟢 Public-ish (it IS the WhatsApp number) |
| `PORT`, `NODE_ENV`, `LOG_LEVEL` | YES | 🟢 Not sensitive |
| `WEBHOOK_SECRET` | YES (empty in both) | 🟢 N/A (empty value) |

**Note**: `WEBHOOK_SECRET=""` is a separate issue — webhook is not HMAC-verified — but out of scope for this sprint.

### F2 — `.env` file permissions were 644 (FIXED)

Before: `-rw-r--r--` (world-readable on the VPS).
After: `chmod 600 .env` → `-rw-------` (root only).
**Status: applied, non-destructive.**

### F3 — `.env.example` is clean ✅

No real secrets; only placeholders (`seu_token`, etc.). Safe to keep tracked.

### F4 — Remote URL is clean ✅

`git@github.com:LucianoAlf/LA-Organizer.git` (SSH-based, no embedded PAT).

### F5 — `marker_logs` and `ritual_logs` do NOT leak secrets ✅

Sample of 50 rows each scanned for `service_role|sb_secret|eyJ...|UAZAPI|TOKEN|api_key|password|sk-...|Bearer`: **0 hits**. The 500-char `raw_excerpt` truncation in `logMarker()` does correctly drop trailing JSON containing values that could be sensitive — but the AI does not emit secrets in markers anyway.

### F6 — PM2 logs and cron logs do NOT contain secrets ✅

Last 2000 lines of `tom-out.log` + 1000 lines of `rituals.log`: 0 hits for the secret patterns above.

### F7 — Claude credentials are properly locked ✅

`/root/.claude/.credentials.json`: `600 root:root`.

## Actions required from the user (NOT applied — destructive / external)

These require explicit go-ahead because they're either destructive (force-push) or affect external services (key rotation breaks running deployments):

### A1 — Rotate all secrets exposed in git history

```bash
# 1) Supabase service_role key
#    Dashboard: https://supabase.com/dashboard/project/cesnbnrynvxvgdhfmaua/settings/api
#    Click "Roll service_role" → copy the new JWT.

# 2) UAZAPI token
#    Login to UAZAPI panel → regenerate instance token.

# 3) Update .env on VPS:
ssh tom 'nano /opt/LA-Organizer/.env'
ssh tom 'pm2 reload tom'
```

After rotation, the public history values become useless even if someone clones the repo.

### A2 — Purge `.env` from git history

After rotation (A1), the historical values are dead — purging is no longer urgent for security but is good hygiene. If you want to do it:

```bash
# Method: git filter-repo (preferred over filter-branch).
# WARNING: rewrites history; everyone with a clone must re-clone.
pip install git-filter-repo
cd /opt/LA-Organizer
git filter-repo --invert-paths --path .env
git push origin --force --all
git push origin --force --tags
```

**Recommendation**: rotate first (A1), keep history as-is unless required by compliance.

### A3 — Make repo private (optional)

If public visibility isn't required:
```bash
gh repo edit LucianoAlf/LA-Organizer --visibility private --accept-visibility-change-consequences
```

## Operational hygiene going forward

1. `.env` is in `.gitignore` ✅ (verified)
2. `.env` permissions: 600 ✅ (just applied)
3. New secrets must NEVER be committed. If accidentally committed:
   - Rotate immediately
   - Use `git filter-repo` to purge
4. Use `direnv` or PM2's ecosystem.config to avoid `.env` proliferation (future).

## What we DID apply this sprint

- ✅ chmod 600 .env (eliminates VPS-local exposure)
- ✅ Verified observability tables (marker_logs, ritual_logs) do not leak
- ✅ Verified PM2 / cron logs do not leak

## What we did NOT apply (requires user)

- ⏳ Rotate `SUPABASE_SERVICE_ROLE_KEY` (mandatory before scaling)
- ⏳ Rotate `UAZAPI_TOKEN` (mandatory before scaling)
- ⏳ Optional: purge `.env` from history
- ⏳ Optional: make repo private

## Verdict

For **piloto controlado interno** (you + a few testers): the exposed secrets are a known risk; mitigated by VPS-only hardening (chmod 600). Acceptable if the user accepts the public-history exposure consciously.

For **produção plena**: A1 (rotation) is **mandatory**. Without it, anyone reading the public repo can write to your DB or send WA on your behalf.
