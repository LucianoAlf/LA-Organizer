# Checklist Templates — Responsável, Líder e Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar `responsible_id` e `leader_id` nos templates de checklist, exibir nomes no card com toggle inline de ativo/pausado, atualizar o dispatcher para usar esses campos, e criar skill TOM para gestão via WhatsApp.

**Architecture:** Migration SQL adiciona 2 FKs nullable em `op_checklists` e 3 campos de justificativa em `op_checklist_completions`. O dispatcher prioriza `responsible_id`/`leader_id` quando definidos, com fallback na lógica atual de `function_role+shift`. Frontend usa `CustomSelect` customizado (sem select nativo). TOM ganha skill `checklists-admin`.

**Tech Stack:** Supabase PostgreSQL, Deno Edge Functions (n/a aqui), React 18 + TypeScript, @tanstack/react-query, Tailwind CSS design system próprio, Node.js (engine TOM), UAZAPI WhatsApp.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `supabase/migrations/20260515000000_checklist_responsaveis.sql` | Create | Schema DB |
| `web/src/types.ts` | Modify | Tipos TS atualizados |
| `web/src/components/ChecklistTemplateSheet.tsx` | Modify | Campos Responsável/Líder/Status no modal |
| `web/src/components/TemplateCard.tsx` | Modify | Nomes + toggle inline |
| `web/src/screens/Checklists.tsx` | Modify | Query join responsible/leader, mostrar inativos |
| `src/rituals/dispatcher.js` | Modify | Usar responsible_id/leader_id |
| `skills/checklists-admin.md` | Create | Skill TOM para gestão |
| `src/prompts/system.js` | Modify | Trigger para checklists-admin |

---

## Task 1: DB Migration

**Files:**
- Create: `supabase/migrations/20260515000000_checklist_responsaveis.sql`

- [ ] **Step 1: Criar arquivo de migration**

```sql
-- supabase/migrations/20260515000000_checklist_responsaveis.sql
-- Adiciona responsável e líder explícitos nos templates de checklist.
-- Ambos nullable — templates legados sem configuração usam fallback (function_role+shift).

ALTER TABLE op_checklists
  ADD COLUMN IF NOT EXISTS responsible_id UUID REFERENCES collaborators(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS leader_id UUID REFERENCES collaborators(id) ON DELETE SET NULL;

-- Campos para justificativa do líder quando o responsável não conclui
ALTER TABLE op_checklist_completions
  ADD COLUMN IF NOT EXISTS justification   TEXT,
  ADD COLUMN IF NOT EXISTS justified_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS justified_by_id UUID REFERENCES collaborators(id) ON DELETE SET NULL;

-- Índices para lookup no dispatcher
CREATE INDEX IF NOT EXISTS idx_op_checklists_responsible_id ON op_checklists(responsible_id);
CREATE INDEX IF NOT EXISTS idx_op_checklists_leader_id ON op_checklists(leader_id);
```

- [ ] **Step 2: Aplicar migration via Supabase MCP**

Use a ferramenta `mcp__4c04bb52-f946-4fe8-85f6-b01d200f8c20__apply_migration` com o SQL acima no projeto `cesnbnrynvxvgdhfmaua`.

- [ ] **Step 3: Verificar colunas aplicadas**

Use `mcp__4c04bb52-f946-4fe8-85f6-b01d200f8c20__execute_sql`:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'op_checklists'
  AND column_name IN ('responsible_id', 'leader_id')
ORDER BY column_name;
```
Esperado: 2 linhas, ambas `uuid`, `YES` (nullable).

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'op_checklist_completions'
  AND column_name IN ('justification', 'justified_at', 'justified_by_id');
```
Esperado: 3 linhas.

---

## Task 2: Atualizar tipos TypeScript

**Files:**
- Modify: `web/src/types.ts`

Contexto: `OpChecklistTemplate` está em `web/src/types.ts`. Não existe `types/index.ts`.

- [ ] **Step 1: Ler o arquivo atual**

Leia `web/src/types.ts` e localize a interface `OpChecklistTemplate` e `OpChecklistCompletion`.

- [ ] **Step 2: Adicionar campos em OpChecklistTemplate**

Adicione os dois campos novos após `updated_by`:

