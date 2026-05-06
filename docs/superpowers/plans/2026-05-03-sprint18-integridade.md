# Sprint 18 — Integridade de Agenda e Execução Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar uma camada de integridade ao TOM que detecta conflitos temporais, suspeita de duplicidades e flagga itens de execução zumbi — sempre como alerta inteligente para decisão humana, nunca como bloqueio automático.

**Architecture:** Helpers de detecção puros no engine (zero schema novo) + pre-check hooks em `applyTaskActions` e `applyEventActions` que retornam suspect/soft/hard payloads sem persistir. Skill nova `integridade-agenda.md` ensina TOM a apresentar findings naturalmente e a aguardar confirmação humana antes de criar (DUP nunca bloqueia auto; SOFT pede microconfirm; HARD bloqueia + 1 confirmação). 2 blocos novos no dispatcher para varredura periódica de stale tasks (14d) e unclosed events (1x por dia, idempotência via ritual_logs). Zero schema novo, zero migrations.

**Tech Stack:** Node.js (engine, dispatcher, system prompt), markdown (skill TOM), PostgreSQL `tsrange &&` operator. Supabase MCP só para queries de verificação.

**Spec:** `docs/superpowers/specs/2026-05-03-sprint18-integridade-design.md`

**Note:** Workflow obrigatório (Sprint 15 estabelecido):
1. Edit local em `D:/la-organizer/_remote/...`
2. Verificar com `node -c`
3. Clone temp do main → copy → commit → push origin main
4. `ssh tom "cd /opt/LA-Organizer && git pull && pm2 restart tom"`
5. Cleanup clone temp
NUNCA scp direto.

---

## Codebase Context

### Linhas exatas relevantes — não tocar sem necessidade

| Símbolo | Arquivo | Linha |
|---|---|---|
| `applyEventActions(collaborator, events)` | `src/engine.js` | 1556 |
| Loop `for (const e of events)` + INSERT | `src/engine.js` | 1559–1594 |
| `return { okCount, failCount }` (events) | `src/engine.js` | 1595 |
| `applyTaskActions(collaborator, actions)` | `src/engine.js` | 2078 |
| Branch `a.action === 'create'` | `src/engine.js` | 2144 |
| Dedupe defensivo 60s | `src/engine.js` | 2254–2275 |
| INSERT de task + `okCount++` | `src/engine.js` | 2276–2335 |
| `return { okCount, failCount }` (tasks) | `src/engine.js` | 2560 |
| `buildActiveCoordinationContext` (Sprint 17) | `src/engine.js` | ~3163 |
| `async function processMessage` | `src/engine.js` | 3307 |
| `coordContext` wiring Sprint 17 | `src/engine.js` | 3361–3368 |
| `buildSystemPrompt(collab, { ..., coordHint, coordContext })` | `src/engine.js` | 3371 |
| Bloco `2.65` EVENT_CREATE em processMessage | `src/engine.js` | 3589–3608 |
| Bloco TASK_UPDATE em processMessage | `src/engine.js` | ~3555 |
| `buildSystemPrompt(collaborator, opts = {})` | `src/prompts/system.js` | 828 |
| `opts.coordContext → ctx.coordContext` | `src/prompts/system.js` | 832 |
| async prompt injection coordContext | `src/prompts/system.js` | 1011–1012 |
| sync prompt injection coordContext | `src/prompts/system.js` | 1048–1049 |
| `async function run(opts = {})` | `src/rituals/dispatcher.js` | 915 |
| `nowSaoPaulo()` → `{ hour, minute, dow, ymd }` | `src/rituals/dispatcher.js` | 97 |
| `timeToSlot(t)` / `currentSlot(now)` | `src/rituals/dispatcher.js` | 117 / 125 |
| `alreadySent(collaboratorId, ritualType, ymd)` | `src/rituals/dispatcher.js` | 130 |
| `logRitualEvent(collaboratorId, type, status, detail, refDate)` | `src/rituals/dispatcher.js` | 61 |
| Último bloco dispatcher: `checkCoordinationTimeouts` | `src/rituals/dispatcher.js` | 1096–1101 |
| `dispatchAnnouncements` (Sprint 13) — fim do run() | `src/rituals/dispatcher.js` | 1103–1109 |

### Padrão de retorno com integrityPayload

`applyEventActions` e `applyTaskActions` retornam atualmente `{ okCount, failCount }`. Sprint 18 estende para `{ okCount, failCount, integrityPayload }` onde `integrityPayload` pode ser `null` ou:

```js
{
  severity: 'hard' | 'soft',  // hard = bloqueia até confirmação; soft = microconfirm
  type: 'temporal_hard' | 'temporal_soft' | 'dup_event' | 'dup_task',
  conflicts: [{ id, title, start_at?, end_at?, overlapMin?, _score?, reason? }],
  candidateTitle: string,
}
```

Em `processMessage`, ao receber `integrityPayload` não-nulo:
- `severity === 'hard'`: substituir `reply` pelo texto de alerta, NÃO emitir marker, logMarker como `rejected` com reason `integrity_hard_conflict`.
- `severity === 'soft'`: substituir `reply` pelo texto de alerta (microconfirm), NÃO emitir marker, logMarker como `rejected` com reason `integrity_soft_confirm_pending`.

### Regras globais §2.0 (A1+A2+A3) — NUNCA violar

| Ajuste | Regra obrigatória |
|---|---|
| **A1 — DUP nunca bloqueia auto** | `detectDuplicateSemanticEvent` / `detectDuplicateSemanticTask` sempre retornam payload para skill decidir. Nunca `failCount++; continue` silencioso. Sempre `return { okCount: 0, failCount: 1, integrityPayload: { severity: 'soft', type: 'dup_*', ... } }` para o caller tratar. |
| **A2 — SOFT não cria silenciosamente** | `detectTemporalConflict` soft retorna payload também. INSERT só acontece após novo turno com "sim/manda/pode/ignora". |
| **A3 — Dia carregado = complemento** | `detectOverloadedDay` só gera string complementar dentro de alertas DUP ou SOFT existentes. Nunca gatilho próprio de confirmação. |
| **Fail-open** | Se qualquer detector lança exceção, `catch` loga `[IntegrityCheck] detector err (non-fatal): <msg>` e INSERT prossegue normalmente. |

### Markers — zero markers novos

Reutiliza `<<EVENT_CREATE>>` e `<<TASK_UPDATE>>` existentes. O fluxo de "confirmar criação após alerta" usa novo turno do TOM (skill instrui aguardar). Nenhum marker novo.

