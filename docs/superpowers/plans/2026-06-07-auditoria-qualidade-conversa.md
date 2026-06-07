# Auditoria de Qualidade de Conversa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detectar falhas reais do usuário com o TOM a partir das conversas (alta precisão), gravar em fila de triagem e trazer na auditoria das 07h.

**Architecture:** Analisador LLM (`conversation-audit.js`) acoplado ao loop do Dream (03h) no `dispatcher.js`; grava em `tom_audit_findings` com dedupe por assinatura+contador; um check novo no `health-check.js` lê a fila e entra no relatório das 07h automaticamente (via `ALL_CHECKS`).

**Tech Stack:** Node.js CommonJS, Supabase (`cesnbnrynvxvgdhfmaua`), `node:test`, LLM via `src/ai/provider.js` (`chat()` → `{text}`). Deploy: scp path absoluto + `pm2 restart tom` + md5.

**Convenções do projeto (override do skill):** NÃO há git commit entre tasks — trabalha local em `_remote`. Validação por task = `node --check` + `node --test`. Deploy é uma task única no fim (scp + md5 + restart). Migrations via MCP `apply_migration`.

**Pré-integração já levantada (não re-investigar):**
- Dream loop: `dispatcher.js:3011-3029`, dentro dele `await consolidateMemoryFor(c)` (linha 3020). `c` tem `{id, full_name, phone, role, unit}`.
- `consolidateMemoryFor` carrega só **inbound** → o audit precisa do PRÓPRIO loader (inbound+outbound).
- Provider: `const { chat } = require('../ai/provider'); const r = await chat(systemPrompt, [{role:'user',content}], maxTokens); r.text` é a resposta.
- Health-check: `ALL_CHECKS` (array `[nome, fn]`) em `health-check.js:475`; cada fn retorna `{status:'ok'|'warning'|'error', detail, samples?}`. Adicionar entrada = aparece no relatório.
- `conversation_history` colunas: `collaborator_id, direction('inbound'|'outbound'), content, created_at, message_type`.

---

## Task 1: Migration `tom_audit_findings`

**Files:**
- Create (via MCP apply_migration): tabela `tom_audit_findings`

- [ ] **Step 1: Aplicar a migration**

Via MCP `apply_migration` (project_id `cesnbnrynvxvgdhfmaua`, name `tom_audit_findings`):

```sql
create table if not exists public.tom_audit_findings (
  id uuid primary key default gen_random_uuid(),
  collaborator_id uuid references public.collaborators(id),
  category text not null,
  severity text not null default 'medio',
  summary text not null,
  evidence text not null,
  occurred_at timestamptz,
  signature text not null,
  status text not null default 'novo',
  occurrences int not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  promoted_code text,
  created_at timestamptz not null default now()
);
create unique index if not exists tom_audit_findings_open_sig
  on public.tom_audit_findings (signature)
  where status in ('novo','confirmado');
alter table public.tom_audit_findings enable row level security;
comment on table public.tom_audit_findings is
  'Achados de qualidade de conversa detectados pelo analisador acoplado ao Dream. Fila de triagem; service-role only. Confirmados viram tom_known_issues.';
```

- [ ] **Step 2: Verificar**

Via MCP `execute_sql`:
```sql
select column_name, data_type from information_schema.columns
where table_name='tom_audit_findings' order by ordinal_position;
```
Expected: 14 colunas, `status`/`category`/`signature` como `text`, `occurrences` como `integer`.

---

## Task 2: Helpers puros (normalize + signature) com TDD

**Files:**
- Create: `src/services/conversation-audit.js`
- Test: `src/services/conversation-audit.test.js`

- [ ] **Step 1: Escrever o teste que falha**

