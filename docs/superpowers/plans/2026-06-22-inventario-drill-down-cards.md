# Inventário — Drill-down dos cards ATENÇÃO e EM MANUTENÇÃO — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans para implementar task-a-task. Steps usam checkbox (`- [ ]`).

**Goal:** Clicar nos cards ATENÇÃO e EM MANUTENÇÃO do Inventário abre um bottom-sheet com a lista exata dos itens daquele grupo (e mata o bug que jogava o usuário pra "Pra Hoje").

**Architecture:** Um helper puro único (`lib/inventario-status.ts`) define o filtro de cada status e é consumido tanto pelo contador (`useInventarioStats`) quanto por um novo hook de lista (`useInventarioItensPorStatus`) — paridade card↔lista por construção. Um novo `ItemListSheet` (reusando `AdaptiveSheet` + `ItemCard` + o menu de ações da `SalaPage`) renderiza a lista. `StatsCards`/`ListaPage` passam a abrir o sheet em vez de navegar pra rota fantasma.

**Tech Stack:** React 18 + TypeScript + Tailwind + @tanstack/react-query + supabase-js (laReportClient) + vitest 4.

## Global Constraints

- **PWA only.** Não toca backend/engine/voz do TOM. Tudo em `_remote/web/src/`.
- **Deploy-hold (metodologia do Alf):** criar `D:\la-organizer\.deploy-hold` ANTES de editar qualquer arquivo em `web/src` (Task 0); remover SÓ na Task 6, com OK explícito do Alf. Protege edição concorrente de outros chats no `_remote` compartilhado.
- **Sem git commit por task.** `_remote` não é git repo; o auto-deploy hook (Stop) commita+pusha no fim do turno e a Vercel deploya `web/` em ~2min.
- **NÃO modificar `ItemCard.tsx`** (compartilhado com a `SalaPage` — risco de regressão). O badge de revisão é renderizado POR FORA dele.
- **Guardrail desktop:** `ListaPage` é responsiva (sem variante `*Desktop`); `AdaptiveSheet` já entrega bottom-sheet no mobile e modal no desktop. Validar 375px e 1440px.
- **Validação:** `cd _remote/web && npx tsc --noEmit` + `npx vite build`; `npx vitest run <arquivo>` pros puros; preview em `localhost:4173`.
- **Regra aprovada:** o filtro força `ativo = true` em ATENÇÃO **e** EM MANUTENÇÃO (confirmado pelo Alf 22/06).

---

### Task 0: Deploy-hold

**Files:**
- Create: `D:\la-organizer\.deploy-hold`

- [ ] **Step 1: Criar o hold antes de tocar em qualquer código**

Run (Bash tool, git-bash):
```bash
echo "inventario-drill-down 2026-06-22 (chat Inventário)" > /d/la-organizer/.deploy-hold && ls -la /d/la-organizer/.deploy-hold
```
Expected: o arquivo existe. A partir daqui o auto-deploy fica pausado até a Task 6.

---

### Task 1: Helper puro `inventario-status.ts` (fonte única do filtro) — TDD

**Files:**
- Create: `_remote/web/src/lib/inventario-status.ts`
- Test: `_remote/web/src/lib/inventario-status.test.ts`

**Interfaces:**
- Produces:
  - `type InventarioStatusTipo = 'atencao' | 'manutencao'`
  - `proximaRevisaoLimite(now?: Date): string` — hoje+30d em `YYYY-MM-DD`
  - `aplicaFiltroStatus<Q extends {eq;lte}>(query: Q, tipo: InventarioStatusTipo, now?: Date): Q` — sempre `.eq('ativo', true)` + cláusula por tipo
  - `statusRevisao(proxima_revisao: string|null, now?: Date): { texto: string; tom: 'danger'|'warning' } | null`

- [ ] **Step 1: Escrever os testes (failing-first)**

