# Fase 1 — Números Honestos (Dashboard de Governança) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fazer os números da `DashboardTime` pararem de mentir — excluir canceladas de "Pra hoje", contagem real (sem teto de 50), colapsar fan-out de recorrência e ocultar inativos — extraindo a lógica num módulo PURO testável.

**Architecture:** A lógica honesta vira `web/src/lib/governance-metrics.ts` (funções puras, unit-test com vitest). `DashboardTime.tsx` passa a consumi-la: corrige as queries e troca `overdue.length` (truncado) pela contagem de obrigações DISTINTAS. Sem rewrite visual (isso é a Fase 2). Entrega sozinha: o CEO vê número honesto hoje.

**Tech Stack:** React + TypeScript + Supabase-js + vitest. Spec: `docs/superpowers/specs/2026-06-08-dashboard-governanca-design.md` §4.

> **Nota deste repo:** NÃO fazer git manual — o Stop hook `auto-deploy.ps1` commita/pusha `_remote/` no fim do turno. "Verificação" = vitest + `tsc -b` + preview em `localhost:4173`. Sem passos de `git commit`.

---

## File Structure
- **Create:** `web/src/lib/governance-metrics.ts` — funções puras de contagem honesta.
- **Create:** `web/src/lib/governance-metrics.test.ts` — unit (vitest).
- **Modify:** `web/src/screens/DashboardTime.tsx` — `fetchTeamSnapshot` (queries) + interface `TeamSnapshot` + 2 pontos de render.

---

## Task 1: Módulo puro `governance-metrics.ts` (TDD)

**Files:**
- Create: `web/src/lib/governance-metrics.ts`
- Test: `web/src/lib/governance-metrics.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// web/src/lib/governance-metrics.test.ts
import { describe, it, expect } from 'vitest';
import {
  normTitle, dedupeRecurringOverdue, filterActiveAssignees,
  countDistinctOverdue, overdueByPerson, type OverdueRow,
} from './governance-metrics';

const rows: OverdueRow[] = [
  { id: '1', title: 'Liberar arte-convite', assigned_to: 'jhon', due_date: '2026-06-02' },
  { id: '2', title: 'Convidar alunos', assigned_to: 'jhon', due_date: '2026-06-02' },
  { id: '3', title: 'Dar presença dos alunos', assigned_to: 'jhon', due_date: '2026-06-05' },
  { id: '4', title: 'Dar presença dos alunos', assigned_to: 'jhon', due_date: '2026-06-03' },
  { id: '5', title: 'DAR  presença  dos alunos', assigned_to: 'jhon', due_date: '2026-06-04' },
  { id: '6', title: 'Montar repertório', assigned_to: 'ju', due_date: '2026-06-06' },
  { id: '7', title: 'Tarefa do inativo', assigned_to: 'kinho', due_date: '2026-06-01' },
];

describe('normTitle', () => {
  it('baixa caixa, tira acento e colapsa espaço', () => {
    expect(normTitle('DAR  presença  dos Alunos')).toBe('dar presenca dos alunos');
  });
});

describe('dedupeRecurringOverdue', () => {
  it('colapsa título igual do mesmo dono em 1 grupo com count e due mais antigo', () => {
    const g = dedupeRecurringOverdue(rows);
    // jhon: arte, convidar, presença(x3) = 3 grupos; ju: 1; kinho: 1 → 5 grupos
    expect(g.length).toBe(5);
    const presenca = g.find(x => x.assigned_to === 'jhon' && x.title.toLowerCase().includes('presen'))!;
    expect(presenca.count).toBe(3);
    expect(presenca.oldestDue).toBe('2026-06-03');
    expect(presenca.recurring).toBe(true);
  });
});

describe('filterActiveAssignees', () => {
  it('remove linhas de quem não está ativo', () => {
    const active = new Set(['jhon', 'ju']);
    expect(filterActiveAssignees(rows, active).some(r => r.assigned_to === 'kinho')).toBe(false);
  });
});

describe('contagem honesta', () => {
  it('countDistinctOverdue = nº de obrigações distintas (recorrência conta 1)', () => {
    const active = new Set(['jhon', 'ju']);
    const g = dedupeRecurringOverdue(filterActiveAssignees(rows, active));
    expect(countDistinctOverdue(g)).toBe(4); // arte, convidar, presença, repertório (kinho fora)
  });
  it('overdueByPerson conta grupos por pessoa, ordenado desc', () => {
    const g = dedupeRecurringOverdue(filterActiveAssignees(rows, new Set(['jhon', 'ju'])));
    const byp = overdueByPerson(g);
    expect(byp[0]).toEqual({ assigned_to: 'jhon', count: 3 });
    expect(byp.find(p => p.assigned_to === 'ju')!.count).toBe(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd _remote/web && npx vitest run src/lib/governance-metrics.test.ts`