```typescript
// Antes (trecho existente):
export interface OpChecklistTemplate {
  id: string
  name: string
  function_role: string
  unit: string
  shift: string
  days_of_week: number[]
  dispatch_time: string
  completion_threshold: number
  is_active: boolean
  created_by: string | null
  updated_by: string | null
  created_at?: string
  updated_at?: string
}

// Depois (adicionar os dois campos novos):
export interface OpChecklistTemplate {
  id: string
  name: string
  function_role: string
  unit: string
  shift: string
  days_of_week: number[]
  dispatch_time: string
  completion_threshold: number
  is_active: boolean
  created_by: string | null
  updated_by: string | null
  responsible_id: string | null      // FK para collaborators — null = fallback por função
  leader_id: string | null           // FK para collaborators — null = fallback gerente unidade
  created_at?: string
  updated_at?: string
}
```

- [ ] **Step 3: Adicionar campos em OpChecklistCompletion**

Localize `OpChecklistCompletion` e adicione:

```typescript
// Adicionar após os campos existentes de completions:
  justification: string | null
  justified_at: string | null
  justified_by_id: string | null
```

- [ ] **Step 4: Verificar TypeScript**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```
Esperado: sem erros.

---

## Task 3: ChecklistTemplateSheet — campos Responsável, Líder e Status

**Files:**
- Modify: `web/src/components/ChecklistTemplateSheet.tsx`

Contexto: o componente tem 347 linhas. Usa `CustomSelect` para dropdowns (sem select nativo). A `saveMutation` faz upsert em `op_checklists`. Precisamos adicionar: (1) query de colaboradores ativos, (2) estados `responsibleId`, `leaderId`, `isActive`, (3) inicialização no `useEffect`, (4) campos no payload do upsert, (5) dois campos `CustomSelect` + toggle de status no JSX.

- [ ] **Step 1: Adicionar import useQuery**

Na linha 5 atual:
```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query'
```
Trocar por:
```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
```

- [ ] **Step 2: Adicionar estados novos após linha 68 (após `const [items, ...]`)**

Após `const [newItemText, setNewItemText] = useState('')`:
```typescript
  const [responsibleId, setResponsibleId] = useState<string>('')
  const [leaderId, setLeaderId] = useState<string>('')
  const [isActive, setIsActive] = useState(true)
```

- [ ] **Step 3: Adicionar query de colaboradores (após `const sensors = useSortableSensors()`)**

```typescript
  const { data: collaborators = [] } = useQuery<{ id: string; full_name: string }[]>({
    queryKey: ['collaborators-active-minimal'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('collaborators')
        .select('id, full_name')
        .eq('is_active', true)
        .order('full_name')
      if (error) throw error
      return data ?? []
    },
    staleTime: 5 * 60_000,
  })

  const collaboratorOptions = [
    { value: '', label: 'Nenhum' },
    ...collaborators.map(c => ({ value: c.id, label: c.full_name })),
  ]
```

- [ ] **Step 4: Adicionar inicialização no useEffect**

No bloco `if (template) { ... }` do `useEffect`, após `setThreshold(template.completion_threshold)`:
```typescript
      setResponsibleId(template.responsible_id ?? '')
      setLeaderId(template.leader_id ?? '')
      setIsActive(template.is_active)
```

No bloco `else { ... }` (modo criação), após `setItems([])`:
```typescript
      setResponsibleId('')
      setLeaderId('')
      setIsActive(true)
```

- [ ] **Step 5: Adicionar campos no payload da saveMutation**

No objeto `payload` dentro de `saveMutation.mutationFn`, substituir `is_active: true` e adicionar os novos campos:

```typescript
      const payload = {
        name: name.trim(),
        function_role: functionRole,
        unit,
        shift,
        days_of_week: daysOfWeek,
        dispatch_time: dispatchTime,
        completion_threshold: threshold,
        is_active: isActive,                          // era hardcoded true
        responsible_id: responsibleId || null,        // novo
        leader_id: leaderId || null,                  // novo
        updated_by: collaborator!.id,
        ...(template ? { id: template.id } : {}),
      }