Criar `_remote/web/src/lib/inventario-status.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { proximaRevisaoLimite, aplicaFiltroStatus, statusRevisao } from './inventario-status';

describe('proximaRevisaoLimite', () => {
  it('retorna hoje+30d em YYYY-MM-DD', () => {
    expect(proximaRevisaoLimite(new Date('2026-06-22T12:00:00Z'))).toBe('2026-07-22');
  });
});

describe('aplicaFiltroStatus', () => {
  function makeQ() {
    const calls: Array<[string, string, unknown]> = [];
    const q: any = {
      eq: (c: string, v: unknown) => { calls.push(['eq', c, v]); return q; },
      lte: (c: string, v: unknown) => { calls.push(['lte', c, v]); return q; },
      calls,
    };
    return q;
  }
  it('atencao: sempre ativo=true + lte proxima_revisao', () => {
    const q = makeQ();
    aplicaFiltroStatus(q, 'atencao', new Date('2026-06-22T12:00:00Z'));
    expect(q.calls).toContainEqual(['eq', 'ativo', true]);
    expect(q.calls).toContainEqual(['lte', 'proxima_revisao', '2026-07-22']);
  });
  it('manutencao: sempre ativo=true + eq status', () => {
    const q = makeQ();
    aplicaFiltroStatus(q, 'manutencao');
    expect(q.calls).toContainEqual(['eq', 'ativo', true]);
    expect(q.calls).toContainEqual(['eq', 'status', 'manutencao']);
  });
});

describe('statusRevisao', () => {
  const hoje = new Date(2026, 5, 22); // 22/06/2026 local
  it('passado → venceu há Nd / danger', () => {
    expect(statusRevisao('2026-06-17', hoje)).toEqual({ texto: 'Revisão venceu há 5d', tom: 'danger' });
  });
  it('hoje → vence hoje / danger', () => {
    expect(statusRevisao('2026-06-22', hoje)).toEqual({ texto: 'Revisão vence hoje', tom: 'danger' });
  });
  it('futuro → em Nd / warning', () => {
    expect(statusRevisao('2026-06-30', hoje)).toEqual({ texto: 'Revisão em 8d', tom: 'warning' });
  });
  it('null → null', () => {
    expect(statusRevisao(null, hoje)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd _remote/web && npx vitest run src/lib/inventario-status.test.ts`
Expected: FAIL (módulo `./inventario-status` não existe).

- [ ] **Step 3: Implementar o helper**

Criar `_remote/web/src/lib/inventario-status.ts`:
```ts
// Fonte de verdade ÚNICA do filtro de status do inventário.
// Consumido pelo contador (useInventarioStats) E pela lista (useInventarioItensPorStatus),
// garantindo que a lista do drill-down SEMPRE bata com o número do card.

export type InventarioStatusTipo = 'atencao' | 'manutencao';

/**
 * Data-limite da janela de "atenção": hoje + 30 dias, em YYYY-MM-DD.
 * Mantém EXATAMENTE a fórmula do contador original (epoch + 30d → toISOString),
 * de propósito, p/ paridade com o card. NÃO trocar por YMD local aqui: mudaria o
 * número do card por timezone (só `ativo=true` foi aprovado como mudança). `now` injetável p/ teste.
 */
export function proximaRevisaoLimite(now?: Date): string {
  const base = now ? now.getTime() : Date.now();
  return new Date(base + 30 * 86400000).toISOString().slice(0, 10);
}

/**
 * Aplica o filtro do status numa query do laReportClient (builder fluente do supabase-js).
 * SEMPRE inclui .eq('ativo', true). Depois, por tipo:
 *   atencao    → .lte('proxima_revisao', limite)
 *   manutencao → .eq('status', 'manutencao')
 * Retorna a própria query (encadeável). Usado por count(head) E por select(*).
 */
export function aplicaFiltroStatus<Q extends {
  eq: (col: string, val: unknown) => Q;
  lte: (col: string, val: unknown) => Q;
}>(query: Q, tipo: InventarioStatusTipo, now?: Date): Q {
  let q = query.eq('ativo', true);
  if (tipo === 'atencao') q = q.lte('proxima_revisao', proximaRevisaoLimite(now));
  else q = q.eq('status', 'manutencao');
  return q;
}

/** YMD LOCAL (sem deslocamento UTC) do Date informado. */
function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Diferença em dias inteiros entre dois YYYY-MM-DD (a - b), sem efeito de fuso. */
function diasEntre(aYmd: string, bYmd: string): number {
  const [ay, am, ad] = aYmd.split('-').map(Number);
  const [by, bm, bd] = bYmd.split('-').map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
}

/**
 * Label humana da revisão para o card de ATENÇÃO. Função pura.
 *   passado → { texto: 'Revisão venceu há Nd', tom: 'danger' }
 *   hoje    → { texto: 'Revisão vence hoje', tom: 'danger' }
 *   futuro  → { texto: 'Revisão em Nd', tom: 'warning' }
 *   null    → null
 */
export function statusRevisao(
  proxima_revisao: string | null,
  now?: Date,
): { texto: string; tom: 'danger' | 'warning' } | null {
  if (!proxima_revisao) return null;
  const hoje = ymdLocal(now ?? new Date());
  const diff = diasEntre(proxima_revisao.slice(0, 10), hoje);
  if (diff < 0) return { texto: `Revisão venceu há ${-diff}d`, tom: 'danger' };
  if (diff === 0) return { texto: 'Revisão vence hoje', tom: 'danger' };
  return { texto: `Revisão em ${diff}d`, tom: 'warning' };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd _remote/web && npx vitest run src/lib/inventario-status.test.ts`
