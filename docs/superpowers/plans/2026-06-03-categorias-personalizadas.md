# Categorias personalizadas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps usam checkbox `- [ ]`. Opus na migration/RLS e no engine; Sonnet no resto. NÃO commitar entre tasks (auto-deploy no fim); backend via scp+pm2.

**Goal:** Cada colaborador cria/apaga categorias custom (despesa+receita) no PWA, refletindo em form/pizza/listas, e o TOM passa a reconhecê-las.

**Architecture:** `pf_categories` já tem o schema (defaults `collaborator_id NULL` + custom por usuário). Falta RLS de escrita, UI de criar/apagar, e tornar o `safeCategory` do engine + o prompt cientes das custom. Soft-delete (`is_active=false`).

**Tech Stack:** Postgres/Supabase (RLS), React+TS+Vite (PWA), Node CommonJS (TOM).

---

## FASE 1 — PWA

### Task 1: Migration — RLS de escrita em `pf_categories`
**Files:** Create `migrations/20260603_pf_categories_rls_custom.sql`; aplicar via MCP.
**Model:** Opus.

- [ ] **Step 1: Escrever + aplicar a migration** (apply_migration, project `cesnbnrynvxvgdhfmaua`, name `pf_categories_rls_custom`):

```sql
ALTER TABLE pf_categories ENABLE ROW LEVEL SECURITY;

-- Leitura: defaults globais (collaborator_id NULL) + as próprias do colaborador.
DROP POLICY IF EXISTS pf_categories_select ON pf_categories;
CREATE POLICY pf_categories_select ON pf_categories FOR SELECT
  USING (collaborator_id IS NULL OR collaborator_id = current_collab_id());

-- Insert: só categoria própria, não-default.
DROP POLICY IF EXISTS pf_categories_insert ON pf_categories;
CREATE POLICY pf_categories_insert ON pf_categories FOR INSERT
  WITH CHECK (collaborator_id = current_collab_id() AND is_default = false);

-- Update/Delete: só linhas próprias (defaults intocáveis).
DROP POLICY IF EXISTS pf_categories_update ON pf_categories;
CREATE POLICY pf_categories_update ON pf_categories FOR UPDATE
  USING (collaborator_id = current_collab_id()) WITH CHECK (collaborator_id = current_collab_id());
DROP POLICY IF EXISTS pf_categories_delete ON pf_categories;
CREATE POLICY pf_categories_delete ON pf_categories FOR DELETE
  USING (collaborator_id = current_collab_id());
```

- [ ] **Step 2: Verificar** via execute_sql:
```sql
SELECT polname, cmd FROM pg_policies WHERE tablename='pf_categories';
```
Expected: 4 policies (select/insert/update/delete).

---

### Task 2: Lógica pura — `slugify` + uniquificador (TDD)
**Files:** Create `web/src/lib/slugify.ts`; Test `web/src/lib/slugify.test.ts`.
**Model:** Sonnet.

- [ ] **Step 1: Teste que falha** (`slugify.test.ts`):
```ts
import { describe, it, expect } from 'vitest';
import { toSlug, uniqueSlug } from './slugify';

describe('toSlug', () => {
  it('normaliza acento/espaço/maiúscula', () => {
    expect(toSlug('Shows')).toBe('shows');
    expect(toSlug('Aulas Particulares')).toBe('aulas_particulares');
    expect(toSlug('Café & Cia')).toBe('cafe_cia');
  });
});
describe('uniqueSlug', () => {
  it('mantém quando livre', () => { expect(uniqueSlug('shows', new Set())).toBe('shows'); });
  it('sufixa quando colide', () => {
    expect(uniqueSlug('shows', new Set(['shows']))).toBe('shows_2');
    expect(uniqueSlug('shows', new Set(['shows','shows_2']))).toBe('shows_3');
  });
});
```
- [ ] **Step 2: Rodar e falhar** — `cd /d/la-organizer/_remote/web && npx vitest run src/lib/slugify.test.ts` → FAIL.
- [ ] **Step 3: Implementar** (`slugify.ts`):
```ts
export function toSlug(label: string): string {
  return String(label || '')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'cat';
}
export function uniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}
```
- [ ] **Step 4: Rodar e passar.**

