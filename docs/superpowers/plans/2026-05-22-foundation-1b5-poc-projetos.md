# Foundation 1b.5 — POC Projetos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Migrar a tela `/projetos` para usar o design system (PageShell + Toolbar + KanbanBoard/DenseTable + DetailDrawer) com dados reais do Supabase, preservando o banner de aprovação e a query role-based.

**Architecture:** Reescrita pragmática da `screens/Projetos.tsx`. POC visual: Kanban (default) + Lista (DenseTable) via ViewSwitcher; click no card abre DetailDrawer com resumo + CTA "Abrir projeto" (navega para `/projetos/:id` que continua funcionando). NESTE POC: sem drag-and-drop, sem inline rename/delete/category (acessados via tela de detalhe existente). Banner de aprovação preservado.

**Tech Stack:** React 18, TypeScript, TanStack Query 5, Supabase, design/* (1b.2/1b.3/1b.4).

---

## Mapa de arquivos

| Ação | Caminho |
|------|---------|
| Criar | `web/src/screens/projetos/constants.ts` |
| Criar | `web/src/screens/projetos/ProjectCardV2.tsx` |
| Criar | `web/src/screens/projetos/ProjectDetailDrawer.tsx` |
| Modificar | `web/src/screens/Projetos.tsx` (reescrita) |

`Projetos.tsx` original (564 linhas com DnD, inline rename, etc.) será reescrito. A versão antiga fica no git history. Drag-and-drop e inline edit voltarão em fase futura. A tela `/projetos/:id` (`ProjetoDetalhe.tsx`) NÃO é tocada — é onde acontece todo o edit.

---

### Task 1: constants.ts

Constantes locais da tela: colunas Kanban, cores por status, ícones.

**Files:**
- Create: `web/src/screens/projetos/constants.ts`

- [ ] **Step 1: Criar o arquivo**

```ts
import type { Project, ProjectStatus, ProjectCategory } from '../../types';

/** Ordem das colunas no Kanban e seus labels PT-BR. */
export const KANBAN_COLUMNS: Array<{ id: ProjectStatus; title: string; accentColor: string }> = [
  { id: 'pending_approval', title: 'Aguardando aprovação', accentColor: '#F59E0B' },
  { id: 'planning',         title: 'Em planejamento',      accentColor: '#60a5fa' },
  { id: 'active',           title: 'Em andamento',         accentColor: '#A3BE50' },
  { id: 'paused',           title: 'Pausado',              accentColor: '#9E9E9E' },
];

/** Categorias com cor (hex puro pra usar em badge inline). Mantém paridade com CategoryTag.tsx. */
export const CATEGORY_BADGE: Record<ProjectCategory, { label: string; bg: string; fg: string }> = {
  pedagogical:    { label: 'Pedagógico',    bg: 'rgba(139, 92, 246, 0.15)',  fg: '#C4B5FD' },
  commercial:     { label: 'Comercial',     bg: 'rgba(217, 70, 239, 0.15)',  fg: '#F0ABFC' },
  administrative: { label: 'Administrativo',bg: 'rgba(6, 182, 212, 0.15)',   fg: '#A5F3FC' },
  operational:    { label: 'Operacional',   bg: 'rgba(20, 184, 166, 0.15)',  fg: '#99F6E4' },
  event:          { label: 'Evento',        bg: 'rgba(244, 63, 94, 0.15)',   fg: '#FECDD3' },
  infrastructure: { label: 'Infraestrutura',bg: 'rgba(100, 116, 139, 0.20)', fg: '#CBD5E1' },
};

