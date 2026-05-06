# Sprint 13 Fatia 1 — MVP Anúncio Segmentado

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Director e coordinator criam anúncios segmentados via PWA ou TOM; mensagens são entregues via WhatsApp em lotes de 1 msg/min com suporte a agendamento e cancelamento com retratação.

**Architecture:** DB-first com cron dispatcher — tabelas `announcements` + `announcement_jobs` no Supabase; `rituals/dispatcher.js` adiciona `dispatchAnnouncements(now)` chamado a cada tick (1×/min); PWA e TOM escrevem no DB; cron é o único que envia mensagens.

**Tech Stack:** Node.js (dispatcher), Supabase (DB + RLS), React + TanStack Query (PWA), UAZAPI (WhatsApp via whatsapp service)

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/rituals/dispatcher.js` | Modificar | Adicionar `dispatchAnnouncements` + `handleCancellations` |
| `src/engine.js` | Modificar | Parser + applier do marker `<<ANNOUNCEMENT_ACTION>>` |
| `src/prompts/system.js` | Modificar | Incluir skill comunicados no prompt de director/coordinator |
| `skills/comunicados.md` | Criar | Skill que ensina o TOM a criar/cancelar anúncios |
| `web/src/types.ts` | Modificar | Tipos `Announcement` e `AnnouncementAudience` |
| `web/src/screens/Comunicados.tsx` | Criar | Tela de listagem + FAB |
| `web/src/components/ComunicadoSheet.tsx` | Criar | BottomSheet compositor com seletor de público |
| `web/src/App.tsx` | Modificar | Rota `/mais/comunicados` |
| `web/src/screens/Mais.tsx` | Modificar | Item "Comunicados" com requireRoles |

---

## Task 1: DB Migration

**Files:**
- Supabase SQL (via MCP `execute_sql`)

- [ ] **Step 1: Aplicar migration**

Execute via Supabase MCP (`mcp__4c04bb52...execute_sql`, project_id = `cesnbnrynvxvgdhfmaua`):

```sql
-- 1. Tabela de anúncios
CREATE TABLE IF NOT EXISTS announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid REFERENCES collaborators(id),
  body text NOT NULL,
  audience jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('draft','scheduled','sending','sent','cancelled')),
  scheduled_at timestamptz,
  cancel_retraction_sent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_announcements_status
  ON announcements(status, scheduled_at);

-- 2. Jobs de entrega por destinatário
CREATE TABLE IF NOT EXISTS announcement_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  recipient_id uuid REFERENCES collaborators(id),
  phone text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','failed','cancelled')),
  retry_count int NOT NULL DEFAULT 0,
  sent_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_announcement_jobs_pending
  ON announcement_jobs(announcement_id, status);
CREATE INDEX IF NOT EXISTS idx_announcement_jobs_status_created
  ON announcement_jobs(status, created_at);

-- 3. RLS
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY announcements_select ON announcements
  FOR SELECT TO authenticated
  USING (current_collab_role() IN ('director','coordinator'));

CREATE POLICY announcements_write ON announcements
  FOR ALL TO authenticated
  WITH CHECK (current_collab_role() IN ('director','coordinator'));

-- announcement_jobs: director/coordinator podem ler (para mostrar progresso no PWA)
-- INSERT/UPDATE é feito exclusivamente pelo service role (Node.js)
CREATE POLICY announcement_jobs_select ON announcement_jobs
  FOR SELECT TO authenticated
  USING (current_collab_role() IN ('director','coordinator'));
```

- [ ] **Step 2: Verificar tabelas**

Execute no Supabase MCP:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('announcements','announcement_jobs');
-- Expected: 2 rows
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add announcements + announcement_jobs tables with RLS"
```

---

## Task 2: TOM Skill (`skills/comunicados.md`)

**Files:**
- Create: `skills/comunicados.md`
- Modify: `src/prompts/system.js`

- [ ] **Step 1: Criar arquivo de skill**

Criar `skills/comunicados.md`:

```markdown
# Skill: Comunicados Internos

Você tem permissão de criar e cancelar comunicados internos via WhatsApp para a equipe.
Use esta skill quando director ou coordinator pedir para avisar, comunicar ou notificar colaboradores.

## Intenções que ativam esta skill

- "avisa [público] que..."
- "manda mensagem para [público]..."
- "comunica para [público]..."
- "notifica [público]..."
- "cancela o comunicado" / "cancela o último aviso"

## Criar um comunicado

### Passo 1 — Entender o pedido

Identifique:
- **body**: o texto da mensagem a enviar (reformule se necessário, mantenha direto)
- **audience**: quem deve receber (veja tabela abaixo)
- **scheduled_at**: quando enviar (null = imediato; ISO8601 se agendado)

### Público (`audience` JSON)

| Pedido do usuário | JSON audience |
|---|---|
| "todo mundo" / "todos" / "a equipe toda" | `{"all": true}` |
| "a secretaria" | `{"function_role": ["secretary_morning","secretary_evening"]}` |
| "secretaria da manhã" | `{"function_role": ["secretary_morning"]}` |
| "pedagógico" | `{"function_role": ["pedagogical_assistant"]}` |
| "limpeza" | `{"function_role": ["cleaning"]}` |
| "pessoal da Barra" | `{"unidade": ["barra"]}` |
| "pessoal do Recreio" | `{"unidade": ["recreio"]}` |
| "turno da manhã" | `{"turno": ["morning"]}` |
| "turno da tarde" | `{"turno": ["afternoon"]}` |
| "turno da noite" | `{"turno": ["evening"]}` |
| combinação | `{"function_role": ["secretary_morning"], "unidade": ["barra"]}` |

Dimensões são combinadas com AND. Dentro de cada dimensão, OR.

### Passo 2 — Confirmar antes de enviar

Sempre mostre um resumo e peça confirmação:

```
Vou mandar este comunicado:

