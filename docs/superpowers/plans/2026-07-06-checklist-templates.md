# Modelos de Checklist — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Templates de checklist nomeados, compartilhados no time, aplicáveis na criação/delegação de tarefas no PWA (Agenda + Grupos, mobile + desktop) e via TOM (WhatsApp).

**Architecture:** Tabela nova `checklist_templates` (RLS team-shared). No PWA, tudo acontece na seção CHECKLIST do `QuickCreateSheet` (picker + salvar como modelo + sheet de gestão CRUD). No TOM, os modelos entram no system prompt (`src/prompts/system.js`) com regra de cópia exata para `subtasks:[...]` — o engine já materializa filhas (engine.js:5312); **zero mudança em engine.js**.

**Tech Stack:** Supabase (Postgres + RLS), React 18 + TypeScript + react-query + Tailwind (DS próprio), vitest, Node CommonJS (engine/prompts).

## Global Constraints

- Spec: `docs/superpowers/plans/../specs/2026-07-06-checklist-templates-design.md` (decisões: team-shared; app+TOM; CRUD completo inline; NÃO usar `op_checklists`).
- Design System obrigatório: `CustomSelect`, `Button`, `ConfirmDialog`, `BottomSheet`/`AdaptiveSheet`, tokens `bg-bg-surface/text-fg/border-border/text-tom`. NUNCA `<select>` nativo.
- **NÃO commitar manualmente** — o Stop hook (auto-deploy) commita `_remote/` no fim do turno. Migrations aplicadas via Supabase MCP (`apply_migration`), projeto `cesnbnrynvxvgdhfmaua`. Passos "Commit" dos templates de task = N/A.
- Engine-side: editar SOMENTE `src/prompts/system.js`. ANTES de editar, baixar cópia fresca da VPS (`scp tom:/opt/LA-Organizer/src/prompts/system.js ...`) — local pode divergir. Deploy: `node --check` + scp de volta + `pm2 restart tom` + conferir logs.
- Mobile 375px E desktop 1440px testados antes de encerrar (38 rotas sagradas).
- RLS: usar `current_collab_id()` e `current_collab_role()` (NUNCA `auth.uid()`). UI espelha EXATAMENTE a política RLS (lição DELEGATE-EDIT-COORD-GATE-TRAP: política divergente criar↔editar = armadilha).

---

### Task 1: Migration `checklist_templates` + RLS + seed

**Files:**
- Create: `supabase/migrations/20260706_checklist_templates.sql` (cópia do SQL aplicado, para histórico)
- Aplicar via MCP `apply_migration` (name: `checklist_templates`)

**Interfaces:**
- Produces: tabela `checklist_templates(id uuid, name text, items jsonb, created_by uuid, created_at, updated_at)`; RLS: SELECT/INSERT todo colaborador; UPDATE/DELETE criador ou coordinator/director.

- [ ] **Step 1: Aplicar a migration** (via `mcp apply_migration`, project `cesnbnrynvxvgdhfmaua`):

```sql
CREATE TABLE checklist_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80),
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NOT NULL REFERENCES collaborators(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX checklist_templates_name_uq ON checklist_templates (lower(trim(name)));

ALTER TABLE checklist_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_read_checklist_templates ON checklist_templates
  FOR SELECT TO authenticated USING (true);
CREATE POLICY auth_insert_checklist_templates ON checklist_templates
  FOR INSERT TO authenticated WITH CHECK (created_by = current_collab_id());
CREATE POLICY auth_update_checklist_templates ON checklist_templates
  FOR UPDATE TO authenticated USING (
    created_by = current_collab_id()
    OR current_collab_role() = ANY (ARRAY['coordinator'::text, 'director'::text])
  );
CREATE POLICY auth_delete_checklist_templates ON checklist_templates
  FOR DELETE TO authenticated USING (
    created_by = current_collab_id()
    OR current_collab_role() = ANY (ARRAY['coordinator'::text, 'director'::text])
  );

-- Seed (auditoria 06/07): funil do Jonathan + funil da Vitoria. created_by = Admin.
INSERT INTO checklist_templates (name, items, created_by)
SELECT 'Aula Experimental (visita)',
       '["Mensagem enviada","Cliente respondeu","Visita agendada","Aluno fez a Experimental"]'::jsonb,
       id FROM collaborators WHERE full_name = 'Admin' LIMIT 1;
INSERT INTO checklist_templates (name, items, created_by)
SELECT 'Contato com aluno (cobrança)',
       '["Enviei mensagem para o aluno","Aguardando resposta","Aluno respondeu — aguardando pagamento","Resolvido"]'::jsonb,
       id FROM collaborators WHERE full_name = 'Admin' LIMIT 1;
```

