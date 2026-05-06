# Sprint 16 — Coordenação Conversacional via TOM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o TOM intermedeie comunicação entre colaboradores com hierarquia humana, rastreabilidade e timeout, criando uma camada de coordenação conversacional via WhatsApp.

**Architecture:** Nova entidade `coordination_requests` (não reutiliza tasks/notifications). Novo marker `<<COORDINATION_REQUEST>>` + `applyCoordinationRequestAction` no engine. Novo marker `<<COORDINATION_RESPONSE>>` + `applyCoordinationResponseAction`. Skill TOM nova `coordenacao-conversacional.md` carregada para todos os roles. Detecção de resposta via LLM hint (COORD_HINT) injetado no system prompt do recipient. Dispatcher block `checkCoordinationTimeouts` para alertas de prazo. Sem PWA no MVP.

**Tech Stack:** Supabase MCP (migration DDL), Node.js (engine.js + dispatcher.js), Markdown (skill TOM). Sem mudança em PWA neste MVP.

**Spec:** `docs/superpowers/specs/2026-05-03-sprint16-coordenacao-conversacional-design.md`

**Note:** Workflow obrigatório de deploy (estabelecido em Sprint 15):
1. Edit local em `D:/la-organizer/_remote/...`
2. Verificar com `node -c src/engine.js` ou `node -c src/rituals/dispatcher.js`
3. Clone temp do main, copy files, commit, push origin main (FONTE DA VERDADE)
4. `ssh tom "cd /opt/LA-Organizer && git pull && pm2 restart tom"`
5. Cleanup clone temp

NUNCA usar scp direto que cria divergência git silenciosa.

---

## Codebase Context

### Padrão de markers existente

Todo marker no engine segue exatamente:
```
<<MARKER_NAME>>
{ JSON payload }
<<END>>
```
**Nunca** `<</MARKER_NAME>>` — esse bug foi o que quebrou Sprint 15. Fechamento sempre `<<END>>`.

### Pipeline em `processMessage()` (engine.js linha 2695)

1. LLM gera `reply` com zero ou mais blocos marker
2. Engine executa cada bloco em sequência: `parseXxxMarker(reply)` → `applyXxxAction(collab, parsed)`
3. Cada bloco extrai seu `cleanText` (reply sem o marker) antes de executar
4. Resultado logado em `marker_logs` com status `executed` ou `rejected`
5. Após TODOS os parsers: catch-all strip de markers não reconhecidos (linha ~3190) — **qualquer marker novo que não tiver parser plumbed vaza cru para o usuário**. Este catch-all é crítico: COORDINATION_REQUEST e COORDINATION_RESPONSE **devem** ser plumbed na fatia 2/4 respectivamente.

### Funções helper reutilizáveis no engine.js

- `findCollaboratorByName(name)` (linha 1698) — lookup case-insensitive por primeiro nome; rejeita ambíguo; retorna `null` se não encontrado
- `logMarker(collabId, type, status, reason, raw)` — auditoria unificada
- `whatsapp.sendMessage(phone, body)` — do `require('./services/whatsapp')`
- `supabase` — do `require('./supabase/client')`

### Funções helper reutilizáveis no dispatcher.js

- `findCollaboratorById` — já existe; busca collab por UUID
- `nameForCollab(collab)` — retorna nome de exibição
- Bloco `run()` termina na linha 1044 (após `dispatchAnnouncements`); todos os blocos são `try/catch` independentes
- `module.exports` na linha 1565

### Padrão de parser (referência: `parseSchoolEventActionMarker`, linha 923)

```js
function parseXxxMarker(text) {
  if (!text) return null;
  const re = /<<MARKER_NAME>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  const cleanText = text.replace(re, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(m[1].trim());
  } catch (err) {
    logSchemaErr('MARKER_NAME', ['invalid_json: ' + err.message], m[1]);
    return { malformed: true, cleanText };
  }
  // validações de schema...
  return { ...parsed, cleanText };
}
```

### Padrão de bloco no pipeline (referência: `SCHOOL_EVENT_ACTION`, linhas 3074–3108)

```js
// Sprint N — <<MARKER_NAME>> — descrição
{
  const parsed = parseXxxMarker(reply);
  if (parsed && parsed.malformed) {
    console.warn('[XxxAction] WARN: malformed marker, dropping block');
    await logMarker(collab.id, 'MARKER_NAME', 'rejected', 'schema_invalid', null);
    reply = parsed.cleanText || reply;
  } else if (parsed) {
    const result = await applyXxxAction(collab, parsed);
    await logMarker(collab.id, 'MARKER_NAME',
      result.ok ? 'executed' : 'rejected',
      result.ok ? `detail=...` : result.reason, null);
    reply = parsed.cleanText || (result.replyText ?? reply);
  }
}
```

### DB helpers

- `current_collab_role()` — DB function que retorna role do user autenticado
- `current_collab_id()` — retorna UUID do collaborator autenticado
- `set_config('app.current_user_id', X)` — deve ser chamado antes de mutations que dependem de RLS
- Supabase project ID: `cesnbnrynvxvgdhfmaua`

### State machine de coordination_requests

```
pending → rejected_by_tom  (gating: INSERT com esse status, NÃO envia WhatsApp)
pending → sent             (engine: WhatsApp enviado + UPDATE)
sent    → responded        (engine in-message: recipient responde + LLM detecta)
sent    → timeout          (dispatcher: response_deadline expirado)
sent/pending → cancelled   (requester cancela — não implementado neste Sprint)
```

### Decisões fechadas (spec §5)

1. `read_at` — nullable, sem captura UAZAPI neste MVP
2. PWA Fatia 7 — fora do MVP
3. `collaborator` + followup → RECUSADO (INSERT rejected_by_tom, sem WhatsApp)
4. `parent_request_id` — incluir no schema desde já
5. Detecção de resposta — LLM via COORD_HINT (conservador, threshold na skill)
6. Coordinator → director — relay_literal/relay_assisted PERMITIDOS; followup BLOQUEADO

### Matriz de autorização (spec §2.4)

| requester_role | relay_literal | relay_assisted | followup |
|---|---|---|---|
| director | qualquer recipient | qualquer recipient | qualquer recipient |
| coordinator | qualquer collab ativo | qualquer collab ativo | qualquer collab ativo **exceto director** |
| manager | qualquer collab ativo | qualquer collab ativo | qualquer collab ativo **exceto director** |
| collaborator | qualquer collab ativo | qualquer collab ativo | **RECUSADO** |

---

## File Structure

**Criados:**
- `D:/la-organizer/_remote/skills/coordenacao-conversacional.md` — skill nova, carregada para todos os roles
- `supabase migration` — via MCP `apply_migration`, sem arquivo físico local

**Modificados:**
- `D:/la-organizer/_remote/src/engine.js` — 4 adições:
  1. `parseCoordinationRequestMarker()` — função parser (após linha 960)
  2. `applyCoordinationRequestAction()` — função apply (após o parser)
  3. `parseCoordinationResponseMarker()` + `applyCoordinationResponseAction()` — resposta do recipient (junto com os anteriores)
  4. Pipeline: bloco COORDINATION_REQUEST após SCHOOL_EVENT_ACTION (após linha 3108); bloco COORDINATION_RESPONSE antes de Memory save (antes linha 3174); COORD_HINT injection no início de processMessage (após collab lookup, antes do LLM)
  5. `module.exports` — adicionar `applyCoordinationRequestAction`
- `D:/la-organizer/_remote/src/rituals/dispatcher.js` — 2 adições:
  1. Função `checkCoordinationTimeouts()` (nova, após `checkDepartmentOperational`)
  2. Wire em `run()` após `checkDepartmentOperational` block (após linha 1036)
  3. `module.exports` linha 1565 — adicionar `checkCoordinationTimeouts`