Público: [descrição legível do público]
Mensagem: "[body]"
Envio: [imediato | data/hora formatada]

Confirma?
```

### Passo 3 — Emitir marker após confirmação

Só emita o marker DEPOIS que o usuário confirmar ("sim", "confirma", "pode", "vai", etc.).

```
<<ANNOUNCEMENT_ACTION>>
{
  "action": "create",
  "body": "<texto exato a enviar>",
  "audience": <json do público>,
  "scheduled_at": <"2026-04-30T08:00:00-03:00" | null>
}
<<END>>
```

### Passo 4 — Confirmar envio

Após o marker, responda: "Comunicado despachado. ✓"
(O sistema vai informar quantas pessoas receberam.)

---

## Cancelar um comunicado

Quando o usuário pede para cancelar, busque o comunicado mais recente ativo. Confirme antes de cancelar.

```
Cancelo o comunicado enviado há [tempo] para [público]?

"[preview do body]"

Confirma?
```

Após confirmação:
```
<<ANNOUNCEMENT_ACTION>>
{"action": "cancel", "announcement_id": "latest"}
<<END>>
```

O sistema cancela jobs pendentes e envia retratação para quem já recebeu.

---

## Regras

- NUNCA emita o marker sem confirmação explícita do usuário
- Se o público for ambíguo, pergunte antes de confirmar
- Se scheduled_at for no passado, avise e peça nova hora
- Mensagem de retratação automática: "[LA Music] — O comunicado anterior foi cancelado. Por favor, desconsidere."
```

- [ ] **Step 2: Incluir skill no system prompt para director/coordinator**

Em `src/prompts/system.js`, encontre a função `buildSystemPrompt` (ou equivalente que monta o prompt). Adicione após o carregamento do hint de checklists:

```js
// Comunicados internos — disponível apenas para director/coordinator
if (collab && (collab.role === 'director' || collab.role === 'coordinator')) {
  const comunicadosSkill = fs.existsSync(path.join(__dirname, '../../skills/comunicados.md'))
    ? fs.readFileSync(path.join(__dirname, '../../skills/comunicados.md'), 'utf-8')
    : '';
  if (comunicadosSkill) {
    prompt += '\n\n---\n\n' + comunicadosSkill;
  }
}
```

> **Nota:** Se `buildSystemPrompt` em `system.js` não tem acesso a `collab.role` diretamente, passe o `collaborator` completo (que já é carregado no engine.js) — verifique o padrão existente para `getActiveChecklistHint`.

- [ ] **Step 3: Adicionar `ANNOUNCEMENT_ACTION` ao BLOCK_RULES**

No mesmo `src/prompts/system.js`, localize onde `<<CHECKLIST_ACTION>>` é listado nos marcadores válidos (BLOCK_RULES ou equivalente). Adicione `<<ANNOUNCEMENT_ACTION>>` na mesma lista.

- [ ] **Step 4: Commit**

```bash
git add skills/comunicados.md src/prompts/system.js
git commit -m "feat: add comunicados skill + include in director/coordinator system prompt"
```

---

## Task 3: Engine — Marker Parser + Applier

**Files:**
- Modify: `src/engine.js` (adicionar após `applyChecklistAction` ~linha 381, integrar no pipeline ~linha 2335)

- [ ] **Step 1: Adicionar `parseAnnouncementActionMarker` em engine.js**

Após a função `applyChecklistAction` (busque a linha `module.exports` do bloco de checklist ou procure `// Sprint 11 F2+ — Marker <<CHECKLIST_ACTION>>`), adicione:

```js
// Sprint 13 F1 — Marker <<ANNOUNCEMENT_ACTION>>. TOM emite quando director/coordinator
// confirma criação ou cancelamento de comunicado interno. Persiste em announcements
// e announcement_jobs (create) ou seta status=cancelled (cancel).
function parseAnnouncementActionMarker(text) {
  if (!text) return null;
  const re = /<<ANNOUNCEMENT_ACTION>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  const cleanText = text.replace(re, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(m[1].trim());
  } catch (err) {
    logSchemaErr('ANNOUNCEMENT_ACTION', ['invalid_json: ' + err.message], m[1]);
    return { malformed: true, cleanText };
  }
  if (!parsed || typeof parsed !== 'object') return { malformed: true, cleanText };
  if (!['create', 'cancel'].includes(parsed.action)) {
    logSchemaErr('ANNOUNCEMENT_ACTION', ['action:invalid'], parsed);
    return { malformed: true, cleanText };
  }
  if (parsed.action === 'create') {
    if (!parsed.body || typeof parsed.body !== 'string' || !parsed.body.trim()) {
      logSchemaErr('ANNOUNCEMENT_ACTION', ['body:missing_or_empty'], parsed);
      return { malformed: true, cleanText };
    }
  }
  return { ...parsed, cleanText, malformed: false };
}

async function applyAnnouncementAction(collaborator, parsed) {
  const { action, body, audience, scheduled_at, announcement_id } = parsed;

  if (action === 'cancel') {
    let annId = announcement_id && announcement_id !== 'latest' ? announcement_id : null;
    if (!annId) {
      const { data } = await supabase
        .from('announcements')
        .select('id')
        .eq('created_by', collaborator.id)
        .in('status', ['scheduled', 'sending'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) return { ok: false, reason: 'no_active_announcement' };
      annId = data.id;
    }
    const { error } = await supabase
      .from('announcements')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', annId);
    if (error) return { ok: false, reason: error.message };
    return { ok: true, action: 'cancelled', announcement_id: annId };
  }

  if (action === 'create') {
    // Resolver destinatários conforme audience
    let q = supabase
      .from('collaborators')
      .select('id, phone')
      .eq('is_active', true)
      .not('phone', 'is', null);

    if (audience && !audience.all) {
      if (audience.function_role?.length) q = q.in('function_role', audience.function_role);
      if (audience.unidade?.length) q = q.in('unit', audience.unidade);
      if (audience.turno?.length) q = q.in('shift', audience.turno);
    }

    const { data: recipients, error: rErr } = await q;
    if (rErr) return { ok: false, reason: rErr.message };
    if (!recipients || recipients.length === 0) return { ok: false, reason: 'no_recipients' };

    const { data: ann, error: annErr } = await supabase
      .from('announcements')
      .insert({
        created_by: collaborator.id,
        body: body.trim(),
        audience: audience || { all: true },
        status: 'scheduled',
        scheduled_at: scheduled_at || null,
      })
      .select('id')
      .single();
    if (annErr) return { ok: false, reason: annErr.message };

    const jobs = recipients.map(r => ({
      announcement_id: ann.id,
      recipient_id: r.id,
      phone: r.phone,
    }));
    const { error: jobErr } = await supabase.from('announcement_jobs').insert(jobs);
    if (jobErr) return { ok: false, reason: jobErr.message };

    return { ok: true, action: 'created', announcement_id: ann.id, recipient_count: recipients.length };
  }

  return { ok: false, reason: 'unknown_action' };
}
```

- [ ] **Step 2: Integrar no pipeline `processMessage`**

No bloco de processamento de markers dentro de `processMessage` (após o bloco do `CHECKLIST_ACTION` ~linha 2328), adicione:

```js
  // Sprint 13 F1 — <<ANNOUNCEMENT_ACTION>> — criar/cancelar comunicado interno.
  {
    const parsedAnn = parseAnnouncementActionMarker(reply);
    if (parsedAnn && parsedAnn.malformed) {
      console.warn('[AnnouncementAction] WARN: malformed marker, dropping block');
      await logMarker(collab.id, 'ANNOUNCEMENT_ACTION', 'rejected', 'schema_invalid', null);
      reply = parsedAnn.cleanText || reply;
    } else if (parsedAnn) {
      const result = await applyAnnouncementAction(collab, parsedAnn);
      await logMarker(
        collab.id,
        'ANNOUNCEMENT_ACTION',
        result.ok ? 'executed' : 'rejected',
        result.ok
          ? `action=${result.action} count=${result.recipient_count ?? 0}`
          : result.reason,
        null
      );
      let base = parsedAnn.cleanText || '';
      if (result.ok && !base) {
        if (result.action === 'created') {
          base = `Comunicado criado para ${result.recipient_count} pessoa${result.recipient_count !== 1 ? 's' : ''}. ✓`;
        } else if (result.action === 'cancelled') {
          base = 'Comunicado cancelado. Retratação será enviada para quem já recebeu. ✓';
        }
      } else if (!result.ok && !base) {
        if (result.reason === 'no_recipients') {
          base = 'Nenhum colaborador encontrado para esse público. Verifica os filtros?';
        } else if (result.reason === 'no_active_announcement') {
          base = 'Não encontrei nenhum comunicado ativo para cancelar.';
        } else {
          base = 'Tive um erro ao criar o comunicado. Tenta de novo?';
        }
      }
      reply = base || reply;
    }
  }
```

- [ ] **Step 3: Verificar que o engine não tem referência a ANNOUNCEMENT_ACTION já em BLOCK_RULES**

```bash
grep -n "ANNOUNCEMENT_ACTION" src/engine.js src/prompts/system.js
# Deve aparecer só nas linhas que acabamos de adicionar
```

- [ ] **Step 4: Commit**

```bash
git add src/engine.js src/prompts/system.js
git commit -m "feat: add ANNOUNCEMENT_ACTION marker parser and applier in engine"
```

---

## Task 4: Broadcaster (`rituals/dispatcher.js`)

**Files:**
- Modify: `src/rituals/dispatcher.js`

- [ ] **Step 1: Adicionar `handleCancellations` antes de `dispatchAnnouncements`**