- [ ] **Step 2: Verificar** com `execute_sql`:
```sql
SELECT name, jsonb_array_length(items) AS n, created_by IS NOT NULL AS tem_dono
FROM checklist_templates ORDER BY name;
```
Expected: 2 linhas ("Aula Experimental (visita)" n=4; "Contato com aluno (cobrança)" n=4), `tem_dono=true`.

- [ ] **Step 3:** Salvar o mesmo SQL em `supabase/migrations/20260706_checklist_templates.sql`.

---

### Task 2: Lib `checklistTemplates.ts` (tipos + I/O + helper puro) — TDD

**Files:**
- Create: `web/src/lib/checklistTemplates.ts`
- Test: `web/src/lib/checklistTemplates.test.ts`

**Interfaces:**
- Produces:
  - `interface ChecklistTemplate { id: string; name: string; items: string[]; created_by: string }`
  - `applyTemplate(draft: string[], tplItems: string[]): string[]` — append dos itens do modelo que ainda NÃO existem no rascunho (match exato após trim); preserva ordem do modelo.
  - `normalizeTemplateName(raw: string): string | null` — trim; retorna null se length < 2 ou > 80.
  - `canManageTemplate(t: Pick<ChecklistTemplate,'created_by'>, meuId: string | undefined, role: string | undefined): boolean` — criador OU role coordinator/director (espelha RLS EXATAMENTE; NÃO usar hasCoordLevel/has_coord_permissions).
  - I/O: `listTemplates(): Promise<ChecklistTemplate[]>` (order name), `createTemplate(name, items, collabId)`, `updateTemplate(id, patch: { name?: string; items?: string[] })` (seta `updated_at`), `deleteTemplate(id)`.

- [ ] **Step 1: Teste falhando** — `web/src/lib/checklistTemplates.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { applyTemplate, normalizeTemplateName, canManageTemplate } from './checklistTemplates';

describe('applyTemplate', () => {
  it('preenche rascunho vazio com os itens do modelo', () => {
    expect(applyTemplate([], ['a', 'b'])).toEqual(['a', 'b']);
  });
  it('faz append preservando itens já digitados', () => {
    expect(applyTemplate(['x'], ['a', 'b'])).toEqual(['x', 'a', 'b']);
  });
  it('não duplica item que já existe (match exato com trim)', () => {
    expect(applyTemplate(['Mensagem enviada'], ['Mensagem enviada ', 'Cliente respondeu']))
      .toEqual(['Mensagem enviada', 'Cliente respondeu']);
  });
});

describe('normalizeTemplateName', () => {
  it('trim + aceita 2..80', () => expect(normalizeTemplateName('  Experimental ')).toBe('Experimental'));
  it('rejeita curto', () => expect(normalizeTemplateName(' a ')).toBeNull());
  it('rejeita > 80', () => expect(normalizeTemplateName('x'.repeat(81))).toBeNull());
});

describe('canManageTemplate', () => {
  const t = { created_by: 'u1' };
  it('criador pode', () => expect(canManageTemplate(t, 'u1', 'collaborator')).toBe(true));
  it('coord/director podem', () => {
    expect(canManageTemplate(t, 'u2', 'coordinator')).toBe(true);
    expect(canManageTemplate(t, 'u2', 'director')).toBe(true);
  });
  it('manager NÃO (espelha RLS)', () => expect(canManageTemplate(t, 'u2', 'manager')).toBe(false));
});
```

- [ ] **Step 2:** `cd _remote/web && npx vitest run src/lib/checklistTemplates.test.ts` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar** `web/src/lib/checklistTemplates.ts`:

```ts
// Modelos de checklist compartilhados no time (demanda Jonathan ADM 06/07).
// Tabela checklist_templates — spec docs/superpowers/specs/2026-07-06-checklist-templates-design.md
// canManageTemplate espelha EXATAMENTE a RLS (criador OU coordinator/director) — nunca
// divergir UI de política (lição DELEGATE-EDIT-COORD-GATE-TRAP).
import { supabase } from './supabase';

export interface ChecklistTemplate { id: string; name: string; items: string[]; created_by: string }

export function applyTemplate(draft: string[], tplItems: string[]): string[] {
  const have = new Set(draft.map((s) => s.trim()));
  const add = tplItems.map((s) => s.trim()).filter((s) => s && !have.has(s));
  return [...draft, ...add];
}

export function normalizeTemplateName(raw: string): string | null {
  const name = (raw || '').trim();
  return name.length >= 2 && name.length <= 80 ? name : null;
}

export function canManageTemplate(
  t: Pick<ChecklistTemplate, 'created_by'>, meuId: string | undefined, role: string | undefined,
): boolean {
  if (!meuId) return false;
  return t.created_by === meuId || role === 'coordinator' || role === 'director';
}

export async function listTemplates(): Promise<ChecklistTemplate[]> {
  const { data, error } = await supabase
    .from('checklist_templates').select('id, name, items, created_by').order('name');
  if (error) throw error;
  return (data ?? []).map((t) => ({ ...t, items: Array.isArray(t.items) ? t.items : [] })) as ChecklistTemplate[];
}

export async function createTemplate(name: string, items: string[], collabId: string): Promise<ChecklistTemplate> {
  const { data, error } = await supabase
    .from('checklist_templates')
    .insert({ name, items, created_by: collabId })
    .select('id, name, items, created_by').single();
  if (error) throw error;
  return data as ChecklistTemplate;
}

export async function updateTemplate(id: string, patch: { name?: string; items?: string[] }): Promise<void> {
  const { error } = await supabase
    .from('checklist_templates')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('checklist_templates').delete().eq('id', id);
  if (error) throw error;
}

// Erro amigável pro índice único de nome (23505).
export const isDupName = (e: unknown): boolean =>
  typeof (e as { code?: string })?.code === 'string' && (e as { code: string }).code === '23505';
```

- [ ] **Step 4:** `npx vitest run src/lib/checklistTemplates.test.ts` → PASS (8 testes).

---

### Task 3: `ChecklistTemplatesSheet` (gestão CRUD)

**Files:**
- Create: `web/src/components/ChecklistTemplatesSheet.tsx`

**Interfaces:**
- Consumes: Task 2 (`listTemplates/createTemplate/updateTemplate/deleteTemplate/normalizeTemplateName/canManageTemplate/isDupName`, tipo `ChecklistTemplate`), `useAuth()` (collaborator.id/.role), DS (`AdaptiveSheet`, `Button`, `ConfirmDialog`, `showToast`).
- Produces: `<ChecklistTemplatesSheet open onClose />` — auto-suficiente (react-query key `['checklist-templates']`).

- [ ] **Step 1: Implementar** o componente:

```tsx
// Gestão de Modelos de Checklist (CRUD completo) — abre de dentro do QuickCreateSheet
// ("Gerenciar modelos…"). Team-shared; editar/excluir só criador ou coordenação
// (canManageTemplate espelha a RLS). Demanda Jonathan ADM 06/07.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, X, ArrowUp, ArrowDown } from 'lucide-react';
import { AdaptiveSheet } from './AdaptiveSheet';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { showToast } from './Toast';
import { useAuth } from '../contexts/AuthContext';
import {
  listTemplates, createTemplate, updateTemplate, deleteTemplate,
  normalizeTemplateName, canManageTemplate, isDupName, type ChecklistTemplate,
} from '../lib/checklistTemplates';

const inputCls = 'w-full bg-bg-surface border border-border rounded-md p-2 text-fg text-body-md focus:outline-none focus:border-tom';

export function ChecklistTemplatesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ['checklist-templates'], queryFn: listTemplates, enabled: open });

  // null = listagem; 'new' = criando; ChecklistTemplate = editando
  const [editing, setEditing] = useState<'new' | ChecklistTemplate | null>(null);
  const [name, setName] = useState('');
  const [items, setItems] = useState<string[]>([]);
  const [novoItem, setNovoItem] = useState('');
  const [confirmDel, setConfirmDel] = useState<ChecklistTemplate | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['checklist-templates'] });
  const salvar = useMutation({
    mutationFn: async () => {
      const n = normalizeTemplateName(name);
      if (!n) throw new Error('nome_invalido');
      const list = items.map((s) => s.trim()).filter(Boolean);
      if (list.length === 0) throw new Error('sem_itens');
      if (editing === 'new') await createTemplate(n, list, collaborator!.id);
      else if (editing) await updateTemplate(editing.id, { name: n, items: list });
    },
    onSuccess: () => { invalidate(); setEditing(null); showToast({ kind: 'success', title: 'Modelo salvo' }); },
    onError: (e: Error) => showToast({
      kind: 'error',
      title: e.message === 'nome_invalido' ? 'Nome precisa ter de 2 a 80 letras.'
        : e.message === 'sem_itens' ? 'Adiciona pelo menos um item.'
        : isDupName(e) ? 'Já existe um modelo com esse nome.' : 'Não consegui salvar. Tenta de novo.',
    }),
  });
  const excluir = useMutation({
    mutationFn: (id: string) => deleteTemplate(id),
    onSuccess: () => { invalidate(); setConfirmDel(null); showToast({ kind: 'success', title: 'Modelo excluído' }); },
    onError: () => showToast({ kind: 'error', title: 'Não consegui excluir.' }),
  });

  function abrirEdicao(t: 'new' | ChecklistTemplate) {
    setEditing(t);
    setName(t === 'new' ? '' : t.name);
    setItems(t === 'new' ? [] : [...t.items]);
    setNovoItem('');
  }
  const addItem = () => { const s = novoItem.trim(); if (!s) return; setItems((p) => [...p, s]); setNovoItem(''); };
  const move = (i: number, d: -1 | 1) => setItems((p) => {
    const j = i + d; if (j < 0 || j >= p.length) return p;
    const n = [...p]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });

  return (
    <AdaptiveSheet open={open} onClose={onClose} title="Modelos de checklist" size="sm">
      {!editing ? (
        <div className="space-y-2">
          <p className="text-body-sm text-fg-muted">Modelos do time — todo mundo vê e usa. Editar/excluir: quem criou ou coordenação.</p>
          {(templates.data ?? []).map((t) => {
            const posso = canManageTemplate(t, collaborator?.id, collaborator?.role);
            return (
              <div key={t.id} className="flex items-center gap-2 rounded-md border border-border bg-bg-elevated px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-body-md text-fg truncate">{t.name}</div>
                  <div className="text-caption text-fg-muted truncate">{t.items.length} itens · {t.items.slice(0, 3).join(' → ')}{t.items.length > 3 ? '…' : ''}</div>
                </div>
                <button type="button" aria-label={`Editar ${t.name}`} disabled={!posso} onClick={() => abrirEdicao(t)}
                  className="shrink-0 p-1.5 rounded-sm text-fg-muted hover:text-tom disabled:opacity-30 focus-ring"><Pencil size={15} /></button>
                <button type="button" aria-label={`Excluir ${t.name}`} disabled={!posso} onClick={() => setConfirmDel(t)}
                  className="shrink-0 p-1.5 rounded-sm text-fg-muted hover:text-danger disabled:opacity-30 focus-ring"><Trash2 size={15} /></button>
              </div>
            );
          })}
          {templates.data && templates.data.length === 0 && (
            <p className="text-body-sm text-fg-muted">Nenhum modelo ainda — cria o primeiro.</p>
          )}
          <Button variant="secondary" size="md" leadingIcon={<Plus size={15} />} onClick={() => abrirEdicao('new')}>Novo modelo</Button>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="block">
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Nome do modelo</div>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
              placeholder="Ex.: ADM — Aula Experimental" autoFocus className={inputCls} />
          </label>
          <div>
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Itens (na ordem)</div>
            <div className="space-y-1 mb-2">
              {items.map((it, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="flex-1 min-w-0 text-body-md text-fg break-words">{it}</span>
                  <button type="button" aria-label="Subir" onClick={() => move(i, -1)} disabled={i === 0}
                    className="p-1 text-fg-muted hover:text-fg disabled:opacity-30 focus-ring rounded"><ArrowUp size={14} /></button>
                  <button type="button" aria-label="Descer" onClick={() => move(i, 1)} disabled={i === items.length - 1}
                    className="p-1 text-fg-muted hover:text-fg disabled:opacity-30 focus-ring rounded"><ArrowDown size={14} /></button>
                  <button type="button" aria-label="Remover item" onClick={() => setItems((p) => p.filter((_, j) => j !== i))}
                    className="p-1 text-fg-muted hover:text-danger focus-ring rounded"><X size={14} /></button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input value={novoItem} onChange={(e) => setNovoItem(e.target.value)} maxLength={200}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
                placeholder="Adicionar item…" className={inputCls} />
              <button type="button" disabled={!novoItem.trim()} onClick={addItem}
                className="shrink-0 text-tom text-body-md font-medium disabled:opacity-40 focus-ring rounded px-1">Add</button>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" size="md" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button variant="primary" size="md" disabled={salvar.isPending} onClick={() => salvar.mutate()}>
              {salvar.isPending ? 'Salvando…' : 'Salvar modelo'}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog open={!!confirmDel} title={`Excluir "${confirmDel?.name}"?`}
        description="Tarefas já criadas com esse modelo não mudam. Não dá pra desfazer."
        confirmLabel="Excluir" confirmVariant="danger" isPending={excluir.isPending}
        onConfirm={() => confirmDel && excluir.mutate(confirmDel.id)} onClose={() => setConfirmDel(null)} />
    </AdaptiveSheet>
  );
}
```

