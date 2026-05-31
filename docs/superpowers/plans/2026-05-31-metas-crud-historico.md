# Metas — CRUD + Histórico de Aportes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) ou superpowers:executing-plans. Steps usam checkbox (`- [ ]`).

**Goal:** Dar CRUD completo a Metas no PWA (aporte via sheet, editar, arquivar) + histórico de aportes (tabela + trigger) + tela de detalhe, com bilateralidade TOM (aporte logado, edit_goal, delete_goal).

**Architecture:** Nova `pf_goal_contributions` + trigger `pf_sync_goal_amount` (espelha o trigger de saldo) mantém `current_amount` e dá histórico, eliminando o read-modify-write atual. PWA ganha ContributionSheet, GoalSheet edição, MetaDetalhePage. TOM ganha edit_goal/delete_goal e loga aportes.

**Tech Stack:** Supabase Postgres (MCP apply_migration/execute_sql), Node CommonJS (engine), React+TS+Tailwind (PWA).

**Convenções (CLAUDE.md):**
- **NÃO commitar entre tasks** (Stop hook commita+pusha `_remote/` → Vercel ~2min). Última linha de cada task = validação.
- Engine (`src/`,`skills/`) precisa **SCP imediato**: `scp /d/la-organizer/_remote/<p> tom:/opt/LA-Organizer/<p> && ssh tom "pm2 restart tom"`.
- **Segurança:** toda query nova filtra `.eq('collaborator_id', cid)`; cid da sessão/param, nunca inventado. Updates com whitelist.
- PWA: `cd /d/la-organizer/_remote/web && npx tsc --noEmit && npx vite build`. DS: AdaptiveSheet/CustomSelect/DateInput/Button/Field/Fab. Token `tom`; **texto preto sobre verde** (`bg-tom text-black`).

---

## Task 1: Migration — `pf_goal_contributions` + trigger + backfill + RLS

**Files:**
- Create: `migrations/20260531_pf_goal_contributions.sql`
- Apply: MCP `apply_migration` (name `pf_goal_contributions`)

- [ ] **Step 1: Escrever a migration** (ordem importa: backfill ANTES do trigger pra não duplicar)

`migrations/20260531_pf_goal_contributions.sql`:
```sql
-- 1) Tabela de aportes (log)
CREATE TABLE IF NOT EXISTS pf_goal_contributions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  goal_id         uuid NOT NULL REFERENCES pf_goals(id) ON DELETE CASCADE,
  amount          numeric NOT NULL CHECK (amount > 0),
  note            text,
  contributed_at  date NOT NULL DEFAULT CURRENT_DATE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pf_goal_contrib_goal   ON pf_goal_contributions(goal_id);
CREATE INDEX IF NOT EXISTS idx_pf_goal_contrib_collab ON pf_goal_contributions(collaborator_id);

-- 2) Backfill: 1 aporte "saldo inicial" por meta com saldo > 0 (ANTES do trigger)
INSERT INTO pf_goal_contributions (collaborator_id, goal_id, amount, note, contributed_at, created_at)
SELECT collaborator_id, id, current_amount, 'saldo inicial', created_at::date, created_at
FROM pf_goals WHERE current_amount > 0;

-- 3) Trigger que mantém pf_goals.current_amount (espelha pf_sync_account_balance)
CREATE OR REPLACE FUNCTION pf_sync_goal_amount() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE pf_goals SET current_amount = current_amount + NEW.amount, updated_at = now() WHERE id = NEW.goal_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE pf_goals SET current_amount = GREATEST(current_amount - OLD.amount, 0), updated_at = now() WHERE id = OLD.goal_id;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE pf_goals SET current_amount = current_amount - OLD.amount + NEW.amount, updated_at = now() WHERE id = NEW.goal_id;
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pf_sync_goal_amount ON pf_goal_contributions;
CREATE TRIGGER trg_pf_sync_goal_amount
  AFTER INSERT OR UPDATE OR DELETE ON pf_goal_contributions
  FOR EACH ROW EXECUTE FUNCTION pf_sync_goal_amount();

-- 4) RLS (espelha pf_goals_owner)
ALTER TABLE pf_goal_contributions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pf_goal_contributions_owner ON pf_goal_contributions;
CREATE POLICY pf_goal_contributions_owner ON pf_goal_contributions FOR ALL TO authenticated
  USING (collaborator_id = current_collab_id()) WITH CHECK (collaborator_id = current_collab_id());
```