Adicione antes da função `run()` (após `dispatchChecklists`):

```js
// Sprint 13 F1 — Cancel + retraction handler.
// Chamado a cada tick: (a) cancela jobs pending de anúncios cancelados,
// (b) envia mensagem de retratação para quem já recebeu.
async function handleCancellations(whatsapp) {
  const { data: cancelled, error } = await supabase
    .from('announcements')
    .select('id')
    .eq('status', 'cancelled')
    .eq('cancel_retraction_sent', false);
  if (error) { console.error('[dispatchAnnouncements] cancel query err:', error.message); return; }
  if (!cancelled || cancelled.length === 0) return;

  for (const ann of cancelled) {
    // Para jobs pendentes
    await supabase.from('announcement_jobs')
      .update({ status: 'cancelled' })
      .eq('announcement_id', ann.id)
      .eq('status', 'pending');

    // Retratação para jobs já enviados
    const { data: sentJobs } = await supabase
      .from('announcement_jobs')
      .select('phone')
      .eq('announcement_id', ann.id)
      .eq('status', 'sent');

    for (const job of (sentJobs || [])) {
      try {
        await whatsapp.sendMessage(job.phone, '[LA Music] — O comunicado anterior foi cancelado. Por favor, desconsidere.');
      } catch (err) {
        console.error('[dispatchAnnouncements] retraction send err:', err.message);
      }
    }

    await supabase.from('announcements')
      .update({ cancel_retraction_sent: true })
      .eq('id', ann.id);

    console.log(`[dispatchAnnouncements] cancellation handled for announcement=${ann.id.slice(0,8)}`);
  }
}

// Sprint 13 F1 — Broadcast dispatcher. Chamado a cada tick do cron.
// Processa 1 job por tick (rate = 1 msg/min, anti-ban Meta).
// Ordem FIFO por created_at.
async function dispatchAnnouncements(now = new Date()) {
  const whatsapp = require('../services/whatsapp');
  const nowIso = now instanceof Date ? now.toISOString() : new Date().toISOString();

  // 1. Anúncios prontos para enviar
  const { data: ready, error: rErr } = await supabase
    .from('announcements')
    .select('id, body, status')
    .in('status', ['scheduled', 'sending'])
    .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`);
  if (rErr) { console.error('[dispatchAnnouncements] ready query err:', rErr.message); }

  if (ready && ready.length > 0) {
    const annIds = ready.map(a => a.id);
    const byId = new Map(ready.map(a => [a.id, a]));

    // 2. Pegar 1 job pending (FIFO)
    const { data: job, error: jErr } = await supabase
      .from('announcement_jobs')
      .select('id, announcement_id, phone, retry_count')
      .eq('status', 'pending')
      .in('announcement_id', annIds)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (jErr) console.error('[dispatchAnnouncements] job query err:', jErr.message);

    if (job) {
      const ann = byId.get(job.announcement_id);
      try {
        await whatsapp.sendMessage(job.phone, ann.body);
        await supabase.from('announcement_jobs')
          .update({ status: 'sent', sent_at: nowIso })
          .eq('id', job.id);

        // Primeiro job do anúncio: scheduled → sending
        if (ann.status === 'scheduled') {
          await supabase.from('announcements')
            .update({ status: 'sending', updated_at: nowIso })
            .eq('id', ann.id);
        }

        // Verificar se é o último job pendente
        const { count } = await supabase
          .from('announcement_jobs')
          .select('id', { count: 'exact', head: true })
          .eq('announcement_id', ann.id)
          .eq('status', 'pending');
        if (count === 0) {
          await supabase.from('announcements')
            .update({ status: 'sent', updated_at: nowIso })
            .eq('id', ann.id);
          console.log(`[dispatchAnnouncements] announcement=${ann.id.slice(0,8)} fully sent`);
        }

        console.log(`[dispatchAnnouncements] sent job=${job.id.slice(0,8)} → ${job.phone.slice(-4)}`);
      } catch (err) {
        const newRetry = (job.retry_count || 0) + 1;
        const updates = newRetry >= 3
          ? { status: 'failed', error: err.message.slice(0, 200), retry_count: newRetry }
          : { retry_count: newRetry, error: err.message.slice(0, 200) };
        await supabase.from('announcement_jobs').update(updates).eq('id', job.id);
        console.error(`[dispatchAnnouncements] send err job=${job.id.slice(0,8)}:`, err.message);
      }
    }
  }

  // 3. Tratar cancelamentos (todo tick)
  await handleCancellations(whatsapp);
}
```

- [ ] **Step 2: Chamar `dispatchAnnouncements` em `run()`**

Na função `run()`, após o bloco de `dispatchChecklists` (~linha 526), adicione:

```js
  // Sprint 13 F1 — comunicados internos (broadcast queue)
  try {
    await dispatchAnnouncements(new Date());
  } catch (err) {
    console.error('[Dispatcher] dispatchAnnouncements erro:', err.message);
  }
```

- [ ] **Step 3: Exportar `dispatchAnnouncements`**

Na última linha do arquivo:
```js
// ANTES:
module.exports = { run, dispatchChecklists, parseOnboardingMarker: undefined };