- `D:/la-organizer/_remote/src/prompts/system.js` — 1 adição: loader da skill `coordenacao-conversacional.md` após marketing block (após linha 971)

---

## Task 1 — Fatia 1: Schema + RLS

**Objetivo:** Criar a tabela `coordination_requests` com RLS, indexes e trigger `updated_at`.

**Arquivos:**
- DB via MCP (sem arquivo físico local)

---

- [ ] **Step 1.1 — Aplicar migration via MCP**

Use `mcp__4c04bb52-f946-4fe8-85f6-b01d200f8c20__apply_migration` com:
- `project_id`: `cesnbnrynvxvgdhfmaua`
- `name`: `sprint16_coordination_requests`

SQL:
```sql
-- Sprint 16: Coordenação Conversacional via TOM
-- Tabela principal de coordenação mediada pelo TOM

CREATE TABLE coordination_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id          uuid NOT NULL REFERENCES collaborators(id),
  recipient_id          uuid NOT NULL REFERENCES collaborators(id),
  mode                  text NOT NULL
                          CHECK (mode IN ('relay_literal', 'relay_assisted', 'followup')),
  message_body          text NOT NULL,
  message_original      text,
  status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN (
                            'pending',
                            'sent',
                            'responded',
                            'timeout',
                            'cancelled',
                            'rejected_by_tom'
                          )),
  expects_response      boolean NOT NULL DEFAULT false,
  response_deadline     timestamptz,
  sent_at               timestamptz,
  read_at               timestamptz,
  responded_at          timestamptz,
  response_summary      text,
  recipient_message_id  uuid REFERENCES conversation_history(id),
  cancelled_at          timestamptz,
  cancelled_reason      text,
  parent_request_id     uuid REFERENCES coordination_requests(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Trigger updated_at (reutiliza padrão existente no projeto)
CREATE TRIGGER coordination_requests_updated_at
  BEFORE UPDATE ON coordination_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Índices
CREATE INDEX coord_req_recipient_status_idx
  ON coordination_requests(recipient_id, status);

CREATE INDEX coord_req_requester_created_idx
  ON coordination_requests(requester_id, created_at DESC);

CREATE INDEX coord_req_pending_response_idx
  ON coordination_requests(response_deadline)
  WHERE expects_response = true AND status = 'sent';

-- RLS
ALTER TABLE coordination_requests ENABLE ROW LEVEL SECURITY;

-- Director vê e faz tudo
CREATE POLICY coord_req_director_all ON coordination_requests
  FOR ALL USING (current_collab_role() = 'director');

-- Qualquer colaborador vê o que pediu (requester) E o que recebeu (recipient)
CREATE POLICY coord_req_collab_self ON coordination_requests
  FOR SELECT USING (
    current_collab_id() = requester_id
    OR current_collab_id() = recipient_id
  );

-- Colaborador pode criar (INSERT) apenas como requester
CREATE POLICY coord_req_collab_insert ON coordination_requests
  FOR INSERT WITH CHECK (current_collab_id() = requester_id);
```

- [ ] **Step 1.2 — Verificar tabela criada**

Use `mcp__4c04bb52-f946-4fe8-85f6-b01d200f8c20__execute_sql` com `project_id` `cesnbnrynvxvgdhfmaua`:

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'coordination_requests'
ORDER BY ordinal_position;
```

Esperado: 20 colunas, todas presentes, `parent_request_id` nullable.

- [ ] **Step 1.3 — Verificar indexes**

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'coordination_requests'
ORDER BY indexname;
```

Esperado: 4 indexes (pkey + 3 criados acima).

- [ ] **Step 1.4 — Verificar RLS policies**

```sql
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'coordination_requests'
ORDER BY policyname;
```

Esperado: 3 policies — `coord_req_director_all`, `coord_req_collab_self`, `coord_req_collab_insert`.

- [ ] **Step 1.5 — Smoke test RLS: INSERT como director (deve passar)**

```sql
-- Substitua os UUIDs por IDs reais de um director e um collaborator no banco
SELECT set_config('app.current_user_id',
  (SELECT id::text FROM collaborators WHERE role = 'director' LIMIT 1), true);

INSERT INTO coordination_requests (requester_id, recipient_id, mode, message_body)
SELECT
  (SELECT id FROM collaborators WHERE role = 'director' LIMIT 1),
  (SELECT id FROM collaborators WHERE role = 'collaborator' LIMIT 1),
  'relay_assisted',
  'Teste de smoke test Sprint 16'
RETURNING id, status;
```

Esperado: retorna row com `status = 'pending'`.

- [ ] **Step 1.6 — Smoke test RLS: SELECT cross-collab sem ser director (deve retornar 0 rows)**

```sql
-- Como um collaborator que NÃO é requester nem recipient do registro acima
SELECT set_config('app.current_user_id',
  (SELECT id::text FROM collaborators
   WHERE role = 'collaborator'
   ORDER BY created_at DESC LIMIT 1), true);

SELECT count(*) FROM coordination_requests;
-- Deve retornar 0 (só vê o que é seu)
```

- [ ] **Step 1.7 — Limpar registro de smoke test**

```sql
DELETE FROM coordination_requests WHERE message_body = 'Teste de smoke test Sprint 16';
```

- [ ] **Step 1.8 — Deploy**

Fatia 1 é só DB — sem arquivos locais para commitar. A migration já está aplicada no Supabase Cloud. Nenhum deploy de código necessário nesta fatia.

---

## Task 2 — Fatia 2: Engine — parser + apply + gating + pipeline

**Objetivo:** Implementar `parseCoordinationRequestMarker`, `applyCoordinationRequestAction` e wiring no pipeline de `processMessage`. Ao final desta fatia: director envia trigger → marker emitido → Rafinha recebe WhatsApp + registro em `coordination_requests`.

**Arquivos:**
- Modify: `D:/la-organizer/_remote/src/engine.js`

---

- [ ] **Step 2.1 — Inserir `parseCoordinationRequestMarker` após `applySchoolEventAction` (após linha 1112)**

Abra `engine.js`. Após o bloco `applySchoolEventAction` (que termina por volta da linha 1112), insira a função nova:

```js
// Sprint 16 — Marker <<COORDINATION_REQUEST>>.
// Emitido pelo TOM quando qualquer colaborador pede para repassar mensagem,
// avisar ou cobrar outro colaborador.
function parseCoordinationRequestMarker(text) {
  if (!text) return null;
  const re = /<<COORDINATION_REQUEST>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  const cleanText = text.replace(re, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(m[1].trim());
  } catch (err) {
    logSchemaErr('COORDINATION_REQUEST', ['invalid_json: ' + err.message], m[1]);
    return { malformed: true, cleanText };
  }
  if (!parsed || typeof parsed !== 'object') return { malformed: true, cleanText };
  if (!parsed.recipient_name || typeof parsed.recipient_name !== 'string') {
    logSchemaErr('COORDINATION_REQUEST', ['recipient_name:missing'], parsed);
    return { malformed: true, cleanText };
  }
  if (!['relay_literal', 'relay_assisted', 'followup'].includes(parsed.mode)) {
    logSchemaErr('COORDINATION_REQUEST', ['mode:invalid'], parsed);
    return { malformed: true, cleanText };
  }
  if (!parsed.message_body || typeof parsed.message_body !== 'string') {
    logSchemaErr('COORDINATION_REQUEST', ['message_body:missing'], parsed);
    return { malformed: true, cleanText };
  }
  return {
    recipient_name:           String(parsed.recipient_name).trim(),
    mode:                     parsed.mode,
    message_body:             String(parsed.message_body).trim(),
    message_original:         parsed.message_original ? String(parsed.message_original).trim() : null,
    expects_response:         Boolean(parsed.expects_response),
    response_deadline_hours:  parsed.response_deadline_hours ? Number(parsed.response_deadline_hours) : null,
    cleanText,
  };
}
```