---

### Task 3: `lib/categorias.ts` — create/deactivate + lookup com inativas
**Files:** Modify `web/src/lib/categorias.ts`.
**Model:** Sonnet.

- [ ] **Step 1:** `PfCategoryRow` ganha `is_active: boolean` e `is_custom: boolean` (derivado de collaborator_id != null). `listCategories` deixa de filtrar `is_active` no servidor (traz todas as visíveis) — o picker filtra no cliente; o lookup usa todas. Substituir a função por:
```ts
export interface PfCategoryRow {
  id: string; slug: string; label: string; emoji: string; color: string;
  type: 'expense' | 'income'; sort_order: number; is_active: boolean; is_custom: boolean;
}
export async function listCategories(): Promise<PfCategoryRow[]> {
  const { data, error } = await supabase
    .from('pf_categories')
    .select('id, slug, label, emoji, color, type, sort_order, is_active, collaborator_id')
    .order('type', { ascending: true }).order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id, slug: r.slug, label: r.label, emoji: r.emoji, color: r.color,
    type: r.type, sort_order: r.sort_order, is_active: r.is_active, is_custom: r.collaborator_id != null,
  }));
}
```
- [ ] **Step 2:** Adicionar create/deactivate (paleta fixa de cor):
```ts
const CAT_COLORS = ['#F59E0B','#8B5CF6','#EC4899','#22C55E','#3B82F6','#EF4444','#06B6D4','#A16207','#D946EF','#0EA5E9'];

export async function createCategory(collaboratorId: string, input: { label: string; emoji: string; type: 'expense' | 'income' }) {
  const label = input.label.trim();
  if (!label) throw new Error('Dá um nome pra categoria.');
  const all = await listCategories();
  const sameType = all.filter((c) => c.type === input.type);
  if (sameType.some((c) => c.is_active && c.label.toLowerCase() === label.toLowerCase()))
    throw new Error('Já existe uma categoria com esse nome.');
  const taken = new Set(sameType.map((c) => c.slug));
  const { toSlug, uniqueSlug } = await import('./slugify');
  const slug = uniqueSlug(toSlug(label), taken);
  const color = CAT_COLORS[sameType.length % CAT_COLORS.length];
  const maxSort = sameType.reduce((m, c) => Math.max(m, c.sort_order), 0);
  const { data, error } = await supabase.from('pf_categories').insert({
    collaborator_id: collaboratorId, slug, label, emoji: input.emoji || '🏷️', color,
    type: input.type, is_default: false, sort_order: maxSort + 1, is_active: true,
  }).select().single();
  if (error) throw error;
  return data as { slug: string };
}

export async function deactivateCategory(collaboratorId: string, id: string) {
  const { error } = await supabase.from('pf_categories')
    .update({ is_active: false }).eq('id', id).eq('collaborator_id', collaboratorId);
  if (error) throw error;
}
```

---

### Task 4: Hooks — useCreateCategory / useDeactivateCategory + lookup inclui inativas
**Files:** Modify `web/src/hooks/useFinanceiro.ts`.
**Model:** Sonnet.

- [ ] **Step 1:** Importar `createCategory, deactivateCategory` de `../lib/categorias`. Adicionar (espelhando o padrão `useFinMutation` existente, KEY `['pf_categories']`):
```ts
export const useCreateCategory = () => useFinMutation(
  (cid, input: { label: string; emoji: string; type: 'expense' | 'income' }) => cat.createCategory(cid, input)
);
export const useDeactivateCategory = () => useFinMutation(
  (cid, id: string) => cat.deactivateCategory(cid, id)
);
```
(ajustar import: `import * as cat from '../lib/categorias'` ou nomeado — seguir o estilo do arquivo. `useFinMutation` já invalida KEY=['financeiro']; garantir que também invalida `['pf_categories']` — se o helper não invalida essa key, usar `useMutation` com `qc.invalidateQueries({queryKey:['pf_categories']})`.)
- [ ] **Step 2:** `useCategoryLookup` já mapeia todas as linhas de `useCategories` — como agora `listCategories` traz inativas, o lookup resolve rótulo de categoria apagada automaticamente. Confirmar que nada filtra `is_active` ali.