---

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/engine.js` | **Modificar** | Funções puras de detecção (F1) + wiring em `applyEventActions` e `applyTaskActions` create (F2) + integrityPayload handling em bloco 2.65 e TASK_UPDATE (F2) |
| `src/rituals/dispatcher.js` | **Modificar** | Funções `detectStaleTasks` + `detectUnclosedPastEvents` (F4) + wiring em `run()` |
| `src/prompts/system.js` | **Modificar** | `opts.integrityHygiene` wiring + skill loader para `integridade-agenda.md` (F3) |
| `skills/integridade-agenda.md` | **Criar** | Skill TOM: 3 modos + tabela de severidade + 8 exemplos PRD §4 + REGRA CRÍTICA |

Zero migrations. Zero schema novo.

---

## Task 1 — Fatia 1: Helpers puros de detecção (engine.js)

**Files:**
- Modify: `src/engine.js` (inserir antes da linha 3307 `async function processMessage`)

### Objetivo
5 funções puras: `jaroWinkler`, `normalizeForSim`, `detectTemporalConflict`, `detectDuplicateSemanticEvent`, `detectDuplicateSemanticTask`. Sem wiring — funções existem mas não são chamadas ainda. Fail-open obrigatório: qualquer detector que lança exceção dentro do `catch` retorna estrutura vazia.

---

- [ ] **Step 1.1 — Verificar sintaxe do engine.js antes de qualquer mudança**

```bash
node -c D:/la-organizer/_remote/src/engine.js
```
Esperado: sem output (sintaxe OK). Se falhar, parar e reportar.

---

- [ ] **Step 1.2 — Inserir bloco de helpers Jaro-Winkler + normalização antes da linha 3307**

Inserir imediatamente antes da linha 3307 (`async function processMessage(phone, text, raw = {}) {`) em `D:/la-organizer/_remote/src/engine.js`:

```js
// ─────────────────────────────────────────────────────────────────────────────
// Sprint 18 — Integridade de Agenda e Execução
// Helpers puros de detecção. Fail-open: exceptions são capturadas pelos callers.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Jaro-Winkler similarity — retorna 0..1.
 * Implementação pura, sem dependência npm. Ideal para títulos curtos.
 */
function jaroWinkler(s1, s2) {
  if (s1 === s2) return 1.0;
  const len1 = s1.length, len2 = s2.length;
  if (!len1 || !len2) return 0.0;
  const matchDist = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0);
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);
  let matches = 0, transpositions = 0;
  for (let i = 0; i < len1; i++) {
    const lo = Math.max(0, i - matchDist);
    const hi = Math.min(i + matchDist + 1, len2);
    for (let j = lo; j < hi; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = s2Matches[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0.0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
    if (s1[i] === s2[i]) prefix++; else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Normaliza string para comparação: lowercase, remove pontuação, trim. */
function normalizeForSim(s) {
  return String(s || '').toLowerCase().replace(/[^a-záàãâéêíóôõúüç\s]/g, '').replace(/\s+/g, ' ').trim();
}
```

---

- [ ] **Step 1.3 — Inserir `detectTemporalConflict` logo após o bloco do Step 1.2**

Inserir imediatamente após o bloco `normalizeForSim` inserido no step anterior:

```js
/**
 * Sprint 18 — detecta conflitos temporais antes de criar evento.
 * Fail-open: exceptions retornam { hardConflicts: [], softConflicts: [] }.
 * @param {object} collab — row de collaborators
 * @param {object} candidate — { start_at: ISO, end_at: ISO, modality, location_text }
 * @returns {{ hardConflicts: object[], softConflicts: object[] }}
 */
async function detectTemporalConflict(collab, candidate) {
  try {
    if (!candidate.start_at || !candidate.end_at) return { hardConflicts: [], softConflicts: [] };
    const { data: overlaps, error } = await supabase
      .from('events')
      .select('id, title, start_at, end_at, modality, location_text, category, status')
      .eq('collaborator_id', collab.id)
      .neq('status', 'cancelled')
      .lt('start_at', candidate.end_at)
      .gt('end_at', candidate.start_at)
      .limit(20);
    if (error) {
      console.error('[detectTemporalConflict] query err:', error.message);
      return { hardConflicts: [], softConflicts: [] };
    }
    const hardConflicts = [], softConflicts = [];
    const candStart = new Date(candidate.start_at).getTime();
    const candEnd   = new Date(candidate.end_at).getTime();
    const candDur   = candEnd - candStart;
    for (const ev of (overlaps || [])) {
      const evStart = new Date(ev.start_at).getTime();
      const evEnd   = new Date(ev.end_at).getTime();
      // Diferença < 1min → possível duplicidade; delegado para detectDuplicateSemanticEvent
      if (Math.abs(evStart - candStart) < 60_000) continue;
      const overlapMs    = Math.min(candEnd, evEnd) - Math.max(candStart, evStart);
      const overlapRatio = overlapMs / candDur;
      const bothPresencial = (ev.modality === 'presencial' || ev.modality === 'hibrido')
                          && (candidate.modality === 'presencial' || candidate.modality === 'hibrido');
      const bothOnline  = ev.modality === 'online' && candidate.modality === 'online';
      // HARD: overlap ≥50% + presencial + AMBOS location_text preenchidos e distintos (decisão 5.4)
      const diffLocation = ev.location_text && candidate.location_text
                        && ev.location_text.toLowerCase().trim() !== candidate.location_text.toLowerCase().trim();
      const overlapMin = Math.round(overlapMs / 60_000);
      if (overlapRatio >= 0.5 && bothPresencial && diffLocation) {
        hardConflicts.push({ ...ev, overlapRatio, overlapMin, reason: 'presencial_diff_location' });
      } else if (overlapRatio >= 0.5 && bothPresencial) {
        softConflicts.push({ ...ev, overlapRatio, overlapMin, reason: 'presencial_same_location' });
      } else if (overlapRatio >= 0.5 && bothOnline) {
        softConflicts.push({ ...ev, overlapRatio, overlapMin, reason: 'online_simultaneous' });
      } else if (overlapRatio >= 0.5) {
        softConflicts.push({ ...ev, overlapRatio, overlapMin, reason: 'online_presencial_mixed' });
      } else if (overlapRatio > 0) {
        softConflicts.push({ ...ev, overlapRatio, overlapMin, reason: 'partial_overlap' });
      }
    }
    return { hardConflicts, softConflicts };
  } catch (err) {
    console.error('[IntegrityCheck] detectTemporalConflict err (non-fatal):', err.message);
    return { hardConflicts: [], softConflicts: [] };
  }
}
```

---

- [ ] **Step 1.4 — Inserir `detectDuplicateSemanticEvent` após `detectTemporalConflict`**

```js
/**
 * Sprint 18 — detecta duplicidade semântica antes de criar evento.
 * Janela: ±48h em torno de candidate.start_at.
 * Fail-open: exceptions retornam { probable: [], possible: [] }.
 * @returns {{ probable: object[], possible: object[] }}
 *   probable: score > 0.7  (duplicado provável — A1: NUNCA bloqueia auto)
 *   possible: 0.5 < score ≤ 0.7 (alerta leve)
 */
async function detectDuplicateSemanticEvent(collab, candidate) {
  try {
    if (!candidate.title) return { probable: [], possible: [] };
    const candDate = candidate.start_at ? candidate.start_at.slice(0, 10) : null;
    const windowStart = candDate
      ? new Date(new Date(candDate).getTime() - 48 * 3600_000).toISOString() : null;
    const windowEnd = candDate
      ? new Date(new Date(candDate).getTime() + 48 * 3600_000).toISOString() : null;
    let query = supabase
      .from('events')
      .select('id, title, start_at, end_at, category, location_text, status, created_at')
      .eq('collaborator_id', collab.id)
      .neq('status', 'cancelled');
    if (windowStart && windowEnd) query = query.gte('start_at', windowStart).lte('start_at', windowEnd);
    const { data: candidates, error } = await query.limit(30);
    if (error) {
      console.error('[detectDuplicateSemanticEvent] query err:', error.message);
      return { probable: [], possible: [] };
    }
    const candTitleNorm = normalizeForSim(candidate.title);
    const probable = [], possible = [];
    for (const ev of (candidates || [])) {
      let score = jaroWinkler(candTitleNorm, normalizeForSim(ev.title));
      const evDate = ev.start_at ? ev.start_at.slice(0, 10) : null;
      if (candDate && evDate && candDate === evDate) score = Math.min(score + 0.3, 1.0);
      if (candidate.category && ev.category === candidate.category) score = Math.min(score + 0.1, 1.0);
      if (candidate.location_text && ev.location_text &&
          normalizeForSim(candidate.location_text) === normalizeForSim(ev.location_text)) {
        score = Math.min(score + 0.1, 1.0);
      }
      if (score > 0.7) probable.push({ ...ev, _score: score });
      else if (score > 0.5) possible.push({ ...ev, _score: score });
    }
    probable.sort((a, b) => b._score - a._score);
    possible.sort((a, b) => b._score - a._score);
    return { probable: probable.slice(0, 3), possible: possible.slice(0, 3) };
  } catch (err) {
    console.error('[IntegrityCheck] detectDuplicateSemanticEvent err (non-fatal):', err.message);
    return { probable: [], possible: [] };
  }
}
```

---

- [ ] **Step 1.5 — Inserir `detectDuplicateSemanticTask` após `detectDuplicateSemanticEvent`**

```js
/**
 * Sprint 18 — detecta task similar já aberta antes de criar.
 * Janela: tasks abertas dos últimos 30 dias.
 * Fail-open: exceptions retornam { probable: [], possible: [] }.
 * @param {object} collab
 * @param {object} candidate — { title, description, assigned_to, department_id, request_type_id }
 * @returns {{ probable: object[], possible: object[] }}
 */
async function detectDuplicateSemanticTask(collab, candidate) {
  try {
    if (!candidate.title) return { probable: [], possible: [] };
    const cutoff = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
    const { data: openTasks, error } = await supabase
      .from('tasks')
      .select('id, title, description, assigned_to, department_id, request_type_id, status, created_at, due_date')
      .eq('assigned_to', candidate.assigned_to || collab.id)
      .not('status', 'in', '("done","cancelled")')
      .gte('created_at', cutoff)
      .limit(50);
    if (error) {
      console.error('[detectDuplicateSemanticTask] query err:', error.message);
      return { probable: [], possible: [] };
    }
    const candTitleNorm = normalizeForSim(candidate.title);
    const probable = [], possible = [];
    for (const task of (openTasks || [])) {
      let score = jaroWinkler(candTitleNorm, normalizeForSim(task.title));
      if (candidate.department_id && task.department_id === candidate.department_id) score = Math.min(score + 0.2, 1.0);
      if (candidate.request_type_id && task.request_type_id === candidate.request_type_id) score = Math.min(score + 0.2, 1.0);
      // Keywords: nomes próprios (token ≥4 chars começando maiúscula no título original)
      const candKeywords = (candidate.title || '').match(/\b[A-ZÁÀÃÂÉÊÍÓÔÕÚ][a-záàãâéêíóôõúç]{3,}\b/g) || [];
      const taskKeywords = (task.title || '').match(/\b[A-ZÁÀÃÂÉÊÍÓÔÕÚ][a-záàãâéêíóôõúç]{3,}\b/g) || [];
      const shared = candKeywords.filter(k => taskKeywords.includes(k));
      if (shared.length > 0) score = Math.min(score + 0.1 * Math.min(shared.length, 2), 1.0);
      if (score > 0.7) probable.push({ ...task, _score: score });
      else if (score > 0.5) possible.push({ ...task, _score: score });
    }
    probable.sort((a, b) => b._score - a._score);
    possible.sort((a, b) => b._score - a._score);
    return { probable: probable.slice(0, 3), possible: possible.slice(0, 3) };
  } catch (err) {
    console.error('[IntegrityCheck] detectDuplicateSemanticTask err (non-fatal):', err.message);
    return { probable: [], possible: [] };
  }
}
```

---

- [ ] **Step 1.6 — Verificar sintaxe após inserções**

```bash
node -c D:/la-organizer/_remote/src/engine.js
```
Esperado: sem output.

---

- [ ] **Step 1.7 — Smoke test F1: testar jaroWinkler via node REPL**

```bash
node -e "
const { jaroWinkler, normalizeForSim } = (() => {
  // copiar as duas funções aqui inline para teste isolado
  function jaroWinkler(s1, s2) { if (s1 === s2) return 1.0; const len1 = s1.length, len2 = s2.length; if (!len1 || !len2) return 0.0; const matchDist = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0); const s1Matches = new Array(len1).fill(false); const s2Matches = new Array(len2).fill(false); let matches = 0, transpositions = 0; for (let i = 0; i < len1; i++) { const lo = Math.max(0, i - matchDist); const hi = Math.min(i + matchDist + 1, len2); for (let j = lo; j < hi; j++) { if (s2Matches[j] || s1[i] !== s2[j]) continue; s1Matches[i] = s2Matches[j] = true; matches++; break; } } if (!matches) return 0.0; let k = 0; for (let i = 0; i < len1; i++) { if (!s1Matches[i]) continue; while (!s2Matches[k]) k++; if (s1[i] !== s2[k]) transpositions++; k++; } const jaro = (matches/len1 + matches/len2 + (matches - transpositions/2)/matches)/3; let prefix = 0; for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) { if (s1[i] === s2[i]) prefix++; else break; } return jaro + prefix * 0.1 * (1 - jaro); }
  function normalizeForSim(s) { return String(s || '').toLowerCase().replace(/[^a-zà-ü\s]/g, '').replace(/\s+/g, ' ').trim(); }
  return { jaroWinkler, normalizeForSim };
})();
console.log('reuniao levi vs reuniao levi hugo:', jaroWinkler('reuniao levi', 'reuniao levi hugo').toFixed(3));
console.log('apresentacao vs apresentacao sistema gestao:', jaroWinkler('apresentacao', 'apresentacao sistema gestao').toFixed(3));
console.log('abc vs xyz:', jaroWinkler('abc', 'xyz').toFixed(3));
"
```
Esperado (aproximado): `reuniao levi vs reuniao levi hugo: 0.9xx`, `apresentacao vs...: 0.8xx`, `abc vs xyz: 0.0xx`.

---

- [ ] **Step 1.8 — Smoke test F1: verificar SQL de overlap temporal**

Abrir Supabase MCP e executar (substituir `<collab_id>` por um ID real com eventos):

```sql
SELECT id, title, start_at, end_at, modality, location_text, status
FROM events
WHERE collaborator_id = '<collab_id>'
  AND status != 'cancelled'
  AND start_at < '2026-05-05T12:00:00-03:00'
  AND end_at   > '2026-05-05T09:00:00-03:00'
LIMIT 5;
```
Esperado: retorna eventos que se sobreporiam a um candidato das 09:00–12:00. Se não houver dados reais, confirmar que a query roda sem erro.

---

## Task 2 — Fatia 2: Pre-check hooks em applyEventActions e applyTaskActions

**Files:**
- Modify: `src/engine.js` (3 zonas: `applyEventActions` loop, `applyTaskActions` create branch, bloco `2.65` + TASK_UPDATE em `processMessage`)

### Objetivo
Chamar os detectores antes do INSERT. Retornar `integrityPayload` para o caller via assinatura estendida `{ okCount, failCount, integrityPayload }`. Em `processMessage`, detectar `integrityPayload` e substituir `reply` pelo texto de alerta — sem emitir o INSERT.

**ATENÇÃO A1+A2:** DUP (probable) retorna `{ severity: 'soft', type: 'dup_*' }` — nunca `failCount++; continue` silencioso. SOFT temporal retorna `{ severity: 'soft', type: 'temporal_soft' }` — nunca INSERT silencioso. HARD temporal retorna `{ severity: 'hard', type: 'temporal_hard' }`.

---

- [ ] **Step 2.1 — Verificar sintaxe antes de qualquer mudança**

```bash
node -c D:/la-organizer/_remote/src/engine.js
```
Esperado: sem output.

---

- [ ] **Step 2.2 — Adicionar pre-check de integridade no loop de `applyEventActions` (linha 1559)**

Localizar a linha 1559 em `src/engine.js`:
```js
  for (const e of events) {
    try {
      const ctx = e.context || (e.category === 'pessoal' ? 'personal' : 'work');
```

Modificar `applyEventActions` para: (a) aceitar parâmetro `_integrityPayload = null` no closure, (b) chamar detectores antes do INSERT, (c) retornar `integrityPayload` na assinatura. Substituir a função completa de linha 1556 até 1596:

```js
async function applyEventActions(collaborator, events) {
  let okCount = 0, failCount = 0;
  let integrityPayload = null;
  const last4 = String(collaborator.phone || '').slice(-4);
  for (const e of events) {
    try {
      // Sprint 18 — pre-check de integridade (fail-open: erros nos detectores não bloqueiam)
      let temporalResult = { hardConflicts: [], softConflicts: [] };
      let dupResult      = { probable: [], possible: [] };
      try {
        [temporalResult, dupResult] = await Promise.all([
          detectTemporalConflict(collaborator, e),
          detectDuplicateSemanticEvent(collaborator, e),
        ]);
      } catch (detErr) {
        console.warn('[IntegrityCheck] event detectors err (non-fatal):', detErr.message);
      }

      // HARD conflict (A2: bloqueia até confirmação explícita, 1 rodada)
      if (temporalResult.hardConflicts.length > 0) {
        const c = temporalResult.hardConflicts[0];
        const startStr = new Date(c.start_at).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
        const endStr   = new Date(c.end_at).toLocaleTimeString('pt-BR',   { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
        console.warn(`[IntegrityCheck] HARD temporal conflict for "${String(e.title).slice(0,40)}" — overlaps "${String(c.title).slice(0,40)}" ${startStr}–${endStr} (${c.reason})`);
        integrityPayload = {
          severity: 'hard',
          type: 'temporal_hard',
          conflicts: temporalResult.hardConflicts.slice(0, 2).map(x => ({ id: x.id, title: x.title, start_at: x.start_at, end_at: x.end_at, overlapMin: x.overlapMin, reason: x.reason })),
          candidateTitle: e.title,
        };
        failCount++;
        continue;
      }

      // A1: DUP semântico provável — NUNCA bloqueia auto; retorna suspect-payload para skill decidir
      if (dupResult.probable.length > 0) {
        const d = dupResult.probable[0];
        console.warn(`[IntegrityCheck] DUP_EVENT score=${d._score.toFixed(2)} "${String(e.title).slice(0,40)}" ~ "${String(d.title).slice(0,40)}"`);
        integrityPayload = {
          severity: 'soft',
          type: 'dup_event',
          conflicts: dupResult.probable.slice(0, 3).map(x => ({ id: x.id, title: x.title, start_at: x.start_at, end_at: x.end_at, _score: x._score })),
          candidateTitle: e.title,
        };
        failCount++;
        continue;
      }

      // A2: SOFT temporal — NÃO cria silenciosamente; microconfirm via skill
      if (temporalResult.softConflicts.length > 0) {
        const c = temporalResult.softConflicts[0];
        console.log(`[IntegrityCheck] SOFT temporal conflict "${String(e.title).slice(0,40)}" ~ "${String(c.title).slice(0,40)}" overlap=${c.overlapMin}min (${c.reason})`);
        integrityPayload = {
          severity: 'soft',
          type: 'temporal_soft',
          conflicts: temporalResult.softConflicts.slice(0, 2).map(x => ({ id: x.id, title: x.title, start_at: x.start_at, end_at: x.end_at, overlapMin: x.overlapMin, reason: x.reason })),
          candidateTitle: e.title,
        };
        failCount++;
        continue;
      }

      // Sem findings: INSERT normal
      const ctx = e.context || (e.category === 'pessoal' ? 'personal' : 'work');
      const row = {
        title: e.title.trim().slice(0, 200),
        description: typeof e.description === 'string' ? e.description.slice(0, 1000) : null,
        collaborator_id: collaborator.id,
        created_by: collaborator.id,
        context: ctx,
        category: e.category,
        start_at: e.start_at,
        end_at: e.end_at,
        modality: e.modality,
        location_text: typeof e.location_text === 'string' ? e.location_text.slice(0, 200) : null,
        meeting_url: typeof e.meeting_url === 'string' ? e.meeting_url.slice(0, 500) : null,
        project_id: typeof e.project_id === 'string' ? e.project_id : null,
        status: 'scheduled',
        source: 'tom',
      };
      const { data, error } = await supabase
        .from('events')
        .insert(row)
        .select('id')
        .single();
      if (error) {
        console.error('[Event] create err:', error.message);
        failCount++;
        continue;
      }
      console.log(`[Event] create "${row.title.slice(0, 60)}" cat=${row.category} mod=${row.modality} ctx=${ctx} by ${last4} (id=${String(data?.id || '').slice(0, 8)})`);
      okCount++;
    } catch (err) {
      console.error('[Event] throw err:', err.message);
      failCount++;
    }
  }
  return { okCount, failCount, integrityPayload };
}
```

---

- [ ] **Step 2.3 — Adicionar pre-check de duplicidade semântica em `applyTaskActions` branch `create`**

Localizar linha ~2254 em `src/engine.js` — o comentário do dedupe defensivo:
```js
        // Sprint 11.2 hotfix — Dedupe defensivo. Bug observado: TOM emite TASK_CREATE
```

Inserir o bloco Sprint 18 **imediatamente antes** desse comentário (após `insertRow.due_date` e `insertRow.remind_at` serem definidos, antes do dedupe de 60s):

```js
        // Sprint 18 — pre-check de duplicidade semântica (A1: nunca bloqueia auto)
        // Ocorre APÓS validações de role/requestTypeId, ANTES do dedupe defensivo de 60s.
        let _taskIntegrityPayload = null;
        try {
          const _taskDupResult = await detectDuplicateSemanticTask(collaborator, {
            title: a.title,
            description: typeof a.description === 'string' ? a.description : undefined,
            assigned_to: assignedTo,
            department_id: departmentId || undefined,
            request_type_id: requestTypeId || undefined,
          });
          if (_taskDupResult.probable.length > 0) {
            const _d = _taskDupResult.probable[0];
            console.warn(`[IntegrityCheck] DUP_TASK score=${_d._score.toFixed(2)} "${a.title.trim().slice(0,40)}" ~ "${String(_d.title).slice(0,40)}" (${_d.status})`);
            // A1: retornar suspect-payload. INSERT NÃO ocorre. Skill processa no novo turno.
            _taskIntegrityPayload = {
              severity: 'soft',
              type: 'dup_task',
              conflicts: _taskDupResult.probable.slice(0, 3).map(x => ({ id: x.id, title: x.title, status: x.status, due_date: x.due_date, _score: x._score })),
              candidateTitle: a.title.trim(),
            };
          }
        } catch (_detErr) {
          console.warn('[IntegrityCheck] task dup detector err (non-fatal):', _detErr.message);
        }
        if (_taskIntegrityPayload) {
          // Não insere. Sinaliza para applyTaskActions retornar payload.
          // Usa mecanismo de objeto retornado — ver return abaixo.
          return { okCount, failCount: failCount + 1, integrityPayload: _taskIntegrityPayload };
        }
```

---

- [ ] **Step 2.4 — Estender o `return` final de `applyTaskActions` para incluir `integrityPayload`**

Localizar a linha 2560 em `src/engine.js`:
```js
  return { okCount, failCount };
```

Substituir por:
```js
  return { okCount, failCount, integrityPayload: null };
```

---

- [ ] **Step 2.5 — Atualizar bloco `2.65` EVENT_CREATE em `processMessage` para consumir `integrityPayload`**

Localizar o bloco nas linhas 3589–3608 em `src/engine.js`:
```js
    } else if (parsedEv) {
      const { okCount, failCount } = await applyEventActions(collab, parsedEv.events);
      console.log(`[Event] batch done: ${okCount} ok, ${failCount} fail (collab ${String(collab.phone).slice(-4)})`);
      const result = okCount > 0 ? 'executed' : 'rejected';
      const reason = okCount > 0 ? `ok=${okCount} fail=${failCount}` : `all_failed:${failCount}`;
      await logMarker(collab.id, 'EVENT_CREATE', result, reason, null);
      let base = parsedEv.cleanText || '';
      if (failCount > 0 && okCount === 0) {
        base = (base ? base + '\n\n' : '') + '_não consegui salvar o compromisso, te aviso depois_';
      }
      reply = base || reply;
    }
```

Substituir por:
```js
    } else if (parsedEv) {
      const { okCount, failCount, integrityPayload } = await applyEventActions(collab, parsedEv.events);
      console.log(`[Event] batch done: ${okCount} ok, ${failCount} fail (collab ${String(collab.phone).slice(-4)})`);
      if (integrityPayload) {
        // Sprint 18: integrity finding — NÃO persiste; skill apresenta ao user e aguarda confirmação
        const iSeverity = integrityPayload.severity;
        const iType     = integrityPayload.type;
        const logReason = `integrity_${iType}:severity=${iSeverity}:candidate="${String(integrityPayload.candidateTitle).slice(0,40)}"`;
        await logMarker(collab.id, 'EVENT_CREATE', 'rejected', logReason, null);
        console.warn(`[IntegrityCheck] EVENT_CREATE blocked by ${iType} (${iSeverity}) — "${String(integrityPayload.candidateTitle).slice(0,40)}"`);
        // reply já foi construído pelo Claude com o texto de alerta (skill integridade-agenda.md).
        // Apenas garantir que marker <<EVENT_CREATE>> seja removido do reply.
        reply = parsedEv.cleanText || reply;
      } else {
        const result = okCount > 0 ? 'executed' : 'rejected';
        const reason = okCount > 0 ? `ok=${okCount} fail=${failCount}` : `all_failed:${failCount}`;
        await logMarker(collab.id, 'EVENT_CREATE', result, reason, null);
        let base = parsedEv.cleanText || '';
        if (failCount > 0 && okCount === 0) {
          base = (base ? base + '\n\n' : '') + '_não consegui salvar o compromisso, te aviso depois_';
        }
        reply = base || reply;
      }
    }
```

---

- [ ] **Step 2.6 — Atualizar bloco TASK_UPDATE em `processMessage` para consumir `integrityPayload`**

Localizar o bloco nas linhas ~3555–3565 em `src/engine.js`:
```js
      const { okCount, failCount } = await applyTaskActions(collab, parsedTask.actions);
      console.log(`[Task] batch done: ${okCount} ok, ${failCount} fail (collab ${String(collab.phone).slice(-4)})`);
      const result = okCount > 0 ? 'executed' : 'rejected';
      const reason = okCount > 0 ? `ok=${okCount} fail=${failCount}` : `all_failed:${failCount}`;
      await logMarker(collab.id, 'TASK_UPDATE', result, reason, null);
      let base = parsedTask.cleanText || '';
```

Substituir `const { okCount, failCount } =` por `const { okCount, failCount, integrityPayload } =`, e inserir o bloco de guarda imediatamente após a linha `console.log` de batch:

```js
      const { okCount, failCount, integrityPayload } = await applyTaskActions(collab, parsedTask.actions);
      console.log(`[Task] batch done: ${okCount} ok, ${failCount} fail (collab ${String(collab.phone).slice(-4)})`);
      if (integrityPayload) {
        const iType = integrityPayload.type;
        const logReason = `integrity_${iType}:candidate="${String(integrityPayload.candidateTitle).slice(0,40)}"`;
        await logMarker(collab.id, 'TASK_UPDATE', 'rejected', logReason, null);
        console.warn(`[IntegrityCheck] TASK_UPDATE blocked by ${iType} — "${String(integrityPayload.candidateTitle).slice(0,40)}"`);
        reply = parsedTask.cleanText || reply;
      } else {
        const result = okCount > 0 ? 'executed' : 'rejected';
        const reason = okCount > 0 ? `ok=${okCount} fail=${failCount}` : `all_failed:${failCount}`;
        await logMarker(collab.id, 'TASK_UPDATE', result, reason, null);
        let base = parsedTask.cleanText || '';
        if (failCount > 0 && okCount === 0) {
          base = (base ? base + '\n\n' : '') + '_não consegui registrar agora, te aviso depois_';
        }
        reply = base || reply;
      }
```

---

- [ ] **Step 2.7 — Verificar sintaxe**

```bash
node -c D:/la-organizer/_remote/src/engine.js
```
Esperado: sem output.

---

- [ ] **Step 2.8 — Smoke test F2: confirmar que `[IntegrityCheck]` aparece nos logs**

Usando Supabase MCP, verificar se existem eventos que se sobreporiam com um candidato. Em seguida, verificar nos logs de pm2 (pós-deploy) que o prefixo `[IntegrityCheck]` aparece. Para pré-deploy, testar via node com dados mock:

```bash
node -e "
require('dotenv').config({ path: 'D:/la-organizer/_remote/.env' });
const { applyEventActions } = require('D:/la-organizer/_remote/src/engine.js');
// Nota: engine exporta processMessage; applyEventActions é interna.
// Smoke test real via SQL abaixo — confirmar retorno de integrityPayload.
console.log('module loaded OK');
"
```
Se `engine.js` não exporta as funções internas, confirmar apenas via `node -c` + SQL queries. O smoke test real acontece pós-deploy.

---

## Task 3 — Fatia 3: Skill `integridade-agenda.md` + wiring em system.js

**Files:**
- Create: `skills/integridade-agenda.md`
- Modify: `src/prompts/system.js` (loader da skill + `opts.integrityHygiene`)

### Objetivo
Skill ensina TOM a interpretar payloads `integrity_*`, formatar alertas naturalmente, aguardar confirmação humana antes de criar. Wiring em `system.js` espelha o padrão `coordContext` (Sprint 17).

---

- [ ] **Step 3.1 — Criar `skills/integridade-agenda.md`**

Criar arquivo `D:/la-organizer/_remote/skills/integridade-agenda.md` com o conteúdo:

```markdown
# Skill: Integridade de Agenda e Execução

> Sprint 18. Esta skill é carregada para todos os roles.

## O que é esta skill

Quando você tenta criar um evento ou tarefa, o engine verifica automaticamente conflitos e duplicidades **antes** de salvar. Se encontrar algo, ele **não salva** e devolve um payload especial para você apresentar ao usuário.

Esta skill define como você apresenta esses findings e quando aguarda confirmação versus quando pode prosseguir.

---

## REGRA CRÍTICA

```
NUNCA bloqueie criação apenas por suspeita vaga.
APENAS severity "hard" bloqueia explicitamente até confirmação.
Tudo o mais é alerta informativo que pede uma microconfirmação.

Se o usuário disser qualquer variante de "cria mesmo assim", "manda", "pode fazer",
"tudo bem", "ignora", "sim" → emita o marker normalmente no próximo turno.
NÃO faça nova rodada de confirmação após o "sim" do usuário.
```

---

## Modo 1 — Pre-create check (quando engine retorna integrity payload)

O engine retorna um objeto de integridade quando detecta algo. Você reconhece pelo contexto da conversa que **o evento/tarefa não foi criado** mesmo após você ter emitido o marker.

### Tabela de comportamento por tipo

| Tipo retornado | Severity | O que você faz |
|---|---|---|
| `temporal_hard` | hard | Mostra o conflito claramente. Diz que não criou. Pergunta UMA vez: "quer criar mesmo assim?" Aguarda "sim" antes de emitir o marker novamente. |
| `dup_event` | soft | Mostra o evento parecido (com data). Pergunta: "parece duplicidade — é o mesmo evento?" Aguarda resposta. Se usuário diz "sim, cria", emita o marker. |
| `dup_task` | soft | Mostra a tarefa parecida (com status). Pergunta: "já tem algo parecido aberto — quer criar assim mesmo ou prefere usar a existente?" |
| `temporal_soft` | soft | Informa a sobreposição brevemente. Pergunta: "tem sobreposição de N min com [título] — quer criar mesmo assim?" Aguarda "sim/manda/pode". |

### Exemplos canônicos por caso PRD §4

**Caso E1 — HARD temporal (presencial, locais distintos)**
> Usuário: "marca reunião amanhã 10h no Recreio"
> Engine: `{ type: 'temporal_hard', conflicts: [{ title: 'Apresentação Levi', start_at: '...09:00', end_at: '...10:30', reason: 'presencial_diff_location' }] }`

Resposta TOM:
```
Opa — você já tem *Apresentação Levi* das 9h às 10h30 presencial (outro local). Não dá pra estar nos dois ao mesmo tempo.

Quer criar mesmo assim?
```
Após "sim, cria": emite `<<EVENT_CREATE>>` normalmente.

---

**Caso E2 — SOFT temporal (online simultâneo)**
> Engine: `{ type: 'temporal_soft', conflicts: [{ title: 'Reunião Renan', overlapMin: 30, reason: 'online_simultaneous' }] }`

Resposta TOM:
```
Você já tem *Reunião Renan* nesse horário — sobreposição de 30 min (ambas online). Quer criar mesmo assim?
```
Após "sim": emite o marker.

---

**Caso E3 — DUP de evento**
> Engine: `{ type: 'dup_event', conflicts: [{ title: 'Apresentação Sistema Gestão Levi', start_at: '2026-05-04T09:00:00-03:00', _score: 0.83 }] }`

Resposta TOM:
```
Encontrei um evento parecido já criado: *Apresentação Sistema Gestão Levi* (amanhã 09h). É o mesmo ou quer criar um evento separado?
```
Após "cria separado" ou "é diferente": emite o marker.

---

**Caso E4 — DUP de tarefa**
> Engine: `{ type: 'dup_task', conflicts: [{ title: 'Renan — NF pendente', status: 'pending', due_date: '2026-05-10', _score: 0.75 }] }`

Resposta TOM:
```
Já existe uma tarefa parecida aberta: *Renan — NF pendente* (prazo 10/05, pendente). Quer abrir uma nova mesmo assim ou prefere continuar com essa?
```
Após "abre nova" ou "é diferente": emite o marker. Após "usa a existente": não emite marker.

---

**Caso E7 — Dia carregado (A3: complemento, não gatilho)**
Quando o engine retorna qualquer alerta de DUP ou SOFT e `daily_plan` mostra ≥6 itens no mesmo dia, adicione **ao final** do texto de alerta:
```
(O dia de amanhã já tem 6+ itens planejados — dia bem cheio.)
```
Nunca use "dia carregado" como motivo primário de bloqueio ou confirmação.

---

## Modo 2 — Higiene sob demanda

Quando o usuário diz frases como:
- "o que tenho parado", "tarefas zumbi", "tô com muita coisa aberta"
- "mostra eventos que não fechei", "limpa minha agenda"

→ Informe que você vai verificar e peça ao usuário aguardar. Use o contexto de higiene do `[INTEGRITY_HYGIENE_CONTEXT]` se disponível, ou sugira: "Só me dizer o que quer revisar primeiro: tarefas paradas há mais de 2 semanas, ou compromissos passados que estão em aberto?"

Proponha limpeza item a item: para cada item, diga o que é e pergunte se quer fechar/arquivar/manter.

---

## Modo 3 — Briefing integration

**APENAS SE** o system prompt incluir um bloco `[INTEGRITY_HYGIENE_CONTEXT]` com findings ao final do briefing matinal (`[RITUAL: briefing_diario]`), mencione-os com tom leve:

- Tasks paradas há 14d+: *"Encontrei N tarefa(s) parada(s) há um tempo — quer dar uma passada nelas hoje?"*
- Compromissos passados sem fechar: *"Tem N compromisso(s) que já aconteceu(ram) mas ainda estão abertos — quer fechar agora?"*

**Nunca inclua esta seção se `[INTEGRITY_HYGIENE_CONTEXT]` estiver ausente ou vazio.**
Tom: direto, leve, nunca alarmista. Uma frase, uma microação.

---

## Regras de convivência com outras skills

- Esta skill **não substitui** `coordenacao-conversacional.md` (Sprint 16/17). As duas convivem.
- Se uma criação é bloqueada por integridade, o bloco `[ACTIVE_COORDINATION_CONTEXT]` do ACC (Sprint 17) permanece válido para o contexto geral da conversa.
- Nunca mencione "payload", "integrityPayload", "severity" ou termos técnicos ao usuário. Fale naturalmente.
```

---

- [ ] **Step 3.2 — Verificar que o arquivo foi criado corretamente**

```bash
node -e "const fs = require('fs'); const c = fs.readFileSync('D:/la-organizer/_remote/skills/integridade-agenda.md', 'utf8'); console.log('OK — chars:', c.length, 'lines:', c.split('\\n').length);"
```
Esperado: `OK — chars: XXXX lines: XX` (sem erro).

---

- [ ] **Step 3.3 — Adicionar `opts.integrityHygiene` no `buildSystemPrompt` em `system.js`**

Localizar a linha 832 em `src/prompts/system.js`:
```js
  if (opts.coordContext) ctx.coordContext = opts.coordContext;   // Sprint 17 ACC
```

Inserir imediatamente após:
```js
  if (opts.integrityHygiene) ctx.integrityHygiene = opts.integrityHygiene; // Sprint 18 hygiene
```

---

- [ ] **Step 3.4 — Injetar `integrityHygiene` no async system prompt (linha ~1011)**

Localizar em `src/prompts/system.js` o bloco de injeção `coordContext`:
```js
  if (ctx && ctx.coordContext) {
    systemPrompt += '\n\n' + ctx.coordContext;
  }
```

Inserir imediatamente após:
```js
  if (ctx && ctx.integrityHygiene) {
    systemPrompt += '\n\n[INTEGRITY_HYGIENE_CONTEXT]\n' + ctx.integrityHygiene;
  }
```

---

- [ ] **Step 3.5 — Injetar `integrityHygiene` no sync system prompt (linha ~1048)**

Localizar em `src/prompts/system.js` o bloco de injeção sync `coordContext`:
```js
  if (ctx && ctx.coordContext) {
    syncPrompt += '\n\n' + ctx.coordContext;
  }
```

Inserir imediatamente após:
```js
  if (ctx && ctx.integrityHygiene) {
    syncPrompt += '\n\n[INTEGRITY_HYGIENE_CONTEXT]\n' + ctx.integrityHygiene;
  }
```

---

- [ ] **Step 3.6 — Verificar que a skill já é carregada via `pickSkill` (não precisa de mudança)**

Em `system.js`, `pickSkill` retorna a skill baseada no conteúdo da mensagem. A skill `integridade-agenda.md` é sempre relevante (não é gatilhada por keyword — é injetada junto ao briefing). Verificar se a lógica de `pickSkill` permite uma "skill global" ou se precisa ser injetada diretamente.

Localizar linha 844 em `src/prompts/system.js`:
```js
  const skill = pickSkill(collaborator, lastUserMessage, hist);
```

Se `pickSkill` não retornar `integridade-agenda` automaticamente, adicionar injeção complementar logo após `const skillBlock = ...` (linha ~854):

```js
  // Sprint 18 — integridade-agenda: injetada como skill auxiliar para todos os roles
  // (assim como priorizacao-inteligente é AUX para alguns roles)
  const integritySkillBody = loadSkill('integridade-agenda.md');
  const integritySkillBlock = integritySkillBody
    ? `\n\n# 🛡️ SKILL AUXILIAR: integridade-agenda\n\n${integritySkillBody}`
    : '';
```

E incluir `integritySkillBlock` na construção do `systemPrompt` (linha ~931 onde `skillBlock` é passado).

**Nota:** verificar o padrão de como `auxPriorityBody` é injetado (linha ~851–855) e replicar o mesmo padrão para `integritySkillBlock`.

---

- [ ] **Step 3.7 — Verificar sintaxe**

```bash
node -c D:/la-organizer/_remote/src/prompts/system.js
```
Esperado: sem output.

---

- [ ] **Step 3.8 — Smoke test F3: confirmar que skill aparece no system prompt**

```bash
node -e "
require('dotenv').config({ path: 'D:/la-organizer/_remote/.env' });
const { buildSystemPrompt } = require('D:/la-organizer/_remote/src/prompts/system.js');
// Chamar com collab mock para ver se skill é incluída
console.log('system.js loaded OK');
"
```
Esperado: sem erro de módulo.

---

## Task 4 — Fatia 4: Dispatcher hygiene blocks

**Files:**
- Modify: `src/rituals/dispatcher.js` (2 novas funções + wiring em `run()`)

### Objetivo
`detectStaleTasks`: segunda-feira às 09:00 BRT, max 5 tasks. `detectUnclosedPastEvents`: todos os dias às 09:30 BRT, max 3 eventos. Idempotência via `ritual_logs`. Wiring em `run()` após `checkCoordinationTimeouts` (linha 1101).

**Padrão reutilizado:** exatamente como `checkDepartmentOperational` — `alreadySent` → query → `whatsapp.sendMessage` → `logRitualEvent`.

---

- [ ] **Step 4.1 — Verificar sintaxe do dispatcher antes de qualquer mudança**

```bash
node -c D:/la-organizer/_remote/src/rituals/dispatcher.js
```
Esperado: sem output.

---

- [ ] **Step 4.2 — Inserir função `detectStaleTasks` antes de `async function run(opts = {}) {` (linha 915)**

Inserir imediatamente antes da linha 915 em `D:/la-organizer/_remote/src/rituals/dispatcher.js`:

```js
// Sprint 18 — Higiene de execução: tasks zumbi (stale)
// Dispara segunda-feira às 09:00 BRT. Max 5 tasks. Idempotência via ritual_logs.
async function detectStaleTasks(now = new Date()) {
  const sp = nowSaoPaulo();
  if (sp.dow !== 1 || currentSlot(sp) !== timeToSlot('09:00')) return; // segunda 09:00

  const whatsapp = require('../services/whatsapp');
  const STALE_DAYS = 14;
  const MAX_ALERTS = 5;
  const staleCutoff = new Date(now.getTime() - STALE_DAYS * 24 * 3600_000).toISOString();
  const ymdRef = sp.ymd;

  const collabs = await listCollaborators();
  for (const collab of collabs) {
    if (await alreadySent(collab.id, 'hygiene_stale_tasks', ymdRef)) continue;

    const { data: staleTasks, error } = await supabase
      .from('tasks')
      .select('id, title, due_date, updated_at, status')
      .eq('assigned_to', collab.id)
      .not('status', 'in', '("done","cancelled")')
      .lt('updated_at', staleCutoff)
      .order('updated_at', { ascending: true })
      .limit(MAX_ALERTS);

    if (error) {
      console.error('[detectStaleTasks] query err:', error.message);
      await logRitualEvent(collab.id, 'hygiene_stale_tasks', 'error', error.message, ymdRef);
      continue;
    }
    if (!staleTasks || staleTasks.length === 0) {
      await logRitualEvent(collab.id, 'hygiene_stale_tasks', 'skipped', 'no_stale_tasks', ymdRef);
      continue;
    }

    const count = staleTasks.length;
    const listText = staleTasks
      .slice(0, 3)
      .map(t => `• _${String(t.title).slice(0, 60)}_`)
      .join('\n');
    const msg = `👻 *Higiene de tarefas*\n\nEncontrei *${count}* tarefa${count > 1 ? 's' : ''} aberta${count > 1 ? 's' : ''} há mais de ${STALE_DAYS} dias sem atualização:\n${listText}${count > 3 ? `\n_...e mais ${count - 3}_` : ''}\n\nQuer revisar agora? Só dizer "abre minhas tarefas paradas".`;

    try {
      await whatsapp.sendMessage(collab.phone, msg);
      await logRitualEvent(collab.id, 'hygiene_stale_tasks', 'sent', `count=${count}`, ymdRef);
    } catch (err) {
      console.error(`[detectStaleTasks] send err ${String(collab.phone).slice(-4)}:`, err.message);
      await logRitualEvent(collab.id, 'hygiene_stale_tasks', 'error', err.message, ymdRef);
    }
  }
}
```

---

- [ ] **Step 4.3 — Inserir função `detectUnclosedPastEvents` imediatamente após `detectStaleTasks`**

```js
// Sprint 18 — Higiene de execução: eventos passados sem fechamento
// Dispara todos os dias às 09:30 BRT. Max 3 eventos. Idempotência via ritual_logs.
async function detectUnclosedPastEvents(now = new Date()) {
  const sp = nowSaoPaulo();
  if (currentSlot(sp) !== timeToSlot('09:30')) return; // 09:30 (qualquer dia)

  const whatsapp = require('../services/whatsapp');
  const MAX_ALERTS = 3;
  const cutoff24h = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const ymdRef = sp.ymd;

  const collabs = await listCollaborators();
  for (const collab of collabs) {
    if (await alreadySent(collab.id, 'hygiene_unclosed_events', ymdRef)) continue;

    const { data: unclosed, error } = await supabase
      .from('events')
      .select('id, title, start_at, end_at, category')
      .eq('collaborator_id', collab.id)
      .not('status', 'in', '("done","cancelled")')
      .lt('end_at', cutoff24h)
      .order('end_at', { ascending: false })
      .limit(MAX_ALERTS);

    if (error) {
      console.error('[detectUnclosedPastEvents] query err:', error.message);
      await logRitualEvent(collab.id, 'hygiene_unclosed_events', 'error', error.message, ymdRef);
      continue;
    }
    if (!unclosed || unclosed.length === 0) {
      await logRitualEvent(collab.id, 'hygiene_unclosed_events', 'skipped', 'none_found', ymdRef);
      continue;
    }

    const count = unclosed.length;
    const listText = unclosed
      .map(e => {
        const dateStr = new Date(e.end_at).toLocaleDateString('pt-BR', {
          timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
        });
        return `• _${String(e.title).slice(0, 60)}_ (${dateStr})`;
      })
      .join('\n');
    const msg = `📌 *Compromissos sem fechamento*\n\nTinha *${count}* compromisso${count > 1 ? 's' : ''} que já aconteceu${count > 1 ? 'ram' : ''} e ainda está${count > 1 ? 'o' : ''} em aberto:\n${listText}\n\nQuer fechar agora? Só responder "fecha" ou me dizer o que aconteceu.`;

    try {
      await whatsapp.sendMessage(collab.phone, msg);
      await logRitualEvent(collab.id, 'hygiene_unclosed_events', 'sent', `count=${count}`, ymdRef);
    } catch (err) {
      console.error(`[detectUnclosedPastEvents] send err ${String(collab.phone).slice(-4)}:`, err.message);
      await logRitualEvent(collab.id, 'hygiene_unclosed_events', 'error', err.message, ymdRef);
    }
  }
}
```

---

- [ ] **Step 4.4 — Adicionar wiring em `run()` após o bloco `checkCoordinationTimeouts` (linha 1101)**

Localizar em `src/rituals/dispatcher.js` as linhas 1096–1108:
```js
  // Sprint 16 — Alertas de timeout para coordination_requests sem resposta
  try {
    await checkCoordinationTimeouts(new Date());
  } catch (err) {
    console.error('[Dispatcher] checkCoordinationTimeouts erro:', err.message);
  }

  // Sprint 13 F1 — comunicados internos (broadcast queue)
  try {
    await dispatchAnnouncements(new Date());
```

Inserir entre `checkCoordinationTimeouts` e `dispatchAnnouncements`:

```js
  // Sprint 18 — Higiene de execução (stale tasks + unclosed events)
  try {
    await detectStaleTasks(new Date());
  } catch (err) {
    console.error('[Dispatcher] detectStaleTasks erro:', err.message);
  }

  try {
    await detectUnclosedPastEvents(new Date());
  } catch (err) {
    console.error('[Dispatcher] detectUnclosedPastEvents erro:', err.message);
  }

```

---

- [ ] **Step 4.5 — Verificar sintaxe do dispatcher**

```bash
node -c D:/la-organizer/_remote/src/rituals/dispatcher.js
```
Esperado: sem output.

---

- [ ] **Step 4.6 — Smoke test F4: verificar query stale tasks via SQL (Supabase MCP)**

```sql
-- Verificar tasks abertas sem update há mais de 14 dias (simula detectStaleTasks)
SELECT id, title, assigned_to, status, updated_at
FROM tasks
WHERE status NOT IN ('done', 'cancelled')
  AND updated_at < NOW() - INTERVAL '14 days'
ORDER BY updated_at ASC
LIMIT 5;
```
Esperado: retorna rows (ou vazio se não houver tasks stale). Query deve rodar sem erro.

---

- [ ] **Step 4.7 — Smoke test F4: verificar query unclosed events via SQL (Supabase MCP)**

```sql
-- Verificar eventos passados sem fechamento (simula detectUnclosedPastEvents)
SELECT id, title, collaborator_id, end_at, status
FROM events
WHERE status NOT IN ('done', 'cancelled')
  AND end_at < NOW() - INTERVAL '24 hours'
ORDER BY end_at DESC
LIMIT 3;
```
Esperado: retorna rows (ou vazio). Query deve rodar sem erro.

---

- [ ] **Step 4.8 — Smoke test F4: verificar idempotência via ritual_logs**

```sql
-- Após um disparo real (pós-deploy), confirmar que ritual_log foi criado
SELECT collaborator_id, ritual_type, status, detail, reference_date, created_at
FROM ritual_logs
WHERE ritual_type IN ('hygiene_stale_tasks', 'hygiene_unclosed_events')
ORDER BY created_at DESC
LIMIT 10;
```
Pré-deploy: esperado 0 rows. Pós-deploy: esperado rows com `status = 'sent'` ou `'skipped'` após a segunda às 09:00 / qualquer dia às 09:30.

---

## Task 5 — Fatia 5: Single deploy + validação E2E

**Files:**
- Todos os arquivos das Fatias 1–4 (engine.js, dispatcher.js, system.js, skills/integridade-agenda.md)
- Deploy via clone temp → copy → commit → push → VPS pull + restart

### Objetivo
Bundle commit de F1–F4 em produção. Validar 8 cenários PRD §4. Registrar 2 atenções pós-deploy.

---

- [ ] **Step 5.1 — Verificar sintaxe final de todos os arquivos modificados**

```bash
node -c D:/la-organizer/_remote/src/engine.js && echo "engine OK"
node -c D:/la-organizer/_remote/src/rituals/dispatcher.js && echo "dispatcher OK"
node -c D:/la-organizer/_remote/src/prompts/system.js && echo "system OK"
```
Esperado: 3 linhas `... OK`.

---

- [ ] **Step 5.2 — Clone temp do main**

```bash
cd D:/la-organizer && git clone git@github.com:<org>/LA-Organizer.git _temp_sprint18
```
Substituir `<org>` pelo org real. Se o remote URL já é conhecido do repositório em `_remote`, verificar com `git -C D:/la-organizer/_remote remote -v`.

---

- [ ] **Step 5.3 — Copiar arquivos modificados para o clone temp**

```bash
cp D:/la-organizer/_remote/src/engine.js D:/la-organizer/_temp_sprint18/src/engine.js
cp D:/la-organizer/_remote/src/rituals/dispatcher.js D:/la-organizer/_temp_sprint18/src/rituals/dispatcher.js
cp D:/la-organizer/_remote/src/prompts/system.js D:/la-organizer/_temp_sprint18/src/prompts/system.js
cp D:/la-organizer/_remote/skills/integridade-agenda.md D:/la-organizer/_temp_sprint18/skills/integridade-agenda.md
```

---

- [ ] **Step 5.4 — Verificar sintaxe nos arquivos do clone temp**

```bash
node -c D:/la-organizer/_temp_sprint18/src/engine.js && echo "clone engine OK"
node -c D:/la-organizer/_temp_sprint18/src/rituals/dispatcher.js && echo "clone dispatcher OK"
node -c D:/la-organizer/_temp_sprint18/src/prompts/system.js && echo "clone system OK"
```
Esperado: 3 linhas `... OK`.

---

- [ ] **Step 5.5 — Commit e push para origin main**

```bash
cd D:/la-organizer/_temp_sprint18
git add src/engine.js src/rituals/dispatcher.js src/prompts/system.js skills/integridade-agenda.md
git commit -m "feat(sprint18): integridade de agenda — detectores de conflito/dup + hygiene blocks

- jaroWinkler + normalizeForSim helpers puros
- detectTemporalConflict (HARD/SOFT), detectDuplicateSemanticEvent, detectDuplicateSemanticTask
- pre-check hooks em applyEventActions e applyTaskActions create
- processMessage bloco 2.65 + TASK_UPDATE consomem integrityPayload
- skill integridade-agenda.md (3 modos, tabela severidade, 8 exemplos PRD §4)
- system.js: opts.integrityHygiene wiring + skill auxiliar loader
- dispatcher: detectStaleTasks (seg 09:00 BRT) + detectUnclosedPastEvents (09:30 BRT)
- A1: DUP nunca bloqueia auto; A2: SOFT pede microconfirm; A3: dia carregado = complemento
- Zero schema novo, zero migrations, fail-open"
git push origin main
```

---

- [ ] **Step 5.6 — Deploy no VPS**

```bash
ssh tom "cd /opt/LA-Organizer && git pull && pm2 restart tom"
```
Esperado: `[PM2] Restarting...` sem erros. Verificar logs com `ssh tom "pm2 logs tom --lines 20"`.

---

- [ ] **Step 5.7 — Cleanup clone temp**

```bash
rm -rf D:/la-organizer/_temp_sprint18
```

---

- [ ] **Step 5.8 — Validação E2E Cenário E1 — HARD temporal**

Pré-condição: ter evento presencial das 09:00–10:30 no Recreio em produção.
Ação: enviar via WhatsApp para o collab de teste: `"marca reunião amanhã 10h no Recreio"`

Esperado:
- TOM responde com alerta de conflito (cita o evento existente, diz que não salvou)
- Nenhuma nova linha na tabela `events`
- Log `[IntegrityCheck] HARD temporal conflict` visível em `pm2 logs`
- `marker_logs` tem `EVENT_CREATE rejected integrity_temporal_hard`

Após responder `"sim, cria mesmo assim"`:
- TOM emite `<<EVENT_CREATE>>`
- Nova linha em `events` é criada
- Log `[Event] create ...` visível

---

- [ ] **Step 5.9 — Validação E2E Cenário E2 — SOFT temporal (online)**

Pré-condição: ter evento online das 09:00–10:00.
Ação: `"cria reunião online às 09:30"`

Esperado:
- TOM informa sobreposição com nome e duração
- Aguarda confirmação antes de criar
- Log `[IntegrityCheck] SOFT temporal conflict` visível
- Após "manda": evento criado

---

- [ ] **Step 5.10 — Validação E2E Cenário E3 — DUP de evento**

Pré-condição: ter evento "Apresentação Sistema Gestão Levi" amanhã.
Ação: `"marca apresentação com Levi amanhã"`

Esperado:
- TOM pergunta sobre duplicidade, cita o evento existente com data
- Log `[IntegrityCheck] DUP_EVENT score=0.8x` visível
- Após "é diferente, cria": evento criado

---

- [ ] **Step 5.11 — Validação E2E Cenário E4 — DUP de tarefa**

Pré-condição: ter task aberta "Renan — NF pendente".
Ação: `"abre tarefa falar com Renan sobre a NF"`

Esperado:
- TOM mostra a task existente (com status e prazo)
- Após "abre nova": task criada

---

- [ ] **Step 5.12 — Validação E2E Cenário E5 — Stale tasks digest**

Pré-condição: collab com 3+ tasks sem `updated_at` há 15+ dias.
Aguardar: próxima segunda-feira às 09:00 BRT.

Esperado:
- WhatsApp com lista de até 5 tasks
- `ritual_logs` tem linha `hygiene_stale_tasks, sent, count=N`
- Segunda chamada no mesmo dia: `ritual_logs` tem `skipped, ja_enviado_hoje`

---

- [ ] **Step 5.13 — Validação E2E Cenário E6 — Unclosed past events**

Pré-condição: collab com evento `end_at` há 36h, `status = 'scheduled'`.
Aguardar: 09:30 BRT do dia seguinte.

Esperado:
- WhatsApp com lista de até 3 eventos
- `ritual_logs` tem linha `hygiene_unclosed_events, sent`

---

- [ ] **Step 5.14 — Validação E2E Cenário E8 — Non-regression Sprint 17**

Ação: criar evento sem conflito enquanto ACC está ativo (coordination_request aberto).

Esperado:
- Evento criado normalmente
- ACC e integridade coexistem sem interferência
- Nenhum log `[IntegrityCheck]` para este cenário

---

- [ ] **Step 5.15 — Atenções pós-deploy registradas**

**A1 — DUP não bloqueia silenciosamente:** verificar nos logs de produção que não existe nenhum `[Event] create` seguido de `DUP_EVENT` no mesmo tick sem intervenção do usuário. Todo `DUP_EVENT` deve ser seguido de `EVENT_CREATE rejected integrity_dup_event` nos `marker_logs`.

```sql
-- Verificar marker_logs de integridade na última semana
SELECT collaborator_id, marker_type, result, reason, created_at
FROM marker_logs
WHERE reason LIKE 'integrity_%'
ORDER BY created_at DESC
LIMIT 20;
```

**A2 — Threshold conservador:** monitorar por 2 semanas o volume de `integrity_soft_confirm_pending` em `marker_logs`. Se volume > 50% de todos os `EVENT_CREATE rejected`, o threshold de 0.7 pode estar conservador demais para eventos recorrentes. Ação corretiva Sprint 19: adicionar detecção de recorrência (título idêntico em semanas consecutivas → não alerta duplicidade).

---

## ⚠️ Atenções obrigatórias durante validação E2E (Alf 2026-05-03)

3 pontos exigem **olhar humano direto** durante a Fatia 5 e nos primeiros dias pós-deploy:

### B1 — Tom dos textos de duplicidade
Mensagens de DUP devem soar como **suspeita / apoio à decisão**, NÃO como bloqueio disfarçado. Ex.: ✅ "Achei algo parecido — '...' criado ontem. É a mesma coisa, ou são duas separadas?" vs. ❌ "Não vou criar porque já existe..."
Validação: revisar TODOS os exemplos da skill `integridade-agenda.md` na Task 3, e em F5 observar cada alerta de DUP que TOM emitir.

### B2 — Regressão em criação de task/evento
Pre-check hooks tocam o caminho crítico de criação. Em F5, criar 1 task SEM duplicidade + 1 evento SEM conflito → confirmar que o fluxo continua exatamente como antes (status 'pending', WhatsApp enviado, log padrão).

### B3 — Peso da skill auxiliar global no prompt
`integridade-agenda.md` entra como auxiliar sempre carregada. Após F3, medir tamanho do system prompt (`[Prompt] size: X chars` log) vs. baseline. Se acréscimo > 1500 chars, considerar enxugar a skill.

Estes pontos não bloqueiam fatias 1-4. Aplicam-se durante F5 + retrospectiva 1 semana pós-deploy.

---

## Self-Review

### Spec coverage

| Seção do spec | Task correspondente |
|---|---|
| §2.2.1 `detectTemporalConflict` | Task 1 Steps 1.3, Task 2 Step 2.2 |
| §2.2.2 school_events / day overloaded (A3) | A3: complemento inline na skill (Task 3 Step 3.1). `detectOverloadedDay` omitida conforme A3 — apenas string complementar na skill |
| §2.3.1 `jaroWinkler` + `normalizeForSim` | Task 1 Steps 1.2, 1.7 |
| §2.3.2 `detectDuplicateSemanticEvent` | Task 1 Step 1.4 |
| §2.3.3 `detectDuplicateSemanticTask` | Task 1 Step 1.5 |
| §2.4.1 `detectStaleTasks` dispatcher | Task 4 Steps 4.2, 4.4 |
| §2.4.2 `detectUnclosedPastEvents` dispatcher | Task 4 Steps 4.3, 4.4 |
| §2.4.3 briefing integration `[INTEGRITY_HYGIENE_CONTEXT]` | Task 3 Steps 3.3–3.5, skill Modo 3 |
| §2.5 skill `integridade-agenda.md` | Task 3 Steps 3.1–3.8 |
| §2.6 pre-check hooks engine | Task 2 |
| §2.6.1 retorno `integrityPayload` | Task 2 Steps 2.5, 2.6 |
| §2.7 dispatcher blocos + `run()` wiring | Task 4 Step 4.4 |
| §3 fail-open | Todos os detectores têm `try/catch` outer com log `(non-fatal)` |
| §4 E1–E8 cenários PRD | Task 5 Steps 5.8–5.14 |
| §5 decisões fechadas | A1 Steps 2.2/2.3; A2 Steps 2.2/2.5/2.6; A3 skill Modo 1; 5.1 limits em Tasks 4; 5.2 threshold 0.7; 5.3 14d stale; 5.4 HARD condição; 5.5 sem integrity_alert_log; 5.6 hygiene só com findings |

**Gap nota:** `detectSchoolEventConflict` (§2.2.2) está na spec mas A3 diz "dia carregado = complemento leve". Esta implementação omite a função dedicada `detectSchoolEventConflict` e `detectOverloadedDay` — o efeito é capturado como nota de texto na skill (Modo 1, Caso E7). Isso está alinhado com A3. Se precisar de detecção real de school_events, adicionar em Sprint 19.

### Placeholder scan

Nenhum "TBD", "TODO", "fill in details" ou "similar to Task N" no plano. Todos os blocos de código são completos.

### Type consistency

- `integrityPayload` retornado por `applyEventActions` e `applyTaskActions` → consumido em `processMessage` bloco 2.65 e TASK_UPDATE com `const { okCount, failCount, integrityPayload }` — consistente.
- `detectTemporalConflict` retorna `{ hardConflicts, softConflicts }` — usado em Step 2.2 como `temporalResult.hardConflicts` e `temporalResult.softConflicts` — consistente.
- `detectDuplicateSemanticEvent` e `detectDuplicateSemanticTask` retornam `{ probable, possible }` — usados em Steps 2.2 e 2.3 como `dupResult.probable` e `_taskDupResult.probable` — consistente.
- `nowSaoPaulo()` retorna `{ hour, minute, dow, ymd }` — usado em `detectStaleTasks` como `sp.dow`, `currentSlot(sp)`, `sp.ymd` — consistente com linha 97 do dispatcher.
- `timeToSlot('09:00')` e `currentSlot(sp)` — funções existentes em dispatcher.js linhas 117 e 125 — uso consistente.
- Assinatura `logRitualEvent(collaboratorId, type, status, detail, refDate)` — linha 61 do dispatcher — usada consistentemente em todos os blocos novos.