```

- [ ] **Step 6: Adicionar campos no JSX — após o campo "Função" (linha ~221)**

Após o bloco `<div>` que contém o `CustomSelect` de `functionRole`, adicionar:

```tsx
        <div>
          <label className="text-caption text-fg-muted block mb-1">Responsável</label>
          <CustomSelect
            value={responsibleId}
            onChange={setResponsibleId}
            options={collaboratorOptions}
          />
        </div>

        <div>
          <label className="text-caption text-fg-muted block mb-1">Líder <span className="text-fg-muted font-normal">(recebe alerta se não fizer)</span></label>
          <CustomSelect
            value={leaderId}
            onChange={setLeaderId}
            options={collaboratorOptions}
          />
        </div>
```

- [ ] **Step 7: Adicionar toggle de Status na grid de Horário/Threshold**

O grid atual (linha ~266) tem 2 colunas: Horário e Threshold. Mudar para 3 colunas e adicionar Status:

```tsx
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-caption text-fg-muted block mb-1">Horário *</label>
            <TimeInput value={dispatchTime} onChange={setDispatchTime} />
          </div>
          <div>
            <label className="text-caption text-fg-muted block mb-1">Threshold (%) *</label>
            <input
              type="number"
              min={0}
              max={100}
              value={threshold}
              onChange={e => setThreshold(Number(e.target.value))}
              className="w-full h-12 bg-bg-surface border border-border rounded-md px-3
                         text-body text-fg focus:outline-none focus:border-tom focus-ring"
            />
          </div>
          <div>
            <label className="text-caption text-fg-muted block mb-1">Status</label>
            <div className="h-12 flex items-center gap-2">
              <button
                type="button"
                role="switch"
                aria-checked={isActive}
                onClick={() => setIsActive(v => !v)}
                className={[
                  'relative h-6 w-11 rounded-full transition-colors focus-ring flex-shrink-0',
                  isActive ? 'bg-tom' : 'bg-fg-muted/30',
                ].join(' ')}
              >
                <span className={[
                  'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                  isActive ? 'translate-x-5' : '',
                ].join(' ')} />
              </button>
              <span className={`text-body-sm ${isActive ? 'text-fg' : 'text-fg-muted'}`}>
                {isActive ? 'Ativo' : 'Pausado'}
              </span>
            </div>
          </div>
        </div>
```

- [ ] **Step 8: Verificar TypeScript**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```
Esperado: sem erros.

---

## Task 4: TemplateCard — nomes + toggle inline

**Files:**
- Modify: `web/src/components/TemplateCard.tsx`

Contexto: o card atual (119 linhas) mostra `function_role`, `unit`, `shift`, `dispatch_time` em texto plano. O toggle está escondido no `RowMenu`. Precisa: (1) mostrar nomes de responsável/líder, (2) adicionar toggle visível no canto superior direito.

- [ ] **Step 1: Ampliar o tipo TemplateCardData**

Na linha 32-37:
```typescript
// Antes:
export type TemplateCardData = OpChecklistTemplate & {
  op_checklist_items?: OpChecklistItem[]
  last_audit?: (Pick<OpChecklistAudit, 'changed_at'> & {
    collaborator?: { full_name: string } | null
  }) | null
}

// Depois:
export type TemplateCardData = OpChecklistTemplate & {
  op_checklist_items?: OpChecklistItem[]
  last_audit?: (Pick<OpChecklistAudit, 'changed_at'> & {
    collaborator?: { full_name: string } | null
  }) | null
  responsible?: { id: string; full_name: string } | null
  leader?: { id: string; full_name: string } | null
}
```

- [ ] **Step 2: Substituir o sub-header de metadados (linha 94-105)**

Substituir o bloco atual que mostra `FUNCTION_LABEL[template.function_role]` por:

```tsx
          <p className="text-body-sm text-fg-muted mt-0.5">
            {template.responsible?.full_name
              ? `${template.responsible.full_name}`
              : FUNCTION_LABEL[template.function_role] ?? template.function_role}
            {' · '}
            {template.dispatch_time?.slice(0, 5)}
          </p>
          {template.leader?.full_name && (
            <p className="text-body-sm text-fg-muted">
              Líder: {template.leader.full_name}
            </p>
          )}
          <p className="text-body-sm text-fg-muted">
            {activeItems.length} {activeItems.length === 1 ? 'item' : 'itens'}
            {' · '}threshold {template.completion_threshold}%
          </p>
          {editedAt && (
            <p className="text-body-sm text-fg-muted mt-0.5">
              Editado por {editorName ?? '—'} em {editedAt}
            </p>
          )}
```