---

### Task 5: `CustomSelect` — ação de rodapé opcional
**Files:** Modify `web/src/components/CustomSelect.tsx`.
**Model:** Sonnet.

- [ ] **Step 1:** Adicionar prop opcional `footerAction?: { label: string; onClick: () => void }`. Renderizar como último item fixo do dropdown (após as options), com borda superior, fechando o dropdown ao clicar. Em `Props`:
```ts
  footerAction?: { label: string; onClick: () => void };
```
Na lista do dropdown, depois do `options.map(...)` (dentro do mesmo container, fora do ternário de vazio), adicionar:
```tsx
{footerAction && (
  <button
    type="button"
    onClick={() => { setOpen(false); footerAction.onClick(); }}
    className="w-full px-3 py-2 text-left text-body-sm text-tom border-t border-border hover:bg-bg-elevated focus-ring"
  >
    {footerAction.label}
  </button>
)}
```
Garantir que o bloco aparece mesmo com `options.length === 0` (mover pra fora do ternário "Nenhuma opção"). Default sem `footerAction` = comportamento atual idêntico.
- [ ] **Step 2:** `npx tsc --noEmit` OK.

---

### Task 6: `NovaCategoriaSheet` + wiring no LancamentoSheet
**Files:** Create `web/src/screens/financeiro/components/NovaCategoriaSheet.tsx`; Modify `web/src/screens/financeiro/components/LancamentoSheet.tsx`.
**Model:** Sonnet.

- [ ] **Step 1: Criar `NovaCategoriaSheet.tsx`** (espelha o grid de emoji do AccountSheet):
```tsx
import { useEffect, useState } from 'react';
import { BottomSheet } from '../../../components/BottomSheet';
import { Field } from '../../../components/Field';
import { Button } from '../../../components/Button';
import { useCreateCategory } from '../../../hooks/useFinanceiro';

const EMOJIS = ['🏷️','🎤','🎸','🎵','🎬','🎨','📚','💼','🏆','🎁','🍔','🛒','🚗','🏠','💊','✈️','🐾','💡','🔧','💰','📈','🤝'];

export function NovaCategoriaSheet({ open, onClose, type, onCreated }: {
  open: boolean; onClose: () => void; type: 'expense' | 'income'; onCreated: (slug: string) => void;
}) {
  const createMut = useCreateCategory();
  const [label, setLabel] = useState('');
  const [emoji, setEmoji] = useState('🏷️');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setLabel(''); setEmoji('🏷️'); setError(null); } }, [open]);

  async function submit() {
    setError(null);
    try {
      const r = await createMut.mutateAsync({ label, emoji, type });
      onCreated((r as { slug: string }).slug);
      onClose();
    } catch (e) { setError((e as Error).message); }
  }
  return (
    <BottomSheet open={open} onClose={onClose} title={`Nova categoria de ${type === 'income' ? 'receita' : 'despesa'}`}>
      <div className="flex flex-col gap-md">
        <Field label="Nome">
          <div className="flex items-center gap-2">
            <span className="text-2xl shrink-0" aria-hidden>{emoji}</span>
            <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex: Shows"
              className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom" />
          </div>
          <div className="flex gap-1.5 mt-2 flex-wrap">
            {EMOJIS.map((e) => (
              <button key={e} type="button" onClick={() => setEmoji(e)} aria-label={`Ícone ${e}`}
                className={['h-8 w-8 rounded-full flex items-center justify-center text-lg focus-ring',
                  emoji === e ? 'bg-tom/15 ring-2 ring-tom' : 'bg-bg-elevated hover:bg-bg-surface'].join(' ')}>{e}</button>
            ))}
          </div>
        </Field>
        {error && <p className="text-body-sm text-danger">{error}</p>}
        <Button variant="primary" fullWidth loading={createMut.isPending} onClick={submit} disabled={!label.trim()}>
          Criar categoria
        </Button>
      </div>
    </BottomSheet>
  );
}
```
- [ ] **Step 2: Wire no LancamentoSheet** — adicionar estado `const [novaCat, setNovaCat] = useState(false);`, passar `footerAction` no CustomSelect de Categoria:
```tsx
<CustomSelect value={category} options={categoryOptions} onChange={(v) => setCategory(v as PfCategory)}
  footerAction={{ label: '➕ Incluir categoria', onClick: () => setNovaCat(true) }} />
```
e montar o sheet (o `type` atual define despesa/receita; ao criar, seleciona a nova):
```tsx
<NovaCategoriaSheet open={novaCat} type={type} onClose={() => setNovaCat(false)}
  onCreated={(slug) => setCategory(slug as PfCategory)} />
```
(import do NovaCategoriaSheet no topo.)
- [ ] **Step 3:** `npx tsc --noEmit` OK.