/** Agrupa projetos por status. Ignora `completed` e `cancelled` (não aparecem no kanban). */
export function groupByStatus(projects: Project[]): Record<ProjectStatus, Project[]> {
  const groups: Record<ProjectStatus, Project[]> = {
    pending_approval: [],
    planning: [],
    active: [],
    paused: [],
    completed: [],
    cancelled: [],
  };
  for (const p of projects) groups[p.status].push(p);
  return groups;
}
```

- [ ] **Step 2: TypeScript check**

```powershell
cd D:\la-organizer\_remote\web; npx tsc --noEmit
```

---

### Task 2: ProjectCardV2.tsx

Card presentacional usado tanto no Kanban quanto como célula da tabela (simplificado).

**Files:**
- Create: `web/src/screens/projetos/ProjectCardV2.tsx`

- [ ] **Step 1: Criar o arquivo**

```tsx
import type { Project } from '../../types';
import { CATEGORY_BADGE } from './constants';

interface ProjectCardV2Props {
  project: Project;
  onClick?: () => void;
}

export function ProjectCardV2({ project, onClick }: ProjectCardV2Props) {
  const cat = CATEGORY_BADGE[project.category];
  const progress = Math.max(0, Math.min(100, project.progress_percent ?? 0));

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-lg border border-border bg-bg-elevated hover:border-tom/40 hover:bg-bg-elevated2 transition-colors p-3 focus-ring"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-[13px] font-semibold text-fg leading-tight line-clamp-2 flex-1">
          {project.name}
        </h3>
        <span
          className="shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
          style={{ backgroundColor: cat.bg, color: cat.fg }}
        >
          {cat.label}
        </span>
      </div>
      {project.description && (
        <p className="text-[11px] text-fg-muted line-clamp-2 mb-2">{project.description}</p>
      )}
      <div className="flex items-center justify-between gap-2 mt-2">
        <span className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">
          Progresso
        </span>
        <span className="text-[10px] font-bold text-fg tabular-nums">{progress}%</span>
      </div>
      <div className="w-full h-1 rounded-full bg-bg-app overflow-hidden mt-1">
        <div
          className="h-full rounded-full bg-tom transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
    </button>
  );
}
```

- [ ] **Step 2: TypeScript check**

---

### Task 3: ProjectDetailDrawer.tsx

Drawer de detalhe ao clicar num card. Mostra resumo read-only + CTA "Abrir projeto" que navega pra `/projetos/:id`.

**Files:**
- Create: `web/src/screens/projetos/ProjectDetailDrawer.tsx`

- [ ] **Step 1: Criar o arquivo**

```tsx
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Calendar, Users, Tag, Activity } from 'lucide-react';
import { DetailDrawer } from '../../design/primitives/DetailDrawer';
import type { Project } from '../../types';
import { CATEGORY_BADGE, KANBAN_COLUMNS } from './constants';

