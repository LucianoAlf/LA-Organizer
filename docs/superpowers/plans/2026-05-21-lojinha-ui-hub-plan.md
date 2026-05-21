# Lojinha UI Hub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refatorar a UI da Lojinha eliminando o 3º nível de tabs — virar tela-hub (drill-down) com 3 cards-atalho (Produtos / Histórico / Reservas) e cada um abrindo sua própria tela com filtros em chips horizontais.

**Architecture:** React Router com 4 rotas (`/inventario/loja` hub + `/produtos` + `/historico` + `/reservas`). Unidade selecionada vive em URL search param (`?unit=<uuid>`). Componentes novos: `ChipFilterRow`, `HubCard`, `UnidadeChip`. Refactor: `LojaPage` → `LojaHub`; `HistoricoVendasView` → `HistoricoPage`; `ReservasView` → `ReservasPage`; novo `ProdutosPage` extraído da lista atual.

**Tech Stack:** React 18 + TypeScript + Vite + react-router-dom v6 + TanStack Query + Tailwind (tokens DS) + Supabase client. Padrões DS: `BottomSheet`, `Fab`, `CustomSelect`, `Field`, `LoadingState`, `EmptyState`.

**Spec:** `docs/superpowers/specs/2026-05-21-lojinha-ui-hub-design.md`

---

## Mapa de arquivos

### Criar
- `web/src/components/ChipFilterRow.tsx` — chip row horizontal sem scrollbar
- `web/src/components/HubCard.tsx` — card-linha clicável com KPI inline
- `web/src/components/UnidadeChip.tsx` — chip-seletor que abre BottomSheet
- `web/src/hooks/useUnidadeSelecionada.ts` — hook pra ler/setar unit param na URL
- `web/src/screens/inventario/LojaHub.tsx` — tela-hub (substitui InventarioLojaPage)
- `web/src/screens/inventario/ProdutosPage.tsx` — tela só de produtos
- `web/src/screens/inventario/HistoricoPage.tsx` — tela só de histórico (refactor)
- `web/src/screens/inventario/ReservasPage.tsx` — tela só de reservas (refactor)

### Modificar
- `web/src/App.tsx` — adicionar 3 rotas novas
- `web/src/screens/inventario/LojaPage.tsx` — DELETAR (substituído por LojaHub)
- `web/src/screens/inventario/components/HistoricoVendasView.tsx` — DELETAR (vira HistoricoPage)
- `web/src/screens/inventario/components/ReservasView.tsx` — DELETAR (vira ReservasPage)

### Não muda
- `ProdutoCard`, `VendaWizardSheet`, `EntradaRicaSheet`, `TransferenciaSheet`, `ProdutoFormSheet`, `EstornoConfirmSheet`, `ReservaSheet` — reusados como são
- Hooks `useReportLoja`, `useHistoricoVendas`, `useReservas`, `useReportUnidades` — sem mudança
- `Fab`, `BottomSheet`, `Field`, `CustomSelect` — usados

---

## Task A: Componentes base (ChipFilterRow + UnidadeChip + HubCard + hook)

**Files:**
- Create: `web/src/components/ChipFilterRow.tsx`
- Create: `web/src/components/HubCard.tsx`
- Create: `web/src/components/UnidadeChip.tsx`
- Create: `web/src/hooks/useUnidadeSelecionada.ts`

- [ ] **Step 1: Criar `useUnidadeSelecionada.ts`**

```ts
import { useSearchParams } from 'react-router-dom';
import { useReportUnidades } from './useLaReport';
import { useEffect } from 'react';

/**
 * Lê/escreve a unidade selecionada no URL search param `?unit=<uuid>`.
 * Default: Barra se existir, senão primeira unidade ativa.
 * Persiste entre navegações Hub ↔ telas internas.
 */
export function useUnidadeSelecionada() {
  const [params, setParams] = useSearchParams();
  const { data: unidades = [], isLoading } = useReportUnidades();
  const unidadeId = params.get('unit') || '';

  useEffect(() => {
    if (!isLoading && !unidadeId && unidades.length > 0) {
      const barra = unidades.find(u => u.nome === 'Barra');
      const next = barra?.id || unidades[0].id;
      setParams(p => { p.set('unit', next); return p; }, { replace: true });
    }
  }, [isLoading, unidadeId, unidades, setParams]);

  const unidade = unidades.find(u => u.id === unidadeId) ?? null;

  function setUnidade(id: string) {
    setParams(p => { p.set('unit', id); return p; }, { replace: true });
  }

  return { unidadeId, unidade, unidades, setUnidade, isLoading };
}
```

- [ ] **Step 2: Criar `ChipFilterRow.tsx`**

