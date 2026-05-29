# Monitor de Saúde do Provider de IA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expor no relatório diário (health-check 07:00) a latência e a saúde do provider de IA que a `tom_metrics` já coleta, e parar o erro recorrente do `marker_logs` que descarta o registro de fallback.

**Architecture:** Um novo check `checkProviderHealth` em `src/rituals/health-check.js` que lê `tom_metrics` (24h), calcula latência mediana/P95/máx + % fallback + falhas em JS (volume ~125/dia, não precisa de RPC), e devolve `{status, detail}` no mesmo contrato dos outros checks. Mais uma migration que adiciona `'fallback'` ao CHECK constraint `marker_logs_result_check`. Sem tabela/serviço novo; reusa 100% a infra.

**Tech Stack:** Node.js (CommonJS), Supabase JS client, health-check ritual existente, migration SQL. Deploy via SCP pro VPS `tom`. Cron do health-check é externo (crontab) → next run pega o arquivo novo sem `pm2 restart`. Migration de constraint vale imediato no banco (sem restart).

**Notas de ambiente:**
- Deploy engine/rituais: `scp D:/la-organizer/_remote/<path> tom:/opt/LA-Organizer/<path>`.
- Migration: aplicar via Supabase MCP `apply_migration` (project `cesnbnrynvxvgdhfmaua`) E salvar o arquivo em `supabase/migrations/` pro histórico.
- Git: NÃO commitar manualmente — auto-deploy hook commita `_remote/` no fim do turno.
- A `tom_metrics` tem coluna de tempo `ts` (timestamptz), NÃO `created_at`.

---

### Task 1: Migration — aceitar `result='fallback'` no marker_logs

**Files:**
- Create: `supabase/migrations/20260529180000_marker_logs_allow_fallback.sql`

- [ ] **Step 1: Escrever a migration**

Conteúdo completo do arquivo:

```sql
-- marker_logs.result aceitava só executed/rejected/skipped/redirected.
-- O engine loga result='fallback' quando o Claude cai pro Codex (engine.js ~6089),
-- mas o insert era rejeitado pelo CHECK → linha de auditoria perdida + erro recorrente
-- no log ([marker_logs] insert err type=PROVIDER result=fallback). Adiciona 'fallback'.
ALTER TABLE marker_logs DROP CONSTRAINT IF EXISTS marker_logs_result_check;
ALTER TABLE marker_logs ADD CONSTRAINT marker_logs_result_check
  CHECK (result = ANY (ARRAY['executed'::text, 'rejected'::text, 'skipped'::text, 'redirected'::text, 'fallback'::text]));
```

- [ ] **Step 2: Aplicar a migration via Supabase MCP**

Usar `apply_migration` (project_id `cesnbnrynvxvgdhfmaua`, name `marker_logs_allow_fallback`) com o SQL acima.

- [ ] **Step 3: Verificar que o constraint inclui 'fallback'**

Run (Supabase MCP `execute_sql`):
```sql
select pg_get_constraintdef(oid) as def from pg_constraint where conname='marker_logs_result_check';
```
Esperado: `def` contém `'fallback'::text`.

- [ ] **Step 4: Verificar que um insert com result='fallback' passa (e limpar)**

Run (Supabase MCP `execute_sql`):
```sql
insert into marker_logs (collaborator_id, marker_type, result, reason, raw_excerpt)
values (null, 'PROVIDER', 'fallback', 'smoke-test-constraint', null) returning id;
```
Esperado: retorna 1 id (sem erro de constraint). Depois remover:
```sql
delete from marker_logs where marker_type='PROVIDER' and reason='smoke-test-constraint';
```

---

### Task 2: Check `checkProviderHealth` no health-check.js

**Files:**
- Modify: `src/rituals/health-check.js` (thresholds L19-24; novo check antes do runner ~L368; ALL_CHECKS L373; module.exports L435)