---

### Task 7: Tela "Gerenciar categorias" + entrada + rota
**Files:** Create `web/src/screens/financeiro/CategoriasPage.tsx`; Modify a rota (onde as rotas `/financeiro/*` são registradas) + um link de entrada (FinanceQuickLinks ou dashboard).
**Model:** Sonnet.

- [ ] **Step 1: Criar `CategoriasPage.tsx`** — lista as categorias custom do usuário (is_custom) agrupadas por tipo, cada uma com lixeirinha (confirm → `useDeactivateCategory`); defaults aparecem só como leitura (sem lixeira) OU são omitidas. Header "Categorias" + ← Voltar. Padrão visual das outras páginas (`flex flex-col gap-md pb-32 md:pb-md`, header com `text-section-title`). Usa `useCategories()` + `useDeactivateCategory()`.
- [ ] **Step 2: Registrar rota** `/financeiro/categorias` no mesmo arquivo onde estão as outras rotas de financeiro (procurar `financeiro/carteiras` no router e espelhar, lazy se as outras forem lazy).
- [ ] **Step 3: Entrada** — adicionar um link "Categorias" em `FinanceQuickLinks.tsx` (espelhar os links existentes) apontando pra `/financeiro/categorias`.
- [ ] **Step 4:** `npx tsc --noEmit` + `npx vite build` OK.

---

### Task 8: Realtime (se necessário) + build final Fase 1
**Files:** Modify `web/src/hooks/useRealtimeFinance.ts` (se `pf_categories` não estiver na união).
**Model:** Sonnet.

- [ ] **Step 1:** Conferir se `pf_categories` está na `PfTable` union de `useRealtimeFinance`. Se não, adicionar (pra criar/apagar refletir cross-device).
- [ ] **Step 2:** `cd /d/la-organizer/_remote/web && npx tsc --noEmit && npx vite build` → OK.

---

## FASE 2 — TOM reconhece

### Task 9: `financeiro-service.js` — slugs válidos por usuário
**Files:** Modify `src/services/financeiro-service.js`.
**Model:** Sonnet.

- [ ] **Step 1:** Adicionar e exportar:
```js
// Categorias válidas pro usuário: defaults (collaborator_id null) + custom ativas dele.
async function listCategorySlugs(collaboratorId, type) {
  let q = supabase.from('pf_categories').select('slug, label, type, collaborator_id, is_active')
    .or(`collaborator_id.is.null,collaborator_id.eq.${collaboratorId}`)
    .eq('is_active', true);
  if (type) q = q.eq('type', type);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}
```
(adicionar `listCategorySlugs` ao `module.exports`.)
- [ ] **Step 2:** `node --check src/services/financeiro-service.js` OK.

---

