# Precisão da Auditoria do TOM — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O relatório de auditoria das 07h para de re-levantar findings de bugs já corrigidos, sem esconder regressões reais.

**Architecture:** Duas redes não-destrutivas. (1) Janela de atividade (`last_seen ≤ 7d`, determinística) tira a pilha inativa do relatório. (2) Casamento semântico por LLM, só sobre os findings da janela, marca os já-cobertos por um fix posterior e destaca regressões. A política temporal (`incident_at`/`last_seen` vs `corrigido_em`) é determinística e separada do LLM. Veredito gravado em `auto_triage` (jsonb); `status` humano nunca é tocado por máquina.

**Tech Stack:** Node.js (CommonJS, `node >= 20`), `node:test` + `node:assert`, Supabase (`@supabase/supabase-js`), provider de IA injetado (`chat`).

**Spec:** `docs/superpowers/specs/2026-06-19-precisao-auditoria-tom-design.md`

---

## Convenções deste projeto (LEIA antes de executar)

- **NÃO commitar entre tasks.** Por [CLAUDE.md](../../../CLAUDE.md), trabalho fica local em `_remote/`; o Stop hook (`scripts/auto-deploy.ps1`) versiona tudo no fim do turno. Por isso **cada task fecha em VALIDAÇÃO** (testes verdes + `node --check`), **não** em `git commit`.
- **HOLD de deploy ativo** (`D:\la-organizer\.deploy-hold`). Enquanto existir, o backend (`src/`, `skills/`, `migrations/`) **não sobe pra VPS**. Execução de código fica **retida até OK explícito do Alf**. Este plano pode ser escrito/revisado; **não execute** sem liberação.
- **Não tocar o Balde A (recorrência)** — sob observação. Nenhuma task aqui toca recorrência; confirme antes de editar.
- **Protocolo de bugs:** ao concluir, registrar em `tom_known_issues` (código sugerido `AUDIT-PRECISION-WINDOW-MATCH`).
- Rodar 1 teste: `node --test src/services/finding-triage.test.js`. Rodar todos os tocados: `node --test src/services/finding-triage.test.js src/services/conversation-audit.test.js src/rituals/health-check.test.js`.
- Sintaxe: `node --check src/<arquivo>.js`.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `migrations/20260619_audit_precision.sql` | DDL: `incident_at`, `incident_confidence`, `auto_triage` | Criar |
| `src/services/finding-triage.js` | Constantes + `decideTriage` (pura) + `parseMatches` + `triageOpenFindings` | Criar |
| `src/services/finding-triage.test.js` | Testes do módulo acima | Criar |
| `src/prompts/finding-triage-prompt.js` | `SYSTEM` + `buildMatchMessages` (prompt do casamento) | Criar |
| `src/prompts/finding-triage-prompt.test.js` | Trava as regras-chave do prompt | Criar |
| `src/services/conversation-audit.js` | `resolveIncidentAt` + gravar `incident_at` no upsert | Modificar |
| `src/services/conversation-audit.test.js` | Estender p/ `resolveIncidentAt` e upsert com `incident_at` | Modificar |
| `src/rituals/health-check.js` | `formatConvQuality` (pura) + janela/`auto_triage` em `checkConversationQuality` + rodar triagem | Modificar |
| `src/rituals/health-check.test.js` | Testes de `formatConvQuality` | Criar |
| `scripts/backfill-incident-at.js` | Backfill de `incident_at` nos findings existentes | Criar |

**Contratos (consistência entre tasks):**
- `finding-triage.js` exporta: `WINDOW_DAYS=7`, `KI_LOOKBACK_DAYS=45`, `MATCH_MIN_CONFIDENCE=0.7`, `MARGIN_MS=12*3600*1000`, `decideTriage`, `parseMatches`, `triageOpenFindings`.
- `decideTriage(finding, match, opts) → { decision: 'keep'|'suppress'|'regression', matched_code, reason }`.
- `resolveIncidentAt(sb, collaboratorId, evidence, occurredAt, sinceIso) → { incident_at, incident_confidence: 'high'|'low'|'none' }`.
- `auto_triage` jsonb gravado = `{ ...decideTriage, match_confidence, decided_at }`.

---

## Task 1: Migração de esquema

**Files:**
- Create: `migrations/20260619_audit_precision.sql`

- [ ] **Step 1: Escrever a migração**

```sql
-- 20260619_audit_precision.sql
-- Precisão da auditoria: tempo real do incidente + veredito de auto-triagem.
ALTER TABLE public.tom_audit_findings
  ADD COLUMN IF NOT EXISTS incident_at         timestamptz,
  ADD COLUMN IF NOT EXISTS incident_confidence text,   -- 'high' | 'low' | 'none'
  ADD COLUMN IF NOT EXISTS auto_triage         jsonb;  -- {decision, matched_code, match_confidence, reason, decided_at}

COMMENT ON COLUMN public.tom_audit_findings.incident_at IS
  'Tempo real do incidente (evidence-anchored). NULL quando desconhecido.';
COMMENT ON COLUMN public.tom_audit_findings.auto_triage IS
  'Veredito da auto-triagem (finding-triage.js). NUNCA substitui status humano.';
```

- [ ] **Step 2: (Quando liberado) aplicar a migração**

Via MCP Supabase `apply_migration` no projeto `cesnbnrynvxvgdhfmaua` com o SQL acima. **Não aplicar enquanto o HOLD estiver ativo** sem OK do Alf.

- [ ] **Step 3: Verificar colunas**

Via `execute_sql`:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name='tom_audit_findings' AND column_name IN ('incident_at','incident_confidence','auto_triage');
```
Expected: 3 linhas (`timestamp with time zone`, `text`, `jsonb`).

---

## Task 2: `decideTriage` — política temporal pura

**Files:**
- Create: `src/services/finding-triage.js`
- Create: `src/services/finding-triage.test.js`

- [ ] **Step 1: Escrever os testes que falham**

```js
// src/services/finding-triage.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { decideTriage, MARGIN_MS } = require('./finding-triage');