`src/services/conversation-audit.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeSummary, signatureFor } = require('./conversation-audit');

test('normalizeSummary: remove acento/pontuação/número, baixa, colapsa', () => {
  assert.strictEqual(
    normalizeSummary('TOM negou salvar 2 gastos!!!'),
    'tom negou salvar gastos'
  );
});
test('signatureFor: mesma entrada → mesma assinatura', () => {
  const a = signatureFor('confabulation', 'c1', 'TOM negou salvar gasto');
  const b = signatureFor('confabulation', 'c1', 'tom  negou salvar  gasto.');
  assert.strictEqual(a, b);
});
test('signatureFor: categoria diferente → assinatura diferente', () => {
  const a = signatureFor('confabulation', 'c1', 'x');
  const b = signatureFor('wrong_refusal', 'c1', 'x');
  assert.notStrictEqual(a, b);
});
test('signatureFor: colaborador diferente → assinatura diferente', () => {
  assert.notStrictEqual(signatureFor('x', 'c1', 's'), signatureFor('x', 'c2', 's'));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/services/conversation-audit.test.js`
Expected: FAIL (`Cannot find module './conversation-audit'`).

- [ ] **Step 3: Implementar os helpers**

Criar `src/services/conversation-audit.js` com (só os helpers nesta task):
```js
// src/services/conversation-audit.js
// Auditoria de Qualidade de Conversa — detecta falhas reais do usuário com o TOM
// (confabulação, recusa indevida, mídia falha, pedido largado, frustração) a partir
// da conversa de 24h. Acoplado ao Dream (03h). Alta precisão; dedupe por assinatura.
'use strict';
const crypto = require('crypto');

/** Normaliza o resumo pra assinatura: sem acento/pontuação/número, minúsculo, colapsado, 60 chars. */
function normalizeSummary(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\d+/g, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/** Assinatura de dedupe: categoria + colaborador + resumo normalizado. */
function signatureFor(category, collaboratorId, summary) {
  return crypto.createHash('sha1')
    .update(`${category}:${collaboratorId}:${normalizeSummary(summary)}`)
    .digest('hex');
}

module.exports = { normalizeSummary, signatureFor };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test src/services/conversation-audit.test.js`
Expected: PASS (4/4).

---

## Task 3: Prompt de detecção (alta precisão)

**Files:**
- Create: `src/prompts/conversation-audit-prompt.js`

- [ ] **Step 1: Implementar o builder do prompt**

Criar `src/prompts/conversation-audit-prompt.js`:
```js
// src/prompts/conversation-audit-prompt.js
// Prompt de ALTA PRECISÃO pra detectar falhas do TOM numa conversa. Lista vazia é o
// resultado NORMAL e esperado — só emite finding com trecho-prova literal + confiança alta.
'use strict';

const SYSTEM = `Você é um AUDITOR de qualidade do agente TOM (assistente de WhatsApp da LA Music).
Recebe uma conversa (linhas "USUÁRIO:" e "TOM:") e detecta APENAS falhas REAIS e CLARAS do TOM.

CATEGORIAS (use exatamente estas keys):
- "confabulation": TOM afirma ter feito algo sem ter feito, OU nega capacidade que tem (ex.: diz "não consigo salvar gasto" tendo salvo gasto antes na mesma conversa).
- "wrong_refusal": usuário pede algo que o sistema FAZ e o TOM diz que não dá / não tem acesso.
- "media_fail": TOM não conseguiu processar áudio/imagem que o usuário mandou.
- "dropped_request": usuário pediu algo e o TOM não resolveu nem encaminhou (ficou no ar).
- "frustration": usuário demonstra irritação clara ("pô", "você não entendeu", "irmão", repetir a mesma demanda).

REGRAS (inegociáveis):
1. Só emita um finding se houver TRECHO LITERAL da conversa que PROVE a falha. Sem prova → não emite.
2. Na dúvida, NÃO emita. Lista vazia é o resultado correto na maioria das conversas.
3. Não invente: "evidence" precisa aparecer LITERALMENTE na conversa.
4. Conversa boa, small talk, ou caso que o TOM resolveu bem → lista vazia.
5. severity: "alto" (bloqueou o usuário / contradição grave), "medio" (atrito real), "baixo" (incômodo leve).

