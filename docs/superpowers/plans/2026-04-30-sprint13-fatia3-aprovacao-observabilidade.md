# Sprint 13 Fatia 3 — Aprovação + Observabilidade

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar fluxo de aprovação para comunicados criados por coordinator (director aprova via TOM ou PWA) + tela de observabilidade no PWA com fila de aprovação, métricas por comunicado e alerta de duplicidade.

**Architecture:** Estende a máquina de estados de `announcements` (novos status `pending_approval` + `rejected`). Coordinator cria → notifica directors via TOM (WhatsApp). Director aprova/rejeita via WhatsApp (engine emite marker) ou PWA (UPDATE direto). Para aprovações via PWA, o dispatcher cron detecta `coordinator_notified_at IS NULL` e envia o feedback via WhatsApp. Broadcaster da Fatia 1 não é alterado — já ignora tudo fora de `scheduled/sending`.

**Tech Stack:** Supabase (PostgreSQL + RLS), Node.js engine (TOM), React + TanStack Query (PWA).

**Spec:** `docs/superpowers/specs/2026-04-30-sprint13-fatia3-aprovacao-observabilidade-design.md`

---

## Codebase Context (zero-context onboarding)

**Backend:**
- `src/engine.js` (~2700 linhas): TOM AI agent. Tem markers `<<X>>...<<END>>` para ações estruturadas. Funções existentes: `parseAnnouncementActionMarker`, `applyAnnouncementAction`, `parseSchoolEventActionMarker`, `applySchoolEventAction`. Pipeline `processMessage` chama `parseX` → `applyX`.
- `src/rituals/dispatcher.js` (~1174 linhas): cron despachante. `run()` chama `dispatchChecklists`, `dispatchAnnouncements`, `handleCancellations`. Cada anúncio em `scheduled` → `sending` → `sent`. 1 mensagem/min anti-ban.
- `src/prompts/system.js`: monta prompt do TOM. `BLOCK_RULES` lista markers que TOM pode emitir. Carrega skills condicionalmente por role.
- `skills/comunicados.md`, `skills/eventos-institucionais.md`: skills TOM existentes (markdown).

**Frontend (PWA):**
- `web/src/types.ts`: tipos compartilhados. Já tem `Announcement`, `AnnouncementAudience`, `AnnouncementJob`, `audienceLabel()`.
- `web/src/screens/`: telas (Comunicados.tsx, AgendaEscolar.tsx, Mais.tsx, App.tsx).
- `web/src/components/BottomSheet.tsx`: sheet componente — props `open`, `onClose`, `title`.
- `web/src/contexts/AuthContext.tsx`: `useAuth()` retorna `{ collaborator, role, signOut }`. Use `collaborator.id`.

**CSS conventions:** `bg-brand` (NÃO `bg-primary`), `text-brand`, `bg-bg-elevated`, `bg-bg-surface`, `text-fg-muted`, `focus:border-brand`. Spacing tokens: `p-md`, `gap-md`, `space-y-lg`. Type tokens: `text-section-title`, `text-body-md`, `text-body-sm`.

**Supabase patterns:**
- Antes de qualquer mutação no PWA: `await supabase.rpc('set_config', { key: 'app.current_user_id', value: collaborator.id })`. Isso popula `current_collab_role()` usado pelas RLS policies.
- Engine usa service role key → bypassa RLS.

**Auth → role mapping:**
- `useAuth().role` retorna a role do collaborator (`director`, `coordinator`, ou outras).
- Engine recebe `collaborator` object com `.role`, `.id`, `.full_name`, `.phone`.

**Project IDs:**
- Supabase project: `cesnbnrynvxvgdhfmaua`
- Use MCP tools `mcp__4c04bb52...__apply_migration` para migrations e `mcp__4c04bb52...__execute_sql` para queries de validação.

---

## File Structure

**Created:**
- `skills/aprovacao-comunicados.md` — TOM skill para director/coordinator
- `web/src/components/AprovacaoSheet.tsx` — bottom sheet para motivo de rejeição
- `web/src/screens/Observabilidade.tsx` — tela PWA com fila de aprovação + métricas

**Modified:**
- `src/engine.js` — `applyAnnouncementAction` (status condicional + notif directors), novos `parseAnnouncementApprovalMarker` + `applyAnnouncementApproval`, integração no pipeline `processMessage`
- `src/prompts/system.js` — `BLOCK_RULES` add `<<ANNOUNCEMENT_APPROVAL>>`, carregar `aprovacao-comunicados.md` para director/coordinator
- `src/rituals/dispatcher.js` — nova função `notifyCoordinators(whatsapp)`, chamada em `run()`
- `web/src/types.ts` — extender `Announcement` com `reviewed_by`, `rejection_reason`, `coordinator_notified_at`; novos tipos `AnnouncementWithMetrics`, `ApprovalAction`
- `web/src/screens/Mais.tsx` — adicionar item Observabilidade
- `web/src/App.tsx` — adicionar route `/mais/observabilidade`

**No tests directory exists in this project.** Validation is done via:
- DB: `mcp__4c04bb52...__execute_sql` for SQL assertions
- Engine/dispatcher: manual smoke tests via TOM messages or direct DB inspection
- PWA: visual inspection on `npm run dev` (port 4173 is the production preview, 5173 is dev)

---

## Task 1: DB Migration — Status Machine + Audit Columns