- [ ] **Step 2:** `npx tsc --noEmit` → EXIT 0. (Se `Button`/`ConfirmDialog`/`AdaptiveSheet` tiverem props diferentes, ler o arquivo do componente e ajustar a chamada — NUNCA mudar o DS.)

---

### Task 4: Picker "Usar modelo…" + "salvar como modelo" no QuickCreateSheet

**Files:**
- Create: `web/src/components/ChecklistTemplatePicker.tsx`
- Modify: `web/src/components/QuickCreateSheet.tsx` (abas Tarefa ~l.864-867 e Delegar ~l.940-943, onde `<ChecklistDraftField …>` é renderizado)

**Interfaces:**
- Consumes: Task 2 (lib), Task 3 (sheet), `CustomSelect`, `useAuth`, react-query.
- Produces: `<ChecklistTemplatePicker items={string[]} onChange={(next: string[]) => void} />` — renderiza a linha do picker + save-as-model + monta o `ChecklistTemplatesSheet`.

- [ ] **Step 1: Implementar** `web/src/components/ChecklistTemplatePicker.tsx`:

```tsx
// Linha "Usar modelo…" da seção CHECKLIST do QuickCreateSheet + "salvar como modelo".
// O picker APLICA itens no rascunho (applyTemplate: append sem duplicar); os itens
// continuam editáveis antes de criar. Sentinel __manage__ abre o CRUD (sheet).
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CustomSelect } from './CustomSelect';
import { showToast } from './Toast';
import { useAuth } from '../contexts/AuthContext';
import { ChecklistTemplatesSheet } from './ChecklistTemplatesSheet';
import {
  listTemplates, createTemplate, applyTemplate, normalizeTemplateName, isDupName,
} from '../lib/checklistTemplates';

const MANAGE = '__manage__';

export function ChecklistTemplatePicker({ items, onChange }: { items: string[]; onChange: (next: string[]) => void }) {
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ['checklist-templates'], queryFn: listTemplates, staleTime: 5 * 60_000 });
  const [manageOpen, setManageOpen] = useState(false);
  const [savingName, setSavingName] = useState<string | null>(null); // null = fechado

  const salvarModelo = useMutation({
    mutationFn: async () => {
      const n = normalizeTemplateName(savingName ?? '');
      if (!n) throw new Error('nome_invalido');
      await createTemplate(n, items.map((s) => s.trim()).filter(Boolean), collaborator!.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['checklist-templates'] });
      setSavingName(null);
      showToast({ kind: 'success', title: 'Modelo salvo', msg: 'Já disponível pra todo o time.' });
    },
    onError: (e: Error) => showToast({
      kind: 'error',
      title: e.message === 'nome_invalido' ? 'Nome precisa ter de 2 a 80 letras.'
        : isDupName(e) ? 'Já existe um modelo com esse nome.' : 'Não consegui salvar o modelo.',
    }),
  });

  return (
    <div className="mb-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[180px] max-w-[280px]">
          <CustomSelect
            value=""
            placeholder="Usar modelo…"
            size="sm"
            options={[
              ...(templates.data ?? []).map((t) => ({ value: t.id, label: t.name, sublabel: `${t.items.length} itens` })),
              { value: MANAGE, label: '⚙️ Gerenciar modelos…', sublabel: 'criar / editar / excluir' },
            ]}
            onChange={(v) => {
              if (v === MANAGE) { setManageOpen(true); return; }
              const t = (templates.data ?? []).find((x) => x.id === v);
              if (t) onChange(applyTemplate(items, t.items));
            }}
          />
        </div>
        {items.length > 0 && savingName === null && (
          <button type="button" onClick={() => setSavingName('')}
            className="text-body-sm text-tom underline underline-offset-2 focus-ring rounded">
            salvar como modelo
          </button>
        )}
      </div>
      {savingName !== null && (
        <div className="flex items-center gap-2 mt-2">
          <input value={savingName} onChange={(e) => setSavingName(e.target.value)} maxLength={80} autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); salvarModelo.mutate(); } if (e.key === 'Escape') setSavingName(null); }}
            placeholder="Nome do modelo (ex.: ADM — Experimental)"
            className="flex-1 bg-bg-surface border border-border rounded-md p-2 text-fg text-body-sm focus:outline-none focus:border-tom" />
          <button type="button" disabled={salvarModelo.isPending} onClick={() => salvarModelo.mutate()}
            className="shrink-0 text-body-sm text-black bg-tom font-medium px-3 py-1.5 rounded-md disabled:opacity-40 focus-ring">Salvar</button>
          <button type="button" onClick={() => setSavingName(null)}
            className="shrink-0 text-body-sm text-fg-muted focus-ring rounded px-1">Cancelar</button>
        </div>
      )}
      <ChecklistTemplatesSheet open={manageOpen} onClose={() => setManageOpen(false)} />
    </div>
  );
}
```