// DEPOIS:
module.exports = { run, dispatchChecklists, dispatchAnnouncements, parseOnboardingMarker: undefined };
```

- [ ] **Step 4: Testar manualmente o broadcaster**

```bash
# No VPS (ou localmente com .env preenchido):
node -e "
require('dotenv').config();
const { dispatchAnnouncements } = require('./src/rituals/dispatcher');
dispatchAnnouncements(new Date()).then(() => { console.log('done'); process.exit(0); });
"
# Expected: sem erros; se não houver jobs pending, apenas silêncio + handleCancellations log
```

- [ ] **Step 5: Commit**

```bash
git add src/rituals/dispatcher.js
git commit -m "feat: add dispatchAnnouncements broadcaster to cron dispatcher"
```

---

## Task 5: PWA Types

**Files:**
- Modify: `web/src/types.ts`

- [ ] **Step 1: Adicionar tipos em types.ts**

Adicione ao final de `web/src/types.ts` (antes do último export se houver):

```ts
// ─── Sprint 13 F1 — Comunicados Internos ────────────────────────────────────

export interface AnnouncementAudience {
  all?: boolean;
  function_role?: string[];
  unidade?: string[];
  turno?: string[];
}

export interface Announcement {
  id: string;
  created_by: string;
  body: string;
  audience: AnnouncementAudience;
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled';
  scheduled_at: string | null;
  cancel_retraction_sent: boolean;
  created_at: string;
  updated_at: string;
}

export interface AnnouncementJob {
  id: string;
  announcement_id: string;
  recipient_id: string | null;
  phone: string;
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
  retry_count: number;
  sent_at: string | null;
  error: string | null;
  created_at: string;
}

export function audienceLabel(audience: AnnouncementAudience): string {
  if (!audience || audience.all) return 'Todos';
  const parts: string[] = [];
  const roleMap: Record<string, string> = {
    secretary_morning: 'Secretaria manhã',
    secretary_evening: 'Secretaria tarde',
    pedagogical_assistant: 'Pedagógico',
    cleaning: 'Limpeza',
    coordinator: 'Coordenação',
    director: 'Diretoria',
  };
  const unitMap: Record<string, string> = {
    barra: 'Barra', recreio: 'Recreio', campo_grande: 'Campo Grande',
  };
  const turnoMap: Record<string, string> = {
    morning: 'Manhã', afternoon: 'Tarde', evening: 'Noite', full: 'Integral',
  };
  if (audience.function_role?.length) {
    parts.push(audience.function_role.map(r => roleMap[r] ?? r).join(', '));
  }
  if (audience.unidade?.length) {
    parts.push(audience.unidade.map(u => unitMap[u] ?? u).join(', '));
  }
  if (audience.turno?.length) {
    parts.push(audience.turno.map(t => turnoMap[t] ?? t).join(', '));
  }
  return parts.join(' · ') || 'Todos';
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/types.ts
git commit -m "feat: add Announcement types and audienceLabel helper"
```

---

## Task 6: PWA Components

**Files:**
- Create: `web/src/components/ComunicadoSheet.tsx`
- Create: `web/src/screens/Comunicados.tsx`

- [ ] **Step 1: Criar `ComunicadoSheet.tsx`**

```tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { BottomSheet } from './BottomSheet';
import type { AnnouncementAudience } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
}

const FUNCTION_ROLES = [
  { value: 'secretary_morning', label: 'Secretaria manhã' },
  { value: 'secretary_evening', label: 'Secretaria tarde' },
  { value: 'pedagogical_assistant', label: 'Pedagógico' },
  { value: 'cleaning', label: 'Limpeza' },
  { value: 'coordinator', label: 'Coordenação' },
];

const UNIDADES = [
  { value: 'barra', label: 'Barra' },
  { value: 'recreio', label: 'Recreio' },
  { value: 'campo_grande', label: 'Campo Grande' },
];

const TURNOS = [
  { value: 'morning', label: 'Manhã' },
  { value: 'afternoon', label: 'Tarde' },
  { value: 'evening', label: 'Noite' },
  { value: 'full', label: 'Integral' },
];