- [ ] **Step 2: Aplicar via MCP** — `apply_migration` (project `cesnbnrynvxvgdhfmaua`, name `pf_goal_contributions`) com o SQL acima.

- [ ] **Step 3: Verificar invariante e trigger** — `execute_sql`:
```sql
-- backfill preservou sum == current_amount?
SELECT g.id, g.name, g.current_amount,
       COALESCE(SUM(c.amount),0) AS soma_aportes,
       g.current_amount - COALESCE(SUM(c.amount),0) AS diff
FROM pf_goals g LEFT JOIN pf_goal_contributions c ON c.goal_id=g.id
WHERE g.collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f'
GROUP BY g.id, g.name, g.current_amount;
```
Esperado: `diff = 0` em todas as metas.

- [ ] **Step 4: Testar o trigger ao vivo** — `execute_sql` (insere e apaga um aporte de teste numa meta do Luciano e confere current_amount sobe/desce; depois apaga o aporte de teste):
```sql
-- pega uma meta
SELECT id, current_amount FROM pf_goals WHERE collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f' AND is_active LIMIT 1;
-- (use o id retornado) inserir aporte de 10 → current_amount deve subir 10; depois DELETE → deve voltar.
```
(Validação manual: confirmar que o trigger soma no insert e reverte no delete.)

---

## Task 2: Backend — funções de aporte/edição de meta

**Files:** Modify `src/services/financeiro-service.js` (perto de `addToGoal`/`createGoal` ~246-267, e `module.exports` ~511)

- [ ] **Step 1: Adicionar funções** (todas filtram `collaborator_id`):
```js
async function addGoalContribution(collaboratorId, goalId, { amount, note = null, date = null }) {
  const row = { collaborator_id: collaboratorId, goal_id: goalId, amount, note };
  if (date) row.contributed_at = date;
  const { data, error } = await supabase.from('pf_goal_contributions').insert(row).select().single();
  if (error) throw error; // trigger atualiza pf_goals.current_amount
  return data;
}
async function listGoalContributions(collaboratorId, goalId) {
  const { data, error } = await supabase.from('pf_goal_contributions')
    .select('id, goal_id, amount, note, contributed_at')
    .eq('collaborator_id', collaboratorId).eq('goal_id', goalId)
    .order('contributed_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
async function deleteGoalContribution(collaboratorId, contributionId) {
  const { error } = await supabase.from('pf_goal_contributions')
    .delete().eq('id', contributionId).eq('collaborator_id', collaboratorId);
  if (error) throw error; // trigger reverte
}
async function updateGoal(collaboratorId, goalId, patch) {
  const allowed = {};
  for (const k of ['name', 'target_amount', 'monthly_contribution', 'deadline', 'icon']) {
    if (patch[k] !== undefined) allowed[k] = patch[k];
  }
  allowed.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('pf_goals')
    .update(allowed).eq('id', goalId).eq('collaborator_id', collaboratorId).select().single();
  if (error) throw error;
  return data;
}
async function deactivateGoal(collaboratorId, goalId) {
  const { error } = await supabase.from('pf_goals')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', goalId).eq('collaborator_id', collaboratorId);
  if (error) throw error;
}
```

- [ ] **Step 2: Exportar** — adicionar ao `module.exports`: `addGoalContribution, listGoalContributions, deleteGoalContribution, updateGoal, deactivateGoal` (mantendo os existentes).

- [ ] **Step 3: Validar** — `node --check src/services/financeiro-service.js` (sem erro).

---

## Task 3: Engine — aporte logado + edit_goal/delete_goal + skill + deploy

**Files:** Modify `src/engine.js` (`update_goal` ~6133; `FINANCE_ACTIONS` ~5887), `skills/financeiro-pessoal.md`

- [ ] **Step 1: `update_goal` (aporte) passa a LOGAR** (engine.js ~6133):
```js
case 'update_goal': {
  const cands = await financeService.findGoal(cid, params.goal_name || params.name || '');
  if (cands.length === 0) return 'Não achei essa meta.';
  const goal = cands[0];
  const add = Number(params.add_amount || 0);
  if (!(add > 0)) return 'Quanto você quer guardar?';
  await financeService.addGoalContribution(cid, goal.id, { amount: add }); // trigger atualiza
  const novo = Number(goal.current_amount) + add;
  const pct = Math.round((novo / goal.target_amount) * 100);
  return `✅ Guardou R$${add} em ${goal.name}. Progresso: ${pct}% (R$${novo}/R$${goal.target_amount}).`;
}
```