Expected: PASS (8 testes).

- [ ] **Step 5:** Sem commit (auto-deploy versiona no fim do turno).

---

### Task 2: Hook de lista `useInventarioItensPorStatus`

**Files:**
- Create: `_remote/web/src/hooks/useInventarioItensPorStatus.ts`

**Interfaces:**
- Consumes: `aplicaFiltroStatus`, `InventarioStatusTipo` (Task 1); `laReportClient`, `useAccess`, `ReportInventarioItem` (existentes).
- Produces: `useInventarioItensPorStatus(unidadeId: string|undefined, tipo: InventarioStatusTipo|null): UseQueryResult<ReportInventarioItem[]>`

- [ ] **Step 1: Implementar o hook**

Criar `_remote/web/src/hooks/useInventarioItensPorStatus.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { laReportClient } from '../lib/lareport-client';
import { useAccess } from './useAccess';
import { aplicaFiltroStatus, type InventarioStatusTipo } from '../lib/inventario-status';
import type { ReportInventarioItem } from '../lib/lareport-types';

// Lista os itens que compõem um card de status (atencao | manutencao) de uma unidade.
// Reusa o MESMO filtro do contador (aplicaFiltroStatus) → a lista bate com o número do card.
export function useInventarioItensPorStatus(
  unidadeId: string | undefined,
  tipo: InventarioStatusTipo | null,
) {
  const access = useAccess('inventario');
  return useQuery<ReportInventarioItem[]>({
    queryKey: ['lareport', 'por-status', tipo, unidadeId, access.unitFilter],
    enabled: access.allowed && Boolean(unidadeId) && tipo != null,
    queryFn: async () => {
      let q: any = laReportClient.from('inventario').select('*');
      if (unidadeId) q = q.eq('unidade_id', unidadeId);
      if (access.unitFilter) {
        const f = access.unitFilter;
        if (Array.isArray(f)) q = q.in('unidade_id', f);
        else q = q.eq('unidade_id', f);
      }
      q = aplicaFiltroStatus(q, tipo as InventarioStatusTipo);
      q = tipo === 'atencao'
        ? q.order('proxima_revisao', { ascending: true })
        : q.order('nome', { ascending: true });
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ReportInventarioItem[];
    },
  });
}
```

- [ ] **Step 2: Verificar compilação**

Run: `cd _remote/web && npx tsc --noEmit`
Expected: zero erros.

- [ ] **Step 3:** Sem commit.

---

### Task 3: Refatorar `useInventarioStats` p/ usar o filtro único

**Files:**
- Modify: `_remote/web/src/hooks/useInventarioStats.ts`

**Interfaces:**
- Consumes: `aplicaFiltroStatus` (Task 1). Assinatura pública do hook **não muda**.

- [ ] **Step 1: Trocar os filtros inline pelo helper**

Em `_remote/web/src/hooks/useInventarioStats.ts`:

1. Adicionar import no topo (após a linha do `useAccess`):
```ts
import { aplicaFiltroStatus } from '../lib/inventario-status';
```

2. Remover a linha do `limit30d` (agora vem de dentro de `aplicaFiltroStatus`):
```ts
      const limit30d = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
```