**Files:**
- Migration applied via Supabase MCP (no local SQL file in this project's pattern)

- [ ] **Step 1: Apply migration**

Use the Supabase MCP tool `mcp__4c04bb52-f946-4fe8-85f6-b01d200f8c20__apply_migration` with project_id `cesnbnrynvxvgdhfmaua`, name `sprint13_fatia3_approval`, and this query:

```sql
-- 1. Estender o CHECK de status para aceitar pending_approval e rejected
ALTER TABLE announcements
  DROP CONSTRAINT IF EXISTS announcements_status_check;

ALTER TABLE announcements
  ADD CONSTRAINT announcements_status_check
    CHECK (status IN ('pending_approval','scheduled','sending','sent','cancelled','rejected'));

-- 2. Auditoria de aprovação
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES collaborators(id),
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS coordinator_notified_at timestamptz;

-- 3. Índice para fila de aprovação
CREATE INDEX IF NOT EXISTS idx_announcements_pending
  ON announcements(status) WHERE status = 'pending_approval';

-- 4. Índice para detecção de notificações pendentes pelo dispatcher
CREATE INDEX IF NOT EXISTS idx_announcements_coordinator_pending_notify
  ON announcements(status, coordinator_notified_at)
  WHERE reviewed_by IS NOT NULL AND coordinator_notified_at IS NULL;
```

- [ ] **Step 2: Verify columns and constraint**

Use `mcp__4c04bb52...__execute_sql` with this query and confirm output shows the new columns and the updated CHECK constraint:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'announcements'
  AND column_name IN ('reviewed_by','rejection_reason','coordinator_notified_at')
ORDER BY column_name;
```

Expected: 3 rows. `reviewed_by` is `uuid`, `rejection_reason` is `text`, `coordinator_notified_at` is `timestamp with time zone`. All nullable.

- [ ] **Step 3: Verify CHECK constraint includes new statuses**

```sql
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'announcements_status_check';
```

Expected output contains: `'pending_approval'`, `'rejected'`, `'scheduled'`, `'sending'`, `'sent'`, `'cancelled'`.

- [ ] **Step 4: Add RLS policy for director-only status updates via PWA**

Apply via `mcp__4c04bb52...__apply_migration` (name `sprint13_fatia3_approval_rls`):

```sql
-- Permite que director atualize status/reviewed_by/rejection_reason via PWA
-- (engine usa service role e bypassa RLS de qualquer forma)
DROP POLICY IF EXISTS announcements_review ON announcements;

CREATE POLICY announcements_review ON announcements
  FOR UPDATE
  TO authenticated
  USING (current_collab_role() = 'director')
  WITH CHECK (current_collab_role() = 'director');
```

- [ ] **Step 5: Verify RLS policy exists**

```sql
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'announcements' AND policyname = 'announcements_review';
```

Expected: 1 row, `cmd = UPDATE`, both `qual` and `with_check` reference `current_collab_role()`.

---

## Task 2: TOM Skill — `skills/aprovacao-comunicados.md`

**Files:**
- Create: `D:\la-organizer\_remote\skills\aprovacao-comunicados.md`

- [ ] **Step 1: Create the skill file**

Create `D:\la-organizer\_remote\skills\aprovacao-comunicados.md` with this exact content:

````markdown
# Aprovação de Comunicados

Esta skill ensina o TOM a coordenar o fluxo de aprovação de comunicados quando criados por coordinator.

## Quando ativar

- O usuário é **coordinator** e está criando um comunicado: TOM informa que o comunicado vai para aprovação.
- O usuário é **director** e responde mensagens contendo `APROVAR <id>` ou `REJEITAR <id> [motivo]`.
- O usuário pergunta "quais comunicados estão aguardando aprovação?" ou similar.

---

## Fluxo do coordinator (criando comunicado)

Após confirmação do coordinator e emissão do marker `<<ANNOUNCEMENT_ACTION>>`, o engine criará o comunicado em `pending_approval` e notificará todos os directors via WhatsApp.

**Resposta do TOM ao coordinator (após criação):**
> "Comunicado registrado e enviado para aprovação dos diretores. Vou te avisar aqui quando for aprovado ou rejeitado. ID: `abc1`"

Não emita o marker `<<ANNOUNCEMENT_ACTION>>` para coordinator se ele não confirmar — sempre confirme antes (igual ao fluxo já existente).

---

## Fluxo do director (aprovando ou rejeitando)

Quando o director recebe a mensagem do TOM com formato:

```
📋 Comunicado pendente de aprovação
De: João (coordinator)
Para: Escola toda
Mensagem: "Reunião de pais na sexta..."
ID: `abc1`
Responda: APROVAR abc1 ou REJEITAR abc1 [motivo]
```

E o director responde com `APROVAR abc1` ou `REJEITAR abc1 texto muito longo`:

**Você (TOM) emite:**

```
<<ANNOUNCEMENT_APPROVAL>>
{"action": "approve", "announcement_id": "abc1"}
<<END>>
```

ou

```
<<ANNOUNCEMENT_APPROVAL>>
{"action": "reject", "announcement_id": "abc1", "reason": "texto muito longo"}
<<END>>
```

**Importante:**
- Sempre extraia o `announcement_id` exatamente como o director escreveu (4 caracteres curtos ou UUID completo).
- Se a rejeição vier sem motivo, omita `reason` do JSON ou use `null`.
- Não confirme antes de emitir — o feedback ao director vem do retorno do engine.

---

## Listagem de pendentes

Se o director ou coordinator perguntar "quais comunicados aguardam aprovação?" ou similar, responda informando que você não tem acesso direto ao banco — peça para abrir o PWA em `/mais/observabilidade` para ver a fila de aprovação.

---

## Regras

- **NUNCA** emita `<<ANNOUNCEMENT_APPROVAL>>` se o usuário não for director (engine vai bloquear de qualquer forma, mas evite ruído).
- **SEMPRE** use o ID exato fornecido pelo director — não invente, não complete.
- Se o director escrever apenas "aprovo" ou "rejeito" sem ID, peça o ID antes: "Qual o ID do comunicado? (4 letras/números)".
````

- [ ] **Step 2: Update `src/prompts/system.js` BLOCK_RULES**

Open `D:\la-organizer\_remote\src\prompts\system.js`. Find the `BLOCK_RULES` constant near line 21. It currently lists markers including `<<ANNOUNCEMENT_ACTION>>` and `<<SCHOOL_EVENT_ACTION>>`. Add `<<ANNOUNCEMENT_APPROVAL>>` to the same list. Example edit (preserve exact existing format):

If the current line is:
```js
'<<ANNOUNCEMENT_ACTION>>', '<<SCHOOL_EVENT_ACTION>>',
```

Change to:
```js
'<<ANNOUNCEMENT_ACTION>>', '<<SCHOOL_EVENT_ACTION>>', '<<ANNOUNCEMENT_APPROVAL>>',
```

- [ ] **Step 3: Load skill conditionally for director and coordinator**

In the same file `src/prompts/system.js`, find the existing block that loads `comunicados.md` (around lines 921-928). Pattern looks like:

```js
if (collaborator.role === 'director' || collaborator.role === 'coordinator') {
  const comunicadosSkill = readFileSync(join(__dirname, '..', '..', 'skills', 'comunicados.md'), 'utf8');
  parts.push(comunicadosSkill);
}
```

Add an analogous block immediately after the `eventos-institucionais.md` loading block:

```js
if (collaborator.role === 'director' || collaborator.role === 'coordinator') {
  const aprovacaoSkill = readFileSync(join(__dirname, '..', '..', 'skills', 'aprovacao-comunicados.md'), 'utf8');
  parts.push(aprovacaoSkill);
}
```

- [ ] **Step 4: Smoke test — system prompt loads skill without crashing**

Run from `D:\la-organizer\_remote`:
```
node -e "const { buildSystemPrompt } = require('./src/prompts/system'); const p = buildSystemPrompt({role:'director', full_name:'Test', id:'00000000-0000-0000-0000-000000000000'}); console.log(p.includes('aprovacao-comunicados') || p.includes('Aprovação de Comunicados') ? 'OK' : 'MISSING'); console.log('BLOCK_RULES has approval:', p.includes('ANNOUNCEMENT_APPROVAL'));"
```

Expected output:
```
OK
BLOCK_RULES has approval: true
```

If the file path or function name differs slightly, inspect `src/prompts/system.js` exports first and adjust.

---

## Task 3: Engine — Modify `applyAnnouncementAction` for Coordinator Flow

**Files:**
- Modify: `D:\la-organizer\_remote\src\engine.js` (the existing `applyAnnouncementAction` function around line 483)

**Context:** The current `applyAnnouncementAction` always inserts with `status='scheduled'`. We need to make it conditional on the author's role: coordinator → `pending_approval` + notify directors; director → `scheduled` (current behavior).

- [ ] **Step 1: Locate and inspect the current `applyAnnouncementAction`**

Read `D:\la-organizer\_remote\src\engine.js` around line 483-560. Note exactly:
- Where the INSERT into `announcements` happens (look for `.from('announcements').insert`)
- The current `status` value being inserted (probably hardcoded `'scheduled'` or comes from `parsed`)
- Where the function exits successfully (return statement)

- [ ] **Step 2: Modify the INSERT to use conditional status**

Change the line that builds the insert payload. The status field should be:

```js
const isCoordinator = collaborator.role === 'coordinator';
const initialStatus = isCoordinator ? 'pending_approval' : (parsed.scheduled_at ? 'scheduled' : 'scheduled');
// initialStatus simplified: coordinator → pending_approval, otherwise → scheduled
```

Replace the existing status logic in the INSERT payload. The payload should now look like:

```js
const { data: ann, error: annErr } = await supabase
  .from('announcements')
  .insert({
    body: parsed.body,
    audience: parsed.audience,
    scheduled_at: parsed.scheduled_at ?? null,
    status: isCoordinator ? 'pending_approval' : 'scheduled',
    created_by: collaborator.id,
  })
  .select()
  .single();
```

Preserve any fields that the existing payload already sets (e.g. `source_event_id` is null for manual create — only used by Fatia 2). **Do not remove existing fields.**

- [ ] **Step 3: For coordinators, skip the announcement_jobs INSERT and notify directors instead**

If `isCoordinator === true`, do NOT create `announcement_jobs` rows yet (they will be created at approval time by a new helper). Instead, after the INSERT succeeds:

```js
if (isCoordinator) {
  // Buscar directors com phone
  const { data: directors } = await supabase
    .from('collaborators')
    .select('id, full_name, phone')
    .eq('role', 'director')
    .not('phone', 'is', null);

  const shortId = ann.id.slice(0, 4);
  const audienceStr = describeAudience(parsed.audience); // helper local — see Step 4
  const bodyPreview = parsed.body.length > 80
    ? parsed.body.slice(0, 80) + '...'
    : parsed.body;

  if (!directors || directors.length === 0) {
    console.warn('[applyAnnouncementAction] Nenhum director com phone — comunicado fica em pending_approval para aprovação manual via PWA');
    return `Comunicado criado. ID curto: \`${shortId}\`. Nenhum diretor com WhatsApp cadastrado — peça aprovação direta no PWA.`;
  }

  for (const director of directors) {
    try {
      await whatsapp.sendMessage(director.phone, [
        '📋 *Comunicado pendente de aprovação*',
        `De: ${collaborator.full_name} (coordinator)`,
        `Para: ${audienceStr}`,
        `Mensagem: "${bodyPreview}"`,
        `ID: \`${shortId}\``,
        `Responda: APROVAR ${shortId} ou REJEITAR ${shortId} [motivo opcional]`,
      ].join('\n'));
    } catch (err) {
      console.error(`[applyAnnouncementAction] Falha ao notificar director ${director.id}:`, err.message);
    }
  }

  return `Comunicado criado e enviado para aprovação dos ${directors.length} diretor(es). Vou te avisar quando for aprovado ou rejeitado. ID: \`${shortId}\`.`;
}

// Caso director (fluxo já existente continua aqui — INSERT de announcement_jobs etc.)
```

- [ ] **Step 4: Add or reuse `describeAudience(audience)` helper**

Search `src/engine.js` for an existing audience-to-text function. The Fatia 1 implementation may already have something like `formatAudienceLabel` or `audienceDescription`. If found, use that name. If not, add this helper near the top of the file (after the requires):

```js
function describeAudience(audience) {
  if (!audience) return 'sem público';
  if (audience.all === true) return 'Escola toda';
  const parts = [];
  if (Array.isArray(audience.function_role) && audience.function_role.length) {
    parts.push(`função: ${audience.function_role.join(', ')}`);
  }
  if (Array.isArray(audience.unidade) && audience.unidade.length) {
    parts.push(`unidade: ${audience.unidade.join(', ')}`);
  }
  if (Array.isArray(audience.turno) && audience.turno.length) {
    parts.push(`turno: ${audience.turno.join(', ')}`);
  }
  return parts.length ? parts.join(' | ') : 'público customizado';
}
```

- [ ] **Step 5: Smoke test the coordinator flow**

Use a test script (or direct DB seed) to simulate the marker. From `D:\la-organizer\_remote`:

```
node -e "
const { applyAnnouncementAction } = require('./src/engine');
// Mock or use a real coordinator collaborator from your DB
const collab = { id: 'REPLACE-WITH-COORDINATOR-UUID', role: 'coordinator', full_name: 'Teste Coord' };
const parsed = { body: 'Smoke test fatia 3', audience: { all: true }, scheduled_at: null, action: 'create' };
applyAnnouncementAction(collab, parsed).then(r => console.log('RESULT:', r));
"
```

Expected: log line "Comunicado criado e enviado para aprovação..." OR (if no directors with phone) "Nenhum diretor com WhatsApp cadastrado".

Verify in DB:
```sql
SELECT id, status, body, created_by FROM announcements ORDER BY created_at DESC LIMIT 1;
```

Expected: `status = 'pending_approval'`, `body = 'Smoke test fatia 3'`.

Cleanup the test row:
```sql
DELETE FROM announcements WHERE body = 'Smoke test fatia 3';
```

- [ ] **Step 6: Verify director flow is unchanged**

Same smoke test but with `role: 'director'`. Expected: announcement is created with `status='scheduled'` and `announcement_jobs` rows are inserted (existing Fatia 1 behavior, untouched).

Cleanup any test rows.

---

## Task 4: Engine — Approval Marker Handler

**Files:**
- Modify: `D:\la-organizer\_remote\src\engine.js`

- [ ] **Step 1: Add `parseAnnouncementApprovalMarker(text)`**

In `src/engine.js`, near the existing `parseAnnouncementActionMarker` (around line 456), add this new function:

```js
function parseAnnouncementApprovalMarker(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(/<<ANNOUNCEMENT_APPROVAL>>\s*([\s\S]*?)\s*<<END>>/i);
  if (!m) return null;
  let parsed;
  try {
    parsed = JSON.parse(m[1]);
  } catch (err) {
    console.warn('[parseAnnouncementApprovalMarker] JSON inválido:', err.message);
    return null;
  }
  if (!['approve', 'reject'].includes(parsed.action)) return null;
  if (typeof parsed.announcement_id !== 'string' || !parsed.announcement_id.trim()) return null;
  // reason é opcional, só aceita string
  if (parsed.reason !== undefined && parsed.reason !== null && typeof parsed.reason !== 'string') {
    parsed.reason = null;
  }
  return {
    action: parsed.action,
    announcement_id: parsed.announcement_id.trim(),
    reason: parsed.reason ?? null,
  };
}
```

- [ ] **Step 2: Add `applyAnnouncementApproval(collaborator, parsed)`**

In `src/engine.js`, near the existing `applyAnnouncementAction` (around line 483), add this new function:

```js
async function applyAnnouncementApproval(collaborator, parsed) {
  if (collaborator.role !== 'director') {
    return 'Apenas diretores podem aprovar ou rejeitar comunicados.';
  }

  // Buscar announcement por short ID (4 chars) ou UUID completo
  const idValue = parsed.announcement_id;
  let query = supabase.from('announcements').select('*');
  if (idValue.length === 4) {
    query = query.filter('id::text', 'ilike', `${idValue}%`);
  } else {
    query = query.eq('id', idValue);
  }

  const { data: rows, error: queryErr } = await query
    .eq('status', 'pending_approval')
    .order('created_at', { ascending: false })
    .limit(1);

  if (queryErr) {
    console.error('[applyAnnouncementApproval] erro buscando announcement:', queryErr.message);
    return 'Erro ao buscar o comunicado. Tenta de novo.';
  }
  if (!rows || rows.length === 0) {
    return `Comunicado \`${idValue}\` não encontrado ou já foi aprovado/rejeitado.`;
  }

  const ann = rows[0];

  if (ann.created_by === collaborator.id) {
    return 'Você não pode aprovar seu próprio comunicado.';
  }

  if (parsed.action === 'approve') {
    const { error: updErr } = await supabase
      .from('announcements')
      .update({
        status: 'scheduled',
        reviewed_by: collaborator.id,
      })
      .eq('id', ann.id);

    if (updErr) {
      console.error('[applyAnnouncementApproval] erro UPDATE approve:', updErr.message);
      return 'Erro ao aprovar o comunicado.';
    }

    // Criar announcement_jobs agora que o comunicado foi aprovado
    const jobsCreated = await createAnnouncementJobs(ann);

    // Notificar coordinator imediatamente (estamos no engine, temos whatsapp)
    await notifyCoordinatorOfDecision(ann, collaborator, 'approve', null);

    return `Comunicado \`${idValue}\` aprovado. ${jobsCreated} mensagem(ns) na fila de envio.`;
  }

  if (parsed.action === 'reject') {
    const reason = parsed.reason || null;
    const { error: updErr } = await supabase
      .from('announcements')
      .update({
        status: 'rejected',
        reviewed_by: collaborator.id,
        rejection_reason: reason,
      })
      .eq('id', ann.id);

    if (updErr) {
      console.error('[applyAnnouncementApproval] erro UPDATE reject:', updErr.message);
      return 'Erro ao rejeitar o comunicado.';
    }

    await notifyCoordinatorOfDecision(ann, collaborator, 'reject', reason);

    return `Comunicado \`${idValue}\` rejeitado. Coordinator foi notificado.`;
  }

  return 'Ação inválida.';
}
```

- [ ] **Step 3: Add helper `createAnnouncementJobs(ann)` — extract from existing applyAnnouncementAction logic**

The current `applyAnnouncementAction` (Fatia 1) inserts `announcement_jobs` after creating the announcement. Extract that logic into a reusable function. Look for the block in `applyAnnouncementAction` that:
1. Queries `collaborators` filtered by `audience` (function_role / unidade / turno / all)
2. Inserts one row per recipient into `announcement_jobs`

Move that into:

```js
async function createAnnouncementJobs(ann) {
  // Build collaborators query from ann.audience
  let q = supabase.from('collaborators').select('id, phone').not('phone', 'is', null);

  const aud = ann.audience || {};
  if (aud.all === true) {
    // no extra filter
  } else {
    if (Array.isArray(aud.function_role) && aud.function_role.length) {
      q = q.in('role', aud.function_role);
    }
    if (Array.isArray(aud.unidade) && aud.unidade.length) {
      q = q.in('unit', aud.unidade);
    }
    if (Array.isArray(aud.turno) && aud.turno.length) {
      q = q.in('shift', aud.turno);
    }
  }

  const { data: recipients, error: recErr } = await q;
  if (recErr) {
    console.error('[createAnnouncementJobs] erro buscando recipients:', recErr.message);
    return 0;
  }
  if (!recipients || recipients.length === 0) {
    // sem recipients → broadcaster vai marcar como sent automaticamente
    return 0;
  }

  const jobs = recipients.map(r => ({
    announcement_id: ann.id,
    recipient_id: r.id,
    phone: r.phone,
    status: 'pending',
    retry_count: 0,
  }));

  const { error: jobErr } = await supabase.from('announcement_jobs').insert(jobs);
  if (jobErr) {
    console.error('[createAnnouncementJobs] erro INSERT jobs:', jobErr.message);
    return 0;
  }
  return jobs.length;
}
```

Then refactor `applyAnnouncementAction` (the director branch) to call `createAnnouncementJobs(ann)` instead of inlining the logic. Keep the compensating delete pattern: if `createAnnouncementJobs` returns `0` AND there was an error, delete the announcement to avoid orphans. (If it returns 0 with no error — empty audience — leave the announcement; broadcaster handles it.)

To distinguish error from empty audience, change `createAnnouncementJobs` to return an object: `{ count, error }`:

```js
async function createAnnouncementJobs(ann) {
  // ... same query ...
  const { data: recipients, error: recErr } = await q;
  if (recErr) return { count: 0, error: recErr.message };
  if (!recipients || recipients.length === 0) return { count: 0, error: null };

  const jobs = recipients.map(r => ({ /* same */ }));
  const { error: jobErr } = await supabase.from('announcement_jobs').insert(jobs);
  if (jobErr) return { count: 0, error: jobErr.message };
  return { count: jobs.length, error: null };
}
```

Update both callers (`applyAnnouncementAction` director branch and `applyAnnouncementApproval` approve branch) accordingly. In the director branch, on error, do compensating delete:

```js
const { count, error: jobsCreateErr } = await createAnnouncementJobs(ann);
if (jobsCreateErr) {
  await supabase.from('announcements').delete().eq('id', ann.id);
  return `Erro ao criar fila de envio: ${jobsCreateErr}. Comunicado descartado.`;
}
```

In the approve branch (Step 2), the announcement already exists and was approved; if jobs creation fails, log error but keep announcement (it can be retried manually). Use the result to log:

```js
const jobsResult = await createAnnouncementJobs(ann);
if (jobsResult.error) {
  console.error('[applyAnnouncementApproval] erro criando jobs após aprovação:', jobsResult.error);
}
const jobsCreated = jobsResult.count;
```

- [ ] **Step 4: Add helper `notifyCoordinatorOfDecision(ann, director, action, reason)`**

Add to `src/engine.js`:

```js
async function notifyCoordinatorOfDecision(ann, director, action, reason) {
  const { data: coord, error } = await supabase
    .from('collaborators')
    .select('phone, full_name')
    .eq('id', ann.created_by)
    .single();
  if (error || !coord || !coord.phone) {
    console.warn('[notifyCoordinatorOfDecision] coordinator sem phone, pulando notificação');
    return;
  }

  let msg;
  if (action === 'approve') {
    msg = `✅ Seu comunicado foi aprovado por ${director.full_name} e será enviado em breve.`;
  } else {
    const motivoStr = reason ? `Motivo: "${reason}"` : 'Sem motivo informado.';
    msg = `❌ Seu comunicado foi rejeitado por ${director.full_name}. ${motivoStr}`;
  }

  try {
    await whatsapp.sendMessage(coord.phone, msg);
    // Marcar como notificado
    await supabase
      .from('announcements')
      .update({ coordinator_notified_at: new Date().toISOString() })
      .eq('id', ann.id);
  } catch (err) {
    console.error('[notifyCoordinatorOfDecision] erro enviando WhatsApp:', err.message);
  }
}
```

- [ ] **Step 5: Wire into the message processing pipeline**

Find `processMessage` in `src/engine.js`. There's an existing block that handles `<<ANNOUNCEMENT_ACTION>>` (around line 2438) and `<<SCHOOL_EVENT_ACTION>>` (around line 2642). The pattern is:

```js
const annMarker = parseAnnouncementActionMarker(assistantText);
if (annMarker) {
  const result = await applyAnnouncementAction(collaborator, annMarker);
  // append result to response
}
```

Add an analogous block immediately after the existing `<<ANNOUNCEMENT_ACTION>>` handler (or after `<<SCHOOL_EVENT_ACTION>>` — order doesn't matter for these three since they're mutually exclusive):

```js
const approvalMarker = parseAnnouncementApprovalMarker(assistantText);
if (approvalMarker) {
  const approvalResult = await applyAnnouncementApproval(collaborator, approvalMarker);
  // Append to response or replace assistant text per existing pattern
  // Follow the EXACT pattern used by the ANNOUNCEMENT_ACTION block above
}
```

Inspect the existing block to see how `result` is appended/returned and replicate that exactly. (May be `assistantText += '\n' + result` or returned as part of a final response — depends on the codebase pattern.)

- [ ] **Step 6: Smoke test approval flow**

Manual test from `D:\la-organizer\_remote`:

```
node -e "
const { parseAnnouncementApprovalMarker, applyAnnouncementApproval } = require('./src/engine');

// Parse test
const m = parseAnnouncementApprovalMarker('texto antes <<ANNOUNCEMENT_APPROVAL>>{\"action\":\"approve\",\"announcement_id\":\"abc1\"}<<END>> texto depois');
console.log('Parsed:', m);

// Reject with reason
const m2 = parseAnnouncementApprovalMarker('<<ANNOUNCEMENT_APPROVAL>>{\"action\":\"reject\",\"announcement_id\":\"abc1\",\"reason\":\"texto longo\"}<<END>>');
console.log('Parsed reject:', m2);

// Invalid
const m3 = parseAnnouncementApprovalMarker('<<ANNOUNCEMENT_APPROVAL>>{\"action\":\"foo\"}<<END>>');
console.log('Parsed invalid:', m3);
"
```

Expected:
```
Parsed: { action: 'approve', announcement_id: 'abc1', reason: null }
Parsed reject: { action: 'reject', announcement_id: 'abc1', reason: 'texto longo' }
Parsed invalid: null
```

- [ ] **Step 7: End-to-end test approval**

Pre-condition: there's an announcement in DB with `status='pending_approval'`, `created_by` = some coordinator. Use the smoke test from Task 3 Step 5 to create one if needed.

Get the short ID:
```sql
SELECT substr(id::text, 1, 4) AS short_id, id FROM announcements WHERE status='pending_approval' ORDER BY created_at DESC LIMIT 1;
```

Run:
```
node -e "
const { applyAnnouncementApproval } = require('./src/engine');
const director = { id: 'REPLACE-WITH-DIRECTOR-UUID', role: 'director', full_name: 'Director Test' };
applyAnnouncementApproval(director, { action: 'approve', announcement_id: 'XXXX', reason: null }).then(r => console.log('RESULT:', r));
"
```

Replace `XXXX` with the short ID from the SELECT. Expected log: "Comunicado `XXXX` aprovado. N mensagem(ns) na fila de envio."

Verify in DB:
```sql
SELECT status, reviewed_by, coordinator_notified_at FROM announcements WHERE substr(id::text, 1, 4) = 'XXXX';
```

Expected: `status='scheduled'`, `reviewed_by` = director's UUID. `coordinator_notified_at` may or may not be set depending on whether coordinator has phone (and whether WhatsApp send succeeded).

Cleanup test rows after.

---

## Task 5: Dispatcher — Notify Coordinators of PWA Decisions

**Files:**
- Modify: `D:\la-organizer\_remote\src\rituals\dispatcher.js`

**Context:** When a director approves/rejects via PWA, the engine isn't involved — only Supabase is updated. The dispatcher cron (which already runs every minute) needs to detect those rows and send the WhatsApp notification.

- [ ] **Step 1: Add `notifyCoordinators(whatsapp)` function**

In `D:\la-organizer\_remote\src\rituals\dispatcher.js`, near the existing `dispatchAnnouncements` function (around line 417), add:

```js
async function notifyCoordinators(whatsapp) {
  // Find announcements where director already reviewed (via PWA) and coordinator hasn't been notified
  const { data: rows, error } = await supabase
    .from('announcements')
    .select(`
      id, status, created_by, reviewed_by, rejection_reason,
      author:collaborators!created_by(id, full_name, phone),
      reviewer:collaborators!reviewed_by(id, full_name)
    `)
    .in('status', ['scheduled', 'rejected'])
    .not('reviewed_by', 'is', null)
    .is('coordinator_notified_at', null)
    .limit(20);

  if (error) {
    console.error('[notifyCoordinators] erro buscando:', error.message);
    return;
  }
  if (!rows || rows.length === 0) return;

  for (const ann of rows) {
    const author = ann.author;
    const reviewer = ann.reviewer;
    if (!author?.phone) {
      // Sem phone — só marca como notificado para não tentar de novo
      await supabase
        .from('announcements')
        .update({ coordinator_notified_at: new Date().toISOString() })
        .eq('id', ann.id);
      continue;
    }

    let msg;
    if (ann.status === 'scheduled') {
      msg = `✅ Seu comunicado foi aprovado${reviewer?.full_name ? ' por ' + reviewer.full_name : ''} e será enviado em breve.`;
    } else {
      const motivoStr = ann.rejection_reason ? `Motivo: "${ann.rejection_reason}"` : 'Sem motivo informado.';
      msg = `❌ Seu comunicado foi rejeitado${reviewer?.full_name ? ' por ' + reviewer.full_name : ''}. ${motivoStr}`;
    }

    try {
      await whatsapp.sendMessage(author.phone, msg);
      await supabase
        .from('announcements')
        .update({ coordinator_notified_at: new Date().toISOString() })
        .eq('id', ann.id);
    } catch (err) {
      console.error(`[notifyCoordinators] falha enviando para ${author.phone}:`, err.message);
      // Não marca como notificado — tenta de novo no próximo tick
    }
  }
}
```

- [ ] **Step 2: For approval-via-PWA, also create announcement_jobs**

The PWA UPDATE only changes status. Jobs need to be created for `scheduled` announcements that don't have any. Update `notifyCoordinators` to also handle this:

After confirming `ann.status === 'scheduled'` and successfully notifying the coordinator, check whether jobs exist; if not, create them. Add this block before the WhatsApp send (or after — order doesn't strictly matter, but doing it before ensures jobs exist when broadcaster picks up):

```js
if (ann.status === 'scheduled') {
  // Verificar se já existem jobs (caso engine tenha criado durante approval via TOM)
  const { data: existingJobs, error: jobCheckErr } = await supabase
    .from('announcement_jobs')
    .select('id')
    .eq('announcement_id', ann.id)
    .limit(1);

  if (!jobCheckErr && (!existingJobs || existingJobs.length === 0)) {
    // Criar jobs (replicar lógica de createAnnouncementJobs do engine)
    const { data: fullAnn } = await supabase
      .from('announcements').select('audience').eq('id', ann.id).single();
    if (fullAnn) {
      await createJobsFromAudience(ann.id, fullAnn.audience);
    }
  }
}
```

And add the helper at the top of `dispatcher.js` (or in the same file near `notifyCoordinators`):

```js
async function createJobsFromAudience(announcementId, audience) {
  let q = supabase.from('collaborators').select('id, phone').not('phone', 'is', null);
  const aud = audience || {};
  if (aud.all !== true) {
    if (Array.isArray(aud.function_role) && aud.function_role.length) q = q.in('role', aud.function_role);
    if (Array.isArray(aud.unidade) && aud.unidade.length) q = q.in('unit', aud.unidade);
    if (Array.isArray(aud.turno) && aud.turno.length) q = q.in('shift', aud.turno);
  }
  const { data: recipients, error } = await q;
  if (error || !recipients || recipients.length === 0) return 0;
  const jobs = recipients.map(r => ({
    announcement_id: announcementId,
    recipient_id: r.id,
    phone: r.phone,
    status: 'pending',
    retry_count: 0,
  }));
  const { error: jobErr } = await supabase.from('announcement_jobs').insert(jobs);
  return jobErr ? 0 : jobs.length;
}
```

- [ ] **Step 3: Wire `notifyCoordinators` into `run()`**

Find the `run()` function in `dispatcher.js` (around line 648). It already calls `dispatchChecklists`, `dispatchAnnouncements`, `handleCancellations`. Add `notifyCoordinators` call BEFORE `dispatchAnnouncements` (so jobs exist before dispatch picks them up):

```js
async function run(now = new Date()) {
  try {
    await dispatchChecklists(now);
    await notifyCoordinators(whatsapp);   // <-- NEW
    await handleCancellations(whatsapp);
    await dispatchAnnouncements(now);
  } catch (err) {
    console.error('[dispatcher.run] erro:', err);
  }
}
```

(Adjust the exact existing call order to match what's currently there — keep the existing functions in the same order, just add `notifyCoordinators` before `dispatchAnnouncements`.)

- [ ] **Step 4: Export the new function**

At the bottom of `dispatcher.js`, find `module.exports = { ... }` and add `notifyCoordinators`:

```js
module.exports = { run, dispatchChecklists, dispatchAnnouncements, handleCancellations, notifyCoordinators };
```

- [ ] **Step 5: Smoke test the dispatcher**

Pre-condition: create a test row simulating a PWA approval:

```sql
-- Use real coordinator + director UUIDs from your collaborators table
INSERT INTO announcements (id, body, audience, status, created_by, reviewed_by, scheduled_at)
VALUES (
  gen_random_uuid(),
  'Smoke test fatia 3 PWA approval',
  '{"all": true}'::jsonb,
  'scheduled',
  'COORDINATOR-UUID-HERE',
  'DIRECTOR-UUID-HERE',
  NULL
)
RETURNING id;
```

Then run from `D:\la-organizer\_remote`:

```
node -e "
const { notifyCoordinators } = require('./src/rituals/dispatcher');
const whatsapp = { sendMessage: async (phone, msg) => { console.log('WOULD SEND TO', phone, ':', msg); } };
notifyCoordinators(whatsapp).then(() => console.log('done'));
"
```

Expected:
- Log line: `WOULD SEND TO <coordinator-phone>: ✅ Seu comunicado foi aprovado por <director-name> e será enviado em breve.`
- Log line: `done`

Verify DB:
```sql
SELECT id, status, coordinator_notified_at FROM announcements WHERE body = 'Smoke test fatia 3 PWA approval';
SELECT count(*) FROM announcement_jobs WHERE announcement_id = (SELECT id FROM announcements WHERE body = 'Smoke test fatia 3 PWA approval');
```

Expected: `coordinator_notified_at` is set; jobs count > 0 (assuming there are collaborators with phone in the DB).

Cleanup:
```sql
DELETE FROM announcement_jobs WHERE announcement_id = (SELECT id FROM announcements WHERE body = 'Smoke test fatia 3 PWA approval');
DELETE FROM announcements WHERE body = 'Smoke test fatia 3 PWA approval';
```

---

## Task 6: PWA — Type Extensions

**Files:**
- Modify: `D:\la-organizer\_remote\web\src\types.ts`

- [ ] **Step 1: Extend `Announcement` interface**

Find the existing `Announcement` interface in `types.ts` (around line 255). Add the new fields:

```ts
export interface Announcement {
  id: string;
  created_by: string;
  body: string;
  audience: AnnouncementAudience;
  status: 'pending_approval' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'rejected';
  scheduled_at: string | null;
  cancel_retraction_sent: boolean;
  source_event_id: string | null;
  reviewed_by: string | null;            // NEW
  rejection_reason: string | null;       // NEW
  coordinator_notified_at: string | null; // NEW
  created_at: string;
  updated_at: string;
}
```

(Keep all existing fields exactly as they are — only add the three new fields.)

- [ ] **Step 2: Add `AnnouncementWithMetrics` and `ApprovalAction`**

Append at the end of `types.ts`:

```ts
export interface AnnouncementWithMetrics extends Announcement {
  author_name: string | null;
  reviewer_name: string | null;
  jobs_total: number;
  jobs_sent: number;
  jobs_failed: number;
  jobs_cancelled: number;
  jobs_pending: number;
}

export type ApprovalAction = 'approve' | 'reject';

/**
 * Detect duplicate-risk announcements: returns the IDs of announcements that share
 * audience-overlap with another active announcement created on the same calendar day.
 */
export function detectDuplicates(items: Announcement[]): Set<string> {
  const dupSet = new Set<string>();
  const active = items.filter(a => ['pending_approval', 'scheduled', 'sending'].includes(a.status));
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j];
      const sameDay = a.created_at.slice(0, 10) === b.created_at.slice(0, 10);
      if (!sameDay) continue;
      if (audienceOverlap(a.audience, b.audience)) {
        dupSet.add(a.id);
        dupSet.add(b.id);
      }
    }
  }
  return dupSet;
}