### Task 10: Engine — `safeCategory` ciente das custom
**Files:** Modify `src/engine.js`.
**Model:** Opus.

- [ ] **Step 1:** `safeCategory` ganha 4º arg opcional `extraSlugs` (Set):
```js
function safeCategory(cat, description, type, extraSlugs) {
  const c = String(cat || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  if (pfValidSlugs(type).has(c)) return c;
  if (extraSlugs && extraSlugs.has(c)) return c;       // categoria custom do usuário
  // ... (resto inalterado: mapCategory por descrição → fallback por tipo)
```
- [ ] **Step 2:** No `case 'register_transaction'` (e em `card_purchase`/`recordCardPurchase`), carregar as custom do usuário e passar:
```js
const _cats = await financeService.listCategorySlugs(cid).catch(() => []);
const _extra = new Set(_cats.filter((r) => r.collaborator_id).map((r) => r.slug));
const category = safeCategory(p.category, p.description, type, _extra);
```
(em `recordCardPurchase`, idem com `'expense'`.)
- [ ] **Step 3:** `node --check src/engine.js` OK.

---

### Task 11: Prompt — injetar categorias custom do usuário
**Files:** Modify `src/prompts/system.js`.
**Model:** Sonnet.

- [ ] **Step 1:** No branch do `pickSkill` que carrega `financeiro-pessoal` (onde já anexa "Fontes deste usuário"), anexar também as **categorias custom** do colaborador:
```js
const _cats = await financeService.listCategorySlugs(collab.id).catch(() => []);
const _custom = _cats.filter((c) => c.collaborator_id);
if (_custom.length) {
  body += `\n\n## Categorias personalizadas deste usuário (use quando casar; NUNCA invente/crie categoria)\n`
    + _custom.map((c) => `• ${c.label} (${c.type === 'income' ? 'receita' : 'despesa'}) → slug "${c.slug}"`).join('\n');
}
```
- [ ] **Step 2:** `node --check src/prompts/system.js` OK.

---

### Task 12: Deploy backend
**Model:** Sonnet.
- [ ] **Step 1:** scp dos 3 arquivos + restart:
```bash
scp /d/la-organizer/_remote/src/services/financeiro-service.js tom:/opt/LA-Organizer/src/services/financeiro-service.js
scp /d/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js
scp /d/la-organizer/_remote/src/prompts/system.js tom:/opt/LA-Organizer/src/prompts/system.js
ssh tom "pm2 restart tom"
```

---

### Task 13: Verificação — RLS + smoke + reconciliação
**Model:** controller (inline).
- [ ] **Step 1: RLS asserts** (execute_sql como dois usuários simulados não é trivial via service_role; validar via PWA cross-user ou checar policies + que insert exige collaborator_id próprio). Mínimo: confirmar 4 policies (Task 1) e que defaults têm `collaborator_id IS NULL`.
- [ ] **Step 2: Smoke PWA:** criar categoria "Shows" (receita) pelo dropdown → aparece selecionada → registrar receita → aparece na pizza/lista. Apagar via Gerenciar → some do picker, transação antiga mantém rótulo.
- [ ] **Step 3: Smoke TOM (Fase 2):** "recebi 500 de show" → cai em `shows` (categoria custom), não em `outras_receitas`.

---

## Self-review
- **Cobertura da spec:** RLS (T1), criar (T2/T3/T6), apagar (T3/T7), slug único (T2), soft-delete+lookup inativas (T3/T4), UI dropdown footer (T5), pizza/listas (data-driven, sem task — já funciona), TOM validar (T9/T10) + prompt (T11). ✓
- **Consistência de tipos:** `createCategory(cid,{label,emoji,type})`, `deactivateCategory(cid,id)`, `listCategorySlugs(cid,type?)`, `safeCategory(cat,desc,type,extraSlugs)`, `footerAction:{label,onClick}` — usados igualzinho onde referenciados. ✓
- **Placeholders:** os pontos "procurar a rota / FinanceQuickLinks" são localização por padrão existente, não placeholder de lógica.