const fix = '2026-06-10T12:00:00Z';
const hi = (incident_at, last_seen) => ({ incident_at, last_seen, incident_confidence: 'high' });
const m = (over = {}) => ({ codigo: 'BUG-1', status: 'corrigido', corrigido_em: fix, confidence: 0.9, ...over });

test('decideTriage: sem match → keep', () => {
  assert.strictEqual(decideTriage(hi('2026-06-01T00:00:00Z', null), null).decision, 'keep');
});
test('decideTriage: confiança do match abaixo do mínimo → keep', () => {
  assert.strictEqual(decideTriage(hi('2026-06-01T00:00:00Z', null), m({ confidence: 0.5 })).decision, 'keep');
});
test('decideTriage: known-issue não corrigido → keep', () => {
  assert.strictEqual(decideTriage(hi('2026-06-01T00:00:00Z', null), m({ status: 'aberto' })).decision, 'keep');
});
test('decideTriage: last_seen depois do fix → regression (vence supressão)', () => {
  const f = hi('2026-06-01T00:00:00Z', '2026-06-15T00:00:00Z'); // incidente pré-fix, mas reincidiu
  assert.strictEqual(decideTriage(f, m()).decision, 'regression');
});
test('decideTriage: incident_at confiável depois do fix → regression', () => {
  assert.strictEqual(decideTriage(hi('2026-06-12T00:00:00Z', null), m()).decision, 'regression');
});
test('decideTriage: incident_at confiável e claramente pré-fix → suppress', () => {
  assert.strictEqual(decideTriage(hi('2026-06-05T00:00:00Z', '2026-06-05T00:00:00Z'), m()).decision, 'suppress');
});
test('decideTriage: incident_confidence baixo → keep (na dúvida mostra)', () => {
  const f = { incident_at: '2026-06-05T00:00:00Z', last_seen: '2026-06-05T00:00:00Z', incident_confidence: 'low' };
  assert.strictEqual(decideTriage(f, m()).decision, 'keep');
});
test('decideTriage: incidente na margem antes do fix → keep (borda)', () => {
  const justBefore = new Date(Date.parse(fix) - MARGIN_MS / 2).toISOString();
  const f = hi(justBefore, justBefore);
  assert.strictEqual(decideTriage(f, m()).decision, 'keep');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/services/finding-triage.test.js`
Expected: FAIL — `Cannot find module './finding-triage'`.

- [ ] **Step 3: Implementar `finding-triage.js` (só constantes + `decideTriage`)**

```js
// src/services/finding-triage.js
// Auto-triagem dos findings da auditoria de conversa: casa com known-issues
// corrigidos e decide manter/suprimir/regressão. NÃO toca o status humano.
'use strict';

const WINDOW_DAYS = 7;            // janela de atividade do relatório (last_seen)
const KI_LOOKBACK_DAYS = 45;      // recorte de known-issues corrigidos candidatos
const MATCH_MIN_CONFIDENCE = 0.7; // abaixo disso, trata como "não casou"
const MARGIN_MS = 12 * 3600 * 1000; // borda de segurança na comparação temporal

/** Decide o destino de um finding casado com um known-issue. Pura: sem DB/LLM.
 * Ordem importa: regressão é avaliada ANTES de supressão (last_seen pós-fix vence). */
function decideTriage(finding, match, opts = {}) {
  const minConf = opts.minConfidence != null ? opts.minConfidence : MATCH_MIN_CONFIDENCE;
  const marginMs = opts.marginMs != null ? opts.marginMs : MARGIN_MS;

  if (!match || !match.codigo || (match.confidence || 0) < minConf) {
    return { decision: 'keep', matched_code: null, reason: 'sem casamento confiável' };
  }
  if (match.status !== 'corrigido' || !match.corrigido_em) {
    return { decision: 'keep', matched_code: match.codigo, reason: 'known-issue não está corrigido' };
  }
  const tFix = Date.parse(match.corrigido_em);
  const tLast = finding.last_seen ? Date.parse(finding.last_seen) : null;
  if (tLast != null && tLast > tFix) {
    return { decision: 'regression', matched_code: match.codigo, reason: 'reincidiu após corrigido_em (last_seen)' };
  }
  const hiconf = finding.incident_confidence === 'high';
  const tInc = finding.incident_at ? Date.parse(finding.incident_at) : null;
  if (hiconf && tInc != null && tInc > tFix) {
    return { decision: 'regression', matched_code: match.codigo, reason: 'incident_at posterior ao corrigido_em' };
  }
  if (hiconf && tInc != null && tInc < tFix - marginMs) {
    return { decision: 'suppress', matched_code: match.codigo, reason: 'já corrigido: incident_at anterior ao corrigido_em' };
  }
  return { decision: 'keep', matched_code: match.codigo, reason: 'tempo do incidente incerto/borda — mostra por segurança' };
}

module.exports = {
  WINDOW_DAYS, KI_LOOKBACK_DAYS, MATCH_MIN_CONFIDENCE, MARGIN_MS,
  decideTriage,
};
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test src/services/finding-triage.test.js`
Expected: PASS (8 testes).

- [ ] **Step 5: Validar sintaxe**

Run: `node --check src/services/finding-triage.js`
Expected: sem saída (ok). (Sem commit — ver Convenções.)

---

## Task 3: `resolveIncidentAt` — tempo real evidence-anchored

**Files:**
- Modify: `src/services/conversation-audit.js`
- Modify: `src/services/conversation-audit.test.js`

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao fim de `conversation-audit.test.js`:

```js
// ── resolveIncidentAt (evidence-anchored) ───────────────────────────
const { resolveIncidentAt } = require('./conversation-audit');

// fakeSb p/ conversation_history: select→eq→gte→order→limit resolve {data}.
function fakeConvSb(rows) {
  const b = {
    from() { return this; }, select() { return this; }, eq() { return this; },
    gte() { return this; }, order() { return this; }, limit() { return Promise.resolve({ data: rows, error: null }); },
  };
  return b;
}

test('resolveIncidentAt: evidence casa com mensagem → high + created_at da msg', async () => {
  const sb = fakeConvSb([
    { created_at: '2026-06-09T10:00:00Z', content: 'oi tom', media_extracted_text: null },
    { created_at: '2026-06-09T14:30:00Z', content: 'TOM não consigo salvar o gasto agora', media_extracted_text: null },
  ]);
  const out = await resolveIncidentAt(sb, 'c1', 'TOM: não consigo salvar o gasto agora', null, '2026-06-08T00:00:00Z');
  assert.strictEqual(out.incident_confidence, 'high');
  assert.strictEqual(out.incident_at, '2026-06-09T14:30:00Z');
});
test('resolveIncidentAt: sem casar mas com occurredAt → low', async () => {
  const sb = fakeConvSb([{ created_at: '2026-06-09T10:00:00Z', content: 'nada a ver', media_extracted_text: null }]);
  const out = await resolveIncidentAt(sb, 'c1', 'evidência inexistente xyz', '2026-06-09T23:59:00Z', '2026-06-08T00:00:00Z');
  assert.strictEqual(out.incident_confidence, 'low');
  assert.strictEqual(out.incident_at, '2026-06-09T23:59:00Z');
});
test('resolveIncidentAt: sem casar e sem occurredAt → none', async () => {
  const sb = fakeConvSb([]);
  const out = await resolveIncidentAt(sb, 'c1', 'qualquer', null, '2026-06-08T00:00:00Z');
  assert.strictEqual(out.incident_confidence, 'none');
  assert.strictEqual(out.incident_at, null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/services/conversation-audit.test.js`
Expected: FAIL — `resolveIncidentAt is not a function`.

- [ ] **Step 3: Implementar `resolveIncidentAt` e exportar**

Em `src/services/conversation-audit.js`, adicionar antes de `upsertFinding`:

```js
/** Pega o trecho mais distintivo do evidence p/ ancorar na conversa.
 * Remove rótulos USUÁRIO:/TOM:, escolhe a linha mais longa, colapsa espaço, 100 chars. */
function pickProbe(evidence) {
  const lines = String(evidence == null ? '' : evidence)
    .split(/\n+/)
    .map(l => l.replace(/^\s*(USU[ÁA]RIO|TOM)\s*:\s*/i, '').replace(/\s+/g, ' ').trim())
    .filter(l => l.length >= 12);
  if (!lines.length) return '';
  return lines.sort((a, b) => b.length - a.length)[0].slice(0, 100).toLowerCase();
}

/** Tempo real do incidente: acha a mensagem da conversa que contém o trecho do
 * evidence e usa o created_at dela. Fallback: occurredAt (proxy de janela). */
async function resolveIncidentAt(sb, collaboratorId, evidence, occurredAt, sinceIso) {
  const probe = pickProbe(evidence);
  if (probe) {
    const { data } = await sb.from('conversation_history')
      .select('created_at, content, media_extracted_text')
      .eq('collaborator_id', collaboratorId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(60);
    const hit = (data || []).find(msMatches);
    function msMatches(m) {
      const hay = `${m.content || ''} ${m.media_extracted_text || ''}`.toLowerCase();
      return hay.includes(probe);
    }
    if (hit) return { incident_at: hit.created_at, incident_confidence: 'high' };
  }
  if (occurredAt) return { incident_at: occurredAt, incident_confidence: 'low' };
  return { incident_at: null, incident_confidence: 'none' };
}
```

E no `module.exports`, acrescentar `resolveIncidentAt` (e `pickProbe` opcional p/ teste):

```js
module.exports = {
  normalizeSummary, signatureFor, parseFindings, rankFindings,
  loadConversation, auditConversation, upsertFinding, resolveIncidentAt,
  CLOSED_STATUSES, SEV_RANK,
};
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test src/services/conversation-audit.test.js`
Expected: PASS (todos os antigos + 3 novos).

- [ ] **Step 5: Validar sintaxe**

Run: `node --check src/services/conversation-audit.js`
Expected: ok.

---

## Task 4: Gravar `incident_at` — `loadConversation` → `auditConversation` → `upsertFinding`

**Files:**
- Modify: `src/services/conversation-audit.js:64-98` (loadConversation/auditConversation) e `:165-174` (insert)
- Modify: `src/services/conversation-audit.test.js`

- [ ] **Step 1: Escrever o teste que falha (upsert grava incident_at)**

Adicionar ao `conversation-audit.test.js`:

```js
test('upsertFinding: inserção grava incident_at e incident_confidence', async () => {
  const calls = { inserts: [], updates: [] };
  const sb = fakeSb([], calls); // sem finding prévio → insere
  await upsertFinding(sb, { id: 'c1' }, {
    category: 'confabulation', severity: 'alto', summary: 's3', evidence: 'e',
    occurred_at: '2026-06-09T23:00:00Z', incident_at: '2026-06-09T14:30:00Z', incident_confidence: 'high',
  });
  assert.strictEqual(calls.inserts.length, 1);
  assert.strictEqual(calls.inserts[0].incident_at, '2026-06-09T14:30:00Z');
  assert.strictEqual(calls.inserts[0].incident_confidence, 'high');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/services/conversation-audit.test.js`
Expected: FAIL — `calls.inserts[0].incident_at` é `undefined`.

- [ ] **Step 3: `loadConversation` passa a devolver `sinceIso`**

Em `loadConversation` ([:64-82](../../../src/services/conversation-audit.js)), trocar o `return`:

```js
  return { text, lastAt, sinceIso };
```
(`sinceIso` já existe como variável local no início da função.)

- [ ] **Step 4: `auditConversation` resolve o incident_at de cada finding**

Em `auditConversation` ([:86-98](../../../src/services/conversation-audit.js)), substituir o corpo do `try`:

```js
  try {
    const { text: convo, lastAt, sinceIso } = await loadConversation(sb, collaborator.id, hours);
    if (convo.length < 80) return [];
    const { buildAuditMessages } = require('../prompts/conversation-audit-prompt');
    const { system, messages } = buildAuditMessages(convo);
    const r = await chat(system, messages, 1200);
    const findings = parseFindings(r && r.text, lastAt);
    for (const f of findings) {
      const inc = await resolveIncidentAt(sb, collaborator.id, f.evidence, f.occurred_at, sinceIso);
      f.incident_at = inc.incident_at;
      f.incident_confidence = inc.incident_confidence;
    }
    return findings;
  } catch (err) {
    console.error(`[ConvAudit] erro p/ ${collaborator.full_name}:`, err.message);
    return [];
  }
```

- [ ] **Step 5: `upsertFinding` grava os 2 campos no insert**

Em `upsertFinding` ([:165-174](../../../src/services/conversation-audit.js)), no objeto do `.insert(...)`, acrescentar:

```js
    await sb.from('tom_audit_findings').insert({
      collaborator_id: collaborator.id,
      category: finding.category,
      severity: finding.severity,
      summary: finding.summary,
      evidence: finding.evidence,
      occurred_at: finding.occurred_at,
      incident_at: finding.incident_at || null,
      incident_confidence: finding.incident_confidence || 'none',
      signature: sig,
      status: 'novo',
    });
```

- [ ] **Step 6: Rodar e ver passar**

Run: `node --test src/services/conversation-audit.test.js`
Expected: PASS (todos).

- [ ] **Step 7: Validar sintaxe**

Run: `node --check src/services/conversation-audit.js`
Expected: ok.

---

## Task 5: Prompt do casamento semântico

**Files:**
- Create: `src/prompts/finding-triage-prompt.js`
- Create: `src/prompts/finding-triage-prompt.test.js`

- [ ] **Step 1: Escrever os testes que falham**

```js
// src/prompts/finding-triage-prompt.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { SYSTEM, buildMatchMessages } = require('./finding-triage-prompt');

test('SYSTEM: exige JSON, proíbe inventar código e foca em causa-raiz', () => {
  assert.match(SYSTEM, /JSON/);
  assert.match(SYSTEM, /matched_code/);
  assert.match(SYSTEM, /causa-raiz|mesmo problema/i);
});
test('buildMatchMessages: injeta findings (id) e known-issues (codigo)', () => {
  const { system, messages } = buildMatchMessages(
    [{ id: 'f1', category: 'confabulation', summary: 'negou salvar', evidence: 'TOM: não salvei' }],
    [{ codigo: 'BUG-1', titulo: 'salvar falhava', area: 'marker', causa_raiz: 'x', fix_resumo: 'y', corrigido_em: '2026-06-10T00:00:00Z' }],
  );
  assert.ok(system.length > 0);
  const userText = messages.map(m => m.content).join('\n');
  assert.match(userText, /f1/);
  assert.match(userText, /BUG-1/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/prompts/finding-triage-prompt.test.js`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar o prompt**

```js
// src/prompts/finding-triage-prompt.js
// Casamento semântico: cada FALHA de conversa ↔ algum BUG CONHECIDO já corrigido.
// O LLM SÓ casa (julgamento). A decisão de ocultar/mostrar é determinística (finding-triage.js).
'use strict';

const SYSTEM = [
  'Você é um classificador técnico. Recebe (A) FALHAS detectadas em conversas do assistente TOM',
  'e (B) BUGS CONHECIDOS já corrigidos. Para cada falha, decida se ela descreve o MESMO problema',
  'técnico (mesma causa-raiz/sintoma) de algum bug conhecido — não basta ser a mesma pessoa ou a',
  'mesma data. Responda SOMENTE JSON, sem texto fora do bloco. NÃO invente código fora da lista B.',
  'Para cada falha: matched_code = código do bug casado ou null; confidence = 0..1 (quão certo).',
  'Formato exato:',
  '{"matches":[{"finding_id":"<id>","matched_code":"<codigo|null>","confidence":0.0,"reason":"<curto>"}]}',
].join('\n');

/** Monta as mensagens do casamento. Retorna {system, messages}. */
function buildMatchMessages(findings, knownIssues) {
  const fLines = (findings || []).map(f =>
    `- id=${f.id} [${f.category}] ${String(f.summary || '').slice(0, 200)} | evidência: ${String(f.evidence || '').slice(0, 400)}`,
  ).join('\n');
  const kLines = (knownIssues || []).map(k =>
    `- ${k.codigo} [${k.area}] ${k.titulo} | causa: ${String(k.causa_raiz || '').slice(0, 200)} | fix: ${String(k.fix_resumo || '').slice(0, 200)} | corrigido_em: ${k.corrigido_em}`,
  ).join('\n');
  const user =
    `FALHAS (A):\n${fLines || '(nenhuma)'}\n\nBUGS CONHECIDOS CORRIGIDOS (B):\n${kLines || '(nenhum)'}\n\n` +
    'Para CADA falha de A, devolva um item em "matches". Use null quando nenhuma casar.';
  return { system: SYSTEM, messages: [{ role: 'user', content: user }] };
}

module.exports = { SYSTEM, buildMatchMessages };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test src/prompts/finding-triage-prompt.test.js`
Expected: PASS.

- [ ] **Step 5: Validar sintaxe**

Run: `node --check src/prompts/finding-triage-prompt.js`
Expected: ok.

---

## Task 6: `parseMatches` — parser tolerante da saída do LLM

**Files:**
- Modify: `src/services/finding-triage.js`
- Modify: `src/services/finding-triage.test.js`

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao `finding-triage.test.js`:

```js
const { parseMatches } = require('./finding-triage');

test('parseMatches: extrai matches válidos e ignora lixo ao redor', () => {
  const raw = 'antes {"matches":[{"finding_id":"f1","matched_code":"BUG-1","confidence":0.9,"reason":"r"}]} depois';
  const out = parseMatches(raw);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].matched_code, 'BUG-1');
  assert.strictEqual(out[0].confidence, 0.9);
});
test('parseMatches: JSON quebrado → []', () => {
  assert.deepStrictEqual(parseMatches('não é json'), []);
});
test('parseMatches: normaliza matched_code "null" textual e confidence ausente', () => {
  const out = parseMatches('{"matches":[{"finding_id":"f2","matched_code":"null"}]}');
  assert.strictEqual(out[0].matched_code, null);
  assert.strictEqual(out[0].confidence, 0);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/services/finding-triage.test.js`
Expected: FAIL — `parseMatches is not a function`.

- [ ] **Step 3: Implementar `parseMatches` e exportar**

Em `finding-triage.js`, adicionar:

```js
/** Extrai o bloco {...} da saída do LLM e normaliza os matches. Nunca lança. */
function parseMatches(raw) {
  const s = String(raw == null ? '' : raw);
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return [];
  let obj;
  try { obj = JSON.parse(s.slice(start, end + 1)); } catch { return []; }
  const list = Array.isArray(obj && obj.matches) ? obj.matches : [];
  return list
    .filter(x => x && typeof x.finding_id === 'string')
    .map(x => ({
      finding_id: x.finding_id,
      matched_code: (x.matched_code && x.matched_code !== 'null') ? String(x.matched_code) : null,
      confidence: typeof x.confidence === 'number' ? x.confidence : 0,
      reason: typeof x.reason === 'string' ? x.reason.slice(0, 200) : '',
    }));
}
```

E acrescentar `parseMatches` ao `module.exports`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test src/services/finding-triage.test.js`
Expected: PASS (11 testes).

- [ ] **Step 5: Validar sintaxe**

Run: `node --check src/services/finding-triage.js`
Expected: ok.

---

## Task 7: `triageOpenFindings` — orquestração (DB + LLM + decisão)

**Files:**
- Modify: `src/services/finding-triage.js`
- Modify: `src/services/finding-triage.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao `finding-triage.test.js`:

```js
const { triageOpenFindings } = require('./finding-triage');

// fakeSb por-tabela: select de tom_audit_findings (janela) e tom_known_issues (candidatos);
// update registra o auto_triage gravado.
function fakeTriageSb(byTable, calls) {
  let tbl = null;
  const b = {
    from(t) { tbl = t; return this; },
    select() { return this; }, in() { return this; }, gte() { return this; },
    eq() { return this; }, order() { return this; },
    update(p) { calls.updates.push(p); return this; },
    limit() { return Promise.resolve({ data: byTable[tbl] || [], error: null }); },
    then(res) { res({ data: byTable[tbl] || [], error: null }); },
  };
  return b;
}

test('triageOpenFindings: suprime finding pré-fix e marca regressão por reincidência', async () => {
  const calls = { updates: [] };
  const sb = fakeTriageSb({
    tom_audit_findings: [
      { id: 'f1', category: 'confabulation', summary: 'salvar falhou', evidence: 'TOM: não salvei',
        incident_at: '2026-06-05T00:00:00Z', incident_confidence: 'high', last_seen: '2026-06-05T00:00:00Z' },
      { id: 'f2', category: 'confabulation', summary: 'salvar falhou de novo', evidence: 'TOM: não salvei',
        incident_at: '2026-06-05T00:00:00Z', incident_confidence: 'high', last_seen: '2026-06-15T00:00:00Z' },
    ],
    tom_known_issues: [
      { codigo: 'BUG-1', titulo: 'salvar falhava', area: 'marker', causa_raiz: 'x', fix_resumo: 'y',
        status: 'corrigido', corrigido_em: '2026-06-10T00:00:00Z' },
    ],
  }, calls);
  const chat = async () => ({ text: '{"matches":[' +
    '{"finding_id":"f1","matched_code":"BUG-1","confidence":0.95,"reason":"mesma causa"},' +
    '{"finding_id":"f2","matched_code":"BUG-1","confidence":0.95,"reason":"mesma causa"}]}' });

  const out = await triageOpenFindings(sb, chat, { nowIso: '2026-06-19T00:00:00Z' });
  assert.strictEqual(out.suppressed, 1);
  assert.strictEqual(out.regressions, 1);
  // gravou auto_triage nos 2
  const decisions = calls.updates.map(u => u.auto_triage && u.auto_triage.decision).filter(Boolean);
  assert.ok(decisions.includes('suppress'));
  assert.ok(decisions.includes('regression'));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/services/finding-triage.test.js`
Expected: FAIL — `triageOpenFindings is not a function`.

- [ ] **Step 3: Implementar `triageOpenFindings`**

Em `finding-triage.js`, adicionar (usa `decideTriage`, `parseMatches`, prompt):

```js
const { buildMatchMessages } = require('../prompts/finding-triage-prompt');

function isoDaysAgo(nowIso, days) {
  return new Date(Date.parse(nowIso) - days * 86400 * 1000).toISOString();
}

/** Casa os findings da janela com known-issues corrigidos e grava auto_triage.
 * sb/chat injetados. NUNCA lança (degrada para no-op). Retorna sumário. */
async function triageOpenFindings(sb, chat, opts = {}) {
  const out = { decided: 0, suppressed: 0, regressions: 0, kept: 0 };
  try {
    const nowIso = opts.nowIso || new Date().toISOString();
    const windowIso = isoDaysAgo(nowIso, opts.windowDays || WINDOW_DAYS);
    const kiSinceIso = isoDaysAgo(nowIso, opts.kiLookbackDays || KI_LOOKBACK_DAYS);

    const { data: findings } = await sb.from('tom_audit_findings')
      .select('id, category, summary, evidence, incident_at, incident_confidence, last_seen')
      .in('status', ['novo', 'confirmado'])
      .gte('last_seen', windowIso);
    const open = findings || [];
    if (!open.length) return out;

    const { data: kis } = await sb.from('tom_known_issues')
      .select('codigo, titulo, area, causa_raiz, fix_resumo, status, corrigido_em')
      .eq('status', 'corrigido')
      .gte('corrigido_em', kiSinceIso);
    const known = kis || [];
    const byCode = {};
    for (const k of known) byCode[k.codigo] = k;

    const { system, messages } = buildMatchMessages(open, known);
    let matchById = {};
    if (known.length) {
      const r = await chat(system, messages, 1500);
      for (const mm of parseMatches(r && r.text)) matchById[mm.finding_id] = mm;
    }

    for (const f of open) {
      const mm = matchById[f.id];
      const ki = mm && mm.matched_code ? byCode[mm.matched_code] : null;
      const match = ki ? { ...ki, confidence: mm.confidence } : null;
      const verdict = decideTriage(f, match, opts);
      const auto_triage = {
        decision: verdict.decision,
        matched_code: verdict.matched_code,
        match_confidence: mm ? mm.confidence : null,
        reason: verdict.reason,
        decided_at: nowIso,
      };
      await sb.from('tom_audit_findings').update({ auto_triage }).eq('id', f.id);
      out.decided++;
      if (verdict.decision === 'suppress') out.suppressed++;
      else if (verdict.decision === 'regression') out.regressions++;
      else out.kept++;
    }
  } catch (err) {
    console.error('[FindingTriage] erro:', err.message);
  }
  return out;
}
```

E acrescentar `triageOpenFindings` ao `module.exports`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test src/services/finding-triage.test.js`
Expected: PASS (12 testes).

- [ ] **Step 5: Validar sintaxe**

Run: `node --check src/services/finding-triage.js`
Expected: ok.

---

## Task 8: Relatório das 07h — janela + `auto_triage` + contagens

**Files:**
- Modify: `src/rituals/health-check.js:500-552` (`checkConversationQuality`)
- Create: `src/rituals/health-check.test.js`

- [ ] **Step 1: Escrever os testes da função pura de formatação**

```js
// src/rituals/health-check.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { formatConvQuality } = require('./health-check');

const base = (over) => ({
  category: 'confabulation', severity: 'medio', summary: 's', occurrences: 1,
  collaborator_id: 'c1', collaborators: { full_name: 'Fulano' }, auto_triage: null, ...over,
});

test('formatConvQuality: suprimidos saem do corpo e viram contagem', () => {
  const r = formatConvQuality([
    base({ id: 'a' }),
    base({ id: 'b', auto_triage: { decision: 'suppress', matched_code: 'BUG-1' } }),
  ], { inactiveCount: 0 });
  assert.match(r.detail, /1 falha/);          // só 1 no corpo
  assert.match(r.detail, /já-corrigid/i);     // contagem de suprimidos
  assert.match(r.detail, /BUG-1/);            // código auditável
});
test('formatConvQuality: regressão aparece em destaque', () => {
  const r = formatConvQuality([
    base({ id: 'a', auto_triage: { decision: 'regression', matched_code: 'BUG-9' } }),
  ], { inactiveCount: 0 });
  assert.match(r.detail, /REGRESS/i);
  assert.match(r.detail, /BUG-9/);
});
test('formatConvQuality: inativos contam mas não poluem corpo', () => {
  const r = formatConvQuality([base({ id: 'a' })], { inactiveCount: 40 });
  assert.match(r.detail, /40 inativ/i);
});
test('formatConvQuality: tudo suprimido/inativo → status ok', () => {
  const r = formatConvQuality([
    base({ id: 'b', auto_triage: { decision: 'suppress', matched_code: 'BUG-1' } }),
  ], { inactiveCount: 5 });
  assert.strictEqual(r.status, 'ok');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/rituals/health-check.test.js`
Expected: FAIL — `formatConvQuality is not a function`.

- [ ] **Step 3: Extrair `formatConvQuality` (pura) e exportá-la**

Em `health-check.js`, criar a função pura com a lógica de blocos/contagens (move o miolo de hoje de [:508-551](../../../src/rituals/health-check.js) e adiciona supressão/regressão/contagens):

```js
// Pura: recebe findings JÁ filtrados por janela + a contagem de inativos.
// Separa suprimidos (auto_triage.decision==='suppress'), destaca regressões e
// monta o corpo com os "keep". NÃO toca DB. Exportada p/ teste.
function formatConvQuality(findings, opts = {}) {
  const inactiveCount = opts.inactiveCount || 0;
  const SEV_EMOJI = { alto: '🔴', medio: '🟠', baixo: '🟡' };
  const SEV_RANK = { alto: 0, medio: 1, baixo: 2 };
  const CONV_CAT_LABEL = {
    confabulation: 'confabulação/contradição', wrong_refusal: 'recusa indevida',
    media_fail: 'mídia falha', dropped_request: 'pedido largado',
    frustration: 'frustração', proactive_overreach: 'cobrança indevida',
  };
  const dec = f => (f.auto_triage && f.auto_triage.decision) || 'keep';
  const suppressed = findings.filter(f => dec(f) === 'suppress');
  const regressions = findings.filter(f => dec(f) === 'regression');
  const body = findings.filter(f => dec(f) === 'keep');

  const counts = [];
  if (inactiveCount) counts.push(`🗃️ ${inactiveCount} inativos (>${opts.windowDays || 7}d sem reincidência)`);
  if (suppressed.length) {
    const codes = [...new Set(suppressed.map(f => f.auto_triage.matched_code).filter(Boolean))];
    counts.push(`🔇 ${suppressed.length} já-corrigidos${codes.length ? ' (' + codes.join(', ') + ')' : ''}`);
  }
  const countLine = counts.length ? `\n${counts.join(' · ')}` : '';

  if (!body.length && !regressions.length) {
    return { status: 'ok', detail: `🗣️ 0 falhas pra revisar${countLine}` };
  }

  const sevRk = f => (SEV_RANK[f.severity] != null ? SEV_RANK[f.severity] : 1);
  const regLines = regressions
    .sort((a, b) => sevRk(a) - sevRk(b))
    .map(f => `  • 🔁 REGRESSÃO [${f.auto_triage.matched_code || '?'}] ${String(f.summary).slice(0, 120)}`);

  const groups = {};
  for (const f of body) (groups[f.collaborator_id || 'unknown'] = groups[f.collaborator_id || 'unknown'] || []).push(f);
  const nameById = {};
  for (const f of body) nameById[f.collaborator_id] = f.collaborators?.full_name?.split(' ')[0] || '—';
  const worstOf = arr => Math.min(...arr.map(sevRk));
  const orderedPids = Object.keys(groups).sort((a, b) => {
    const d = worstOf(groups[a]) - worstOf(groups[b]);
    return d !== 0 ? d : groups[b].length - groups[a].length;
  });
  const blocks = orderedPids.map(pid => {
    const arr = groups[pid].slice().sort((x, y) => sevRk(x) - sevRk(y));
    const lines = arr.map(f => {
      const rec = (f.occurrences || 1) >= 2 ? `🔁${f.occurrences}× ` : '';
      const sev = SEV_EMOJI[f.severity] || '';
      return `  • ${sev} ${rec}[${CONV_CAT_LABEL[f.category] || f.category}] ${String(f.summary).slice(0, 120)}`;
    });
    return `*${nameById[pid] || '—'}* (${arr.length}):\n${lines.join('\n')}`;
  });

  const total = body.length + regressions.length;
  const head = regLines.length ? `🚨 ${regLines.length} regressão(ões):\n${regLines.join('\n')}\n\n` : '';
  return {
    status: 'warning',
    detail: `🗣️ ${total} falha(s) pra revisar:${countLine}\n${head}${blocks.join('\n\n')}`.trim(),
  };
}
```

- [ ] **Step 4: `checkConversationQuality` usa janela + `auto_triage` + `formatConvQuality`**

Substituir a query e o corpo de `checkConversationQuality` ([:500-552](../../../src/rituals/health-check.js)):

```js
async function checkConversationQuality() {
  const { WINDOW_DAYS } = require('../services/finding-triage');
  const windowIso = isoHoursAgo(WINDOW_DAYS * 24);
  // findings abertos da JANELA (atividade recente) + veredito de auto-triagem
  const { data, error } = await supabase
    .from('tom_audit_findings')
    .select('id, category, severity, summary, occurrences, collaborator_id, auto_triage, collaborators:collaborator_id(full_name)')
    .in('status', ['novo', 'confirmado'])
    .gte('last_seen', windowIso)
    .order('occurrences', { ascending: false })
    .limit(200);
  if (error) throw error;
  // contagem de inativos (abertos, fora da janela) — só número, não polui o corpo
  const { count: inactiveCount } = await supabase
    .from('tom_audit_findings')
    .select('id', { count: 'exact', head: true })
    .in('status', ['novo', 'confirmado'])
    .lt('last_seen', windowIso);
  return formatConvQuality(data || [], { inactiveCount: inactiveCount || 0, windowDays: WINDOW_DAYS });
}
```

E no `module.exports` do `health-check.js`, acrescentar `formatConvQuality`.

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test src/rituals/health-check.test.js`
Expected: PASS (4 testes).

- [ ] **Step 6: Validar sintaxe**

Run: `node --check src/rituals/health-check.js`
Expected: ok.

---

## Task 9: Rodar a triagem antes do relatório (runner do health-check)

**Files:**
- Modify: `src/rituals/health-check.js` (bloco `ALL_CHECKS`/runner, ~`:554+`)

- [ ] **Step 1: Adicionar o check de triagem ANTES do `checkConversationQuality`**

Criar um check que dispara a auto-triagem (grava `auto_triage`) para que `checkConversationQuality` leia o veredito já calculado:

```js
// CHECK — Auto-triagem dos findings de conversa (grava auto_triage; roda ANTES do 14).
async function checkFindingTriage() {
  const { triageOpenFindings } = require('../services/finding-triage');
  const { chatForAudit } = require('./_audit-chat'); // mesmo provider usado pelo Dream
  const r = await triageOpenFindings(supabase, chatForAudit);
  return { status: 'ok', detail: `🧭 triagem: ${r.suppressed} já-corrigidos · ${r.regressions} regressão(ões) · ${r.kept} mantidos` };
}
```

> **Nota de integração:** reusar o mesmo wrapper de IA que o Dream injeta em `auditConversation` (`aiChat`). Localize-o no dispatcher ([dispatcher.js:3666](../../../src/rituals/dispatcher.js)) — se não houver helper exportado, passe `aiChat` ao health-check pela mesma via que os outros checks recebem dependências, em vez de criar `_audit-chat`. **Confirme o nome real do provider antes de codar** (não inventar `_audit-chat` se já existe um export).

- [ ] **Step 2: Inserir na lista `ALL_CHECKS` imediatamente antes de `conversation_quality`**

Em `ALL_CHECKS` ([:554+](../../../src/rituals/health-check.js)):

```js
  ['finding_triage',       checkFindingTriage],
  ['conversation_quality', checkConversationQuality],
```

- [ ] **Step 3: Validar sintaxe + suíte tocada**

Run: `node --check src/rituals/health-check.js`
Run: `node --test src/services/finding-triage.test.js src/services/conversation-audit.test.js src/rituals/health-check.test.js`
Expected: ok + todos PASS.

---

## Task 10: Backfill + validação shadow-mode (operacional, quando liberado)

**Files:**
- Create: `scripts/backfill-incident-at.js`

- [ ] **Step 1: Escrever o backfill**

```js
// scripts/backfill-incident-at.js
// Preenche incident_at/incident_confidence nos findings existentes a partir do evidence.
// Rodar na VPS: node --env-file=.env scripts/backfill-incident-at.js
'use strict';
const { createClient } = require('@supabase/supabase-js');
const { resolveIncidentAt } = require('../src/services/conversation-audit');

(async () => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: rows } = await sb.from('tom_audit_findings')
    .select('id, collaborator_id, evidence, occurred_at, created_at, incident_at')
    .is('incident_at', null);
  let done = 0;
  for (const f of rows || []) {
    const since = new Date(Date.parse(f.created_at) - 24 * 3600 * 1000).toISOString();
    const inc = await resolveIncidentAt(sb, f.collaborator_id, f.evidence, f.occurred_at, since);
    await sb.from('tom_audit_findings')
      .update({ incident_at: inc.incident_at, incident_confidence: inc.incident_confidence })
      .eq('id', f.id);
    done++;
  }
  console.log(`backfill incident_at: ${done} findings`);
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Validar sintaxe**

Run: `node --check scripts/backfill-incident-at.js`
Expected: ok.

- [ ] **Step 3: (Quando liberado) shadow-mode antes de ligar o filtro**

Após aplicar a migração (Task 1) e rodar o backfill: rodar `triageOpenFindings` em produção por ~3 dias **com o relatório ainda mostrando tudo** (não filtrar por `auto_triage`), e comparar `auto_triage.decision='suppress'` contra julgamento humano via:
```sql
SELECT id, summary, incident_at, incident_confidence, auto_triage
FROM tom_audit_findings
WHERE auto_triage->>'decision' = 'suppress' ORDER BY (auto_triage->>'decided_at') DESC;
```
Calibrar `MATCH_MIN_CONFIDENCE`/`MARGIN_MS`. Só então ligar o filtro do relatório (Task 8 já implementa; mantê-lo atrás de revisão até a calibração fechar). Meta: taxa de falso-suprimido aceitável (critério de aceite §5 da spec).

- [ ] **Step 4: Registrar em `tom_known_issues`**

```sql
INSERT INTO tom_known_issues
  (codigo, titulo, area, severidade, status, causa_raiz, fix_resumo, sinal_tipo, sinal_padrao,
   colaboradores_afetados, primeira_vez, ultima_vez, ocorrencias, corrigido_em)
VALUES ('AUDIT-PRECISION-WINDOW-MATCH',
  'Relatório 07h re-levantava findings já corrigidos', 'health-check', 'medio', 'corrigido',
  'Relatório sem filtro de tempo + sem casamento com known-issues; occurred_at grosseiro/null',
  'Janela de atividade (last_seen≤7d) + auto-triagem semântica (incident_at vs corrigido_em), não-destrutiva',
  'manual', '%audit%findings%re-levant%', ARRAY['Alf'], now(), now(), 1, now());
```

---

## Self-review (preenchido)

**Cobertura da spec:** §5.1 janela → Task 8/9; §5.2 incident_at → Task 3/4 + backfill Task 10; §5.3 casamento LLM → Task 5/6/7; §5.4 política temporal → Task 2; §5.5 anti-regressão → Task 2 (ordem) + Task 10 (shadow); §5.6 transparência → Task 8; §6 esquema → Task 1; §7 mapa de código → todas. **Sem lacunas.**

**Placeholders:** nenhum "TBD/TODO"; todo passo de código tem código real. Único ponto que exige verificação em runtime (não placeholder, mas confirmação): o nome do provider de IA reusado na Task 9 — explicitamente marcado para confirmar contra `dispatcher.js` antes de codar.

**Consistência de tipos/nomes:** `decideTriage`/`parseMatches`/`triageOpenFindings`/`resolveIncidentAt`/`formatConvQuality`/`buildMatchMessages` usados com a mesma assinatura em todas as tasks; `auto_triage` com os mesmos campos em Task 1, 7 e 8; `WINDOW_DAYS` importado de `finding-triage.js` em Task 8/9 (fonte única).

---

## Notas de execução (19/06) — código implementado

Tasks 1–10 (código) executadas inline com TDD. **38 testes verdes** (`finding-triage` 12, `conversation-audit` 20, `conv-quality-format` 4, `finding-triage-prompt` 2). Produção (Task 11) **RETIDA pelo HOLD**.

Duas divergências do plano original, ambas melhorias:
1. **`formatConvQuality` foi extraída para `src/rituals/conv-quality-format.js`** (módulo próprio + `CONV_CAT_LABEL`), em vez de viver em `health-check.js`. Motivo: `health-check.js` importa `../supabase/client` no topo, que **só existe na VPS** (`project_local_vps_desync`) → não dá pra `require` local → a função pura ficaria intestável. Segue o padrão `group-report-builder.js` do projeto. `checkConversationQuality` importa de `./conv-quality-format`; teste em `conv-quality-format.test.js`.
2. **`checkFindingTriage` reusa `require('../ai/provider').chat`** (o mesmo `aiChat` que o Dream injeta — confirmado em `dispatcher.js:24`), em vez do `_audit-chat` hipotético do plano.

Verificação local de `health-check.js` é por `node --check` (não `require`, por causa do supabase só-na-VPS). Validação E2E real roda na VPS na fase de produção.