function audienceOverlap(x: AnnouncementAudience, y: AnnouncementAudience): boolean {
  if (x.all === true || y.all === true) return true;
  const inter = (a?: string[], b?: string[]) =>
    a && b && a.some(v => b.includes(v));
  if (inter(x.function_role, y.function_role)) return true;
  if (inter(x.unidade, y.unidade)) return true;
  if (inter(x.turno, y.turno)) return true;
  return false;
}

/**
 * Format "há X min/h/d" relative to now.
 */
export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'agora mesmo';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

/**
 * Format announcement status for display.
 */
export function statusLabel(s: Announcement['status']): string {
  const map: Record<Announcement['status'], string> = {
    pending_approval: 'Aguardando aprovação',
    scheduled: 'Agendado',
    sending: 'Enviando',
    sent: 'Enviado',
    cancelled: 'Cancelado',
    rejected: 'Rejeitado',
  };
  return map[s];
}
```

- [ ] **Step 3: Type-check**

From `D:\la-organizer\_remote\web`:

```
npm run build
```

Expected: build succeeds, no type errors. If `tsc` errors mention missing fields, ensure no other file uses the old `Announcement` shape strictly.

---

## Task 7: PWA — `AprovacaoSheet.tsx` Component

**Files:**
- Create: `D:\la-organizer\_remote\web\src\components\AprovacaoSheet.tsx`

- [ ] **Step 1: Create the component**

Write to `D:\la-organizer\_remote\web\src\components\AprovacaoSheet.tsx`:

```tsx
import { useState } from 'react';
import { BottomSheet } from './BottomSheet';
import type { Announcement } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  announcement: Announcement | null;
  onConfirm: (reason: string | null) => Promise<void>;
}