```tsx
import type { ReactNode } from 'react';

export interface ChipItem {
  id: string;
  label: ReactNode;
  count?: number;
}

interface Props {
  items: ChipItem[];
  activeId: string;
  onChange: (id: string) => void;
  /** Extra chips à direita (ex: "Filtros ⚙" pra abrir sheet). */
  extra?: ReactNode;
}

/**
 * Chips horizontais roláveis SEM barra de scroll visível.
 * Min-height 44px (Apple HIG). Item ativo usa cor primária verde.
 */
export function ChipFilterRow({ items, activeId, onChange, extra }: Props) {
  return (
    <div
      className="flex gap-2 overflow-x-auto py-2"
      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' } as React.CSSProperties}
    >
      <style>{`.chip-row-scroll::-webkit-scrollbar{display:none}`}</style>
      <div className="flex gap-2 chip-row-scroll" style={{ minHeight: 44 }}>
        {items.map(it => {
          const active = it.id === activeId;
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => onChange(it.id)}
              className={[
                'whitespace-nowrap rounded-full px-3 py-1.5 text-body-sm border transition-colors',
                active
                  ? 'bg-tom text-bg-app border-tom font-semibold'
                  : 'bg-bg-surface text-fg-muted border-border hover:border-tom/50',
              ].join(' ')}
            >
              {it.label}
              {it.count != null && (
                <span className={[
                  'ml-1.5 rounded-md px-1.5 py-0.5 text-[10px]',
                  active ? 'bg-black/20' : 'bg-bg-app',
                ].join(' ')}>{it.count}</span>
              )}
            </button>
          );
        })}
        {extra}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Criar `HubCard.tsx`**

```tsx
import type { ReactNode } from 'react';

interface Props {
  icon: ReactNode;
  title: string;
  /** Linha meta com KPIs inline. Use <strong> pra valores em destaque. */
  meta: ReactNode;
  onClick: () => void;
}

/**
 * Card-linha clicável (drill-down). Estilo iOS Settings: ícone à esquerda,
 * título + meta no meio, chevron à direita. Touch target ≥ 64px.
 */
export function HubCard({ icon, title, meta, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full bg-bg-surface border border-border rounded-2xl p-md flex items-center gap-3 text-left hover:border-tom/40 transition-colors"
      style={{ minHeight: 64 }}
    >
      <div className="w-12 h-12 rounded-xl bg-tom/10 flex items-center justify-center text-2xl shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-fg font-semibold">{title}</div>
        <div className="text-fg-muted text-body-sm mt-0.5 truncate">{meta}</div>
      </div>
      <div className="text-fg-muted opacity-40 text-xl shrink-0">›</div>
    </button>
  );
}
```

- [ ] **Step 4: Criar `UnidadeChip.tsx`**

```tsx
import { useState } from 'react';
import { BottomSheet } from './BottomSheet';
import { useUnidadeSelecionada } from '../hooks/useUnidadeSelecionada';

/**
 * Chip-seletor de unidade. Mostra unidade ativa; click abre BottomSheet
 * com a lista de unidades disponíveis. Substitui as Tabs horizontais.
 */
export function UnidadeChip() {
  const { unidade, unidades, setUnidade } = useUnidadeSelecionada();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-bg-surface border border-border rounded-xl px-3 py-1.5 text-body-sm text-fg flex items-center gap-1"
      >
        {unidade?.nome ?? 'Selecionar'} <span className="text-fg-muted">▾</span>
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Unidade">
        <div className="space-y-1">
          {unidades.map(u => (
            <button
              key={u.id}
              type="button"
              onClick={() => { setUnidade(u.id); setOpen(false); }}
              className={[
                'w-full text-left px-md py-3 rounded-md border',
                u.id === unidade?.id
                  ? 'bg-tom/10 border-tom text-tom font-semibold'
                  : 'bg-bg-surface border-border text-fg hover:border-tom/30',
              ].join(' ')}
            >
              {u.nome}
            </button>
          ))}
        </div>
      </BottomSheet>
    </>
  );
}
```

- [ ] **Step 5: Validar build**

Run: `cd web && npx tsc --noEmit`
Expected: zero erros.

---

## Task B: LojaHub (refactor da LojaPage atual)

**Files:**
- Create: `web/src/screens/inventario/LojaHub.tsx`
- Modify (depois, Task G): `web/src/App.tsx`, delete `LojaPage.tsx`

- [ ] **Step 1: Criar `LojaHub.tsx`**

```tsx
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { Fab } from '../../components/Fab';
import { LoadingState } from '../../components/LoadingState';
import { UnidadeChip } from '../../components/UnidadeChip';
import { HubCard } from '../../components/HubCard';
import { useUnidadeSelecionada } from '../../hooks/useUnidadeSelecionada';
import { useReportLoja, useHistoricoVendas, useReservas } from '../../hooks/useLaReport';
import { useState, useMemo } from 'react';
import { VendaWizardSheet } from './components/VendaWizardSheet';
import { EntradaRicaSheet } from './components/EntradaRicaSheet';
import { ProdutoFormSheet } from './components/ProdutoFormSheet';
import { TransferenciaSheet } from './components/TransferenciaSheet';
import { ReservaSheet } from './components/ReservaSheet';