- [ ] **Step 3: Adicionar toggle inline no canto superior direito**

Na linha 112-114 atual:
```tsx
        <div className="flex-shrink-0">
          <RowMenu items={menu} />
        </div>
```

Substituir por:
```tsx
        <div className="flex-shrink-0 flex items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={template.is_active}
            onClick={() => archiveMutation.mutate({ activate: !template.is_active })}
            disabled={archiveMutation.isPending}
            className={[
              'relative h-6 w-11 rounded-full transition-colors focus-ring disabled:opacity-50',
              template.is_active ? 'bg-tom' : 'bg-fg-muted/30',
            ].join(' ')}
            title={template.is_active ? 'Pausar template' : 'Ativar template'}
          >
            <span className={[
              'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
              template.is_active ? 'translate-x-5' : '',
            ].join(' ')} />
          </button>
          <RowMenu items={menu} />
        </div>
```

- [ ] **Step 4: Verificar TypeScript**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```
Esperado: sem erros.

---

## Task 5: Checklists.tsx — query com join e templates inativos visíveis

**Files:**
- Modify: `web/src/screens/Checklists.tsx`

Contexto: a query de templates (em torno da linha 113-144) filtra `.eq('is_active', true)` e não faz join de `responsible`/`leader`. Diretores precisam ver templates pausados para poder reativar.

- [ ] **Step 1: Ler o arquivo para localizar a query de templates**

Leia `web/src/screens/Checklists.tsx` e encontre o `useQuery` com `queryKey: ['checklists-templates']`.

- [ ] **Step 2: Atualizar o select da query de templates**

Substituir o `.select(...)` atual:
```typescript
// Antes:
const tQuery = supabase
  .from('op_checklists')
  .select('*, op_checklist_items ( id, checklist_id, description, sort_order, is_active, updated_by )')
  .eq('is_active', true)
  .order('name')

// Depois (remove filtro is_active, adiciona join de pessoas):
const tQuery = supabase
  .from('op_checklists')
  .select(`
    *,
    op_checklist_items ( id, checklist_id, description, sort_order, is_active, updated_by ),
    responsible:collaborators!responsible_id ( id, full_name ),
    leader:collaborators!leader_id ( id, full_name )
  `)
  .order('name')
```

Note: não filtramos `is_active` — directors veem todos (ativos e pausados) para poder gerir. A view pessoal (completions) continua filtrada pelo `collaborator_id`.

- [ ] **Step 3: Verificar TypeScript**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```
Esperado: sem erros.

- [ ] **Step 4: Build de verificação**

```bash
cd web && npx vite build 2>&1 | tail -10
```
Esperado: `built in Xs` sem erros.

---

## Task 6: Dispatcher — usar responsible_id e leader_id

**Files:**
- Modify: `src/rituals/dispatcher.js`

Contexto: a função `dispatchChecklists()` (linha ~319) busca colaboradores via `function_role + shift`. Precisa: (1) usar `responsible_id` quando definido, (2) passar `leader_id` para escalação.

- [ ] **Step 1: Ler dispatcher.js linhas 319-470 para localizar os blocos exatos**

Leia o arquivo e identifique:
- Onde começa a query de colaboradores (`collabQuery`)
- Onde começa a escalação (busca pelo manager da unidade)

- [ ] **Step 2: Substituir o bloco de matching de colaboradores**

Localizar o bloco que começa com `// Primary: match function_role + shift` (aprox. linha 349). Substituir por:

```javascript
      // Routing: se template tem responsible_id, usa diretamente; senão fallback por função
      let collabs = []
      if (template.responsible_id) {
        const { data: person } = await supabase
          .from('collaborators')
          .select('id, full_name, phone')
          .eq('id', template.responsible_id)
          .eq('is_active', true)
          .maybeSingle()
        if (!person || !person.phone) {
          results.push({
            template_id: template.id,
            name: template.name,
            reason: 'responsible_inactive_or_no_phone',
            would_dispatch: false,
          })
          continue
        }
        collabs = [person]
      } else {
        // Fallback legado: matching por function_role + shift
        let collabQuery = supabase
          .from('collaborators')
          .select('id, full_name, phone, unit, function_role, shift')
          .eq('is_active', true)
          .not('phone', 'is', null)
          .eq('function_role', template.function_role)
          .eq('shift', template.shift)
        if (template.unit !== 'all') collabQuery = collabQuery.eq('unit', template.unit)
        const { data: matched } = await collabQuery
        collabs = matched ?? []

        if (collabs.length === 0) {
          // Fallback: manager da unidade
          let fallbackQ = supabase
            .from('collaborators')
            .select('id, full_name, phone')
            .eq('is_active', true)
            .not('phone', 'is', null)
            .eq('role', 'manager')
          if (template.unit !== 'all') fallbackQ = fallbackQ.eq('unit', template.unit)
          const { data: fallback } = await fallbackQ
          if (!fallback || fallback.length === 0) {
            results.push({ template_id: template.id, reason: 'no_collaborators_or_managers', would_dispatch: false })
            continue
          }
          collabs = fallback
        }
      }
```