export function ComunicadoSheet({ open, onClose }: Props) {
  const { collaborator } = useAuth();
  const queryClient = useQueryClient();

  const [body, setBody] = useState('');
  const [audienceAll, setAudienceAll] = useState(true);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedUnidades, setSelectedUnidades] = useState<string[]>([]);
  const [selectedTurnos, setSelectedTurnos] = useState<string[]>([]);
  const [scheduledMode, setScheduledMode] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [error, setError] = useState('');

  function toggleItem<T>(arr: T[], item: T): T[] {
    return arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item];
  }

  function buildAudience(): AnnouncementAudience {
    if (audienceAll) return { all: true };
    const aud: AnnouncementAudience = {};
    if (selectedRoles.length) aud.function_role = selectedRoles;
    if (selectedUnidades.length) aud.unidade = selectedUnidades;
    if (selectedTurnos.length) aud.turno = selectedTurnos;
    return aud;
  }

  const hasAudienceSelection = audienceAll || selectedRoles.length > 0 || selectedUnidades.length > 0 || selectedTurnos.length > 0;
  const canSave = body.trim().length > 0 && hasAudienceSelection && (!scheduledMode || scheduledAt);

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      setError('');
      const audience = buildAudience();

      // Validar que há destinatários
      let q = supabase.from('collaborators').select('id', { count: 'exact', head: true }).eq('is_active', true).not('phone', 'is', null);
      if (!audience.all) {
        if (audience.function_role?.length) q = q.in('function_role', audience.function_role);
        if (audience.unidade?.length) q = q.in('unit', audience.unidade);
        if (audience.turno?.length) q = q.in('shift', audience.turno);
      }
      const { count } = await q;
      if (!count || count === 0) throw new Error('Nenhum colaborador encontrado para este público');

      // Validar agendamento no futuro
      let scheduled_at: string | null = null;
      if (scheduledMode && scheduledAt) {
        const dt = new Date(scheduledAt);
        if (dt <= new Date()) throw new Error('Horário de envio deve ser no futuro');
        scheduled_at = dt.toISOString();
      }

      await supabase.rpc('set_config', { key: 'app.current_user_id', value: collaborator!.id });

      const { data: ann, error: annErr } = await supabase
        .from('announcements')
        .insert({ created_by: collaborator!.id, body: body.trim(), audience, status: 'scheduled', scheduled_at })
        .select('id')
        .single();
      if (annErr) throw annErr;

      // Buscar destinatários e criar jobs
      let rq = supabase.from('collaborators').select('id, phone').eq('is_active', true).not('phone', 'is', null);
      if (!audience.all) {
        if (audience.function_role?.length) rq = rq.in('function_role', audience.function_role);
        if (audience.unidade?.length) rq = rq.in('unit', audience.unidade);
        if (audience.turno?.length) rq = rq.in('shift', audience.turno);
      }
      const { data: recipients } = await rq;
      if (recipients?.length) {
        const jobs = recipients.map(r => ({ announcement_id: ann.id, recipient_id: r.id, phone: r.phone }));
        const { error: jobErr } = await supabase.from('announcement_jobs').insert(jobs);
        if (jobErr) throw jobErr;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comunicados'] });
      setBody('');
      setAudienceAll(true);
      setSelectedRoles([]);
      setSelectedUnidades([]);
      setSelectedTurnos([]);
      setScheduledMode(false);
      setScheduledAt('');
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <BottomSheet open={open} onClose={onClose} title="Novo comunicado">
      <div className="space-y-md p-md">
        <div>
          <label className="text-body-sm text-fg-muted">Mensagem</label>
          <textarea
            className="mt-1 w-full rounded-sm border border-border bg-bg-elevated p-sm text-body-md focus-ring resize-none"
            rows={4}
            maxLength={1000}
            placeholder="Digite o comunicado..."
            value={body}
            onChange={e => setBody(e.target.value)}
          />
          <p className="text-body-sm text-fg-muted text-right">{body.length}/1000</p>
        </div>

        <div>
          <p className="text-body-sm text-fg-muted mb-1">Público</p>
          <label className="flex items-center gap-sm text-body-md">
            <input type="checkbox" checked={audienceAll} onChange={e => { setAudienceAll(e.target.checked); if (e.target.checked) { setSelectedRoles([]); setSelectedUnidades([]); setSelectedTurnos([]); } }} />
            Todos os colaboradores
          </label>
        </div>

        {!audienceAll && (
          <>
            <div>
              <p className="text-body-sm text-fg-muted mb-1">Por função</p>
              <div className="space-y-xs">
                {FUNCTION_ROLES.map(r => (
                  <label key={r.value} className="flex items-center gap-sm text-body-md">
                    <input type="checkbox" checked={selectedRoles.includes(r.value)} onChange={() => setSelectedRoles(prev => toggleItem(prev, r.value))} />
                    {r.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <p className="text-body-sm text-fg-muted mb-1">Por unidade</p>
              <div className="flex flex-wrap gap-sm">
                {UNIDADES.map(u => (
                  <label key={u.value} className="flex items-center gap-xs text-body-md">
                    <input type="checkbox" checked={selectedUnidades.includes(u.value)} onChange={() => setSelectedUnidades(prev => toggleItem(prev, u.value))} />
                    {u.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <p className="text-body-sm text-fg-muted mb-1">Por turno</p>
              <div className="flex flex-wrap gap-sm">
                {TURNOS.map(t => (
                  <label key={t.value} className="flex items-center gap-xs text-body-md">
                    <input type="checkbox" checked={selectedTurnos.includes(t.value)} onChange={() => setSelectedTurnos(prev => toggleItem(prev, t.value))} />
                    {t.label}
                  </label>
                ))}
              </div>
            </div>
          </>
        )}

        <div>
          <label className="flex items-center gap-sm text-body-md">
            <input type="checkbox" checked={scheduledMode} onChange={e => setScheduledMode(e.target.checked)} />
            Agendar envio
          </label>
          {scheduledMode && (
            <input
              type="datetime-local"
              className="mt-2 w-full rounded-sm border border-border bg-bg-elevated p-sm text-body-md focus-ring"
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
            />
          )}
        </div>

        {error && <p className="text-danger text-body-sm">{error}</p>}

        <button
          type="button"
          disabled={!canSave || isPending}
          onClick={() => mutate()}
          className="w-full h-10 rounded-sm bg-primary text-white text-body-md font-medium disabled:opacity-40 focus-ring"
        >
          {isPending ? 'Enviando...' : 'Enviar comunicado'}
        </button>
      </div>
    </BottomSheet>
  );
}
```

- [ ] **Step 2: Criar `Comunicados.tsx`**

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { ComunicadoSheet } from '../components/ComunicadoSheet';
import { audienceLabel } from '../types';
import type { Announcement, AnnouncementJob } from '../types';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  scheduled: 'Agendado',
  sending: 'Enviando',
  sent: 'Enviado',
  cancelled: 'Cancelado',
};

const STATUS_COLOR: Record<string, string> = {
  draft: 'text-fg-muted',
  scheduled: 'text-warning',
  sending: 'text-primary',
  sent: 'text-success',
  cancelled: 'text-danger',
};

export function Comunicados() {
  const { collaborator } = useAuth();
  const queryClient = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ['comunicados'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return data as Announcement[];
    },
  });

  // Buscar contagem de jobs para cada anúncio em sending
  const sendingIds = announcements.filter(a => a.status === 'sending').map(a => a.id);
  const { data: jobCounts = {} } = useQuery({
    queryKey: ['comunicados-jobs', sendingIds],
    enabled: sendingIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('announcement_jobs')
        .select('announcement_id, status')
        .in('announcement_id', sendingIds);
      const counts: Record<string, { sent: number; total: number }> = {};
      for (const job of (data as AnnouncementJob[] || [])) {
        if (!counts[job.announcement_id]) counts[job.announcement_id] = { sent: 0, total: 0 };
        counts[job.announcement_id].total++;
        if (job.status === 'sent') counts[job.announcement_id].sent++;
      }
      return counts;
    },
  });

  const { mutate: cancelAnnouncement } = useMutation({
    mutationFn: async (id: string) => {
      await supabase.rpc('set_config', { key: 'app.current_user_id', value: collaborator!.id });
      const { error } = await supabase.from('announcements').update({ status: 'cancelled' }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['comunicados'] }),
  });

  return (
    <div className="space-y-lg">
      <header>
        <h2 className="text-section-title">Comunicados</h2>
        <p className="text-body-sm text-fg-muted mt-1">Anúncios enviados para a equipe</p>
      </header>

      {isLoading && <p className="text-body-sm text-fg-muted">Carregando...</p>}

      {!isLoading && announcements.length === 0 && (
        <p className="text-body-sm text-fg-muted">Nenhum comunicado enviado ainda.</p>
      )}

      <ul className="space-y-sm">
        {announcements.map(ann => {
          const counts = jobCounts[ann.id];
          return (
            <li key={ann.id} className="surface p-md space-y-xs">
              <p className="text-body-md line-clamp-2">{ann.body}</p>
              <div className="flex items-center gap-sm flex-wrap">
                <span className="text-body-sm text-fg-muted">{audienceLabel(ann.audience)}</span>
                <span className={`text-body-sm font-medium ${STATUS_COLOR[ann.status] ?? ''}`}>
                  {STATUS_LABEL[ann.status] ?? ann.status}
                  {ann.status === 'sending' && counts ? ` ${counts.sent}/${counts.total}` : ''}
                </span>
                {ann.scheduled_at && ann.status === 'scheduled' && (
                  <span className="text-body-sm text-fg-muted">
                    {new Date(ann.scheduled_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                )}
              </div>
              {(ann.status === 'scheduled' || ann.status === 'sending') && (
                <button
                  type="button"
                  onClick={() => cancelAnnouncement(ann.id)}
                  className="text-body-sm text-danger underline focus-ring"
                >
                  Cancelar comunicado
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className="fixed bottom-24 right-4 h-14 w-14 rounded-full bg-primary text-white shadow-lg flex items-center justify-center focus-ring"
        aria-label="Novo comunicado"
      >
        <Plus size={24} />
      </button>

      <ComunicadoSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/screens/Comunicados.tsx web/src/components/ComunicadoSheet.tsx
git commit -m "feat: add Comunicados screen and ComunicadoSheet component"
```

---

## Task 7: PWA Routing

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/screens/Mais.tsx`

- [ ] **Step 1: Adicionar import e rota em App.tsx**

Adicione o import após os imports existentes das screens:
```tsx
import { Comunicados } from './screens/Comunicados';
```

Adicione a rota após a rota de checklists-templates:
```tsx
<Route path="mais/comunicados" element={<Comunicados />} />
```

- [ ] **Step 2: Adicionar item em Mais.tsx**

No array `items`, adicione após o item `checklists-templates`:
```ts
{ to: '/mais/comunicados', label: 'Comunicados', hint: 'Anúncios para a equipe', requireRoles: ['director', 'coordinator'] },
```

- [ ] **Step 3: Commit**

```bash
git add web/src/App.tsx web/src/screens/Mais.tsx
git commit -m "feat: add /mais/comunicados route and nav item"
```

---

## Task 8: E2E Validation

**Files:** Nenhum arquivo novo — apenas verificações

- [ ] **Step 1: Verificar DB — criar anúncio de teste e jobs**

Execute no Supabase MCP (substitua `<collab_id>` por um UUID de collaborator real):

```sql
-- Inserir anúncio de teste
INSERT INTO announcements (created_by, body, audience, status)
VALUES (
  '<collab_id>',
  'Teste de comunicado interno',
  '{"all": true}',
  'scheduled'
) RETURNING id;
-- Anote o id retornado como <ann_id>

-- Inserir job de teste
INSERT INTO announcement_jobs (announcement_id, phone, status)
VALUES ('<ann_id>', '5521000000001', 'pending');

-- Verificar
SELECT a.status, j.status as job_status
FROM announcements a
JOIN announcement_jobs j ON j.announcement_id = a.id
WHERE a.id = '<ann_id>';
-- Expected: status=scheduled, job_status=pending
```

- [ ] **Step 2: Testar broadcaster manualmente**

```bash
node -e "
require('dotenv').config();
const { dispatchAnnouncements } = require('./src/rituals/dispatcher');
dispatchAnnouncements(new Date()).then(r => { console.log('done'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
"
```

Verificar no Supabase:
```sql
SELECT status, sent_at FROM announcement_jobs WHERE announcement_id = '<ann_id>';
-- Expected: status=sent, sent_at IS NOT NULL (se UAZAPI estava disponível)
-- ou status=failed com retry_count=1 (se UAZAPI offline — comportamento correto)
```

- [ ] **Step 3: Testar cancel + retratação**

```sql
-- Inserir novo anúncio + 2 jobs (1 sent, 1 pending)
INSERT INTO announcements (created_by, body, audience, status)
VALUES ('<collab_id>', 'Comunicado para cancelar', '{"all": true}', 'sending')
RETURNING id;
-- Anote <ann2_id>

INSERT INTO announcement_jobs (announcement_id, phone, status, sent_at)
VALUES ('<ann2_id>', '5521000000001', 'sent', now());

INSERT INTO announcement_jobs (announcement_id, phone, status)
VALUES ('<ann2_id>', '5521000000002', 'pending');

-- Cancelar
UPDATE announcements SET status = 'cancelled' WHERE id = '<ann2_id>';
```

Rodar dispatcher novamente. Verificar:
```sql
SELECT status FROM announcement_jobs WHERE announcement_id = '<ann2_id>';
-- Expected: sent (primeiro job), cancelled (segundo job)
SELECT cancel_retraction_sent FROM announcements WHERE id = '<ann2_id>';
-- Expected: true
```

- [ ] **Step 4: Verificar PWA — tela de Comunicados**

1. Iniciar dev server: `cd web && npm run dev`
2. Abrir Simple Browser
3. Logar como director/coordinator
4. Ir em `/mais` → verificar item "Comunicados" aparece
5. Clicar → `/mais/comunicados` abre
6. Clicar FAB `+` → sheet abre com campos: Mensagem, Público, Agendar envio
7. Criar comunicado de teste com "Todos" + imediato → salvar
8. Card aparece na lista com status "Agendado" (enquanto aguarda o cron)
9. Logar como colaborador comum → `/mais` → item "Comunicados" NÃO aparece

- [ ] **Step 5: Verificar TOM skill — simular pedido no chat**

Enviar via WhatsApp (logado como director):
> "TOM, avisa todo mundo que amanhã não tem aula"

Verificar:
- TOM responde com resumo: "Público: Todos · Mensagem: 'Amanhã não tem aula' · Envio: imediato · Confirma?"
- Responder "sim"
- TOM responde "Comunicado criado para X pessoas. ✓" (ou "Comunicado despachado. ✓")
- Verificar no Supabase: registro em `announcements` + jobs em `announcement_jobs`

- [ ] **Step 6: Commit final de validação**

```bash
git add -A
git commit -m "feat: Sprint 13 Fatia 1 — MVP Anúncio Segmentado completo"
```

---

## Self-Review

**Spec coverage:**
- ✅ Interface TOM + PWA (Tasks 2, 3, 6)
- ✅ Segmentação unidade/função/turno/broadcast (Tasks 3, 6)
- ✅ Permissão director+coordinator (Tasks 1 RLS, 2 skill, 6 requireRoles)
- ✅ Agendamento imediato + data/hora (Tasks 1 scheduled_at, 6 ComunicadoSheet)
- ✅ TOM flow resumo → confirma → marker (Task 2 skill, Task 3)
- ✅ Cancelamento jobs pendentes + retratação (Tasks 1, 4)
- ✅ PWA location /mais/comunicados (Tasks 6, 7)
- ✅ Rate 1 msg/min via cron (Task 4 — 1 job por tick)
- ✅ Error handling: sem destinatários, sem phone, retry 3x (Tasks 3, 4, 6)

**Tipos consistentes entre tasks:**
- `Announcement.audience` usa `AnnouncementAudience` — consistente em types.ts, engine.js, ComunicadoSheet.tsx
- `announcement_jobs` usa `announcement_id` (snake_case) — consistente em migration, dispatcher, Comunicados.tsx
- `audience.unidade` vs `collaborators.unit` — mapeamento correto em engine.js (`q.in('unit', audience.unidade)`) e ComunicadoSheet.tsx (query usa `unit`)
- `audience.turno` vs `collaborators.shift` — mapeamento correto em engine.js (`q.in('shift', audience.turno)`)