interface ProjectDetailDrawerProps {
  project: Project | null;
  onClose: () => void;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

export function ProjectDetailDrawer({ project, onClose }: ProjectDetailDrawerProps) {
  const navigate = useNavigate();

  if (!project) {
    return <DetailDrawer open={false} onClose={onClose} title="">{null}</DetailDrawer>;
  }

  const cat = CATEGORY_BADGE[project.category];
  const statusLabel = KANBAN_COLUMNS.find(c => c.id === project.status)?.title
    ?? project.status;
  const progress = Math.max(0, Math.min(100, project.progress_percent ?? 0));

  return (
    <DetailDrawer
      open={!!project}
      onClose={onClose}
      title={project.name}
      subtitle={
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block px-2 py-0.5 rounded text-[10px] font-medium"
            style={{ backgroundColor: cat.bg, color: cat.fg }}
          >
            {cat.label}
          </span>
          <span>·</span>
          <span>{statusLabel}</span>
        </span>
      }
      footer={
        <button
          type="button"
          onClick={() => { onClose(); navigate(`/projetos/${project.id}`); }}
          className="w-full h-9 flex items-center justify-center gap-2 rounded-md bg-tom text-white text-[13px] font-semibold hover:opacity-90 transition-opacity focus-ring"
        >
          <ExternalLink size={14} />
          Abrir projeto
        </button>
      }
    >
      <div className="space-y-4">
        {project.description && (
          <section>
            <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-1">
              Descrição
            </div>
            <p className="text-[13px] text-fg whitespace-pre-wrap">{project.description}</p>
          </section>
        )}

        <section>
          <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-1.5 flex items-center gap-1.5">
            <Activity size={11} /> Progresso
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 rounded-full bg-bg-elevated overflow-hidden">
              <div className="h-full bg-tom rounded-full" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-[13px] font-bold text-fg tabular-nums">{progress}%</span>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-1 flex items-center gap-1.5">
              <Calendar size={11} /> Início
            </div>
            <div className="text-[13px] text-fg">{formatDate(project.start_date)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-1 flex items-center gap-1.5">
              <Calendar size={11} /> Fim
            </div>
            <div className="text-[13px] text-fg">{formatDate(project.end_date)}</div>
          </div>
        </section>

        {project.justification && (
          <section>
            <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-1">
              Justificativa
            </div>
            <p className="text-[13px] text-fg whitespace-pre-wrap">{project.justification}</p>
          </section>
        )}

        {project.location && (
          <section>
            <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-1 flex items-center gap-1.5">
              <Tag size={11} /> Local
            </div>
            <div className="text-[13px] text-fg">{project.location}</div>
          </section>
        )}

        {project.estimated_hours_week !== null && (
          <section>
            <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-1 flex items-center gap-1.5">
              <Users size={11} /> Esforço estimado
            </div>
            <div className="text-[13px] text-fg">{project.estimated_hours_week}h/semana</div>
          </section>
        )}
      </div>
    </DetailDrawer>
  );
}
```

- [ ] **Step 2: TypeScript check**

---

### Task 4: Reescrever Projetos.tsx

Substituir COMPLETAMENTE o conteúdo de `web/src/screens/Projetos.tsx` por:

**Files:**
- Modify: `web/src/screens/Projetos.tsx`

- [ ] **Step 1: Escrever o novo arquivo (substitui o conteúdo inteiro)**

```tsx
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid, List, Rocket, Check, X as XIcon } from 'lucide-react';
import { PageShell } from '../design/primitives/PageShell';
import { Toolbar } from '../design/primitives/Toolbar';
import { ViewSwitcher } from '../design/primitives/ViewSwitcher';
import { FilterPill } from '../design/primitives/FilterPill';
import { EmptyStateDesktop } from '../design/primitives/EmptyStateDesktop';
import { SkeletonList } from '../design/primitives/LoadingSkeleton';
import { KanbanBoard } from '../design/views/KanbanBoard';
import { DenseTable } from '../design/views/DenseTable';
import type { DenseTableColumn } from '../design/views/DenseTable';
import { ProjectCardV2 } from './projetos/ProjectCardV2';
import { ProjectDetailDrawer } from './projetos/ProjectDetailDrawer';
import { KANBAN_COLUMNS, CATEGORY_BADGE, groupByStatus } from './projetos/constants';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { showToast } from '../components/Toast';
import type { Project, ProjectStatus } from '../types';

type ViewMode = 'kanban' | 'list';

const ALIVE_STATUSES: ProjectStatus[] = ['active', 'planning', 'pending_approval', 'paused'];

const SELECT = `
  id, name, description, category, status, progress_percent,
  start_date, end_date, created_by, justification, methodology,
  location, estimated_hours_week, requires_approval, approved_by,
  approved_at, rejection_reason
`;

async function fetchProjects(collabId: string | undefined, isCoordOrDir: boolean): Promise<Project[]> {
  if (!collabId) return [];
  let query = supabase.from('projects').select(SELECT).in('status', ALIVE_STATUSES);
  if (!isCoordOrDir) {
    // Não-coord/director: ver só projetos onde é membro ou criador.
    const { data: memberRows } = await supabase
      .from('project_members')
      .select('project_id')
      .eq('collaborator_id', collabId);
    const memberIds = (memberRows ?? []).map(r => r.project_id);
    const ids = Array.from(new Set([...memberIds]));
    if (ids.length === 0) {
      query = query.eq('created_by', collabId);
    } else {
      query = query.or(`created_by.eq.${collabId},id.in.(${ids.join(',')})`);
    }
  }
  const { data, error } = await query.order('sort_position', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Project[];
}

async function fetchPendingApprovals(collabId: string | undefined): Promise<Project[]> {
  if (!collabId) return [];
  const { data, error } = await supabase
    .from('projects')
    .select(SELECT)
    .eq('status', 'pending_approval')
    .eq('requires_approval', true);
  if (error) throw error;
  return (data ?? []) as Project[];
}

export default function Projetos() {
  const { collaborator, role } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const isCoordOrDir = role === 'coordinator' || role === 'director';
  const [view, setView] = useState<ViewMode>('kanban');
  const [selected, setSelected] = useState<Project | null>(null);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects', collaborator?.id, isCoordOrDir],
    queryFn: () => fetchProjects(collaborator?.id, isCoordOrDir),
    enabled: !!collaborator?.id,
  });