Verificar que o arquivo ainda parseia limpo:
```
node -c D:/la-organizer/_remote/src/engine.js
```
Esperado: sem output (syntax OK).

- [ ] **Step 2.2 — Inserir função helper `_buildRecipientMessage` imediatamente após `parseCoordinationRequestMarker`**

Esta função centraliza os templates de UX §6 (regra não-negociável):

```js
// UX §6 — templates obrigatórios para mensagem ao recipient.
// NUNCA enviar mensagem sem cabeçalho de origem + indicação de modo.
function _buildRecipientMessage(requesterFirstName, mode, messageBody) {
  switch (mode) {
    case 'relay_literal':
      return `O ${requesterFirstName} pediu pra eu te repassar (literalmente):\n\n"${messageBody}"`;
    case 'relay_assisted':
      return `O ${requesterFirstName} me pediu pra te avisar:\n\n${messageBody}`;
    case 'followup':
      return `O ${requesterFirstName} me pediu pra te perguntar (e estou acompanhando tua resposta pra devolver pra ele/ela):\n\n${messageBody}`;
    default:
      return `O ${requesterFirstName} me pediu pra te avisar:\n\n${messageBody}`;
  }
}
```

```
node -c D:/la-organizer/_remote/src/engine.js
```

- [ ] **Step 2.3 — Inserir função helper `_requesterDisplayName` para resolver homônimos (spec §6 fallback)**

```js
// UX §6 — resolve nome de exibição do requester; usa function_title se houver.
function _requesterDisplayName(requester) {
  if (requester.function_title) {
    return `${requester.first_name || requester.full_name.split(' ')[0]} (${requester.function_title})`;
  }
  return requester.first_name || requester.full_name.split(' ')[0];
}
```

```
node -c D:/la-organizer/_remote/src/engine.js
```

- [ ] **Step 2.4 — Inserir `applyCoordinationRequestAction` após os helpers acima**

```js
// Sprint 16 — Executa coordination request: gating de autorização, INSERT, WhatsApp ao recipient.
//
// REGRA DE INSERÇÃO (Alf 2026-05-03):
//   NÃO inserir row em coordination_requests quando:
//     - recipient não encontrado (findCollaboratorByName retorna null)
//     - recipient inativo
//     - self-relay (collab tenta mandar pra si mesmo)
//   Esses casos são "tentativa frustrada de intenção" — auditoria fica em
//   marker_logs (escrita pelo pipeline via logMarker), não em coordination_requests.
//
//   INSERIR row com status='rejected_by_tom' quando:
//     - recipient existe E é ativo E é diferente do requester
//     - intenção foi compreendida
//     - alçada/proibição bloqueou (role_insufficient, cannot_followup_director)
//
//   Princípio: coordination_requests é a entidade de "interação mediada real ou recusada
//   por governança". Tentativas que sequer resolveram o destinatário pertencem ao log, não à entidade.
//
// State machine: pending → rejected_by_tom (auth falha em destinatário VÁLIDO, sem WhatsApp)
//                pending → sent (WhatsApp enviado, UPDATE)
async function applyCoordinationRequestAction(collab, parsed) {
  // 1. Lookup recipient — não cria row se falhar (audit fica em marker_logs)
  const recipient = await findCollaboratorByName(parsed.recipient_name);
  if (!recipient || !recipient.is_active) {
    return {
      ok: false,
      reason: 'recipient_not_found',
      replyText: `Não encontrei ninguém com o nome "${parsed.recipient_name}" ativo no sistema.`,
    };
  }

  // 2. Self-relay
  if (recipient.id === collab.id) {
    return {
      ok: false,
      reason: 'self_relay',
      replyText: 'Você quer mandar uma mensagem pra si mesmo? Isso não faz sentido — fala diretamente 😄',
    };
  }

  // 3. followup bloqueado para collaborator
  if (parsed.mode === 'followup' && collab.role === 'collaborator') {
    await supabase.from('coordination_requests').insert({
      requester_id: collab.id,
      recipient_id: recipient.id,
      mode: parsed.mode,
      message_body: parsed.message_body,
      message_original: parsed.message_original,
      status: 'rejected_by_tom',
      expects_response: parsed.expects_response,
      cancelled_reason: 'role_insufficient',
    });
    return {
      ok: false,
      reason: 'role_insufficient',
      replyText: `Não vou cobrar o ${recipient.first_name || recipient.full_name.split(' ')[0]} por você. Esse tipo de cobrança precisa vir do coordenador ou diretor. Quer que eu te ajude a formular para mandar pro teu coordenador?`,
    };
  }

  // 4. followup bloqueado: coordinator/manager → director
  if (
    parsed.mode === 'followup' &&
    ['coordinator', 'manager'].includes(collab.role) &&
    recipient.role === 'director'
  ) {
    await supabase.from('coordination_requests').insert({
      requester_id: collab.id,
      recipient_id: recipient.id,
      mode: parsed.mode,
      message_body: parsed.message_body,
      message_original: parsed.message_original,
      status: 'rejected_by_tom',
      expects_response: parsed.expects_response,
      cancelled_reason: 'cannot_followup_director',
    });
    return {
      ok: false,
      reason: 'cannot_followup_director',
      replyText: `Não é minha função cobrar o ${recipient.first_name || recipient.full_name.split(' ')[0]} por você — ele/ela é diretor/a. Você pode falar diretamente ou me pedir pra repassar um recado (relay).`,
    };
  }

  // 5. Calcular response_deadline
  let response_deadline = null;
  if (parsed.expects_response && parsed.response_deadline_hours) {
    response_deadline = new Date(
      Date.now() + parsed.response_deadline_hours * 60 * 60 * 1000
    ).toISOString();
  }

  // 6. INSERT com status='pending'
  const { data: inserted, error: insErr } = await supabase
    .from('coordination_requests')
    .insert({
      requester_id:           collab.id,
      recipient_id:           recipient.id,
      mode:                   parsed.mode,
      message_body:           parsed.message_body,
      message_original:       parsed.message_original,
      status:                 'pending',
      expects_response:       parsed.expects_response,
      response_deadline,
    })
    .select('id')
    .single();

  if (insErr) {
    console.error('[CoordinationRequest] insert err:', insErr.message);
    return { ok: false, reason: 'db_insert_error', replyText: 'Tive um erro ao registrar o recado. Tenta de novo?' };
  }

  // 7. Formatar e enviar WhatsApp ao recipient (UX §6)
  const requesterDisplayName = _requesterDisplayName(collab);
  const recipientMsg = _buildRecipientMessage(requesterDisplayName, parsed.mode, parsed.message_body);

  try {
    await whatsapp.sendMessage(recipient.phone, recipientMsg);
  } catch (sendErr) {
    console.error('[CoordinationRequest] sendMessage err:', sendErr.message);
    await supabase.from('coordination_requests')
      .update({ status: 'cancelled', cancelled_reason: 'send_failed', cancelled_at: new Date().toISOString() })
      .eq('id', inserted.id);
    return { ok: false, reason: 'send_failed', replyText: 'Não consegui enviar a mensagem pro WhatsApp do destinatário. Tenta de novo?' };
  }

  // 8. UPDATE status → 'sent'
  await supabase.from('coordination_requests')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', inserted.id);

  // 9. Reply ao requester
  const recipientFirstName = recipient.first_name || recipient.full_name.split(' ')[0];
  const shortId = inserted.id.slice(0, 4);
  const expectsNote = parsed.expects_response ? ' Te aviso quando ele/ela responder.' : '';
  return {
    ok: true,
    reason: `sent=${shortId} recipient=${recipientFirstName}`,
    replyText: `✓ Avisei o ${recipientFirstName}. [ID: ${shortId}]${expectsNote}`,
  };
}
```

