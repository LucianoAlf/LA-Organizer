# Runbook: Env vars do LA Report (cliente direto + serverless)

**Data:** 2026-05-17
**Sprint:** Inventário Bidirecional (Fase A) — Task 8

## Contexto

A PWA usa cliente Supabase direto ao LA Report (anon key) pra leituras e realtime. Os endpoints serverless usam service-role pra escritas.

## Vars necessárias

### Vercel (Production, Preview, Development)
Adicionar em https://vercel.com/<org>/la-organizer/settings/environment-variables :

| Name | Value | Onde pegar |
|---|---|---|
| VITE_LA_REPORT_URL | https://ouqwbbermlzqqvtqwlul.supabase.co | hardcoded |
| VITE_LA_REPORT_ANON_KEY | (anon public key) | https://supabase.com/dashboard/project/ouqwbbermlzqqvtqwlul/settings/api → "anon public" |
| LA_REPORT_URL | https://ouqwbbermlzqqvtqwlul.supabase.co | hardcoded |
| LA_REPORT_SERVICE_ROLE_KEY | (service role key) | mesma página, "service_role" (privada — NUNCA expor no bundle) |

Após adicionar, redeploy automático no próximo push.

### .env.local (dev, gitignored)
Adicionar em `_remote/web/.env.local`:

```bash
VITE_LA_REPORT_URL=https://ouqwbbermlzqqvtqwlul.supabase.co
VITE_LA_REPORT_ANON_KEY=<colar anon key>
# Pra serverless local (vercel dev), também:
LA_REPORT_URL=https://ouqwbbermlzqqvtqwlul.supabase.co
LA_REPORT_SERVICE_ROLE_KEY=<colar service role — só dev local>
```