Responda SOMENTE com JSON válido, sem texto fora do JSON:
{"findings":[{"category":"<key>","severity":"alto|medio|baixo","summary":"<1 linha>","evidence":"<trecho literal>","occurred_at":null}]}
Se não houver falha: {"findings":[]}`;

/** Monta as mensagens pro provider.chat a partir do texto da conversa formatada. */
function buildAuditMessages(conversationText) {
  return {
    system: SYSTEM,
    messages: [{ role: 'user', content: `Conversa pra auditar:\n\n${conversationText}` }],
  };
}

module.exports = { SYSTEM, buildAuditMessages };
```

- [ ] **Step 2: Verificar sintaxe**

Run: `node --check src/prompts/conversation-audit-prompt.js`
Expected: sem saída (OK).

---

## Task 4: Loader + análise + upsert (LLM + persistência)

**Files:**
- Modify: `src/services/conversation-audit.js`
- Test: `src/services/conversation-audit.test.js` (adiciona teste de parsing)

- [ ] **Step 1: Teste do parser de saída do LLM**

Adicionar em `src/services/conversation-audit.test.js`:
```js
const { parseFindings } = require('./conversation-audit');

test('parseFindings: extrai JSON válido e filtra categoria inválida/sem evidence', () => {
  const raw = 'lixo antes {"findings":[' +
    '{"category":"confabulation","severity":"alto","summary":"negou salvar","evidence":"TOM: não consigo salvar"},' +
    '{"category":"inventada","severity":"alto","summary":"x","evidence":"y"},' +
    '{"category":"frustration","severity":"baixo","summary":"sem prova"}' +
    ']} lixo depois';
  const out = parseFindings(raw);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].category, 'confabulation');
});
test('parseFindings: JSON quebrado → []', () => {
  assert.deepStrictEqual(parseFindings('não é json'), []);
});
test('parseFindings: lista vazia → []', () => {
  assert.deepStrictEqual(parseFindings('{"findings":[]}'), []);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/services/conversation-audit.test.js`
Expected: FAIL (`parseFindings is not a function`).

- [ ] **Step 3: Implementar parser + loader + auditConversation + upsertFinding**