```
node -c D:/la-organizer/_remote/src/engine.js
```

- [ ] **Step 2.5 — Inserir bloco COORDINATION_REQUEST no pipeline (após linha 3108, após SCHOOL_EVENT_ACTION)**

Localize a linha 3108 em engine.js (fim do bloco SCHOOL_EVENT_ACTION):
```
    reply = base || reply;
  }
}
```

Adicione imediatamente após:

```js
  // Sprint 16 — <<COORDINATION_REQUEST>> — repassar mensagem / cobrar / avisar outro colaborador.
  {
    const parsedCoord = parseCoordinationRequestMarker(reply);
    if (parsedCoord && parsedCoord.malformed) {
      console.warn('[CoordinationRequest] WARN: malformed marker, dropping block');
      await logMarker(collab.id, 'COORDINATION_REQUEST', 'rejected', 'schema_invalid', null);
      reply = parsedCoord.cleanText || reply;
    } else if (parsedCoord) {
      const result = await applyCoordinationRequestAction(collab, parsedCoord);
      await logMarker(
        collab.id,
        'COORDINATION_REQUEST',
        result.ok ? 'executed' : 'rejected',
        result.reason,
        null
      );
      reply = parsedCoord.cleanText || result.replyText || reply;
    }
  }
```

```
node -c D:/la-organizer/_remote/src/engine.js
```

- [ ] **Step 2.6 — Adicionar `applyCoordinationRequestAction` no `module.exports` (linha 3474)**

Localize a linha:
```js
module.exports = { processMessage, sendRitual, sendCoordinatorReport, buildTeamSummary, buildWeeklyRetrospective, parseOnboardingMarker, persistOnboarding, parseMemoryMarker, parseProjectMarker, parseTaskUpdateMarker, parseWeeklyPlanMarker, parseHabitMarker, parseDndMarker, persistMemoryRows, persistProject, applyTaskActions, applyWeeklyPlan, applyHabitActions, applyDnd, getDndState, consolidateMemoryFor, decayExpiredMemories, looksLikeMemory, resolveTaskByShortId, applyAnnouncementAction };
```

Adicione `applyCoordinationRequestAction` ao final do objeto (antes de `}`):

```js
module.exports = { processMessage, sendRitual, sendCoordinatorReport, buildTeamSummary, buildWeeklyRetrospective, parseOnboardingMarker, persistOnboarding, parseMemoryMarker, parseProjectMarker, parseTaskUpdateMarker, parseWeeklyPlanMarker, parseHabitMarker, parseDndMarker, persistMemoryRows, persistProject, applyTaskActions, applyWeeklyPlan, applyHabitActions, applyDnd, getDndState, consolidateMemoryFor, decayExpiredMemories, looksLikeMemory, resolveTaskByShortId, applyAnnouncementAction, applyCoordinationRequestAction };
```

```
node -c D:/la-organizer/_remote/src/engine.js
```

- [ ] **Step 2.7 — Smoke test manual Fatia 2**

No banco, via `execute_sql`, verificar o pipeline sem precisar de WhatsApp real:

```sql
-- Confirmar que a tabela recebe INSERT no status correto
-- (o smoke test real é E2E na Fatia 6; aqui só confirma o schema aceita os valores)
INSERT INTO coordination_requests (
  requester_id, recipient_id, mode, message_body, status, expects_response
)
SELECT
  (SELECT id FROM collaborators WHERE role = 'director' LIMIT 1),
  (SELECT id FROM collaborators WHERE role = 'collaborator' ORDER BY created_at LIMIT 1),
  'relay_assisted',
  'Teste Fatia 2 — schema aceita sent',
  'sent',
  false
RETURNING id, status, sent_at;
-- Limpar:
DELETE FROM coordination_requests WHERE message_body = 'Teste Fatia 2 — schema aceita sent';
```

- [ ] **Step 2.8 — Deploy Fatia 2**

```bash
# Na máquina local (D:/la-organizer/_remote já é o remote)
# 1. Verificar sintaxe
node -c src/engine.js

# 2. Clonar main em temp, copiar arquivo modificado, commitar e push
cd /tmp
git clone <repo-url> sprint16-f2-deploy
cp D:/la-organizer/_remote/src/engine.js sprint16-f2-deploy/src/engine.js
cd sprint16-f2-deploy
git add src/engine.js
git commit -m "feat(sprint16-f2): COORDINATION_REQUEST marker + applyCoordinationRequestAction + gating"
git push origin main

# 3. Deploy no VPS
ssh tom "cd /opt/LA-Organizer && git pull && pm2 restart tom"

# 4. Cleanup
cd /tmp && rm -rf sprint16-f2-deploy
```

---

## Task 3 — Fatia 3: Skill `coordenacao-conversacional.md` + loader system.js

**Objetivo:** Criar a skill que ensina o TOM a reconhecer pedidos de coordenação e emitir o marker correto. Carregada para TODOS os roles.

**Arquivos:**
- Create: `D:/la-organizer/_remote/skills/coordenacao-conversacional.md`
- Modify: `D:/la-organizer/_remote/src/prompts/system.js`

---

- [ ] **Step 3.1 — Criar `skills/coordenacao-conversacional.md`**

```markdown
# Skill: Coordenação Conversacional

Você pode intermediar comunicação entre colaboradores via WhatsApp — repassar recados, avisar alguém ou acompanhar uma resposta — sem precisar que o solicitante tenha o número da outra pessoa.

## Quando usar

Frases que ativam esta skill:
- "fala com X que...", "manda recado pro Y", "avisa o Z"
- "cobra a Anne", "pergunta pra X se Y"
- "manda exatamente isso pro Rafinha: ..."
- "se o Yuri não responder até 16h, me avisa"
- "transmite isso pros líderes"

## Modos disponíveis

| Modo | Quando usar | Exemplo |
|---|---|---|
| `relay_literal` | Usuário quer que você envie o texto verbatim ("manda exatamente isso") | "Tom, manda exatamente: 'preciso do relatório até sexta'" |
| `relay_assisted` | Usuário quer avisar mas não dita a mensagem — você parafraseia profissionalmente | "Tom, avisa o Yuri que preciso dos criativos até 16h" |
| `followup` | Usuário quer cobrança + monitoramento de resposta — você rastreia e avisa quando responderem | "Tom, cobra o Rafinha e me avisa se ele não responder" |

## Regras obrigatórias

1. **relay_literal**: preserve o texto `message_body` verbatim. Não reinterpretes. Não melhores o estilo.
2. **relay_assisted**: parafraseie para tom profissional, preserve a intenção. Preencha `message_original` com o que o usuário pediu.
3. **Ambíguo entre relay_literal e relay_assisted**: pergunte ao usuário ANTES de emitir o marker.
4. **followup**: somente emita se o usuário claramente quer monitoramento e aviso de resposta.
5. **response_deadline_hours**: infira do contexto ("até 16h" → calcule horas restantes; "até sexta" → horas até sexta 18h). Se não mencionado, omita (null).

## Regra-mãe de alçada (NÃO NEGOCIÁVEL)

- **collaborator** solicitando `followup` → RECUSE ANTES de emitir o marker. Diga: "Esse tipo de cobrança precisa vir do coordenador ou diretor. Posso te ajudar a formular para mandar pro teu coordenador?"
- **coordinator/manager** solicitando `followup` para **director** → RECUSE. Diga: "Não é minha função cobrar o/a diretor/a por você. Posso repassar um recado (relay) se quiser."
- Todos os outros casos: emita o marker normalmente.

## Marker a emitir

```
<<COORDINATION_REQUEST>>
{
  "recipient_name": "Rafinha",
  "mode": "relay_literal | relay_assisted | followup",
  "message_body": "texto exato que será enviado ao recipient",
  "message_original": "o que o requester pediu (preencher apenas em relay_assisted)",
  "expects_response": true,
  "response_deadline_hours": 4
}
<<END>>
```

**Campos obrigatórios:** `recipient_name`, `mode`, `message_body`
**Campos opcionais:** `message_original` (só relay_assisted), `expects_response` (default false), `response_deadline_hours` (só quando expects_response true)

## Mensagem ao recipient (para sua referência — o engine cuida do envio)

O TOM sempre inclui o cabeçalho de origem ao recipient:
- **relay_literal**: `O {nome} pediu pra eu te repassar (literalmente): "{texto}"`
- **relay_assisted**: `O {nome} me pediu pra te avisar: {texto}`
- **followup**: `O {nome} me pediu pra te perguntar (e estou acompanhando tua resposta pra devolver pra ele/ela): {texto}`

O recipient **sempre** sabe quem originou o pedido. Esta é uma regra não-negociável.

## Detecção de resposta (<<COORDINATION_RESPONSE>>)

Quando um recipient envia uma mensagem e você recebe um bloco `[COORD_HINT]` no contexto do sistema indicando recados aguardando resposta, analise se a mensagem atual é claramente uma resposta a um desses recados.

**Só emita `<<COORDINATION_RESPONSE>>` se a mensagem for claramente uma resposta.** Em caso de dúvida, não emita.

```
<<COORDINATION_RESPONSE>>
{
  "request_id": "uuid-completo-do-recado",
  "response_summary": "Resumo claro do que o recipient respondeu, em terceira pessoa. Ex: 'Rafinha disse que vai verificar o teclado amanhã cedo'"
}
<<END>>
```

**Campos obrigatórios:** `request_id` (UUID exato do COORD_HINT), `response_summary`
```