  const { data: pendingApprovals = [] } = useQuery({
    queryKey: ['projects-pending-approval'],
    queryFn: () => fetchPendingApprovals(collaborator?.id),
    enabled: !!collaborator?.id && isCoordOrDir,
  });

  const approveMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('projects')
        .update({ status: 'planning', approved_by: collaborator?.id, approved_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['projects-pending-approval'] });
      showToast({ kind: 'success', title: 'Projeto aprovado!' });
    },
    onError: (err: Error) => showToast({ kind: 'error', title: 'Erro', msg: err.message }),
  });

  const rejectMut = useMutation({
    mutationFn: async (id: string) => {
      const reason = prompt('Motivo da rejeição (opcional):') ?? '';
      const { error } = await supabase
        .from('projects')
        .update({ status: 'cancelled', rejection_reason: reason })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['projects-pending-approval'] });
      showToast({ kind: 'success', title: 'Projeto rejeitado' });
    },
    onError: (err: Error) => showToast({ kind: 'error', title: 'Erro', msg: err.message }),
  });

  const grouped = useMemo(() => groupByStatus(projects), [projects]);
  const totalAlive = projects.length;

  const columns = KANBAN_COLUMNS.map(col => ({
    id: col.id,
    title: col.title,
    accentColor: col.accentColor,
    items: grouped[col.id] ?? [],
  }));

  const tableColumns: DenseTableColumn<Project>[] = [
    { key: 'name', label: 'Nome', render: p => <span className="font-medium">{p.name}</span> },
    {
      key: 'category',
      label: 'Categoria',
      width: 140,
      render: p => {
        const c = CATEGORY_BADGE[p.category];
        return (
          <span
            className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium"
            style={{ backgroundColor: c.bg, color: c.fg }}
          >
            {c.label}
          </span>
        );
      },
    },
    {
      key: 'status',
      label: 'Status',
      width: 160,
      render: p => KANBAN_COLUMNS.find(c => c.id === p.status)?.title ?? p.status,
    },
    {
      key: 'progress',
      label: 'Progresso',
      width: 120,
      align: 'right',
      render: p => <span className="tabular-nums">{Math.round(p.progress_percent ?? 0)}%</span>,
    },
  ];

  return (
    <>
      <PageShell
        title="Projetos"
        subtitle={isLoading ? 'Carregando…' : `${totalAlive} ativos`}
        toolbar={
          <Toolbar
            left={
              <FilterPill label="Status" value="Ativos" active />
            }
            right={
              <>
                <ViewSwitcher
                  options={[
                    { id: 'kanban', label: 'Kanban', Icon: LayoutGrid },
                    { id: 'list',   label: 'Lista',  Icon: List },
                  ]}
                  value={view}
                  onChange={setView}
                />
                <button
                  type="button"
                  onClick={() => navigate('/projetos/novo')}
                  className="h-8 px-3 rounded-md bg-tom text-white text-[12px] font-semibold hover:opacity-90 focus-ring"
                >
                  + Novo
                </button>
              </>
            }
          />
        }
      >
        {/* Banner de aprovações pendentes — visível só para coord/director quando há aprovações */}
        {isCoordOrDir && pendingApprovals.length > 0 && (
          <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-3">
            <div className="text-[12px] font-semibold text-warning mb-2">
              {pendingApprovals.length} projeto{pendingApprovals.length > 1 ? 's' : ''} aguardando aprovação
            </div>
            <div className="flex flex-wrap gap-2">
              {pendingApprovals.map(p => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 px-2 py-1 rounded-md bg-bg-surface border border-border text-[12px]"
                >
                  <button
                    type="button"
                    onClick={() => setSelected(p)}
                    className="font-medium hover:text-tom transition-colors max-w-[200px] truncate"
                  >
                    {p.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => approveMut.mutate(p.id)}
                    aria-label="Aprovar"
                    className="w-5 h-5 grid place-items-center rounded text-success hover:bg-success/20"
                  >
                    <Check size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => rejectMut.mutate(p.id)}
                    aria-label="Rejeitar"
                    className="w-5 h-5 grid place-items-center rounded text-danger hover:bg-danger/20"
                  >
                    <XIcon size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {isLoading ? (
          <SkeletonList count={6} variant="card" />
        ) : projects.length === 0 ? (
          <EmptyStateDesktop
            Icon={Rocket}
            title="Nenhum projeto ativo"
            description="Comece criando seu primeiro projeto para acompanhar tarefas, checkpoints e progresso."
            action={
              <button
                type="button"
                onClick={() => navigate('/projetos/novo')}
                className="h-9 px-4 rounded-md bg-tom text-white text-[13px] font-semibold hover:opacity-90 focus-ring"
              >
                Criar projeto
              </button>
            }
          />
        ) : view === 'kanban' ? (
          <KanbanBoard
            columns={columns}
            getItemKey={p => p.id}
            renderCard={p => <ProjectCardV2 project={p} onClick={() => setSelected(p)} />}
          />
        ) : (
          <DenseTable
            columns={tableColumns}
            rows={projects}
            getRowKey={p => p.id}
            onRowClick={p => setSelected(p)}
          />
        )}
      </PageShell>

      <ProjectDetailDrawer
        project={selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
```

- [ ] **Step 2: TypeScript check + build**

```powershell
cd D:\la-organizer\_remote\web; npx tsc --noEmit; npx vite build
```

Ambos devem passar.

---

## Self-Review

**1. Spec coverage:**
- ✅ PageShell com título "Projetos" + subtítulo de contagem
- ✅ Toolbar: FilterPill (status) + ViewSwitcher (Kanban/Lista) + "+ Novo"
- ✅ KanbanBoard com 4 colunas (`pending_approval | planning | active | paused`)
- ✅ DenseTable view alternativa
- ✅ DetailDrawer ao clicar card/row
- ✅ Banner de aprovações preservado (coord/director only)
- ✅ Approve/Reject mutations preservadas
- ✅ Loading state com SkeletonList
- ✅ Empty state com CTA
- ✅ Navegação para `/projetos/:id` via "Abrir projeto"
- ⏳ **Removido nesse POC** (volta em fase futura): drag-and-drop, inline rename/delete/category

**2. Placeholder scan:** Nenhum TBD/TODO.

**3. Type consistency:**
- `ProjectStatus`, `Project`, `ProjectCategory` importados de `../types`.
- `KANBAN_COLUMNS` tipado com `Array<{ id: ProjectStatus; ... }>`.
- `groupByStatus` retorna `Record<ProjectStatus, Project[]>` cobrindo todos os 6 status.
- `ViewMode = 'kanban' | 'list'` consistente em state, ViewSwitcher e branch render.
- Tokens Tailwind: `text-warning`, `bg-warning/10`, `border-warning/40`, `text-success`, `text-danger`, `bg-success/20`, `bg-danger/20` — todos existem no tailwind.config (cores `success: #22C55E`, `warning: #F59E0B`, `danger: #EF4444`).