Adicionar a `src/services/conversation-audit.js` (antes do `module.exports`, e atualizar o exports):
```js
const supabase = require('./supabase/client') || null; // ajustado abaixo se path diferir

const VALID_CATEGORIES = new Set([
  'confabulation', 'wrong_refusal', 'media_fail', 'dropped_request', 'frustration',
]);
const VALID_SEVERITY = new Set(['alto', 'medio', 'baixo']);

/** Extrai o bloco {...} e valida cada finding. Nunca lança. */
function parseFindings(raw) {
  const s = String(raw == null ? '' : raw);
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return [];
  let obj;
  try { obj = JSON.parse(s.slice(start, end + 1)); } catch { return []; }
  const list = Array.isArray(obj && obj.findings) ? obj.findings : [];
  return list.filter(f =>
    f && VALID_CATEGORIES.has(f.category) &&
    typeof f.evidence === 'string' && f.evidence.trim().length > 0 &&
    typeof f.summary === 'string' && f.summary.trim().length > 0,
  ).map(f => ({
    category: f.category,
    severity: VALID_SEVERITY.has(f.severity) ? f.severity : 'medio',
    summary: String(f.summary).slice(0, 200),
    evidence: String(f.evidence).slice(0, 1000),
    occurred_at: f.occurred_at || null,
  }));
}

/** Carrega a conversa (AMBAS direções) das últimas `hours`h e formata em texto. */
async function loadConversation(sb, collaboratorId, hours = 24) {
  const sinceIso = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const { data } = await sb.from('conversation_history')
    .select('content, direction, created_at')
    .eq('collaborator_id', collaboratorId)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true })
    .limit(300);
  const text = (data || [])
    .map(m => `${m.direction === 'inbound' ? 'USUÁRIO' : 'TOM'}: ${String(m.content || '').slice(0, 600)}`)
    .join('\n')
    .slice(0, 14000);
  return text;
}

/** Analisa a conversa de um colaborador. Retorna Finding[]. NUNCA lança. */
async function auditConversation(sb, chat, collaborator, hours = 24) {
  try {
    const convo = await loadConversation(sb, collaborator.id, hours);
    if (convo.length < 80) return []; // conversa fina demais
    const { buildAuditMessages } = require('../prompts/conversation-audit-prompt');
    const { system, messages } = buildAuditMessages(convo);
    const r = await chat(system, messages, 1200);
    return parseFindings(r && r.text);
  } catch (err) {
    console.error(`[ConvAudit] erro p/ ${collaborator.full_name}:`, err.message);
    return [];
  }
}

/** Grava 1 finding com dedupe por assinatura (open=novo/confirmado). NUNCA lança. */
async function upsertFinding(sb, collaborator, finding) {
  try {
    const sig = signatureFor(finding.category, collaborator.id, finding.summary);
    const { data: existing } = await sb.from('tom_audit_findings')
      .select('id, occurrences')
      .eq('signature', sig)
      .in('status', ['novo', 'confirmado'])
      .limit(1);
    if (existing && existing.length > 0) {
      await sb.from('tom_audit_findings')
        .update({ occurrences: (existing[0].occurrences || 1) + 1, last_seen: new Date().toISOString() })
        .eq('id', existing[0].id);
      return 'incremented';
    }
    await sb.from('tom_audit_findings').insert({
      collaborator_id: collaborator.id,
      category: finding.category,
      severity: finding.severity,
      summary: finding.summary,
      evidence: finding.evidence,
      occurred_at: finding.occurred_at,
      signature: sig,
      status: 'novo',
    });
    return 'inserted';
  } catch (err) {
    console.error('[ConvAudit] upsert err:', err.message);
    return 'error';
  }
}
```
E trocar o `module.exports` para:
```js
module.exports = { normalizeSummary, signatureFor, parseFindings, loadConversation, auditConversation, upsertFinding };
```
Remover a linha `const supabase = require('./supabase/client') || null;` do topo (não é usada — `sb` é injetado nas funções pra facilitar teste). 

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test src/services/conversation-audit.test.js`
Expected: PASS (7/7). Depois `node --check src/services/conversation-audit.js` (OK).

---

## Task 5: Hook no loop do Dream (dispatcher.js)

**Files:**
- Modify: `src/rituals/dispatcher.js` (dentro do loop do Dream, após `consolidateMemoryFor`, ~linha 3020)

- [ ] **Step 1: Adicionar o require no topo do arquivo**

Perto dos outros requires de serviços no topo do `dispatcher.js`, adicionar:
```js
const { auditConversation, upsertFinding } = require('../services/conversation-audit');
const { chat: aiChat } = require('../ai/provider');
```

- [ ] **Step 2: Chamar a auditoria no loop do Dream**

Em `dispatcher.js`, no bloco do Dream, logo após:
```js
        try {
          await consolidateMemoryFor(c);
          dreamOk++;
          // Log p/ ritual_logs — health check usa pra detectar "Dream não rodou".
          await logRitualEvent(c.id, 'daily_dream', 'sent', null, now.ymd);
        }
```
inserir, ANTES do `catch` correspondente, dentro do mesmo `try` (após o `logRitualEvent`):
```js
          // GovQuality — auditoria de qualidade de conversa (acoplada ao Dream).
          // Isolada: erro aqui nunca afeta o Dream. Grava em tom_audit_findings.
          try {
            const findings = await auditConversation(supabase, aiChat, c, 24);
            for (const f of findings) await upsertFinding(supabase, c, f);
            if (findings.length > 0) console.log(`[ConvAudit] ${c.full_name}: ${findings.length} achado(s)`);
          } catch (qErr) {
            console.error(`[ConvAudit] falha p/ ${c.full_name}:`, qErr.message);
          }