- [ ] **Step 3.2 — Verificar que o arquivo foi salvo corretamente**

```bash
node -e "const fs = require('fs'); const s = fs.readFileSync('D:/la-organizer/_remote/skills/coordenacao-conversacional.md', 'utf-8'); console.log('OK, bytes:', s.length);"
```

Esperado: OK com tamanho > 0.

- [ ] **Step 3.3 — Adicionar loader em `system.js` após o bloco marketing (após linha 971)**

No arquivo `D:/la-organizer/_remote/src/prompts/system.js`, localize o bloco que termina na linha 971:
```js
  // Sprint 15 — Piloto Marketing (replicabilidade da camada operacional)
  // ...
  if (collaborator) {
    const marketingPath = path.join(SKILLS_DIR, 'marketing.md');
    if (fs.existsSync(marketingPath)) {
      const marketingSkill = fs.readFileSync(marketingPath, 'utf-8');
      systemPrompt += '\n\n---\n\n' + marketingSkill;
    }
  }
```

Após o `}` que fecha esse bloco (linha 971), insira:

```js
  // Sprint 16 — Coordenação Conversacional (intermediação de mensagens via TOM)
  // Disponível para TODOS os roles: qualquer colaborador pode pedir relay/followup,
  // mas a skill ensina TOM a recusar followup fora de alçada antes de emitir marker.
  if (collaborator) {
    const coordPath = path.join(SKILLS_DIR, 'coordenacao-conversacional.md');
    if (fs.existsSync(coordPath)) {
      const coordSkill = fs.readFileSync(coordPath, 'utf-8');
      systemPrompt += '\n\n---\n\n' + coordSkill;
    }
  }
```

```
node -c D:/la-organizer/_remote/src/prompts/system.js
```

- [ ] **Step 3.4 — Smoke test E2E parcial (skill + engine juntos)**

Este teste confirma que a skill está sendo carregada. No VPS após deploy:
```bash
# Verificar que a skill aparece no system prompt gerado
node -e "
const { buildSystemPrompt } = require('./src/prompts/system');
const collab = { id: 'test', role: 'collaborator', full_name: 'Teste' };
const ctx = { collaborator: collab, personalTasks: [], workTasks: [], memories: [], todayEvents: [], recentMessages: [], notifications: [] };
const { systemPrompt } = buildSystemPrompt(ctx);
console.log('coordenacao-conversacional in prompt:', systemPrompt.includes('COORDINATION_REQUEST'));
" 2>/dev/null
```

Esperado: `coordenacao-conversacional in prompt: true`.

- [ ] **Step 3.5 — Deploy Fatia 3**

```bash
# 1. Verificar sintaxe
node -c D:/la-organizer/_remote/src/prompts/system.js

# 2. Clone, copy, commit, push
cd /tmp
git clone <repo-url> sprint16-f3-deploy
cp D:/la-organizer/_remote/skills/coordenacao-conversacional.md sprint16-f3-deploy/skills/coordenacao-conversacional.md
cp D:/la-organizer/_remote/src/prompts/system.js sprint16-f3-deploy/src/prompts/system.js
cd sprint16-f3-deploy
git add skills/coordenacao-conversacional.md src/prompts/system.js
git commit -m "feat(sprint16-f3): skill coordenacao-conversacional + loader system.js para todos os roles"
git push origin main

# 3. Deploy VPS
ssh tom "cd /opt/LA-Organizer && git pull && pm2 restart tom"

# 4. Cleanup
cd /tmp && rm -rf sprint16-f3-deploy
```

---

## Task 4 — Fatia 4: Detecção de resposta (COORD_HINT + `<<COORDINATION_RESPONSE>>`)

**Objetivo:** Quando o recipient enviar uma mensagem, injetar um hint no system prompt sobre recados pendentes. Se o LLM identificar que é uma resposta, emitir `<<COORDINATION_RESPONSE>>` que fecha o loop e notifica o requester.

**Arquivos:**
- Modify: `D:/la-organizer/_remote/src/engine.js`

---

- [ ] **Step 4.1 — Inserir `parseCoordinationResponseMarker` junto das outras funções parser (após `parseCoordinationRequestMarker`, linha ~1140)**

Localize o bloco `parseCoordinationRequestMarker` inserido na Fatia 2. Logo após ele, insira:

```js
// Sprint 16 — Marker <<COORDINATION_RESPONSE>>.
// Emitido pelo TOM quando recipient envia mensagem que é claramente resposta a um recado aberto.
function parseCoordinationResponseMarker(text) {
  if (!text) return null;
  const re = /<<COORDINATION_RESPONSE>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  const cleanText = text.replace(re, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(m[1].trim());
  } catch (err) {
    logSchemaErr('COORDINATION_RESPONSE', ['invalid_json: ' + err.message], m[1]);
    return { malformed: true, cleanText };
  }
  if (!parsed || typeof parsed !== 'object') return { malformed: true, cleanText };
  if (!parsed.request_id || typeof parsed.request_id !== 'string' ||
      !/^[0-9a-f-]{36}$/.test(parsed.request_id.trim())) {
    logSchemaErr('COORDINATION_RESPONSE', ['request_id:invalid_uuid'], parsed);
    return { malformed: true, cleanText };
  }
  if (!parsed.response_summary || typeof parsed.response_summary !== 'string') {
    logSchemaErr('COORDINATION_RESPONSE', ['response_summary:missing'], parsed);
    return { malformed: true, cleanText };
  }
  return {
    request_id:       parsed.request_id.trim(),
    response_summary: String(parsed.response_summary).trim(),
    cleanText,
  };
}
```

```
node -c D:/la-organizer/_remote/src/engine.js
```

- [ ] **Step 4.2 — Inserir `applyCoordinationResponseAction` após o parser**