- [ ] **Step 2: Adicionar `edit_goal` e `delete_goal`** (logo após o `update_goal`):
```js
case 'edit_goal': {
  const cands = await financeService.findGoal(cid, params.goal_name || params.name || '');
  if (cands.length === 0) return 'Não achei essa meta.';
  const patch = {};
  for (const k of ['name', 'target_amount', 'monthly_contribution', 'deadline', 'icon']) {
    if (params[k] !== undefined) patch[k] = params[k];
  }
  const g = await financeService.updateGoal(cid, cands[0].id, patch);
  return `✏️ Meta atualizada: ${g.icon || '🎯'} ${g.name} (alvo R$${g.target_amount}).`;
}
case 'delete_goal': {
  const cands = await financeService.findGoal(cid, params.goal_name || params.name || '');
  if (cands.length === 0) return 'Não achei essa meta.';
  await financeService.deactivateGoal(cid, cands[0].id);
  return `🗄️ Meta "${cands[0].name}" arquivada.`;
}
```

- [ ] **Step 3: Registrar nas FINANCE_ACTIONS** (~5887) — adicionar `'edit_goal'` e `'delete_goal'` ao array/lista de actions permitidas (junto de create_goal/update_goal/query_goal).

- [ ] **Step 4: Skill** (`skills/financeiro-pessoal.md`) — onde documenta metas, adicionar:
```
- `update_goal` — aporte: params goal_name, add_amount. (O aporte vira histórico — o app mostra a timeline.)
- `edit_goal` — params goal_name + os que mudam: name, target_amount, monthly_contribution, deadline, icon. Ex.: "muda o alvo do carro pra 25000".
- `delete_goal` — params goal_name. Arquiva a meta (reversível). Ex.: "arquiva a meta do carro".
```

- [ ] **Step 5: Validar + deploy:**
`node --check src/engine.js && node --check src/services/financeiro-service.js`
`scp /d/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js && scp /d/la-organizer/_remote/src/services/financeiro-service.js tom:/opt/LA-Organizer/src/services/financeiro-service.js && scp /d/la-organizer/_remote/skills/financeiro-pessoal.md tom:/opt/LA-Organizer/skills/financeiro-pessoal.md && ssh tom "pm2 restart tom"`
Esperado: sem erro de sintaxe; pm2 online.

---

## Task 4: PWA lib — reimplementar addToGoal + updateGoal/deactivateGoal/contribuições

**Files:** Modify `web/src/lib/financeiro.ts` (PfGoal ~26; addToGoal ~230)

- [ ] **Step 1: Estender tipos** (PfGoal ~26):
```ts
export interface PfGoal {
  id: string; name: string; target_amount: number; current_amount: number;
  monthly_contribution: number | null; deadline: string | null; icon: string | null;
  is_active?: boolean;
}
export interface PfGoalContribution {
  id: string; goal_id: string; amount: number; note: string | null; contributed_at: string;
}
```