3. Substituir as duas linhas de `manutRes`/`atencaoRes` dentro do `Promise.all`:
```ts
        applyFilters(laReportClient.from('inventario').select('id', { count: 'exact', head: true }).eq('status', 'manutencao')),
        applyFilters(laReportClient.from('inventario').select('id', { count: 'exact', head: true }).lte('proxima_revisao', limit30d)),
```
por:
```ts
        aplicaFiltroStatus(applyFilters(laReportClient.from('inventario').select('id', { count: 'exact', head: true })), 'manutencao'),
        aplicaFiltroStatus(applyFilters(laReportClient.from('inventario').select('id', { count: 'exact', head: true })), 'atencao'),
```
(TOTAL ITENS e VALOR TOTAL ficam intactos, com `.eq('ativo', true)` inline.)

- [ ] **Step 2: Verificar compilação + testes puros ainda verdes**

Run: `cd _remote/web && npx tsc --noEmit && npx vitest run src/lib/inventario-status.test.ts`
Expected: zero erros tsc; 8 testes PASS.

- [ ] **Step 3:** Sem commit.

---

### Task 4: `ItemListSheet` — o drill-down

**Files:**
- Create: `_remote/web/src/screens/inventario/components/ItemListSheet.tsx`

**Interfaces:**
- Consumes: `useInventarioItensPorStatus` (Task 2), `statusRevisao`/`InventarioStatusTipo` (Task 1), `useInventarioMutations` (existente), `AdaptiveSheet`/`LoadingState`/`EmptyState`/`Badge`/`ItemCard`/`ItemAcoesMenu`/`ItemSheet`/`MoverItemSheet`/`ManutencaoSheet`/`BaixaConfirmSheet` (existentes).
- Produces: `<ItemListSheet open onClose tipo unidadeId />`

- [ ] **Step 1: Implementar o componente**