```js
// Sprint 16 — Processa resposta de recipient: UPDATE status='responded', notifica requester.
async function applyCoordinationResponseAction(collab, parsed) {
  // 1. Buscar o request pelo ID e verificar que recipient bate
  const { data: req, error: fetchErr } = await supabase
    .from('coordination_requests')
    .select('id, requester_id, recipient_id, mode, message_body, status')
    .eq('id', parsed.request_id)
    .eq('recipient_id', collab.id)
    .eq('status', 'sent')
    .maybeSingle();

  if (fetchErr || !req) {
    console.warn('[CoordinationResponse] request not found or not sent:', parsed.request_id.slice(0, 8));
    return { ok: false, reason: 'request_not_found' };
  }

  // 2. UPDATE status → 'responded'
  const { error: updErr } = await supabase
    .from('coordination_requests')
    .update({
      status:           'responded',
      responded_at:     new Date().toISOString(),
      response_summary: parsed.response_summary,
    })
    .eq('id', req.id);

  if (updErr) {
    console.error('[CoordinationResponse] update err:', updErr.message);
    return { ok: false, reason: 'db_update_error' };
  }

  // 3. Buscar requester e notificar
  const { data: requester } = await supabase
    .from('collaborators')
    .select('id, full_name, first_name, phone')
    .eq('id', req.requester_id)
    .maybeSingle();

  const recipientFirstName = collab.first_name || collab.full_name.split(' ')[0];

  if (requester?.phone) {
    const msg = `Boa! O ${recipientFirstName} respondeu o que você pediu:\n\n"${parsed.response_summary}"`;
    try {
      await whatsapp.sendMessage(requester.phone, msg);
    } catch (sendErr) {
      console.error('[CoordinationResponse] notify requester err:', sendErr.message);
      // Não revertemos o status — resposta já foi registrada; falha de notificação é secondary
    }
  }

  console.log(`[CoordinationResponse] req=${req.id.slice(0, 8)} responded by ${String(collab.phone).slice(-4)}`);
  return { ok: true, reason: `req=${req.id.slice(0, 8)}` };
}
```

```
node -c D:/la-organizer/_remote/src/engine.js
```

- [ ] **Step 4.3 — Inserir COORD_HINT injection no início de `processMessage` (após o lookup de collab e logConversation)**

Localize em `processMessage` (linha 2695) o bloco onde `collab` é encontrado e `logConversation` é chamado. O hint deve ser inserido para ser incorporado ao system prompt. A abordagem é: buscar openRequests e armazenar em variável para uso na chamada `buildSystemPrompt`.

Localize a função `buildSystemPrompt` call em `processMessage` (busque `buildSystemPrompt` na função). Antes dessa chamada, adicione:

```js
  // Sprint 16 — COORD_HINT: verifica recados abertos onde collab é recipient
  let coordHint = null;
  {
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: openRequests } = await supabase
      .from('coordination_requests')
      .select('id, requester_id, message_body, created_at')
      .eq('recipient_id', collab.id)
      .eq('status', 'sent')
      .gte('created_at', cutoff24h)
      .order('created_at', { ascending: false })
      .limit(3);

    if (openRequests && openRequests.length > 0) {
      // Buscar nomes dos requesters
      const requesterIds = [...new Set(openRequests.map(r => r.requester_id))];
      const { data: requesters } = await supabase
        .from('collaborators')
        .select('id, full_name, first_name')
        .in('id', requesterIds);
      const requesterMap = Object.fromEntries((requesters || []).map(r => [r.id, r]));

      const lines = openRequests.map(r => {
        const req = requesterMap[r.requester_id];
        const reqName = req ? (req.first_name || req.full_name.split(' ')[0]) : 'alguém';
        const preview = r.message_body.slice(0, 60) + (r.message_body.length > 60 ? '...' : '');
        const ago = Math.round((Date.now() - new Date(r.created_at).getTime()) / 60000);
        const agoStr = ago < 60 ? `${ago}min atrás` : `${Math.round(ago / 60)}h atrás`;
        return `- De: ${reqName} | ID: ${r.id} | "${preview}" | ${agoStr}`;
      });
      coordHint = `[COORD_HINT] Há ${openRequests.length} recado(s) aguardando resposta sua:\n${lines.join('\n')}\nSe a mensagem atual parecer resposta a um desses, emita <<COORDINATION_RESPONSE>>.`;
    }
  }
```

Depois, na chamada a `buildSystemPrompt`, passe o hint no contexto. Localize a linha que monta `ctx` ou chama `buildSystemPrompt(ctx)` e adicione `coordHint` ao ctx:

```js
  // Adicionar coordHint ao ctx antes de buildSystemPrompt
  if (coordHint) {
    ctx.coordHint = coordHint;
  }
```

E em `system.js`, dentro de `buildSystemPrompt`, localize onde o system prompt é finalizado (antes do `return`) e adicione suporte ao hint:

```js
  // Sprint 16 — COORD_HINT injection (só presente quando recipient tem recados abertos)
  if (ctx.coordHint) {
    systemPrompt += '\n\n' + ctx.coordHint;
  }
```

**Localização exata em system.js:** adicionar imediatamente antes do bloco que calcula `totalTasks` e `evCount` (antes da linha 973 no arquivo original).

```
node -c D:/la-organizer/_remote/src/engine.js
node -c D:/la-organizer/_remote/src/prompts/system.js
```

- [ ] **Step 4.4 — Inserir bloco COORDINATION_RESPONSE no pipeline (antes do bloco Memory save, antes da linha 3174)**

Localize no pipeline a linha:
```js
  // 3) Memory save (sempre por último — o conteúdo do bloco NUNCA deve vazar)
```

Insira IMEDIATAMENTE ANTES desse comentário:

```js
  // Sprint 16 — <<COORDINATION_RESPONSE>> — recipient respondeu a um recado aberto.
  {
    const parsedCoordResp = parseCoordinationResponseMarker(reply);
    if (parsedCoordResp && parsedCoordResp.malformed) {
      console.warn('[CoordinationResponse] WARN: malformed marker, dropping block');
      await logMarker(collab.id, 'COORDINATION_RESPONSE', 'rejected', 'schema_invalid', null);
      reply = parsedCoordResp.cleanText || reply;
    } else if (parsedCoordResp) {
      const result = await applyCoordinationResponseAction(collab, parsedCoordResp);
      await logMarker(
        collab.id,
        'COORDINATION_RESPONSE',
        result.ok ? 'executed' : 'rejected',
        result.reason,
        null
      );
      reply = parsedCoordResp.cleanText || reply;
    }
  }
```

```
node -c D:/la-organizer/_remote/src/engine.js
```

- [ ] **Step 4.5 — Atualizar `module.exports` para incluir as novas funções de resposta**

Localize a linha de `module.exports` (que já inclui `applyCoordinationRequestAction` da Fatia 2) e adicione `applyCoordinationResponseAction`:

```js
module.exports = { processMessage, sendRitual, sendCoordinatorReport, buildTeamSummary, buildWeeklyRetrospective, parseOnboardingMarker, persistOnboarding, parseMemoryMarker, parseProjectMarker, parseTaskUpdateMarker, parseWeeklyPlanMarker, parseHabitMarker, parseDndMarker, persistMemoryRows, persistProject, applyTaskActions, applyWeeklyPlan, applyHabitActions, applyDnd, getDndState, consolidateMemoryFor, decayExpiredMemories, looksLikeMemory, resolveTaskByShortId, applyAnnouncementAction, applyCoordinationRequestAction, applyCoordinationResponseAction };
```

```
node -c D:/la-organizer/_remote/src/engine.js
```

- [ ] **Step 4.6 — Deploy Fatia 4**