- [ ] **Step 2: Reimplementar `addToGoal`** (~230) — insere aporte (trigger atualiza), sem read-modify-write:
```ts
export async function addToGoal(collaboratorId: string, goalId: string, amount: number, opts?: { note?: string | null; date?: string }) {
  const row: Record<string, unknown> = { collaborator_id: collaboratorId, goal_id: goalId, amount, note: opts?.note ?? null };
  if (opts?.date) row.contributed_at = opts.date;
  const { data, error } = await supabase.from('pf_goal_contributions').insert(row).select().single();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 3: Adicionar funções:**
```ts
export async function updateGoal(collaboratorId: string, id: string, patch: { name?: string; target_amount?: number; monthly_contribution?: number | null; deadline?: string | null; icon?: string | null }) {
  const allowed: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ['name', 'target_amount', 'monthly_contribution', 'deadline', 'icon'] as const) {
    if (patch[k] !== undefined) allowed[k] = patch[k];
  }
  const { data, error } = await supabase.from('pf_goals')
    .update(allowed).eq('id', id).eq('collaborator_id', collaboratorId).select().single();
  if (error) throw error;
  return data;
}
export async function deactivateGoal(collaboratorId: string, id: string) {
  const { error } = await supabase.from('pf_goals')
    .update({ is_active: false }).eq('id', id).eq('collaborator_id', collaboratorId);
  if (error) throw error;
}
export async function listGoalContributions(collaboratorId: string, goalId: string): Promise<PfGoalContribution[]> {
  const { data, error } = await supabase.from('pf_goal_contributions')
    .select('id, goal_id, amount, note, contributed_at')
    .eq('collaborator_id', collaboratorId).eq('goal_id', goalId)
    .order('contributed_at', { ascending: false });
  if (error) throw error;
  return (data as PfGoalContribution[]) ?? [];
}
export async function deleteGoalContribution(collaboratorId: string, id: string) {
  const { error } = await supabase.from('pf_goal_contributions')
    .delete().eq('id', id).eq('collaborator_id', collaboratorId);
  if (error) throw error;
}
```

- [ ] **Step 4: Incluir `is_active` no select de `listGoals`** (~215): mudar o `.select(...)` pra `'id, name, target_amount, current_amount, monthly_contribution, deadline, icon, is_active'`.

- [ ] **Step 5: Validar** — `cd /d/la-organizer/_remote/web && npx tsc --noEmit` (Atenção: a mudança de assinatura de `addToGoal` vai quebrar o `useAddToGoal` e a `MetasPage` — serão corrigidos nas Tasks 5 e 9; se o tsc acusar SÓ esses dois pontos, está esperado; outros erros, reporte.)

---

## Task 5: PWA hooks — aporte/edição/contribuições + realtime

**Files:** Modify `web/src/hooks/useFinanceiro.ts` (~78-127), `web/src/hooks/useRealtimeFinance.ts` (~8)

- [ ] **Step 1: Atualizar `useAddToGoal` e adicionar hooks** (perto de useCreateGoal ~126):
```ts
export const useAddToGoal = () => useFinMutation(
  (cid, args: { goalId: string; amount: number; note?: string | null; date?: string }) =>
    fin.addToGoal(cid, args.goalId, args.amount, { note: args.note, date: args.date })
);
export const useUpdateGoal = () => useFinMutation(
  (cid, args: { id: string; patch: Parameters<typeof fin.updateGoal>[2] }) => fin.updateGoal(cid, args.id, args.patch)
);
export const useDeactivateGoal = () => useFinMutation((cid, id: string) => fin.deactivateGoal(cid, id));
export const useDeleteGoalContribution = () => useFinMutation((cid, id: string) => fin.deleteGoalContribution(cid, id));
export function useGoalContributions(goalId: string | undefined) {
  const cid = useFinanceiroAuth();
  return useQuery({
    queryKey: [...KEY, 'goal-contributions', goalId, cid],
    queryFn: () => fin.listGoalContributions(cid!, goalId!),
    enabled: !!cid && !!goalId,
  });
}
```

- [ ] **Step 2: Adicionar `pf_goal_contributions` ao union** (`useRealtimeFinance.ts:8`):
```ts
export type PfTable = 'pf_transactions' | 'pf_bills' | 'pf_goals' | 'pf_accounts' | 'pf_budgets'
  | 'pf_cards' | 'pf_card_payments' | 'pf_transfers' | 'pf_goal_contributions';
```

- [ ] **Step 3: Validar** — `cd /d/la-organizer/_remote/web && npx tsc --noEmit` (o erro restante deve ser só na `MetasPage` que ainda chama addToGoal antigo — corrigido na Task 9).

---

## Task 6: PWA — `ContributionSheet` (novo, substitui o prompt)

**Files:** Create `web/src/screens/financeiro/components/ContributionSheet.tsx`

- [ ] **Step 1: Criar o sheet** (espelhar estrutura do GoalSheet/TransactionSheet; DS puro):
```tsx
import { useEffect, useState } from 'react';
import { AdaptiveSheet } from '../../../components/AdaptiveSheet';
import { Button } from '../../../components/Button';
import { DateInput } from '../../../components/DateInput';
import { Field } from '../../../components/Field';
import { useAddToGoal } from '../../../hooks/useFinanceiro';
import type { PfGoal } from '../../../lib/financeiro';

function todayYmd() { return new Date().toISOString().slice(0, 10); }