```

- [ ] **Step 3: Verificar sintaxe**

Run: `node --check src/rituals/dispatcher.js`
Expected: sem saída (OK).

---

## Task 6: Check no health-check + relatório

**Files:**
- Modify: `src/rituals/health-check.js` (nova função + entrada em `ALL_CHECKS`)

- [ ] **Step 1: Implementar `checkConversationQuality`**

Em `health-check.js`, perto dos outros checks (antes de `const ALL_CHECKS`), adicionar:
```js
// ─────────────────────────────────────────────────────────────────
// CHECK 14 — Qualidade das conversas (findings abertos do analisador do Dream)
// ─────────────────────────────────────────────────────────────────
const CONV_CAT_LABEL = {
  confabulation: 'confabulação/contradição',
  wrong_refusal: 'recusa indevida',
  media_fail: 'mídia falha',
  dropped_request: 'pedido largado',
  frustration: 'frustração',
};
async function checkConversationQuality() {
  const { data, error } = await supabase
    .from('tom_audit_findings')
    .select('category, severity, summary, occurrences, collaborator_id, collaborators:collaborator_id(full_name)')
    .in('status', ['novo', 'confirmado'])
    .order('occurrences', { ascending: false })
    .limit(50);
  if (error) throw error;
  const findings = data || [];
  if (findings.length === 0) {
    return { status: 'ok', detail: '🗣️ 0 falhas nas conversas (24h)' };
  }
  const top = findings.slice(0, 5).map(f => {
    const who = f.collaborators?.full_name?.split(' ')[0] || '—';
    const rec = (f.occurrences || 1) >= 2 ? `🔁${f.occurrences}× ` : '';
    return `  • ${rec}[${CONV_CAT_LABEL[f.category] || f.category}] ${String(f.summary).slice(0, 60)} (${who})`;
  });
  const samples = findings.slice(0, 5).map(f => ({
    category: f.category, severity: f.severity, summary: f.summary, occurrences: f.occurrences,
  }));
  return {
    status: 'warning',
    detail: `🗣️ ${findings.length} falha(s) de conversa pra revisar:\n${top.join('\n')}`,
    samples,
  };
}
```

- [ ] **Step 2: Registrar em `ALL_CHECKS`**

Em `health-check.js`, no array `ALL_CHECKS`, adicionar a última linha:
```js
  ['provider_health',        checkProviderHealth],
  ['conversation_quality',   checkConversationQuality],
];
```

- [ ] **Step 3: Verificar sintaxe**

Run: `node --check src/rituals/health-check.js`
Expected: sem saída (OK).

---

## Task 7: Skill auditoria-sistema renderiza os findings

**Files:**
- Modify: `skills/auditoria-sistema.md`

- [ ] **Step 1: Adicionar nota de render**

Em `skills/auditoria-sistema.md`, na seção "## Regras", adicionar um item:
```markdown
- O check `conversation_quality` (🗣️) é a auditoria de QUALIDADE DE CONVERSA: lista falhas reais do TOM com usuários (confabulação, recusa indevida, mídia falha, pedido largado, frustração). Renderize o `detail` exato; recorrentes vêm com 🔁Nx. Se o Luciano pedir detalhe, use os `samples` do bloco. Esses são achados pra CORRIGIR — trate como prioridade.
```

- [ ] **Step 2: Conferir**

Abrir o arquivo e confirmar que a linha está sob "## Regras". (sem comando)

---

## Task 8: Smoke (caso Matheus) + deploy

**Files:**
- Create: `scripts/smoke-conversation-audit.js`
- Deploy: scp dos arquivos + restart

- [ ] **Step 1: Escrever o smoke**

Criar `scripts/smoke-conversation-audit.js`:
```js
// scripts/smoke-conversation-audit.js
// Prova de PRECISÃO: roda o analisador sobre a conversa REAL do Matheus (07/06) e
// confirma que detecta confabulation + wrong_refusal. NÃO grava nada (só analisa).
// Rodar no VPS: cd /opt/LA-Organizer && set -a && . ./.env && node scripts/smoke-conversation-audit.js
const { createClient } = require('@supabase/supabase-js');
const { chat } = require('../src/ai/provider');
const { auditConversation } = require('../src/services/conversation-audit');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);