```bash
# 1. Verificar sintaxe de ambos os arquivos
node -c D:/la-organizer/_remote/src/engine.js
node -c D:/la-organizer/_remote/src/prompts/system.js

# 2. Clone, copy, commit, push
cd /tmp
git clone <repo-url> sprint16-f4-deploy
cp D:/la-organizer/_remote/src/engine.js sprint16-f4-deploy/src/engine.js
cp D:/la-organizer/_remote/src/prompts/system.js sprint16-f4-deploy/src/prompts/system.js
cd sprint16-f4-deploy
git add src/engine.js src/prompts/system.js
git commit -m "feat(sprint16-f4): COORDINATION_RESPONSE marker + COORD_HINT injection + applyCoordinationResponseAction"
git push origin main

# 3. Deploy VPS
ssh tom "cd /opt/LA-Organizer && git pull && pm2 restart tom"

# 4. Cleanup
cd /tmp && rm -rf sprint16-f4-deploy
```

---

## Task 5 — Fatia 5: Dispatcher `checkCoordinationTimeouts`

**Objetivo:** Detectar `coordination_requests` com `status='sent'` e `response_deadline` expirado. Transitar para `timeout` e notificar requester.

**Arquivos:**
- Modify: `D:/la-organizer/_remote/src/rituals/dispatcher.js`

---

- [ ] **Step 5.1 — Inserir `checkCoordinationTimeouts` após `checkDepartmentOperational` (após linha ~775)**

Abra `dispatcher.js`. Após a função `checkDepartmentOperational` (que termina por volta da linha 775, após o `}`), insira:

```js
// Sprint 16 — Verifica coordination_requests com response_deadline expirado.
// Transita 'sent' → 'timeout' e notifica o requester.
// Roda a cada tick. Idempotência: query filtra status='sent' (já em timeout não reaparece).
// Gating por horário: 8h–20h BRT (evita mensagem de madrugada).
async function checkCoordinationTimeouts(now = new Date()) {
  const whatsapp = require('../services/whatsapp');
  const hourBRT = Number(new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false,
  }).format(now));
  if (hourBRT < 8 || hourBRT >= 20) return;

  const { data: expired, error } = await supabase
    .from('coordination_requests')
    .select('id, requester_id, recipient_id, message_body, response_deadline')
    .eq('expects_response', true)
    .eq('status', 'sent')
    .lt('response_deadline', now.toISOString())
    .limit(10);

  if (error) {
    console.error('[checkCoordinationTimeouts] query err:', error.message);
    return;
  }

  for (const req of (expired || [])) {
    // UPDATE status → 'timeout'
    const { error: updErr } = await supabase
      .from('coordination_requests')
      .update({ status: 'timeout', updated_at: now.toISOString() })
      .eq('id', req.id);

    if (updErr) {
      console.error(`[checkCoordinationTimeouts] update err req=${req.id.slice(0, 8)}:`, updErr.message);
      continue;
    }

    // Buscar requester e recipient para notificação
    const { data: people } = await supabase
      .from('collaborators')
      .select('id, full_name, first_name, phone')
      .in('id', [req.requester_id, req.recipient_id]);

    const requester = (people || []).find(p => p.id === req.requester_id);
    const recipient = (people || []).find(p => p.id === req.recipient_id);

    if (requester?.phone) {
      const recipientName = recipient
        ? (recipient.first_name || recipient.full_name.split(' ')[0])
        : 'o destinatário';
      const preview = req.message_body.slice(0, 80) + (req.message_body.length > 80 ? '...' : '');
      const msg = `⏳ Heads up: pedi pro ${recipientName} responder ao seu recado, mas até agora não respondeu.\nMensagem: "${preview}"\nQuer que eu insista ou prefere falar direto?`;
      try {
        await whatsapp.sendMessage(requester.phone, msg);
        console.log(`[checkCoordinationTimeouts] timeout notified req=${req.id.slice(0, 8)} → requester=${requester.phone.slice(-4)}`);
      } catch (sendErr) {
        console.error(`[checkCoordinationTimeouts] notify err req=${req.id.slice(0, 8)}:`, sendErr.message);
      }
    }
  }
}
```

```
node -c D:/la-organizer/_remote/src/rituals/dispatcher.js
```

- [ ] **Step 5.2 — Wiring em `run()`: inserir bloco após `checkDepartmentOperational` (após linha 1036)**

Localize o bloco em `run()`:
```js
  // Sprint 15 F4 — Briefing operacional semanal por departamento (segunda 07:30 BRT)
  try {
    await checkDepartmentOperational(new Date());
  } catch (err) {
    console.error('[Dispatcher] checkDepartmentOperational erro:', err.message);
  }

  // Sprint 13 F1 — comunicados internos (broadcast queue)
```

Insira ENTRE os dois blocos (após a linha 1036 `}` do checkDepartmentOperational, antes do comentário Sprint 13):

```js
  // Sprint 16 — Alertas de timeout para coordination_requests sem resposta
  try {
    await checkCoordinationTimeouts(new Date());
  } catch (err) {
    console.error('[Dispatcher] checkCoordinationTimeouts erro:', err.message);
  }

```

```
node -c D:/la-organizer/_remote/src/rituals/dispatcher.js
```

- [ ] **Step 5.3 — Atualizar `module.exports` do dispatcher (linha 1565)**

Localize:
```js
module.exports = { run, dispatchChecklists, dispatchAnnouncements, notifyCoordinators, remindEventTasks, checkDepartmentOperational, checkChecklistConsequences, parseOnboardingMarker: undefined };
```

Substitua por:
```js
module.exports = { run, dispatchChecklists, dispatchAnnouncements, notifyCoordinators, remindEventTasks, checkDepartmentOperational, checkChecklistConsequences, checkCoordinationTimeouts, parseOnboardingMarker: undefined };
```

```
node -c D:/la-organizer/_remote/src/rituals/dispatcher.js
```

- [ ] **Step 5.4 — Smoke test: criar registro com deadline expirado e verificar query**

Use `execute_sql`:
```sql
-- Criar registro de teste com deadline já expirado
INSERT INTO coordination_requests (
  requester_id, recipient_id, mode, message_body, status,
  expects_response, response_deadline, sent_at
)
SELECT
  (SELECT id FROM collaborators WHERE role = 'director' LIMIT 1),
  (SELECT id FROM collaborators WHERE role = 'collaborator' ORDER BY created_at LIMIT 1),
  'followup',
  'Teste de timeout Sprint 16',
  'sent',
  true,
  now() - interval '2 hours',   -- deadline já passou
  now() - interval '3 hours'
RETURNING id, status, response_deadline;
```

Verificar que a query do dispatcher a pegaria:
```sql
SELECT id, status, response_deadline
FROM coordination_requests
WHERE expects_response = true
  AND status = 'sent'
  AND response_deadline < now()
LIMIT 10;
-- Deve retornar o registro acima
```

Limpar:
```sql
DELETE FROM coordination_requests WHERE message_body = 'Teste de timeout Sprint 16';
```

- [ ] **Step 5.5 — Deploy Fatia 5**

```bash
# 1. Verificar sintaxe
node -c D:/la-organizer/_remote/src/rituals/dispatcher.js

# 2. Clone, copy, commit, push
cd /tmp
git clone <repo-url> sprint16-f5-deploy
cp D:/la-organizer/_remote/src/rituals/dispatcher.js sprint16-f5-deploy/src/rituals/dispatcher.js
cd sprint16-f5-deploy
git add src/rituals/dispatcher.js
git commit -m "feat(sprint16-f5): checkCoordinationTimeouts + wiring em run() + exports"
git push origin main

# 3. Deploy VPS
ssh tom "cd /opt/LA-Organizer && git pull && pm2 restart tom"

# 4. Cleanup
cd /tmp && rm -rf sprint16-f5-deploy
```

---

## Task 6 — Fatia 6: Validação E2E

**Objetivo:** Verificar o fluxo completo das 3 personas: relay, followup, e timeout.

**Pré-requisito:** Fatias 1–5 deployadas. TOM rodando no VPS.

---

- [ ] **Step 6.1 — E2E Cenário A: relay_assisted (director → collaborator)**