- [ ] **Step 1: Adicionar thresholds em WARN_THRESHOLDS**

Localizar (L19-24):
```js
const WARN_THRESHOLDS = {
  rejectedMarkers: 5,
  unknownMarkers: 3,
  recurringErrors: 3,
  actionableNoMarker: 3,
};
```
Substituir por:
```js
const WARN_THRESHOLDS = {
  rejectedMarkers: 5,
  unknownMarkers: 3,
  recurringErrors: 3,
  actionableNoMarker: 3,
  // Provider health (Sprint 31.9): warning se latência/fallback passar destes limites.
  providerMedianMs: 30000,
  providerP95Ms: 90000,
  providerFallbackPct: 10,
};
```

- [ ] **Step 2: Adicionar o helper de percentil + o check, logo ANTES do bloco "Runner" (antes da L370 `// Runner`)**

Inserir:
```js
// ─────────────────────────────────────────────────────────────────
// CHECK — Saúde do provider de IA (latência + fallback), Sprint 31.9
// Lê tom_metrics (24h). Volume ~125/dia → calcula percentil em JS (sem RPC).
// ─────────────────────────────────────────────────────────────────
function _percentileMs(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  const idx = Math.ceil((p / 100) * sortedAsc.length) - 1;
  return sortedAsc[Math.max(0, Math.min(idx, sortedAsc.length - 1))];
}

async function checkProviderHealth() {
  const since = isoHoursAgo(24);
  const { data, error } = await supabase
    .from('tom_metrics')
    .select('latency_ms, provider_used, fallback_from, error_kind')
    .gte('ts', since);
  if (error) return { status: 'error', detail: `provider-health indisponível: ${error.message}` };
  if (!data || data.length === 0) return { status: 'ok', detail: 'Sem mensagens nas últimas 24h' };

  const n = data.length;
  const lat = data.map(r => r.latency_ms).filter(v => typeof v === 'number').sort((a, b) => a - b);
  const med = _percentileMs(lat, 50);
  const p95 = _percentileMs(lat, 95);
  const max = lat.length ? lat[lat.length - 1] : 0;
  const fb = data.filter(r => r.fallback_from).length;
  const fails = data.filter(r => r.error_kind).length;
  const over60 = lat.filter(v => v > 60000).length;
  const fbPct = n ? (fb / n) * 100 : 0;
  const s = (ms) => (ms / 1000).toFixed(1);

  const detail = `${n} msgs · mediana ${s(med)}s · P95 ${s(p95)}s · máx ${s(max)}s · fallback ${fbPct.toFixed(1)}% · falhas ${fails} · >60s ${over60}`;
  const warn = med > WARN_THRESHOLDS.providerMedianMs
    || p95 > WARN_THRESHOLDS.providerP95Ms
    || fbPct > WARN_THRESHOLDS.providerFallbackPct
    || fails > 0;
  return { status: warn ? 'warning' : 'ok', detail };
}
```

- [ ] **Step 3: Registrar no ALL_CHECKS**

Localizar (L385):
```js
  ['known_issues_regression', checkKnownIssuesRegression],
];
```
Substituir por:
```js
  ['known_issues_regression', checkKnownIssuesRegression],
  ['provider_health',        checkProviderHealth],
];
```

- [ ] **Step 4: Exportar checkProviderHealth pro smoke**

Localizar (L435):
```js
module.exports = { runHealthCheck };
```
Substituir por:
```js
module.exports = { runHealthCheck, checkProviderHealth };
```

- [ ] **Step 5: Validar sintaxe**

Run: `node --check D:/la-organizer/_remote/src/rituals/health-check.js`
Esperado: sem saída (OK).

---

### Task 3: Smoke + deploy + verificação

**Files:**
- Create: `scripts/smoke-provider-health.js`

- [ ] **Step 1: Escrever o smoke**