async function main() {
  const { data: m } = await sb.from('collaborators').select('id, full_name').ilike('full_name', '%matheus%').limit(5);
  if (!m || m.length === 0) { console.log('Matheus não encontrado'); process.exit(2); }
  for (const c of m) {
    const findings = await auditConversation(sb, chat, c, 72); // janela 72h pra pegar 07/06
    console.log(`\n=== ${c.full_name} (${findings.length} achados) ===`);
    for (const f of findings) console.log(`[${f.category}/${f.severity}] ${f.summary}\n   prova: ${f.evidence.slice(0,120)}`);
  }
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e); process.exit(2); });
```

- [ ] **Step 2: Validação local completa**

Run: `node --test src/services/conversation-audit.test.js` (PASS 7/7)
Run: `node --check src/services/conversation-audit.js && node --check src/prompts/conversation-audit-prompt.js && node --check src/rituals/dispatcher.js && node --check src/rituals/health-check.js`
Expected: tudo OK.

- [ ] **Step 3: Deploy (scp path ABSOLUTO + md5 + restart)**

```bash
for f in src/services/conversation-audit.js src/prompts/conversation-audit-prompt.js src/rituals/dispatcher.js src/rituals/health-check.js skills/auditoria-sistema.md scripts/smoke-conversation-audit.js; do
  scp /d/la-organizer/_remote/$f tom:/opt/LA-Organizer/$f
  L=$(md5sum /d/la-organizer/_remote/$f | cut -d' ' -f1)
  R=$(ssh tom "md5sum /opt/LA-Organizer/$f | cut -d' ' -f1")
  [ "$L" = "$R" ] && echo "OK $f" || echo "MISMATCH $f"
done
ssh tom "pm2 restart tom"
```
Expected: 6× "OK", pm2 online.

- [ ] **Step 4: Rodar o smoke de precisão no VPS**

```bash
ssh tom "cd /opt/LA-Organizer && set -a && . ./.env && node scripts/smoke-conversation-audit.js"
```
Expected: detecta pelo menos `confabulation` (a contradição "não consigo salvar") e/ou `wrong_refusal` na conversa do Matheus, com trecho-prova.

- [ ] **Step 5: Validar o pipeline ponta-a-ponta (force Dream)**

```bash
ssh tom "cd /opt/LA-Organizer && set -a && . ./.env && node -e \"require('./src/rituals/dispatcher').run({force:'dream'}).then(()=>process.exit(0))\""
```
Depois conferir via MCP execute_sql:
```sql
select category, severity, summary, occurrences, status from tom_audit_findings order by created_at desc limit 10;
```
Expected: findings reais gravados; rodar 2× NÃO duplica (incrementa `occurrences`).

- [ ] **Step 6: Registrar no ledger**

INSERT em `tom_known_issues` com codigo `CONV-QUALITY-AUDIT` documentando a nova camada (área `health-check`, status `corrigido`).

---

## Self-Review (feita)

- **Cobertura da spec:** Camada 1 (Task 4+5), Camada 2/prompt (Task 3), Camada 3/tabela+dedupe (Task 1+4), Camada 4/surface (Task 6) + skill (Task 7) + triagem (manual, documentada). Smoke caso Matheus (Task 8). ✅
- **Correção vs spec:** a spec dizia "reusa a MESMA conversa do Dream"; ajustado — o Dream é inbound-only, então o audit tem loader próprio (inbound+outbound). Decisão registrada aqui.
- **Placeholders:** nenhum — todo passo tem código/comando reais.
- **Consistência de tipos:** `auditConversation(sb, chat, collaborator, hours)` e `upsertFinding(sb, collaborator, finding)` usados igual no dispatcher (Task 5) e no smoke (Task 8); `parseFindings`/`signatureFor`/`normalizeSummary` idem nos testes.