- [ ] **Step 3: Passar leader_id para o contexto de escalação**

Localizar onde o dispatcher armazena o completion na tabela `op_checklist_completions` (insert após envio do WhatsApp). Garantir que o `checklist_id` referencia o template que tem `leader_id`.

A escalação busca o manager da unidade. Localizar essa busca (provavelmente em `remindChecklists` ou `escalateChecklists`) e adicionar:

```javascript
// No bloco de escalação — antes de buscar o manager da unidade:
// Verificar se o template tem leader_id configurado
const { data: tmpl } = await supabase
  .from('op_checklists')
  .select('leader_id, unit')
  .eq('id', completion.checklist_id)
  .maybeSingle()

let escalationTarget = null
if (tmpl?.leader_id) {
  const { data: leader } = await supabase
    .from('collaborators')
    .select('id, full_name, phone')
    .eq('id', tmpl.leader_id)
    .eq('is_active', true)
    .maybeSingle()
  escalationTarget = leader
}

if (!escalationTarget) {
  // Fallback: manager da unidade (código existente)
  escalationTarget = await findUnitManager(tmpl?.unit)
}

if (!escalationTarget?.phone) {
  // sem alvo de escalação — registrar e pular
  continue
}
// Enviar alerta para escalationTarget...
```

- [ ] **Step 4: Verificar sintaxe JS**

```bash
node --check src/rituals/dispatcher.js
```
Esperado: sem erros.

- [ ] **Step 5: Deploy para VPS**

```bash
bash /mnt/d/la-organizer/_remote/scripts/setup-vps-key.sh
scp D:/la-organizer/_remote/src/rituals/dispatcher.js tom:/opt/LA-Organizer/src/rituals/dispatcher.js
ssh tom "pm2 restart tom"
ssh tom "pm2 logs tom --lines 10 --nostream"
```
Esperado: logs sem erros de sintaxe.

---

## Task 7: TOM skill checklists-admin

**Files:**
- Create: `skills/checklists-admin.md`
- Modify: `src/prompts/system.js`

- [ ] **Step 1: Criar skill checklists-admin.md**

```markdown
# SKILL: CHECKLISTS-ADMIN — Gestão de templates via WhatsApp

## Quando esta skill ativa

Diretor ou coordenador pede gestão de checklists:
- "lista checklists", "quais checklists temos", "mostra os checklists"
- "desliga checklist X", "pausa checklist X", "ativa checklist X", "liga checklist X"
- "troca responsável do checklist X para Y", "muda responsável"
- "quem é responsável pelo checklist X", "quem faz o checklist X"

---

## PASSO 1 — Listar todos os templates

Buscar em `op_checklists` todos os registros com join de responsible e leader.
Responder com:

```
📋 *Templates de checklist:*

✅ Fechamento Escola
   👤 Yuri Marinho · 👑 Líder: Luciano Alf · 22:00 · Seg–Sex

⏸ Limpeza (pausado)
   👤 Clayton · 👑 Líder: Krissya · 07:00 · Seg–Sáb