- [ ] **Step 2: Integrar no QuickCreateSheet** — nas DUAS abas. Em `web/src/components/QuickCreateSheet.tsx`, adicionar o import:

```tsx
import { ChecklistTemplatePicker } from './ChecklistTemplatePicker';
```

Aba **Tarefa** (bloco atual ~l.864-867):
```tsx
            {/* Checklist (subtarefas) na criação — escondido quando recorrente (limitação conhecida). */}
            {!recurrenceRule && (
              <div>
                <ChecklistTemplatePicker items={checklistDraft} onChange={setChecklistDraft} />
                <ChecklistDraftField items={checklistDraft} onChange={setChecklistDraft} />
              </div>
            )}
```
Aba **Delegar** (~l.940-943): mesma substituição (mesmo par de componentes, mesmo estado `checklistDraft`).

ATENÇÃO: `ChecklistTemplatePicker` renderiza a linha do modelo ACIMA do label "Checklist" do
`ChecklistDraftField`. Se visualmente ficar melhor abaixo do label, mover o `<ChecklistTemplatePicker>`
pra DENTRO do `ChecklistDraftField` não é permitido sem repassar props — manter fora (simples).

- [ ] **Step 3:** `npx tsc --noEmit` + `npx vite build` → EXIT 0.
- [ ] **Step 4:** `npx vitest run` → suíte inteira verde (303 + 8 novos).

---

### Task 5: TOM — modelos no system prompt (`src/prompts/system.js`)

**Files:**
- Modify: `src/prompts/system.js` (baixar cópia FRESCA da VPS antes; local pode divergir)

**Interfaces:**
- Consumes: tabela `checklist_templates` (Task 1); engine já suporta `subtasks:[...]` no create (engine.js:5312) — NÃO tocar engine.js.
- Produces: bloco "Modelos de checklist do time" no contexto de tarefas do system prompt.

- [ ] **Step 1: Cópia fresca da VPS:**
```bash
scp tom:/opt/LA-Organizer/src/prompts/system.js D:/la-organizer/_remote/src/prompts/system.js
```

- [ ] **Step 2: Localizar** (a) a assinatura de `buildContext(...)` (~l.267) e (b) o call site que monta os dados (grep `buildContext(` no arquivo). Adicionar:

No call site, junto das outras queries de contexto (padrão das vizinhas):
```js
  // Modelos de checklist do time (Jonathan 06/07) — nomes+itens pro TOM aplicar em subtasks.
  let checklistTemplatesCtx = [];
  try {
    const { data: _ct } = await supabase
      .from('checklist_templates').select('name, items').order('name');
    checklistTemplatesCtx = _ct || [];
  } catch (e) { console.warn('[Prompt] checklist_templates:', e.message); }
```
Passar `checklistTemplatesCtx` como argumento novo no FINAL da chamada de `buildContext(...)`, e na assinatura receber `checklistTemplates = []` (default — não quebra outros call sites).