Conteúdo completo:
```javascript
#!/usr/bin/env node
// Smoke: checkProviderHealth lê tom_metrics e devolve {status, detail} válido.
process.chdir('/opt/LA-Organizer');
const { checkProviderHealth } = require('../src/rituals/health-check');

(async () => {
  const r = await checkProviderHealth();
  console.log('status:', r.status);
  console.log('detail:', r.detail);
  const ok = r
    && ['ok', 'warning', 'error'].includes(r.status)
    && typeof r.detail === 'string'
    && (/mediana/.test(r.detail) || /Sem mensagens/.test(r.detail));
  console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
```

- [ ] **Step 2: Deploy do health-check + smoke pro VPS**

Run:
```
scp D:/la-organizer/_remote/src/rituals/health-check.js tom:/opt/LA-Organizer/src/rituals/health-check.js
scp D:/la-organizer/_remote/scripts/smoke-provider-health.js tom:/opt/LA-Organizer/scripts/smoke-provider-health.js
```

- [ ] **Step 3: Rodar o smoke no VPS**

Run:
```
ssh tom "cd /opt/LA-Organizer && node --env-file=.env scripts/smoke-provider-health.js"
```
Esperado: imprime `status:` (ok|warning), `detail:` com `mediana ...s ... fallback ...% · falhas N`, e `SMOKE PASS`.

- [ ] **Step 4: Conferência cruzada dos números (manual)**

Run (Supabase MCP `execute_sql`) — compara com o `detail` do smoke:
```sql
select count(*) as n,
  round((percentile_cont(0.5) within group (order by latency_ms)/1000.0)::numeric,1) as mediana_s,
  count(*) filter (where fallback_from is not null) as fb,
  count(*) filter (where error_kind is not null) as falhas
from tom_metrics where ts > now() - interval '24 hours';
```
Esperado: `mediana_s` e `fb`/`falhas` batem (±0.1s de arredondamento) com o `detail` do smoke.

- [ ] **Step 5: Verificar o relatório completo (opcional, end-to-end)**

Run:
```
ssh tom "cd /opt/LA-Organizer && node --env-file=.env src/rituals/health-check.js 2>&1 | grep -A1 provider_health"
```
Esperado: aparece o check `provider_health` com `status` e `detail` no JSON do relatório.
Nota: NÃO precisa `pm2 restart` — o cron do health-check é invocação `node` externa (crontab), pega o arquivo novo na próxima rodada das 07:00. A migration de constraint já vale no banco para o processo `tom` em execução.

---

## Self-review (preenchido)

- **Cobertura do spec:** check `checkProviderHealth` lendo tom_metrics 24h com mediana/P95/máx/%fallback/falhas/>60s (T2) ✓; threshold de warning (mediana>30s, P95>90s, fallback>10%, falhas>0) em WARN_THRESHOLDS (T2 Step1) ✓; registro no ALL_CHECKS p/ render no relatório (T2 Step3) ✓; migration `'fallback'` no constraint (T1) ✓; error-handling try/catch + caso "sem mensagens" (T2 Step2) ✓; smoke + conferência cruzada (T3) ✓.
- **Desvio consciente do spec:** percentil em JS em vez de `percentile_cont` no SQL — o spec sugeria SQL "pra evitar puxar milhares de linhas", mas o dado real é ~125/dia, então JS é mais simples e evita criar um RPC. Mesmo resultado, menos artefato. (A query de conferência em T3 Step4 ainda usa `percentile_cont` só pra validação cruzada.)
- **Placeholders:** nenhum — todo código completo.
- **Consistência de tipos:** `checkProviderHealth` retorna `{status, detail}` (igual aos outros checks, consumido por `runHealthCheck` L394-397); exportado em module.exports e consumido pelo smoke pelo mesmo nome; `isoHoursAgo`/`supabase`/`WARN_THRESHOLDS` já existem no arquivo e são referenciados pelos nomes corretos; coluna `ts` (não `created_at`) usada consistentemente.