export function ContributionSheet({ open, onClose, goal }: { open: boolean; onClose: () => void; goal: PfGoal | null }) {
  const addMut = useAddToGoal();
  const [amountText, setAmountText] = useState('');
  const [date, setDate] = useState(todayYmd());
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { if (open) { setAmountText(''); setDate(todayYmd()); setNote(''); } }, [open]);

  async function submit() {
    const amount = Number(amountText.replace(',', '.'));
    if (!goal || !isFinite(amount) || amount <= 0) return;
    setSubmitting(true);
    try {
      await addMut.mutateAsync({ goalId: goal.id, amount, note: note.trim() || null, date });
      onClose();
    } catch (e) { alert((e as Error).message); } finally { setSubmitting(false); }
  }

  return (
    <AdaptiveSheet open={open} onClose={onClose} title={goal ? `Guardar pra "${goal.name}"` : 'Guardar'}>
      <div className="flex flex-col gap-3">
        <Field label="Valor">
          <div className="flex items-baseline gap-1">
            <span className="text-fg-muted">R$</span>
            <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)}
              placeholder="0,00" autoFocus
              className="w-full bg-transparent text-2xl font-semibold text-fg focus:outline-none" />
          </div>
        </Field>
        <Field label="Data"><DateInput value={date} onChange={setDate} /></Field>
        <Field label="Nota" sub="Opcional. Ex.: 13º salário, sobrou do mês.">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="O que foi?"
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom" />
        </Field>
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancelar</Button>
          <Button variant="primary" onClick={submit} disabled={submitting || !amountText.trim()}>
            {submitting ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </div>
    </AdaptiveSheet>
  );
}
```
(Antes de codar: leia `GoalSheet.tsx` pra confirmar nomes/props reais de `AdaptiveSheet`/`Field`/`DateInput` e ajuste imports/markup ao padrão exato do projeto.)

- [ ] **Step 2: Validar** — `cd /d/la-organizer/_remote/web && npx tsc --noEmit && npx vite build`.

---

## Task 7: PWA — `GoalSheet` ganha modo edição + arquivar

**Files:** Modify `web/src/screens/financeiro/components/GoalSheet.tsx`

- [ ] **Step 1: Modo edição** — espelhar o padrão do `TransactionSheet` (prop `initial`, `isEdit`, footer):
- Props: `{ open: boolean; onClose: () => void; initial?: PfGoal }`. `const isEdit = !!initial;`
- `useEffect` em `[open, initial]` pré-preenche name/target/monthly/deadline/icon a partir de `initial` (ou limpa no create).
- Hooks: somar `useUpdateGoal()` e `useDeactivateGoal()`.
- `save()`: `await updateMut.mutateAsync({ id: initial!.id, patch: { name, target_amount, monthly_contribution, deadline, icon } })` → `onClose()`.
- `archive()`: `await deactivateMut.mutateAsync(initial!.id)` → `onClose()`.
- Título: `isEdit ? 'Editar meta' : 'Nova meta'`.
- Footer (espelhar TransactionSheet): em `isEdit`, botão **Arquivar** (`variant="danger" size="sm"`) à esquerda + Cancelar + **Salvar**; em create, Cancelar + **Criar meta** (como hoje).

- [ ] **Step 2: Validar** — `cd /d/la-organizer/_remote/web && npx tsc --noEmit && npx vite build`.

---

## Task 8: PWA — `MetaDetalhePage` (novo) + rota

**Files:** Create `web/src/screens/financeiro/MetaDetalhePage.tsx`; Modify `web/src/App.tsx`

- [ ] **Step 1: Rota** (`App.tsx`) — adicionar lazy import e a rota com `:id` (mesmo padrão de `financeiro/cartoes/:id`):
```tsx
const MetaDetalhePage = lazy(() => import('./screens/financeiro/MetaDetalhePage').then(m => ({ default: m.MetaDetalhePage })));
// ...
<Route path="financeiro/metas/:id" element={<MetaDetalhePage />} />
```

- [ ] **Step 2: Criar `MetaDetalhePage.tsx`** — herói + projeção + timeline + ações. Reusar a lógica de projeção do `GoalCard` (MetasPage) — leia o `GoalCard` e reaproveite os helpers (`monthsToGoal*`/finance-utils) que ele usa pra "nesse ritmo". Estrutura:
- `const { id } = useParams()`; `useRealtimeFinance(['pf_goals','pf_goal_contributions'], cid)`.
- Carregar a meta: usar `useGoals()` e achar `goals.find(g => g.id === id)` (ou um hook `useGoal(id)` se preferir — mas reusar useGoals evita query nova).
- `const contribsQ = useGoalContributions(id);` `const delContrib = useDeleteGoalContribution();`
- Herói: ícone + nome + barra/% + "R$ current de R$ target" + bloco "Nesse ritmo" (mesma projeção do GoalCard).
- Botão **"+ Adicionar contribuição"** (`Button variant="primary"`, abre `<ContributionSheet goal={goal} .../>`).
- Topo: ✏️ Editar (abre `<GoalSheet initial={goal} .../>`) e 🗄️ Arquivar (chama `useDeactivateGoal` → navega de volta pra `/financeiro/metas`).
- **Timeline:** lista de `contribsQ.data` — cada item: `+ R$ {amount}`, nota (se houver), data; botão ✕ → `delContrib.mutateAsync(c.id)` (com confirm). Vazio → "Nenhum aporte ainda."
- Voltar (`← Voltar` → `navigate('/financeiro/metas')`). DS puro; texto preto sobre verde.

- [ ] **Step 3: Validar** — `cd /d/la-organizer/_remote/web && npx tsc --noEmit && npx vite build` + abrir preview em `/financeiro/metas/<um id>`.

---

## Task 9: PWA — `MetasPage` usa ContributionSheet + card clicável

**Files:** Modify `web/src/screens/financeiro/MetasPage.tsx`

- [ ] **Step 1: Trocar o `window.prompt` pelo `ContributionSheet`:**
- Remover a função `contribute` com `window.prompt`.
- Estado: `const [contribGoal, setContribGoal] = useState<PfGoal | null>(null);`
- No `GoalCard`, o `onContribute(goal)` passa a fazer `setContribGoal(goal)`.
- Montar `<ContributionSheet open={!!contribGoal} goal={contribGoal} onClose={() => setContribGoal(null)} />`.

- [ ] **Step 2: Card clicável → detalhe:**
- `GoalCard` ganha navegação: a área do card (não o botão de contribuição) clica → `navigate('/financeiro/metas/' + goal.id)`. Use `useNavigate`. Garanta que o botão "+ Adicionar contribuição" NÃO dispare a navegação (`e.stopPropagation()` no onClick do botão, ou botão fora da área clicável).

- [ ] **Step 3: Realtime** — `useRealtimeFinance(['pf_goals', 'pf_goal_contributions'], cid)`.

- [ ] **Step 4: Validar** — `cd /d/la-organizer/_remote/web && npx tsc --noEmit && npx vite build` + preview (aportar pelo sheet; clicar no card abre detalhe; o tsc das Tasks 4/5 agora fecha 100%).

---

## Task 10: Verificação E2E + reconciliação + deploy

- [ ] **Step 1: Build/typecheck completo** — `cd /d/la-organizer/_remote/web && npx tsc --noEmit && npx vite build`. Backend: `node --check src/engine.js src/services/financeiro-service.js`.

- [ ] **Step 2: Smoke PWA (preview, cache SW limpo):** aportar numa meta pelo sheet (não prompt) → aparece na timeline e a barra sobe; excluir um aporte → barra desce; editar meta (alvo/nome); arquivar meta (some da lista); abrir detalhe por clique no card. 375 + 1440.

- [ ] **Step 3: Reconciliação no banco** — `execute_sql`:
```sql
SELECT g.name, g.current_amount, COALESCE(SUM(c.amount),0) AS soma, g.current_amount - COALESCE(SUM(c.amount),0) AS diff
FROM pf_goals g LEFT JOIN pf_goal_contributions c ON c.goal_id=g.id
WHERE g.collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f' AND g.is_active
GROUP BY g.id, g.name, g.current_amount;
```
Esperado: `diff = 0` em todas.

- [ ] **Step 4: Smoke WhatsApp (bilateralidade — engine já deployado na Task 3):** "guardei 200 pro carro" (aporte → aparece na timeline do app), "muda o alvo do carro pra 25000" (edit_goal), "arquiva a meta do carro" (delete_goal). Conferir respostas e reflexo no app.

- [ ] **Step 5: Encerrar turno** — Stop hook commita+pusha `web/` + migration + spec/plano → Vercel. Engine já foi por SCP.

---

## Notas de execução
- **Ordem:** 1 (migration) → 2-3 (backend+engine, deploy) → 4-5 (lib/hooks PWA) → 6-7 (sheets) → 8-9 (detalhe + MetasPage) → 10 (verificação). Tasks 8 (detalhe) e a migration/trigger (1) são as mais sensíveis (Opus); o resto Sonnet.
- **Reuso (DRY):** projeção do detalhe reusa os helpers do `GoalCard`; sheets espelham `GoalSheet`/`TransactionSheet`; trigger espelha `pf_sync_account_balance`.
- **Invariante-chave:** `sum(pf_goal_contributions.amount) == pf_goals.current_amount` por meta — verificado nas Tasks 1 e 10.
- **Segurança:** filtro `collaborator_id` em todas as funções novas (lib + serviço); whitelist em updateGoal; RLS na tabela nova espelha pf_goals.