Expected: FAIL — `Cannot find module './governance-metrics'`.

- [ ] **Step 3: Implementar o módulo**

```ts
// web/src/lib/governance-metrics.ts
// Fonte das regras de "número honesto" da governança (spec §4). Puro/testável.
// Por ora vive no frontend; quando a Fase 6 (digest) chegar, as MESMAS regras
// sobem pra uma função única no Postgres (fonte única front+engine).

export interface OverdueRow {
  id: string;
  title: string;
  assigned_to: string;
  due_date: string; // YYYY-MM-DD
}

export interface DedupedOverdue {
  key: string;
  title: string;
  assigned_to: string;
  count: number;       // quantas linhas colapsaram (fan-out de recorrência)
  oldestDue: string;   // due_date mais antigo do grupo (o mais atrasado)
  recurring: boolean;  // count > 1
}

/** Normaliza título pra agrupar recorrência: minúsculo, sem acento, espaço colapsado. */
export function normTitle(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Colapsa instâncias do mesmo (dono + título normalizado) em 1 grupo. */
export function dedupeRecurringOverdue(rows: OverdueRow[]): DedupedOverdue[] {
  const groups = new Map<string, DedupedOverdue>();
  for (const r of (rows ?? [])) {
    const key = `${r.assigned_to}|${normTitle(r.title)}`;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { key, title: r.title, assigned_to: r.assigned_to, count: 1, oldestDue: r.due_date, recurring: false });
    } else {
      g.count += 1;
      g.recurring = true;
      if (r.due_date < g.oldestDue) g.oldestDue = r.due_date;
    }
  }
  return [...groups.values()];
}

/** Mantém só linhas de colaboradores ativos. */
export function filterActiveAssignees<T extends { assigned_to: string }>(rows: T[], activeIds: Set<string>): T[] {
  return (rows ?? []).filter(r => activeIds.has(r.assigned_to));
}

/** Contagem honesta = nº de obrigações distintas (recorrência já colapsada). */
export function countDistinctOverdue(deduped: DedupedOverdue[]): number {
  return (deduped ?? []).length;
}

/** Atrasos por pessoa = nº de obrigações distintas por dono, desc. */
export function overdueByPerson(deduped: DedupedOverdue[]): Array<{ assigned_to: string; count: number }> {
  const m = new Map<string, number>();
  for (const d of (deduped ?? [])) m.set(d.assigned_to, (m.get(d.assigned_to) ?? 0) + 1);
  return [...m.entries()]
    .map(([assigned_to, count]) => ({ assigned_to, count }))
    .sort((a, b) => b.count - a.count);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd _remote/web && npx vitest run src/lib/governance-metrics.test.ts`
Expected: PASS (todos os `describe`).

---

## Task 2: Ligar a `fetchTeamSnapshot` à lógica honesta

**Files:**
- Modify: `web/src/screens/DashboardTime.tsx`

- [ ] **Step 1: Importar o módulo** (topo do arquivo, junto aos outros imports de `../lib`)

```ts
import {
  dedupeRecurringOverdue, filterActiveAssignees, countDistinctOverdue, overdueByPerson,
  type OverdueRow,
} from '../lib/governance-metrics';
```

- [ ] **Step 2: Trocar a interface `TeamSnapshot`** — substituir o campo `overdue` por contagem honesta + por-pessoa:

```ts
// ANTES:
//   overdue: { id: string; title: string; assigned_to: string; due_date: string }[];
// DEPOIS:
  overdueCount: number;
  overdueByPerson: Array<{ assigned_to: string; count: number }>;
```

- [ ] **Step 3: Corrigir a query de "Pra hoje"** — excluir canceladas e concluídas (`:71-73`):

```ts
  const { count: dueToday = 0 } = await supabase
    .from('tasks').select('id', { count: 'exact', head: true })
    .eq('context', 'work').eq('due_date', today)
    .not('status', 'in', '(done,cancelled)');   // <-- honesto: não conta cancelada/feita
```

- [ ] **Step 4: Corrigir "Atrasadas"** — tirar o teto de 50, deduplicar recorrência, filtrar inativo, contar distinto (`:75-101`):