- [ ] **Step 3: Renderizar o bloco** dentro de `buildContext`, logo após o bloco de tarefas delegadas (~l.663-668, após o `renderChecklistBlock` do delegador):

```js
  // Modelos de checklist do time (demanda Jonathan 06/07): quando o usuário pedir
  // "com o checklist/modelo de X", o TOM cria a tarefa com subtasks copiando os itens
  // EXATAMENTE (engine materializa as filhas — create com subtasks:[...]).
  if (checklistTemplates && checklistTemplates.length) {
    lines.push('', '**Modelos de checklist do time** — se o usuário pedir "com o checklist/modelo de X" ao criar/delegar tarefa, inclua no marker: subtasks:[...] copiando os itens EXATAMENTE como listados (sem parafrasear, sem omitir, sem acrescentar):');
    checklistTemplates.forEach((t) => {
      const items = Array.isArray(t.items) ? t.items : [];
      lines.push(`• ${t.name}: ${JSON.stringify(items)}`);
    });
  }
```

- [ ] **Step 4: Validar sintaxe:** `node --check D:/la-organizer/_remote/src/prompts/system.js` → sem output (OK).

- [ ] **Step 5: Deploy cirúrgico:**
```bash
scp D:/la-organizer/_remote/src/prompts/system.js tom:/opt/LA-Organizer/src/prompts/system.js
ssh tom "cd /opt/LA-Organizer && node --check src/prompts/system.js && pm2 restart tom"
ssh tom "pm2 logs tom --lines 30 --nostream"
```
Expected: restart limpo, sem ReferenceError/SyntaxError nos logs (lição Audit 24/06: guard morto silencioso → SEMPRE conferir logs).

---

### Task 6: Verificação E2E + registro + comunicação

**Files:** nenhum novo (verificação + memória).

- [ ] **Step 1 — E2E app (preview localhost:4173):** `npx vite build` fresco; limpar SW caches; em **1440px**: abrir "Novo" → Delegar → escolher pessoa → "Usar modelo…" → "Aula Experimental (visita)" → conferir 4 itens no rascunho → Criar. Conferir NO BANCO:
```sql
SELECT c.title, c.sort_position, c.assigned_to = p.assigned_to AS herda_dono
FROM tasks p JOIN tasks c ON c.parent_task_id = p.id
WHERE p.title = '<título usado>' ORDER BY c.sort_position;
```
Expected: 4 filhas na ordem do modelo. Repetir em **375px** (mobile) o fluxo "salvar como modelo" (digitar 2 itens → salvar → aparece no select). **Apagar tarefas/modelos de teste ao final.**

- [ ] **Step 2 — E2E TOM (VPS):** enviar (conta do Alf) "cria uma tarefa TESTE TEMPLATE pra amanhã com o checklist de aula experimental" → conferir no banco (4 filhas) → apagar a tarefa. Se o TOM parafrasear itens, registrar em `tom_known_issues` e avaliar o plano-B determinístico (fora do v1).

- [ ] **Step 3 — Memória + registro:** atualizar `MEMORY.md` + criar memória `project_checklist_templates` (o que existe, onde mora, decisão op_checklists). Se surgiu bug no caminho: registrar em `tom_known_issues`.

- [ ] **Step 4 — Mensagem pro Alf enviar ao Jonathan/time** explicando: usar modelo, salvar como modelo, gerenciar, e o comando pelo TOM ("com o checklist de X").

---

## Self-review (feita)

- **Cobertura da spec:** tabela+RLS+seed (T1) ✅ · lib+testes (T2) ✅ · CRUD completo (T3) ✅ · picker+salvar inline nas 2 abas (T4) ✅ · TOM via system.js sem engine.js (T5) ✅ · E2E app+TOM+banco, 375/1440, limpeza de dados (T6) ✅ · fora-de-escopo respeitado ✅.
- **Placeholders:** nenhum — todo passo tem código/comando/expected.
- **Consistência de tipos:** `ChecklistTemplate {id,name,items,created_by}` idêntico em T2/T3/T4; `applyTemplate(draft, tplItems)` consumido em T4 como definido em T2; key react-query `['checklist-templates']` igual em T3/T4.