export function LojaHub() {
  const navigate = useNavigate();
  const { unidadeId, isLoading: lU } = useUnidadeSelecionada();
  const { data: produtos = [] } = useReportLoja(unidadeId || null);
  const { data: vendas30 = [] } = useHistoricoVendas(unidadeId || null, { dias: 30, status: 'todas' });
  const { data: reservasAtivas = [] } = useReservas(unidadeId || null, 'ativa');

  const [vendaOpen, setVendaOpen] = useState(false);
  const [entradaOpen, setEntradaOpen] = useState(false);
  const [produtoOpen, setProdutoOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [reservaOpen, setReservaOpen] = useState(false);

  const baixos = useMemo(() => produtos.filter(p => p.abaixo_minimo || p.zerado), [produtos]);
  const totalUnidades = useMemo(() => produtos.reduce((s, p) => s + p.estoque_atual, 0), [produtos]);
  const valorEstoque = useMemo(
    () => produtos.reduce((s, p) => s + p.estoque_atual * (p.custo ?? 0), 0),
    [produtos]
  );
  const ativas = vendas30.filter(v => v.status === 'ativa');
  const totalFaturado = ativas.reduce((s, v) => s + Number(v.total ?? 0), 0);
  const estornadas = vendas30.length - ativas.length;
  const venceHoje = useMemo(() => {
    const hoje = new Date().toISOString().slice(0, 10);
    return reservasAtivas.filter(r => r.prazo === hoje).length;
  }, [reservasAtivas]);

  if (lU) return <LoadingState />;

  return (
    <div className="space-y-md pb-xl">
      <div className="flex items-center justify-between gap-sm">
        <PageHeader title="🛍 Lojinha" backTo="/inventario" />
        <UnidadeChip />
      </div>

      {baixos.length > 0 && (
        <div className="bg-warning/10 border border-warning/40 border-l-4 rounded-md p-md text-body-sm">
          ⚠️ <strong className="text-warning">{baixos.length} produto{baixos.length > 1 ? 's' : ''} abaixo do estoque mínimo nesta unidade.</strong>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-body-sm text-fg-muted font-semibold uppercase tracking-wide">Acessos rápidos</h3>
        <HubCard
          icon="📦"
          title="Produtos"
          meta={<><strong className="text-fg">{produtos.length} ativos</strong> · R${valorEstoque.toFixed(0)} estoque{baixos.length > 0 ? ` · ${baixos.length} atenção` : ''}</>}
          onClick={() => navigate(`/inventario/loja/produtos?unit=${unidadeId}`)}
        />
        <HubCard
          icon="📊"
          title="Histórico"
          meta={<><strong className="text-fg">{ativas.length} vendas</strong> · R${totalFaturado.toFixed(0)} (30d){estornadas > 0 ? ` · ${estornadas} estornada${estornadas > 1 ? 's' : ''}` : ''}</>}
          onClick={() => navigate(`/inventario/loja/historico?unit=${unidadeId}`)}
        />
        <HubCard
          icon="🔖"
          title="Reservas"
          meta={<><strong className="text-fg">{reservasAtivas.length} ativa{reservasAtivas.length !== 1 ? 's' : ''}</strong> · {venceHoje} vence hoje</>}
          onClick={() => navigate(`/inventario/loja/reservas?unit=${unidadeId}`)}
        />
      </div>

      <div className="space-y-2">
        <h3 className="text-body-sm text-fg-muted font-semibold uppercase tracking-wide">Resumo da unidade</h3>
        <div className="bg-bg-surface border border-border rounded-2xl p-md flex gap-md">
          <div className="flex-1">
            <div className="text-h2 font-bold">{totalUnidades}</div>
            <div className="text-[10px] text-fg-muted uppercase tracking-wide mt-1">Unidades em estoque</div>
          </div>
          <div className="flex-1">
            <div className="text-h2 font-bold text-tom">R${totalFaturado.toFixed(0)}</div>
            <div className="text-[10px] text-fg-muted uppercase tracking-wide mt-1">Vendas (30d)</div>
          </div>
        </div>
      </div>

      <Fab
        label="Novo"
        ariaLabel="Nova operação na lojinha"
        actions={[
          { icon: '💰', label: 'Registrar venda', onClick: () => setVendaOpen(true) },
          { icon: '📦', label: 'Lançar entrada', onClick: () => setEntradaOpen(true) },
          { icon: '🆕', label: 'Cadastrar produto', onClick: () => setProdutoOpen(true) },
          { icon: '🔄', label: 'Transferir estoque', onClick: () => setTransferOpen(true) },
          { icon: '🔖', label: 'Criar reserva', onClick: () => setReservaOpen(true) },
        ]}
      />

      <VendaWizardSheet open={vendaOpen} onClose={() => setVendaOpen(false)} unidadeId={unidadeId} />
      <EntradaRicaSheet open={entradaOpen} onClose={() => setEntradaOpen(false)} unidadeId={unidadeId} />
      <ProdutoFormSheet open={produtoOpen} onClose={() => setProdutoOpen(false)} mode="create" unidadeId={unidadeId} />
      <TransferenciaSheet open={transferOpen} onClose={() => setTransferOpen(false)} unidadeOrigem={unidadeId} />
      <ReservaSheet open={reservaOpen} onClose={() => setReservaOpen(false)} unidadeId={unidadeId} />
    </div>
  );
}
```

- [ ] **Step 2: Validar TS**

Run: `cd web && npx tsc --noEmit`
Expected: zero erros (assume rotas serão adicionadas em Task G).

---

## Task C: ProdutosPage (extrai conteúdo de produtos)

**Files:**
- Create: `web/src/screens/inventario/ProdutosPage.tsx`

- [ ] **Step 1: Criar `ProdutosPage.tsx`**

```tsx
import { useState, useMemo } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/LoadingState';
import { EmptyState } from '../../components/EmptyState';
import { Fab } from '../../components/Fab';
import { UnidadeChip } from '../../components/UnidadeChip';
import { ChipFilterRow } from '../../components/ChipFilterRow';
import { ProdutoCard } from './components/ProdutoCard';
import { ProdutoFormSheet } from './components/ProdutoFormSheet';
import { useReportLoja } from '../../hooks/useLaReport';
import { useUnidadeSelecionada } from '../../hooks/useUnidadeSelecionada';
import { desativarProduto } from '../../lib/lareport-mutations';
import { useQueryClient } from '@tanstack/react-query';
import type { ReportProduto } from '../../lib/lareport-types';

type Filtro = 'todos' | 'baixo' | 'zerado';

export function ProdutosPage() {
  const qc = useQueryClient();
  const { unidadeId } = useUnidadeSelecionada();
  const { data: produtos = [], isLoading } = useReportLoja(unidadeId || null);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [busca, setBusca] = useState('');
  const [produtoOpen, setProdutoOpen] = useState(false);
  const [editando, setEditando] = useState<ReportProduto | null>(null);

  const baixos = produtos.filter(p => p.abaixo_minimo);
  const zerados = produtos.filter(p => p.zerado);

  const visiveis = useMemo(() => {
    let lista = produtos;
    if (filtro === 'baixo') lista = baixos;
    else if (filtro === 'zerado') lista = zerados;
    const q = busca.trim().toLowerCase();
    if (q.length >= 2) lista = lista.filter(p => p.nome.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q));
    return lista;
  }, [produtos, filtro, busca, baixos, zerados]);

  return (
    <div className="space-y-md pb-xl">
      <div className="flex items-center justify-between gap-sm">
        <PageHeader title="📦 Produtos" backTo={`/inventario/loja?unit=${unidadeId}`} />
        <UnidadeChip />
      </div>

      <input
        type="search"
        inputMode="search"
        placeholder="Buscar produto..."
        value={busca}
        onChange={e => setBusca(e.target.value)}
        className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"
      />

      <ChipFilterRow
        items={[
          { id: 'todos',   label: 'Todos',         count: produtos.length },
          { id: 'baixo',   label: 'Estoque baixo', count: baixos.length },
          { id: 'zerado',  label: 'Sem estoque',   count: zerados.length },
        ]}
        activeId={filtro}
        onChange={id => setFiltro(id as Filtro)}
      />

      {isLoading ? (
        <LoadingState />
      ) : visiveis.length === 0 ? (
        <EmptyState icon={<span>📦</span>} title="Sem produtos" description="Nenhum produto encontrado." />
      ) : (
        <div className="space-y-2">
          {visiveis.map(p => (
            <ProdutoCard
              key={p.id}
              produto={p}
              onEdit={() => { setEditando(p); setProdutoOpen(true); }}
              onDeactivate={async () => {
                if (!window.confirm('Desativar produto? Vendas antigas não mudam.')) return;
                try {
                  await desativarProduto(p.id);
                  qc.invalidateQueries({ queryKey: ['lareport', 'loja'] });
                } catch (e) {
                  alert(e instanceof Error ? e.message : 'Erro ao desativar.');
                }
              }}
            />
          ))}
        </div>
      )}

      <Fab
        label="Cadastrar"
        ariaLabel="Cadastrar produto"
        onClick={() => { setEditando(null); setProdutoOpen(true); }}
      />

      <ProdutoFormSheet
        open={produtoOpen}
        onClose={() => { setProdutoOpen(false); setEditando(null); }}
        mode={editando ? 'edit' : 'create'}
        produto={editando ? {
          id: editando.id,
          nome: editando.nome,
          sku: editando.sku,
          preco: editando.preco,
          custo: editando.custo,
          estoque_minimo: editando.estoque_minimo ?? undefined,
          foto_url: editando.foto_url,
          disponivel_whatsapp: editando.disponivel_whatsapp,
          ativo: editando.ativo,
        } : undefined}
        unidadeId={unidadeId}
      />
    </div>
  );
}
```

NOTA: o Fab atual aceita `actions` array; precisa aceitar `onClick` único também. Se não aceita, ajuste rápido em `Fab.tsx`:

```tsx
// Em Fab.tsx — se ainda não existir, adicionar prop onClick e renderizar um botão único
// quando não há actions[]
```

Verifique `web/src/components/Fab.tsx` e adapte; se já suporta `onClick`, ignore.

- [ ] **Step 2: Validar TS**

Run: `cd web && npx tsc --noEmit`
Expected: zero erros (rota será adicionada na Task G).

---

## Task D: HistoricoPage (refactor com chips)

**Files:**
- Create: `web/src/screens/inventario/HistoricoPage.tsx`
- Delete (depois, Task G): `web/src/screens/inventario/components/HistoricoVendasView.tsx`

- [ ] **Step 1: Criar `HistoricoPage.tsx`**

```tsx
import { useState, useMemo } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/LoadingState';
import { EmptyState } from '../../components/EmptyState';
import { BottomSheet } from '../../components/BottomSheet';
import { Field } from '../../components/Field';
import { CustomSelect } from '../../components/CustomSelect';
import { Button } from '../../components/Button';
import { UnidadeChip } from '../../components/UnidadeChip';
import { ChipFilterRow } from '../../components/ChipFilterRow';
import { EstornoConfirmSheet } from './components/EstornoConfirmSheet';
import { useUnidadeSelecionada } from '../../hooks/useUnidadeSelecionada';
import { useHistoricoVendas, type HistoricoVenda } from '../../hooks/useLaReport';

type Periodo = '7' | '30' | '90';
type StatusFiltro = 'todas' | 'ativa' | 'estornada';

function brl(n: number) { return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function fmtData(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function HistoricoPage() {
  const { unidadeId } = useUnidadeSelecionada();
  const [periodo, setPeriodo] = useState<Periodo>('30');
  const [status, setStatus] = useState<StatusFiltro>('ativa');
  const [forma, setForma] = useState<string | ''>('');
  const [filtrosOpen, setFiltrosOpen] = useState(false);
  const [vendaSelecionada, setVendaSelecionada] = useState<HistoricoVenda | null>(null);

  const { data: vendas = [], isLoading } = useHistoricoVendas(unidadeId || null, {
    dias: Number(periodo),
    status,
    formaPagamento: forma || undefined,
  });

  const total = useMemo(() => vendas.filter(v => v.status === 'ativa').reduce((s, v) => s + Number(v.total ?? 0), 0), [vendas]);

  return (
    <div className="space-y-md pb-xl">
      <div className="flex items-center justify-between gap-sm">
        <PageHeader title="📊 Histórico" backTo={`/inventario/loja?unit=${unidadeId}`} />
        <UnidadeChip />
      </div>

      <ChipFilterRow
        items={[
          { id: '30', label: '30 dias' },
          { id: '7',  label: '7d' },
          { id: '90', label: '90d' },
        ]}
        activeId={periodo}
        onChange={id => setPeriodo(id as Periodo)}
        extra={
          <button
            type="button"
            onClick={() => setFiltrosOpen(true)}
            className="whitespace-nowrap rounded-full px-3 py-1.5 text-body-sm border bg-bg-surface text-fg-muted border-border hover:border-tom/50"
          >
            Filtros ⚙
          </button>
        }
      />

      <div className="text-body-sm text-fg-muted">
        <strong className="text-fg">{vendas.length} venda{vendas.length !== 1 ? 's' : ''}</strong> · {brl(total)}
      </div>

      {isLoading ? <LoadingState /> : vendas.length === 0 ? (
        <EmptyState icon={<span>📊</span>} title="Sem vendas" description="Nenhuma venda no período." />
      ) : (
        <div className="space-y-2">
          {vendas.map(v => {
            const estornada = v.status === 'estornada';
            const primeiro = (v.loja_venda_itens || [])[0];
            const nomeProd = (primeiro as any)?.produto_nome ?? primeiro?.loja_produtos?.nome ?? `Produto #${primeiro?.produto_id}`;
            const cliente = v.loja_alunos?.nome ?? v.cliente_nome ?? 'Avulso';
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => !estornada && setVendaSelecionada(v)}
                disabled={estornada}
                className={[
                  'w-full text-left bg-bg-surface border border-border rounded-xl p-md flex items-center gap-3',
                  estornada ? 'opacity-50 cursor-not-allowed' : 'hover:border-tom/40',
                ].join(' ')}
              >
                <div className="text-xl">{estornada ? '↩️' : '💰'}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-fg font-medium truncate">{primeiro?.quantidade ?? 0}× {nomeProd} · {cliente}</div>
                  <div className="text-fg-muted text-body-sm">
                    {fmtData(v.created_at)} · <span className="inline-block px-2 py-0.5 rounded-md bg-bg-app text-xs">{v.forma_pagamento?.toUpperCase()}</span> · <span className="inline-block px-2 py-0.5 rounded-md bg-bg-app text-xs">#{v.id}</span>
                    {estornada && <span className="ml-1 inline-block px-2 py-0.5 rounded-md bg-danger/20 text-danger text-xs">ESTORNADA</span>}
                  </div>
                </div>
                <div className={`tabular-nums shrink-0 ${estornada ? 'line-through' : ''}`}>{brl(Number(v.total ?? 0))}</div>
              </button>
            );
          })}
        </div>
      )}

      <BottomSheet open={filtrosOpen} onClose={() => setFiltrosOpen(false)} title="Filtros">
        <div className="space-y-md">
          <Field label="Status">
            <CustomSelect
              value={status}
              options={[
                { value: 'ativa',     label: 'Ativas' },
                { value: 'estornada', label: 'Estornadas' },
                { value: 'todas',     label: 'Todas' },
              ]}
              onChange={v => setStatus(v as StatusFiltro)}
            />
          </Field>
          <Field label="Forma de pagamento">
            <CustomSelect
              value={forma}
              options={[
                { value: '',         label: 'Todas as formas' },
                { value: 'pix',      label: 'PIX' },
                { value: 'dinheiro', label: 'Dinheiro' },
                { value: 'debito',   label: 'Débito' },
                { value: 'credito',  label: 'Crédito' },
                { value: 'folha',    label: 'Folha' },
                { value: 'saldo',    label: 'Saldo' },
              ]}
              onChange={setForma}
            />
          </Field>
          <Button variant="primary" fullWidth onClick={() => setFiltrosOpen(false)}>Aplicar</Button>
        </div>
      </BottomSheet>

      <EstornoConfirmSheet open={!!vendaSelecionada} onClose={() => setVendaSelecionada(null)} venda={vendaSelecionada} />
    </div>
  );
}
```

- [ ] **Step 2: Validar TS**

Run: `cd web && npx tsc --noEmit`
Expected: zero erros.

---

## Task E: ReservasPage (chips de status)

**Files:**
- Create: `web/src/screens/inventario/ReservasPage.tsx`
- Delete (depois, Task G): `web/src/screens/inventario/components/ReservasView.tsx`

- [ ] **Step 1: Criar `ReservasPage.tsx`**

Use o conteúdo existente de `web/src/screens/inventario/components/ReservasView.tsx` como base. Diferenças:
1. Header próprio (PageHeader + UnidadeChip) — NÃO usar Tabs internas
2. ChipFilterRow para escolher status (Ativas / Finalizadas / Arquivadas), onde Arquivadas = cancelada + expirada
3. Fab pra "Criar reserva"

```tsx
import { useState } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/LoadingState';
import { EmptyState } from '../../components/EmptyState';
import { Fab } from '../../components/Fab';
import { UnidadeChip } from '../../components/UnidadeChip';
import { ChipFilterRow } from '../../components/ChipFilterRow';
import { ReservaSheet } from './components/ReservaSheet';
import { useUnidadeSelecionada } from '../../hooks/useUnidadeSelecionada';
import { useReservas } from '../../hooks/useLaReport';
import { cancelarReserva, finalizarReserva } from '../../lib/lareport-mutations';
import { useQueryClient } from '@tanstack/react-query';
import { showToast } from '../../components/Toast';

type StatusFiltro = 'ativa' | 'finalizada' | 'arquivada';

function diasAte(prazoIso: string | null): number | null {
  if (!prazoIso) return null;
  const d = new Date(prazoIso);
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  return Math.floor((d.getTime() - hoje.getTime()) / 86400000);
}

export function ReservasPage() {
  const qc = useQueryClient();
  const { unidadeId } = useUnidadeSelecionada();
  const [statusFiltro, setStatusFiltro] = useState<StatusFiltro>('ativa');
  const [reservaOpen, setReservaOpen] = useState(false);

  const queryStatus = statusFiltro === 'arquivada' ? 'todas' : statusFiltro;
  const { data: reservas = [], isLoading } = useReservas(unidadeId || null, queryStatus as any);

  const visiveis = statusFiltro === 'arquivada'
    ? reservas.filter(r => r.status === 'cancelada' || r.status === 'expirada')
    : reservas;

  const counts = {
    ativa: reservas.filter(r => r.status === 'ativa').length,
    finalizada: reservas.filter(r => r.status === 'finalizada').length,
    arquivada: reservas.filter(r => r.status === 'cancelada' || r.status === 'expirada').length,
  };

  async function handleCancelar(id: number) {
    const motivo = window.prompt('Motivo do cancelamento (opcional):') ?? undefined;
    if (motivo === null) return;
    try {
      await cancelarReserva(id, motivo);
      qc.invalidateQueries({ queryKey: ['lareport', 'reservas'] });
      showToast({ kind: 'success', title: `Reserva #${id} cancelada` });
    } catch (e) {
      showToast({ kind: 'error', title: 'Erro ao cancelar', msg: e instanceof Error ? e.message : '' });
    }
  }

  return (
    <div className="space-y-md pb-xl">
      <div className="flex items-center justify-between gap-sm">
        <PageHeader title="🔖 Reservas" backTo={`/inventario/loja?unit=${unidadeId}`} />
        <UnidadeChip />
      </div>

      <ChipFilterRow
        items={[
          { id: 'ativa',      label: 'Ativas',      count: counts.ativa },
          { id: 'finalizada', label: 'Finalizadas', count: counts.finalizada },
          { id: 'arquivada',  label: 'Arquivadas',  count: counts.arquivada },
        ]}
        activeId={statusFiltro}
        onChange={id => setStatusFiltro(id as StatusFiltro)}
      />

      {isLoading ? <LoadingState /> :
       visiveis.length === 0 ? <EmptyState icon={<span>🔖</span>} title="Sem reservas" description="Nada por aqui." /> : (
        <div className="space-y-2">
          {visiveis.map(r => {
            const dias = diasAte(r.prazo);
            const vencida = dias !== null && dias < 0;
            const vencimentoLabel = r.status === 'ativa'
              ? (vencida ? 'VENCIDA' : `Vence em ${dias}d`)
              : r.status === 'finalizada' ? 'Finalizada'
              : r.status === 'cancelada' ? 'Cancelada' : 'Expirada';
            const vencimentoCls = r.status === 'ativa'
              ? (vencida ? 'bg-danger/20 text-danger' : 'bg-warning/15 text-warning')
              : 'bg-bg-app text-fg-muted';
            const produtoNome = r.loja_produtos?.nome ?? `Produto #${r.produto_id}`;
            const cliente = r.loja_alunos?.nome ?? r.cliente_nome ?? '—';
            return (
              <div key={r.id} className="bg-bg-surface border border-border rounded-xl p-md">
                <div className="flex items-center gap-3">
                  <div className="text-xl">🔖</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-fg truncate">{cliente} · {r.quantidade}×</div>
                    <div className="text-body-sm text-fg-muted truncate">{produtoNome}</div>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-1 rounded-md ${vencimentoCls}`}>{vencimentoLabel}</span>
                </div>
                {r.status === 'ativa' && (
                  <div className="flex gap-2 mt-3 pt-3 border-t border-border items-center">
                    <button
                      type="button"
                      onClick={() => alert('Use o sheet de finalização (Sprint pós refactor — manter behavior atual)')}
                      className="bg-tom text-bg-app px-3 py-1.5 rounded-md text-body-sm font-semibold"
                    >Finalizar</button>
                    <button
                      type="button"
                      onClick={() => handleCancelar(r.id)}
                      className="text-fg-muted px-3 py-1.5 text-body-sm"
                    >Cancelar</button>
                    <span className="flex-1 text-right text-body-sm text-fg-muted">Prazo: {r.prazo ? new Date(r.prazo).toLocaleDateString('pt-BR') : '—'}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Fab label="Reserva" ariaLabel="Criar reserva" onClick={() => setReservaOpen(true)} />
      <ReservaSheet open={reservaOpen} onClose={() => setReservaOpen(false)} unidadeId={unidadeId} />
    </div>
  );
}
```

NOTA: o "Finalizar" exibe um alert temporário. Se o `ReservasView` atual tem um `FinalizarSheet` inline, copie-o pra cá. Verifique `ReservasView.tsx` linhas finais e replique a sheet de finalização.

- [ ] **Step 2: Replicar FinalizarSheet de `ReservasView.tsx`**

Leia `web/src/screens/inventario/components/ReservasView.tsx`, identifique o subcomponente `FinalizarSheet` (mini sheet com forma de pagamento + preço unitário), e cole inline em `ReservasPage.tsx`. Use `finalizarReserva` da mutation. Substitua o alert do passo anterior pelo `setFinalizarOpen({ id: r.id })`.

- [ ] **Step 3: Validar TS**

Run: `cd web && npx tsc --noEmit`
Expected: zero erros.

---

## Task F: Verificar/ajustar `Fab.tsx` pra aceitar `onClick`

**Files:**
- Modify (se necessário): `web/src/components/Fab.tsx`

Hoje `Fab` provavelmente aceita só `actions[]`. Tasks C, E, e o reuso geral exigem que ele aceite `onClick` único pra ação direta.

- [ ] **Step 1: Inspecionar `Fab.tsx`**

Run: `cat web/src/components/Fab.tsx | head -60`

- [ ] **Step 2: Se não suporta `onClick` único, adicionar prop**

Adicione overload das props:
```tsx
type FabProps = {
  label: string;
  ariaLabel: string;
} & (
  | { onClick: () => void; actions?: never }
  | { actions: { icon: string; label: string; onClick: () => void }[]; onClick?: never }
);
```

E no render: se `onClick` definido, render botão único; senão render o menu de actions.

- [ ] **Step 3: Validar TS**

Run: `cd web && npx tsc --noEmit`

---

## Task G: Rotas + remoção de arquivos antigos

**Files:**
- Modify: `web/src/App.tsx`
- Delete: `web/src/screens/inventario/LojaPage.tsx`
- Delete: `web/src/screens/inventario/components/HistoricoVendasView.tsx`
- Delete: `web/src/screens/inventario/components/ReservasView.tsx`

- [ ] **Step 1: Atualizar imports e rotas em `App.tsx`**

Substituir:
```tsx
import { InventarioLojaPage } from './screens/inventario/LojaPage';
```
Por:
```tsx
import { LojaHub } from './screens/inventario/LojaHub';
import { ProdutosPage } from './screens/inventario/ProdutosPage';
import { HistoricoPage } from './screens/inventario/HistoricoPage';
import { ReservasPage } from './screens/inventario/ReservasPage';
```

Substituir a rota:
```tsx
<Route path="inventario/loja" element={<InventarioLojaPage />} />
```
Por:
```tsx
<Route path="inventario/loja" element={<LojaHub />} />
<Route path="inventario/loja/produtos" element={<ProdutosPage />} />
<Route path="inventario/loja/historico" element={<HistoricoPage />} />
<Route path="inventario/loja/reservas" element={<ReservasPage />} />
```

A ordem deve manter `inventario/loja` ANTES de `inventario/sala/:salaId` (já era assim — preservar).

- [ ] **Step 2: Deletar arquivos antigos**

```bash
rm web/src/screens/inventario/LojaPage.tsx
rm web/src/screens/inventario/components/HistoricoVendasView.tsx
rm web/src/screens/inventario/components/ReservasView.tsx
```

- [ ] **Step 3: Validar build completo**

Run: `cd web && npm run build`
Expected: build sucesso, zero erros TS.

---

## Task H: Smoke test visual no Simple Browser

**Files:** Nenhum (apenas validação).

- [ ] **Step 1: Restart preview**

Use `mcp__Claude_Preview__preview_stop` no server `web-preview` e `preview_start` de novo (pra pegar dist novo).

- [ ] **Step 2: Limpar SW + navegar pro hub**

```js
(async()=>{
  const regs=await navigator.serviceWorker?.getRegistrations()||[];
  for(const r of regs)await r.unregister();
  const ks=await caches.keys();
  for(const k of ks)await caches.delete(k);
  history.pushState({},'','/inventario/loja');
  window.dispatchEvent(new PopStateEvent('popstate'));
})()
```

- [ ] **Step 3: Validar visualmente**

Tirar screenshots de:
- `/inventario/loja` (hub com 3 cards)
- `/inventario/loja/produtos` (busca + chips + lista)
- `/inventario/loja/historico` (chips + lista)
- `/inventario/loja/reservas` (chips + cards com Finalizar/Cancelar)

Checar:
- Chips horizontais SEM barra de scroll visível
- Click no card do hub navega pra tela respectiva
- Back das telas internas volta pro hub (não pro /inventario)
- UnidadeChip funciona em todas as telas e persiste via URL
- FAB funciona em hub (5 ações), produtos (cadastrar), reservas (criar)

- [ ] **Step 4: Auto-deploy**

Termina turno — auto-deploy hook commita+pusha tudo.

---

## Self-review

Checagem inline final antes de dispatchar subagents.

**Spec coverage:**
- §1 Nav: Task G adiciona rotas ✅
- §2 Hub: Task B cria LojaHub ✅
- §3 Produtos: Task C ✅
- §4 Histórico: Task D ✅
- §5 Reservas: Task E ✅
- §6 Componentes: Task A (base) ✅
- §7 URL state: useUnidadeSelecionada em Task A ✅
- §9 Acessibilidade chips min-h 44px: ChipFilterRow ✅
- §11 critérios: Task H smoke ✅

**Placeholders:** sem TBD/TODO. Há um alert temporário em ReservasPage Step 1 que é resolvido pelo Step 2 da mesma task — explícito.

**Type consistency:** `useUnidadeSelecionada()` retorno consistente em todas as tasks (unidadeId, unidade, unidades, setUnidade, isLoading). `ChipFilterRow` props consistentes. `HubCard` props consistentes.

Plan completo. Pronto pra subagent-driven execution.