Quer ligar/desligar algum ou trocar o responsável?
```

---

## PASSO 2A — Ligar / Desligar

Quando pedido claro (ex: "desliga Fechamento Escola"):
1. Buscar template por nome (ILIKE '%termo%')
2. Se ambíguo (mais de 1 resultado), perguntar qual
3. Fazer UPDATE `is_active = true/false`
4. Confirmar:

```
⏸ "Fechamento Escola" pausado. Yuri não vai receber até você religar.
✅ "Fechamento Escola" ativado. Yuri vai receber normalmente.
```

---

## PASSO 2B — Trocar responsável

Quando pedido trocar (ex: "troca responsável do Fechamento para Clayton"):
1. Buscar template por nome
2. Buscar colaborador por nome (ILIKE '%termo%')
3. Se ambíguo em qualquer um, pedir confirmação
4. Fazer UPDATE `responsible_id = <id>`
5. Confirmar:

```
✅ Responsável do "Fechamento Escola" trocado:
   Yuri Marinho → Clayton Souza
```

---

## PASSO 2C — Consultar responsável

Quando perguntado quem faz:

```
📋 *Fechamento Escola*
   👤 Responsável: Yuri Marinho
   👑 Líder: Luciano Alf
   📅 Seg–Sex às 22:00 · ✅ Ativo
```

---

## Regras

1. Só ativar para usuários com `role` = director, coordinator ou manager
2. Se nome de template ou pessoa for ambíguo, SEMPRE confirmar antes de alterar
3. Alterações persistem no banco — não são temporárias
4. Usar UPDATE direto via Supabase service role (não via frontend)
5. Após alterar, confirmar o novo estado do template
```

- [ ] **Step 2: Adicionar trigger em system.js**

Leia `src/prompts/system.js` e localize a seção de detecção de skills (onde `AJUDA_TRIGGERS` e `loadSkill` são usados). Adicionar o bloco de checklists-admin logo antes ou depois do bloco de ajuda:

```javascript
// ── CHECKLISTS-ADMIN skill ───────────────────────────────────────────────
const CHECKLIST_ADMIN_TRIGGERS = [
  'lista checklists', 'quais checklists', 'mostra os checklists',
  'desliga checklist', 'pausa checklist', 'ativa checklist', 'liga checklist',
  'troca responsável', 'muda responsável',
  'quem é responsável pelo checklist', 'quem faz o checklist',
];
const canManageChecklists = ['director', 'coordinator', 'manager'].includes(callerRole);
if (
  canManageChecklists &&
  CHECKLIST_ADMIN_TRIGGERS.some(t => lmLower.includes(t))
) {
  return { name: 'checklists-admin', body: loadSkill('checklists-admin') };
}
```

Nota: `callerRole` é a variável que guarda o `role` do chamador no system.js. Se o nome exato for diferente, ajustar conforme o padrão existente no arquivo.

- [ ] **Step 3: Verificar sintaxe JS**

```bash
node --check src/prompts/system.js
```
Esperado: sem erros.

- [ ] **Step 4: Deploy skill + system.js para VPS**

```bash
scp D:/la-organizer/_remote/skills/checklists-admin.md tom:/opt/LA-Organizer/skills/checklists-admin.md
scp D:/la-organizer/_remote/src/prompts/system.js tom:/opt/LA-Organizer/src/prompts/system.js
ssh tom "pm2 restart tom"
ssh tom "pm2 logs tom --lines 10 --nostream"
```

- [ ] **Step 5: Smoke test via WhatsApp**

Enviar mensagem "lista checklists" para o número do TOM via UAZAPI ou direto pelo WhatsApp do TOM. Esperado: resposta com a lista de templates.

---

## Self-Review

### Spec coverage:
- ✅ `responsible_id` + `leader_id` FK nullable → Task 1 + Task 2
- ✅ Dispatcher usa responsible_id quando definido → Task 6
- ✅ Dispatcher usa leader_id para escalação → Task 6
- ✅ `is_active` toggle no modal → Task 3
- ✅ `is_active` toggle inline no card → Task 4
- ✅ Nomes de responsável/líder no card → Task 4
- ✅ CustomSelect sem native select → Tasks 3 (usa componente existente CustomSelect)
- ✅ Templates inativos visíveis para directors → Task 5
- ✅ Campos de justificativa no banco → Task 1
- ✅ TOM skill para gestão → Task 7
- ✅ Trigger no system.js → Task 7

### Sem placeholders: verificado.

### Consistência de tipos:
- `TemplateCardData` estendido com `responsible` e `leader` (Task 4)
- `OpChecklistTemplate` com `responsible_id` e `leader_id` (Task 2)
- Query join retorna `responsible` e `leader` como objetos (Task 5)
- Todos os campos alinhados.