```ts
  const { data: overdueRaw } = await supabase
    .from('tasks')
    .select('id, title, assigned_to, due_date')
    .eq('context', 'work')
    .lt('due_date', today)
    .not('status', 'in', '(done,cancelled)')
    .order('due_date', { ascending: true })
    .limit(1000);                                // teto alto só de segurança; não trunca o real

  const activeIds = new Set(allCollabs.map(c => c.id));   // allCollabs já é is_active && onboarded
  const overdueActive = filterActiveAssignees((overdueRaw ?? []) as OverdueRow[], activeIds);
  const dedupedOverdue = dedupeRecurringOverdue(overdueActive);
```

E no `return` (`:91-101`), trocar `overdue: overdueRaw ?? []` por:

```ts
    overdueCount: countDistinctOverdue(dedupedOverdue),
    overdueByPerson: overdueByPerson(dedupedOverdue),
```

- [ ] **Step 5: Atualizar o componente** (consumo do snapshot):

No destructuring (`:122`): trocar `overdue` por `overdueCount, overdueByPerson`.
Remover o bloco inline `overdueByPerson` Map (`:123-124`) — agora vem pronto do snapshot.

Card "Atrasadas" (`:138`):
```tsx
        <StatCard label="Atrasadas" value={overdueCount} tone={overdueCount ? 'danger' : 'neutral'} />
```

Seção "Atrasos por pessoa" (`:208-223`) — usar o array pronto:
```tsx
      {overdueByPerson.length > 0 && (
        <section className="surface p-md">
          <div className="flex items-center gap-2 text-label uppercase tracking-wide text-fg-muted">
            <AlertTriangle size={14} /> Atrasos por pessoa
          </div>
          <ul className="mt-md flex flex-wrap gap-2">
            {overdueByPerson.map(({ assigned_to, count }) => (
              <li key={assigned_to}>
                <Link to={`/time/${assigned_to}`} className="inline-block">
                  <Badge tone="danger">{nameOf(assigned_to)}: {count}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
```

- [ ] **Step 6: Typecheck + build**

Run: `cd _remote/web && npx tsc -b`
Expected: 0 erros (interface e usos batem).

- [ ] **Step 7: Re-rodar o unit (garantia de não-regressão)**

Run: `cd _remote/web && npx vitest run src/lib/governance-metrics.test.ts`
Expected: PASS.

---

## Task 3: Validação visual no preview (números honestos de verdade)

**Files:** nenhum (validação).

- [ ] **Step 1: Subir/usar o preview** em `localhost:4173` (já roda; senão `cd _remote/web && npm run preview`).

- [ ] **Step 2: Abrir a Dashboard time** (rota `/time`) logado como coord/CEO. Limpar SW cache (snippet padrão) antes.

- [ ] **Step 3: Conferir contra o banco** (Supabase MCP, project `cesnbnrynvxvgdhfmaua`):
  - "Pra hoje" agora = `tasks context=work, due_date=hoje, status NOT IN (done,cancelled)` (≈31, não 40).
  - "Atrasadas" = nº de obrigações distintas (≈28): rodar a query de overdue + dedupe mental e comparar; o Jhonatan deve contar suas distintas (não 8 com a recorrência inflando).
  - Nenhuma pessoa inativa (ex.: Kinho) aparece em "Atrasos por pessoa".

- [ ] **Step 4: Print/registro** — confirmar visualmente que os 2 cards mudaram pro número honesto.

---

## Self-Review (preenchido)
- **Cobertura do spec §4:** cancelled em Pra hoje ✅ (Task 2 Step 3); count real sem limit(50) ✅ (Step 4); dedupe recorrência ✅ (Task 1 + Step 4); inativo ✅ (filterActiveAssignees). Rótulo de escopo (time vs empresa) → **fica pra Fase 2** (é display do redesenho), anotado no spec.
- **Placeholders:** nenhum; todo passo tem código/comando reais.
- **Consistência de tipos:** `OverdueRow`/`DedupedOverdue` usados igual no módulo, no teste e no snapshot; `overdueCount:number` + `overdueByPerson:{assigned_to,count}[]` batem entre interface, return e render.
- **Escopo:** uma fatia auto-suficiente (números honestos no dashboard atual), sem rewrite visual.

## Próximas fases (planos próprios, depois desta)
2. CEO desktop (KPIs clicáveis + semáforo + drill) · 3. Multi-tenant (`leader-routing` + popular times + escopo) · 4. Líder + mobile · 5. Agir embutido (cobrar/1:1/comunicado via TOM) · 6. Digest unificado 9h + Config · 7. (pré-prod) RLS `is_my_report`.