Criar `_remote/web/src/screens/inventario/components/ItemListSheet.tsx`:
```tsx
import { useState } from 'react';
import { AdaptiveSheet } from '../../../components/AdaptiveSheet';
import { LoadingState } from '../../../components/LoadingState';
import { EmptyState } from '../../../components/EmptyState';
import { Badge } from '../../../components/Badge';
import { ItemCard } from './ItemCard';
import { ItemAcoesMenu } from './ItemAcoesMenu';
import { ItemSheet } from './ItemSheet';
import { MoverItemSheet } from './MoverItemSheet';
import { ManutencaoSheet } from './ManutencaoSheet';
import { BaixaConfirmSheet } from './BaixaConfirmSheet';
import { useInventarioItensPorStatus } from '../../../hooks/useInventarioItensPorStatus';
import { useInventarioMutations } from '../../../hooks/useInventarioMutations';
import { statusRevisao, type InventarioStatusTipo } from '../../../lib/inventario-status';
import type { ReportInventarioItem } from '../../../lib/lareport-types';

interface Props {
  open: boolean;
  onClose: () => void;
  tipo: InventarioStatusTipo | null;
  unidadeId?: string;
}

const TITULOS: Record<InventarioStatusTipo, string> = {
  atencao: 'Itens em atenção',
  manutencao: 'Em manutenção',
};

export function ItemListSheet({ open, onClose, tipo, unidadeId }: Props) {
  const { data: itens = [], isLoading } = useInventarioItensPorStatus(unidadeId, open ? tipo : null);
  const m = useInventarioMutations();
  const [acoesItem, setAcoesItem] = useState<ReportInventarioItem | null>(null);
  const [editItem, setEditItem] = useState<ReportInventarioItem | null>(null);
  const [moverItemSt, setMoverItemSt] = useState<ReportInventarioItem | null>(null);
  const [manutItem, setManutItem] = useState<ReportInventarioItem | null>(null);
  const [baixaItem, setBaixaItem] = useState<ReportInventarioItem | null>(null);

  return (
    <>
      <AdaptiveSheet open={open} onClose={onClose} title={tipo ? TITULOS[tipo] : ''} size="md">
        {isLoading ? (
          <LoadingState />
        ) : itens.length === 0 ? (
          <EmptyState icon={<span>✅</span>} title="Nada por aqui" description="Nenhum item neste grupo agora." />
        ) : (
          <div className="space-y-2">
            {itens.map((item) => {
              const rev = tipo === 'atencao' ? statusRevisao(item.proxima_revisao) : null;
              return (
                <button key={item.id} type="button" onClick={() => setAcoesItem(item)} className="w-full text-left">
                  {rev && (
                    <div className="mb-1">
                      <Badge tone={rev.tom}>🔧 {rev.texto}</Badge>
                    </div>
                  )}
                  <ItemCard item={item} />
                </button>
              );
            })}
          </div>
        )}
      </AdaptiveSheet>

      <ItemAcoesMenu
        open={!!acoesItem}
        item={acoesItem}
        onClose={() => setAcoesItem(null)}
        onEdit={() => { setEditItem(acoesItem); setAcoesItem(null); }}
        onMover={() => { setMoverItemSt(acoesItem); setAcoesItem(null); }}
        onManutencao={() => { setManutItem(acoesItem); setAcoesItem(null); }}
        onBaixa={() => { setBaixaItem(acoesItem); setAcoesItem(null); }}
      />
      <ItemSheet
        open={!!editItem}
        onClose={() => setEditItem(null)}
        item={editItem}
        onSubmit={async (p) => { if (editItem) await m.update.mutateAsync({ id: editItem.id, payload: p }); }}
      />
      {moverItemSt && (
        <MoverItemSheet
          open
          onClose={() => setMoverItemSt(null)}
          item={moverItemSt}
          onSubmit={async (dest, motivo) => { await m.mover.mutateAsync({ id: moverItemSt.id, sala_destino_id: dest, motivo }); }}
        />
      )}
      {manutItem && (
        <ManutencaoSheet
          open
          onClose={() => setManutItem(null)}
          item={manutItem}
          onSubmit={async (p) => { await m.manutencao.mutateAsync({ id: manutItem.id, payload: p }); }}
        />
      )}
      {baixaItem && (
        <BaixaConfirmSheet
          open
          onClose={() => setBaixaItem(null)}
          item={baixaItem}
          onConfirm={async () => { await m.remove.mutateAsync(baixaItem.id); }}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Verificar compilação**

Run: `cd _remote/web && npx tsc --noEmit`
Expected: zero erros. (Se algum onSubmit divergir de assinatura, conferir o uso real na `SalaPage.tsx:203-248` — este componente espelha exatamente aquele padrão.)

- [ ] **Step 3:** Sem commit.

---

### Task 5: Ligar — StatsCards clicável + ListaPage abre o sheet + invalidação

**Files:**
- Modify: `_remote/web/src/screens/inventario/components/StatsCards.tsx`
- Modify: `_remote/web/src/screens/inventario/ListaPage.tsx`
- Modify: `_remote/web/src/hooks/useInventarioMutations.ts`

**Interfaces:**
- `StatsCards` passa a expor `onCardClick?: (tipo: InventarioStatusTipo) => void` (substitui `onAtencaoClick`).

- [ ] **Step 1: StatsCards — manutenção clicável + callback unificado**

Em `_remote/web/src/screens/inventario/components/StatsCards.tsx`:

1. Adicionar import:
```ts
import type { InventarioStatusTipo } from '../../../lib/inventario-status';
```
2. Trocar a interface:
```ts
interface Props { unidadeId?: string; onAtencaoClick?: () => void; }
```
por:
```ts
interface Props { unidadeId?: string; onCardClick?: (tipo: InventarioStatusTipo) => void; }
```
3. Trocar a desestruturação `export function StatsCards({ unidadeId, onAtencaoClick }: Props) {` por:
```ts
export function StatsCards({ unidadeId, onCardClick }: Props) {
```
4. Trocar as duas linhas dos cards Em manutenção / Atenção:
```tsx
      <Card label="Em manutenção" value={data.manutencao} tone="warn" />
      <Card label="Atenção" value={data.atencao} tone="danger" onClick={data.atencao > 0 ? onAtencaoClick : undefined} />
```
por:
```tsx
      <Card label="Em manutenção" value={data.manutencao} tone="warn" onClick={data.manutencao > 0 && onCardClick ? () => onCardClick('manutencao') : undefined} />
      <Card label="Atenção" value={data.atencao} tone="danger" onClick={data.atencao > 0 && onCardClick ? () => onCardClick('atencao') : undefined} />
```

- [ ] **Step 2: ListaPage — estado + sheet + remove o navigate quebrado**

Em `_remote/web/src/screens/inventario/ListaPage.tsx`:

1. Adicionar imports:
```ts
import { ItemListSheet } from './components/ItemListSheet';
import type { InventarioStatusTipo } from '../../lib/inventario-status';
```
2. Adicionar estado logo após `const [unidadeId, setUnidadeId] = useState<string>('');`:
```ts
  const [drillTipo, setDrillTipo] = useState<InventarioStatusTipo | null>(null);
```
3. Trocar a linha do `<StatsCards .../>`:
```tsx
      <StatsCards unidadeId={unidadeId} onAtencaoClick={() => navigate(`/inventario/atencao?unit=${unidadeId}`)} />
```
por:
```tsx
      <StatsCards unidadeId={unidadeId} onCardClick={setDrillTipo} />
```
4. Adicionar o sheet logo antes do fechamento `</div>` final do componente (depois do bloco de Salas):
```tsx
      <ItemListSheet open={!!drillTipo} tipo={drillTipo} unidadeId={unidadeId} onClose={() => setDrillTipo(null)} />
```
(`useNavigate` continua sendo usado na navegação das salas — não remover o import.)

- [ ] **Step 3: useInventarioMutations — invalidar a query da lista**

Em `_remote/web/src/hooks/useInventarioMutations.ts`, dentro de `invalidate`, adicionar uma linha após o invalidate de `stats`:
```ts
    qc.invalidateQueries({ queryKey: ['lareport', 'stats'] });
    qc.invalidateQueries({ queryKey: ['lareport', 'por-status'] });
```

- [ ] **Step 4: Verificar compilação + build**

Run: `cd _remote/web && npx tsc --noEmit && npx vite build`
Expected: zero erros; build conclui.

- [ ] **Step 5:** Sem commit.

---

### Task 6: Validação end-to-end + deploy (com OK do Alf)

**Files:** nenhum novo — validação e liberação.

- [ ] **Step 1: Testes puros + tsc + build (gate final)**

Run: `cd _remote/web && npx vitest run src/lib/inventario-status.test.ts && npx tsc --noEmit && npx vite build`
Expected: 8 testes PASS, zero erros tsc, build OK.

- [ ] **Step 2: Preview funcional (localhost:4173)**

Validar (via preview_eval/preview_screenshot ou navegação): em Mais → Inventário → unidade —
  - clicar **ATENÇÃO** abre o sheet "Itens em atenção"; a contagem da lista == número do card; cada item mostra o badge de revisão.
  - clicar **EM MANUTENÇÃO** (com valor > 0) abre o sheet "Em manutenção" com os itens.
  - tocar num item abre o menu de ações (Editar/Mover/Manutenção/Baixa).
  - registrar uma manutenção com nova próxima revisão futura → item some da lista (invalidação OK). *(usar item descartável — é dado real do LA Report.)*
  - clicar nos cards **não** joga mais pra "Pra Hoje".
  - testar 375px e 1440px.
Expected: tudo verde; print de prova.

- [ ] **Step 3: Pedir OK explícito do Alf p/ liberar o deploy**

Apresentar o resultado da validação e perguntar se pode subir. **Não remover o hold sem o "sim".**

- [ ] **Step 4: Liberar o auto-deploy (após OK)**

Run (Bash tool):
```bash
rm -f /d/la-organizer/.deploy-hold && echo "HOLD LIBERADO"
```
No fim do turno o auto-deploy hook commita+pusha `_remote/` e a Vercel deploya `web/` em ~2min.

- [ ] **Step 5:** Avisar que está no ar (Vercel) e fechar.

---

## Self-Review

**1. Spec coverage:**
- Bug da rota fantasma → Task 5 (remove navigate, abre sheet). ✅
- Drill-down ATENÇÃO + MANUTENÇÃO → Tasks 2/4/5. ✅
- Tocar no item → ações (ItemAcoesMenu + sheets) → Task 4. ✅
- Filtro único card↔lista → Tasks 1/2/3. ✅
- `ativo=true` nos dois cards → Tasks 1/3. ✅
- Badge de revisão fora do ItemCard → Task 4. ✅
- Invalidação pós-mutação → Task 5. ✅
- Testes (puros) + preview → Tasks 1/6. ✅
- Guardrail desktop / não tocar ItemCard → Global Constraints + Task 4. ✅

**2. Placeholder scan:** sem TBD/TODO; todo step de código tem o código real. ✅

**3. Type consistency:** `InventarioStatusTipo`, `aplicaFiltroStatus`, `statusRevisao`, `useInventarioItensPorStatus(unidadeId, tipo)`, `onCardClick(tipo)`, `['lareport','por-status']` consistentes entre Tasks 1→5. Assinaturas de `onSubmit` (update/mover/manutencao/remove) idênticas às usadas na `SalaPage.tsx:203-248`. ✅