1. **Ação:** Director (Alf) envia ao TOM: `"Tom, avisa o Rafinha que preciso do teclado da sala 3 até amanhã de manhã"`
2. **Esperado no WhatsApp do Rafinha:** `O Alf me pediu pra te avisar:\n\nPreciso do teclado da sala 3 até amanhã de manhã`
3. **Verificar no banco:**
```sql
SELECT id, requester_id, recipient_id, mode, status, sent_at, message_body
FROM coordination_requests
WHERE mode = 'relay_assisted'
ORDER BY created_at DESC LIMIT 1;
-- status deve ser 'sent', sent_at preenchido
```
4. **Esperado no WhatsApp do Alf:** `✓ Avisei o Rafinha. [ID: xxxx]`

- [ ] **Step 6.2 — E2E Cenário B: followup + detecção de resposta**

1. **Ação:** Coordinator envia ao TOM: `"Tom, cobra o Yuri sobre os criativos da semana. Se ele não responder em 2 horas, me avisa"`
2. **Esperado no WhatsApp do Yuri:** `O [nome coordinator] me pediu pra te perguntar (e estou acompanhando tua resposta pra devolver pra ele/ela):\n\nPreciso dos criativos da semana`
3. **Verificar no banco:**
```sql
SELECT id, mode, status, expects_response, response_deadline
FROM coordination_requests
WHERE mode = 'followup'
ORDER BY created_at DESC LIMIT 1;
-- status = 'sent', expects_response = true, response_deadline preenchido
```
4. **Ação:** Yuri envia ao TOM qualquer mensagem que claramente responde: `"Oi Tom, já mandei os criativos pro drive"`
5. **Esperado no WhatsApp do Coordinator:** `Boa! O Yuri respondeu o que você pediu:\n\n"Yuri disse que já mandou os criativos pro drive"`
6. **Verificar no banco:**
```sql
SELECT id, status, responded_at, response_summary
FROM coordination_requests
WHERE mode = 'followup'
ORDER BY created_at DESC LIMIT 1;
-- status = 'responded', responded_at preenchido, response_summary preenchido
```

- [ ] **Step 6.3 — E2E Cenário C: recusa por alçada (collaborator + followup)**

1. **Ação:** Um collaborator envia ao TOM: `"Tom, cobra a Anne sobre o relatório"`
2. **Esperado no WhatsApp do collaborator:** mensagem de recusa institucional — `"Não vou cobrar o Anne por você. Esse tipo de cobrança precisa vir do coordenador ou diretor..."`
3. **Verificar no banco:**
```sql
SELECT id, status, cancelled_reason
FROM coordination_requests
WHERE status = 'rejected_by_tom'
ORDER BY created_at DESC LIMIT 1;
-- cancelled_reason = 'role_insufficient'
```

- [ ] **Step 6.4 — E2E Cenário D: relay_literal (texto verbatim)**

1. **Ação:** Director envia ao TOM: `"Tom, manda exatamente isso pro Rafinha: 'sala 3 liberada até as 18h'"`
2. **Esperado no WhatsApp do Rafinha:** `O [nome director] pediu pra eu te repassar (literalmente):\n\n"sala 3 liberada até as 18h"`
3. O texto entre aspas deve ser **idêntico** ao que o director ditou.

- [ ] **Step 6.5 — Verificar catch-all não engole markers (sanidade)**

Após os testes anteriores, verificar no banco de `marker_logs`:
```sql
SELECT marker_type, result, reason, created_at
FROM marker_logs
WHERE marker_type IN ('COORDINATION_REQUEST', 'COORDINATION_RESPONSE')
ORDER BY created_at DESC LIMIT 20;
-- Todos devem aparecer como 'executed', nenhum como 'UNKNOWN_MARKER_STRIPPED'
```

- [ ] **Step 6.6 — Verificar timeout com deadline forçado**

```sql
-- Forçar um request recente para deadline no passado
UPDATE coordination_requests
SET response_deadline = now() - interval '1 minute'
WHERE status = 'sent'
  AND expects_response = true
  AND created_at > now() - interval '1 hour'
LIMIT 1
RETURNING id;
```

Aguardar próximo tick do dispatcher (PM2 cron). Verificar:
```sql
SELECT id, status, updated_at
FROM coordination_requests
WHERE status = 'timeout'
ORDER BY updated_at DESC LIMIT 5;
-- O registro acima deve aparecer com status='timeout'
```

---

## Self-Review

### 1. Spec Coverage

| Seção spec | Task correspondente |
|---|---|
| §2.1 — Decisão: nova entidade | Codebase Context + Task 1 |
| §2.2 — Schema DDL + parent_request_id | Task 1 Step 1.1 (SQL completo) |
| §2.3 — State machine pending/sent/responded/timeout/rejected_by_tom | Task 2 Step 2.4 (lógica), Task 4 Step 4.2, Task 5 Step 5.1 |
| §2.4 — Matriz de autorização + gating | Task 2 Step 2.4 (blocos 3 e 4 de gating) |
| §2.5 — Skill coordenacao-conversacional.md | Task 3 Step 3.1 |
| §2.6 — applyCoordinationRequestAction | Task 2 Step 2.4 |
| §2.7.1 — Engine in-message + COORD_HINT | Task 4 Steps 4.3 |
| §2.7.2 — Dispatcher checkCoordinationTimeouts | Task 5 |
| §5 — Decisões fechadas | Codebase Context + todos os tasks |
| §6 — Templates UX obrigatórios + cabeçalho de origem | Task 2 Step 2.2 (`_buildRecipientMessage`) |
| Fatia 1 (spec §4) | Task 1 |
| Fatia 2 (spec §4) | Task 2 |
| Fatia 3 (spec §4) | Task 3 |
| Fatia 4 (spec §4) | Task 4 |
| Fatia 5 (spec §4) | Task 5 |
| Fatia 6 (spec §4) | Task 6 |
| Fatia 7 PWA — **FORA DO MVP** (Decisão #2) | Skipped por decisão aprovada |

**Gaps identificados:** Nenhum. `cancelled` state (requester cancela após envio) mencionado no state machine da spec mas marcado como "não implementado neste Sprint" — correto pois a spec não tem fatia para isso.

### 2. Placeholder Scan

- Nenhum "TBD", "TODO", "implement later" encontrado no plano.
- Todos os code blocks são código executável real.
- `<repo-url>` nos steps de deploy é o único placeholder legítimo — o implementer deve substituir pelo URL real do repositório.

### 3. Type Consistency

- `parseCoordinationRequestMarker` retorna `{ recipient_name, mode, message_body, message_original, expects_response, response_deadline_hours, cleanText }` — todos esses campos são consumidos por `applyCoordinationRequestAction` nos Steps 2.1 e 2.4. ✓
- `applyCoordinationRequestAction` retorna `{ ok, reason, replyText }` — consumido no pipeline Step 2.5. ✓
- `parseCoordinationResponseMarker` retorna `{ request_id, response_summary, cleanText }` — consumido por `applyCoordinationResponseAction` Step 4.2 e pipeline Step 4.4. ✓
- `applyCoordinationResponseAction` retorna `{ ok, reason }` — consumido no pipeline Step 4.4. ✓
- `_buildRecipientMessage(requesterFirstName, mode, messageBody)` — chamada em `applyCoordinationRequestAction` Step 2.4 com `_requesterDisplayName(collab)` (string), `parsed.mode` (string), `parsed.message_body` (string). ✓
- `checkCoordinationTimeouts` usa `supabase` e `whatsapp` — ambos disponíveis no dispatcher via require. ✓
- `module.exports` do dispatcher: `checkCoordinationTimeouts` adicionado em Step 5.3. ✓
- `module.exports` do engine: `applyCoordinationResponseAction` adicionado em Step 4.5. ✓