export function AprovacaoSheet({ open, onClose, announcement, onConfirm }: Props) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleConfirm = async () => {
    setErr(null);
    setSubmitting(true);
    try {
      await onConfirm(reason.trim() || null);
      setReason('');
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? 'Erro ao rejeitar.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (submitting) return;
    setReason('');
    setErr(null);
    onClose();
  };

  if (!announcement) return null;

  const preview = announcement.body.length > 120
    ? announcement.body.slice(0, 120) + '...'
    : announcement.body;

  return (
    <BottomSheet open={open} onClose={handleClose} title="Rejeitar comunicado">
      <div className="space-y-md">
        <div className="text-body-sm text-fg-muted">
          Comunicado de <strong>{announcement.created_by.slice(0, 8)}</strong>:
        </div>
        <div className="surface p-md text-body-sm">"{preview}"</div>

        <label className="block">
          <span className="text-body-sm text-fg-muted">Motivo da rejeição (opcional)</span>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            placeholder="ex: texto muito longo, horário errado..."
            className="mt-1 w-full bg-bg-elevated border border-border rounded-sm p-md text-body-md focus:border-brand focus-ring"
            disabled={submitting}
          />
        </label>

        {err && <div className="text-body-sm text-danger">{err}</div>}

        <div className="flex gap-md justify-end">
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            className="h-9 px-3 rounded-sm bg-bg-elevated border border-border text-body-sm focus-ring"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="h-9 px-3 rounded-sm bg-danger/10 border border-danger/40 text-danger text-body-sm focus-ring"
          >
            {submitting ? 'Rejeitando...' : 'Confirmar rejeição'}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
```

- [ ] **Step 2: Type-check**

From `D:\la-organizer\_remote\web`:
```
npm run build
```
Expected: build succeeds.

---

## Task 8: PWA — `Observabilidade.tsx` Screen

**Files:**
- Create: `D:\la-organizer\_remote\web\src\screens\Observabilidade.tsx`

- [ ] **Step 1: Create the screen**

Write to `D:\la-organizer\_remote\web\src\screens\Observabilidade.tsx`:

```tsx
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { AprovacaoSheet } from '../components/AprovacaoSheet';
import {
  audienceLabel,
  detectDuplicates,
  timeAgo,
  statusLabel,
  type Announcement,
  type AnnouncementWithMetrics,
} from '../types';

type RawRow = Announcement & {
  author?: { id: string; full_name: string | null } | null;
  reviewer?: { id: string; full_name: string | null } | null;
  jobs?: { status: string }[];
};

function aggregateJobs(rows: RawRow[]): AnnouncementWithMetrics[] {
  return rows.map(r => {
    const jobs = r.jobs ?? [];
    return {
      ...r,
      author_name: r.author?.full_name ?? null,
      reviewer_name: r.reviewer?.full_name ?? null,
      jobs_total: jobs.length,
      jobs_sent: jobs.filter(j => j.status === 'sent').length,
      jobs_failed: jobs.filter(j => j.status === 'failed').length,
      jobs_cancelled: jobs.filter(j => j.status === 'cancelled').length,
      jobs_pending: jobs.filter(j => j.status === 'pending').length,
    };
  });
}

export function Observabilidade() {
  const { collaborator, role } = useAuth();
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState<Announcement | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const isDirector = role === 'director';

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['observabilidade'],
    queryFn: async (): Promise<AnnouncementWithMetrics[]> => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString();
      const { data, error } = await supabase
        .from('announcements')
        .select(`
          *,
          author:collaborators!created_by(id, full_name),
          reviewer:collaborators!reviewed_by(id, full_name),
          jobs:announcement_jobs(status)
        `)
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return aggregateJobs((data ?? []) as RawRow[]);
    },
    refetchInterval: 15_000,
  });

  const approveMut = useMutation({
    mutationFn: async (announcementId: string) => {
      if (!collaborator?.id) throw new Error('Sem sessão');
      await supabase.rpc('set_config', { key: 'app.current_user_id', value: collaborator.id });
      const { error } = await supabase
        .from('announcements')
        .update({ status: 'scheduled', reviewed_by: collaborator.id })
        .eq('id', announcementId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['observabilidade'] }),
    onError: (e: any) => setActionError(e?.message ?? 'Erro ao aprovar.'),
  });

  const rejectMut = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string | null }) => {
      if (!collaborator?.id) throw new Error('Sem sessão');
      await supabase.rpc('set_config', { key: 'app.current_user_id', value: collaborator.id });
      const { error } = await supabase
        .from('announcements')
        .update({
          status: 'rejected',
          reviewed_by: collaborator.id,
          rejection_reason: reason,
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['observabilidade'] }),
    onError: (e: any) => setActionError(e?.message ?? 'Erro ao rejeitar.'),
  });

  const pending = items.filter(a => a.status === 'pending_approval');
  const live = items.filter(a => a.status === 'sending' || a.status === 'scheduled');
  const history = items.filter(
    a => !['pending_approval', 'scheduled', 'sending'].includes(a.status),
  );
  const duplicateIds = useMemo(() => detectDuplicates(items), [items]);

  return (
    <div className="space-y-lg">
      <header>
        <h2 className="text-section-title">Observabilidade</h2>
        <p className="text-body-sm text-fg-muted mt-1">
          Aprovações pendentes · fila ao vivo · histórico de envios
        </p>
      </header>

      {duplicateIds.size > 0 && (
        <div className="surface p-md border border-warning bg-warning/10 text-body-sm">
          ⚠️ Atenção: há {duplicateIds.size} comunicado(s) ativo(s) para o mesmo público hoje.
          Verifique antes de aprovar para evitar duplicidade.
        </div>
      )}

      {actionError && (
        <div className="surface p-md border border-danger bg-danger/10 text-body-sm text-danger">
          {actionError}
          <button onClick={() => setActionError(null)} className="ml-2 underline">fechar</button>
        </div>
      )}

      {/* Bloco 1 — Fila de aprovação */}
      <section>
        <h3 className="text-body-md font-medium mb-md">Fila de aprovação</h3>
        {isLoading ? (
          <div className="text-body-sm text-fg-muted">Carregando...</div>
        ) : pending.length === 0 ? (
          <div className="surface p-md text-body-sm text-fg-muted">
            Nenhum comunicado aguardando aprovação.
          </div>
        ) : (
          <ul className="space-y-md">
            {pending.map(a => (
              <li key={a.id} className={`surface p-md ${duplicateIds.has(a.id) ? 'border-warning' : ''}`}>
                <div className="flex items-start justify-between gap-md">
                  <div className="flex-1 min-w-0">
                    <div className="text-body-sm text-fg-muted">
                      {a.author_name ?? 'desconhecido'} · {audienceLabel(a.audience)} · {timeAgo(a.created_at)}
                    </div>
                    <div className="text-body-md mt-1 break-words">
                      {a.body.length > 200 ? a.body.slice(0, 200) + '...' : a.body}
                    </div>
                  </div>
                  {isDirector ? (
                    <div className="flex flex-col gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => approveMut.mutate(a.id)}
                        disabled={approveMut.isPending}
                        className="h-8 px-3 rounded-sm bg-success/10 border border-success/40 text-success text-body-sm focus-ring"
                      >
                        ✅ Aprovar
                      </button>
                      <button
                        type="button"
                        onClick={() => setRejecting(a)}
                        className="h-8 px-3 rounded-sm bg-danger/10 border border-danger/40 text-danger text-body-sm focus-ring"
                      >
                        ❌ Rejeitar
                      </button>
                    </div>
                  ) : (
                    <span className="text-body-sm text-fg-muted shrink-0">Aguardando director</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Bloco 2 — Fila ao vivo */}
      {live.length > 0 && (
        <section>
          <h3 className="text-body-md font-medium mb-md">Fila ao vivo</h3>
          <ul className="space-y-md">
            {live.map(a => (
              <li key={a.id} className="surface p-md">
                <div className="text-body-sm text-fg-muted">
                  {statusLabel(a.status)} · {audienceLabel(a.audience)}
                  {a.scheduled_at && a.status === 'scheduled' && (
                    <> · agendado para {new Date(a.scheduled_at).toLocaleString('pt-BR')}</>
                  )}
                </div>
                <div className="text-body-md mt-1 break-words">
                  {a.body.length > 120 ? a.body.slice(0, 120) + '...' : a.body}
                </div>
                {a.status === 'sending' && a.jobs_total > 0 && (
                  <div className="mt-2 text-body-sm">
                    <div className="text-fg-muted">{a.jobs_sent} de {a.jobs_total} enviados</div>
                    <div className="h-1 bg-bg-elevated rounded-sm mt-1 overflow-hidden">
                      <div
                        className="h-full bg-brand transition-all"
                        style={{ width: `${(a.jobs_sent / a.jobs_total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Bloco 3 — Histórico recente */}
      <section>
        <h3 className="text-body-md font-medium mb-md">Histórico (últimos 30 dias)</h3>
        {history.length === 0 ? (
          <div className="surface p-md text-body-sm text-fg-muted">
            Nenhum comunicado finalizado nos últimos 30 dias.
          </div>
        ) : (
          <ul className="space-y-md">
            {history.map(a => (
              <li key={a.id} className="surface p-md">
                <div className="flex items-center justify-between gap-md">
                  <div className="flex-1 min-w-0">
                    <div className="text-body-sm text-fg-muted">
                      {statusLabel(a.status)} · {audienceLabel(a.audience)} · {new Date(a.created_at).toLocaleString('pt-BR')}
                    </div>
                    <div className="text-body-md mt-1 truncate">{a.body}</div>
                    {a.status === 'rejected' && a.rejection_reason && (
                      <div className="text-body-sm text-fg-muted italic mt-1">
                        Motivo: {a.rejection_reason}
                      </div>
                    )}
                  </div>
                  {a.status === 'sent' && (
                    <div className="text-body-sm text-fg-muted shrink-0 text-right">
                      {a.jobs_sent} env / {a.jobs_failed} falh / {a.jobs_cancelled} canc
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AprovacaoSheet
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        announcement={rejecting}
        onConfirm={async (reason) => {
          if (!rejecting) return;
          await rejectMut.mutateAsync({ id: rejecting.id, reason });
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Add route in `App.tsx`**

Open `D:\la-organizer\_remote\web\src\App.tsx`. Add the import next to the other screen imports:

```tsx
import { Observabilidade } from './screens/Observabilidade';
```

Add the route inside the `<Route element={<AppShell />}>` block, alongside `mais/comunicados` and `mais/agenda-escolar`:

```tsx
<Route path="mais/observabilidade" element={<Observabilidade />} />
```

- [ ] **Step 3: Add menu item in `Mais.tsx`**

Open `D:\la-organizer\_remote\web\src\screens\Mais.tsx`. Add a new entry to the `items` array immediately after the `agenda-escolar` entry:

```ts
{ to: '/mais/observabilidade', label: 'Observabilidade', hint: 'Aprovações e métricas de envio', requireRoles: ['director', 'coordinator'] },
```

- [ ] **Step 4: Build the PWA**

From `D:\la-organizer\_remote\web`:

```
npm run build
```

Expected: build succeeds, dist/ contains references to `Observabilidade`.

Verify:
```
findstr /s "Observabilidade" dist\assets\*.js
```
Expected: at least one match.

- [ ] **Step 5: Visual smoke test**

Run `npm run dev` from `D:\la-organizer\_remote\web` and open `http://localhost:5173/mais` while logged in as a director or coordinator.

Expected:
- "Observabilidade" item appears in the Mais menu.
- Clicking it navigates to `/mais/observabilidade`.
- Tela carrega sem erros no console.
- Se houver `pending_approval` no DB, aparecem na fila com botões (se director) ou badge (se coordinator).
- Se houver duplicatas, banner amarelo aparece no topo.

If `pending_approval` rows don't exist, create a test row via SQL:

```sql
INSERT INTO announcements (body, audience, status, created_by)
VALUES ('Teste obs fatia 3', '{"all": true}'::jsonb, 'pending_approval', 'COORDINATOR-UUID');
```

Cleanup after visual test:
```sql
DELETE FROM announcements WHERE body = 'Teste obs fatia 3';
```

---

## Task 9: Final E2E Validation

**Goal:** Validate the complete flow end-to-end across TOM and PWA.

- [ ] **Step 1: Coordinator creates via PWA, director approves via PWA**

1. Login as coordinator on PWA.
2. Go to `/mais/comunicados`, create a new comunicado for `Escola toda` with a unique test body (e.g., `"E2E test {timestamp}"`).
3. Verify in DB:
   ```sql
   SELECT id, status, created_by FROM announcements WHERE body LIKE 'E2E test%' ORDER BY created_at DESC LIMIT 1;
   ```
   Expected: `status = 'pending_approval'`.
4. Logout. Login as director.
5. Go to `/mais/observabilidade`. The pending comunicado should appear.
6. Click ✅ Aprovar.
7. Verify in DB:
   ```sql
   SELECT status, reviewed_by FROM announcements WHERE body LIKE 'E2E test%';
   ```
   Expected: `status = 'scheduled'`, `reviewed_by` = director's UUID.
8. Wait for the next dispatcher tick (≤1 minute) and check:
   ```sql
   SELECT coordinator_notified_at FROM announcements WHERE body LIKE 'E2E test%';
   SELECT count(*) FROM announcement_jobs WHERE announcement_id = (SELECT id FROM announcements WHERE body LIKE 'E2E test%');
   ```
   Expected: `coordinator_notified_at` is set; jobs count > 0.
9. Cleanup:
   ```sql
   DELETE FROM announcement_jobs WHERE announcement_id IN (SELECT id FROM announcements WHERE body LIKE 'E2E test%');
   DELETE FROM announcements WHERE body LIKE 'E2E test%';
   ```

- [ ] **Step 2: Coordinator creates via PWA, director rejects via PWA with reason**

Same as Step 1, but:
- After step 6, click ❌ Rejeitar.
- Sheet appears. Type "texto muito longo" in the textarea.
- Click "Confirmar rejeição".
- Verify in DB:
  ```sql
  SELECT status, rejection_reason FROM announcements WHERE body LIKE 'E2E test%';
  ```
  Expected: `status = 'rejected'`, `rejection_reason = 'texto muito longo'`.
- Verify history block on PWA shows the comunicado with the rejection reason in italics.
- Cleanup as above.

- [ ] **Step 3: Director creates via PWA — bypasses approval**

1. Login as director.
2. Create a comunicado at `/mais/comunicados`.
3. Verify in DB: `status = 'scheduled'` immediately. NOT `pending_approval`.
4. Cleanup.

- [ ] **Step 4: TOM flow — coordinator creates, director responds via WhatsApp**

(Requires VPS to be running with TOM.)

1. As coordinator, send a message via WhatsApp: "Quero criar um comunicado: Reunião amanhã às 18h, para todos".
2. Confirm with TOM.
3. Director should receive a WhatsApp notification with the format:
   ```
   📋 Comunicado pendente de aprovação
   De: <coordinator name> (coordinator)
   ...
   ID: `XXXX`
   Responda: APROVAR XXXX ou REJEITAR XXXX [motivo]
   ```
4. Director responds: `APROVAR XXXX`.
5. Coordinator receives WhatsApp: `✅ Seu comunicado foi aprovado por <director name>...`.
6. Verify DB shows `status='scheduled'`, `reviewed_by` set, jobs created.
7. Cleanup if needed.

- [ ] **Step 5: Duplicate-detection alert visible**

1. Create 2 announcements with overlapping audiences on the same day:
   ```sql
   INSERT INTO announcements (body, audience, status, created_by)
   VALUES
     ('Dup test 1', '{"all": true}', 'pending_approval', 'COORD-UUID'),
     ('Dup test 2', '{"function_role": ["teacher"]}', 'scheduled', 'DIRECTOR-UUID');
   ```
2. Open `/mais/observabilidade`. The yellow warning banner should display.
3. Cleanup:
   ```sql
   DELETE FROM announcements WHERE body LIKE 'Dup test%';
   ```

- [ ] **Step 6: Self-approval is blocked**

1. As coordinator, create a comunicado.
2. (Edge case — coordinator shouldn't be able to do this from PWA since there's no approve button for them, but verify the engine blocks it anyway.) From the same coordinator account in TOM, send: `APROVAR XXXX` referring to your own announcement.
3. Expected: TOM responds "Você não pode aprovar seu próprio comunicado."

---

## Self-Review Notes

**Spec coverage:**
- ✅ Schema migration (Task 1)
- ✅ State machine `pending_approval`/`rejected` (Task 1)
- ✅ Coordinator creates → notify directors (Task 3)
- ✅ Director approves/rejects via TOM (Task 4)
- ✅ Director approves/rejects via PWA (Task 8)
- ✅ Coordinator notified via WhatsApp (TOM path: Task 4 step 4; PWA path: Task 5)
- ✅ TOM skill (Task 2)
- ✅ Observabilidade screen with all 4 blocks (Task 8)
- ✅ AprovacaoSheet with optional reason (Task 7)
- ✅ Duplicate detection (Task 6 helper, Task 8 banner)
- ✅ Self-approval block (Task 4 + E2E Task 9 step 6)

**Type consistency:**
- `Announcement.status` includes `pending_approval` and `rejected` (Task 6)
- `applyAnnouncementApproval` uses `parsed.action`, `parsed.announcement_id`, `parsed.reason` — matches `parseAnnouncementApprovalMarker` output (Task 4)
- `notifyCoordinators` reads `coordinator_notified_at` — matches column added in Task 1

**Frequent commits:** This project doesn't have git initialized locally — commits happen on the VPS. The implementer should call out completion of each task in their summary; no `git commit` step is required.
