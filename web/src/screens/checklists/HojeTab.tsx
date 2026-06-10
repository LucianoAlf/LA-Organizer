// Sprint 23 — HojeTab refatorado v2.
// Decisão: trazer a UI do mobile (cards expansíveis com bolinha, drag handle,
// numeração, "+ Item") pro desktop, em coluna única centralizada (~720px).
// Sem painel direito, sem anexo, sem nota inline, sem botões soltos.
//
// Trabalho: completions do TOM de hoje (ChecklistCard) + listas pessoais context='work'.
// Pessoal: listas pessoais context='personal' (PersonalChecklistCard).
// Criação: botão "+ Criar lista" inline (não FAB) — mesmo padrão do mobile.

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { fetchPersonalChecklistsHoje } from '../../lib/personalCompletions';
import { Button } from '../../components/Button';
import { PersonalChecklistCard } from '../../components/PersonalChecklistCard';
import { ChecklistCard } from '../../components/ChecklistCard';
import { PersonalChecklistSheet } from '../../components/PersonalChecklistSheet';
import { EmptyState } from '../../components/EmptyState';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import type { OpChecklistCompletion, PersonalChecklist } from '../../types';

type Mode = 'work' | 'personal';

export function HojeTab() {
  const [mode, setMode] = useState<Mode>('work');
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <div className="px-6 py-6">
      <div className="max-w-[760px] mx-auto space-y-md">
        {/* Toggle Trabalho / Pessoal — sem emoji, mesma cara do DS */}
        <div className="flex gap-2">
          <Chip active={mode === 'work'} onClick={() => setMode('work')}>
            Trabalho
          </Chip>
          <Chip active={mode === 'personal'} onClick={() => setMode('personal')}>
            Pessoal
          </Chip>
        </div>

        {mode === 'work' ? (
          <TrabalhoView onCreateClick={() => setSheetOpen(true)} />
        ) : (
          <PessoalView onCreateClick={() => setSheetOpen(true)} />
        )}
      </div>

      <PersonalChecklistSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        context={mode}
      />
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
        active
          ? 'bg-tom text-bg-app'
          : 'bg-bg-surface text-fg/70 hover:text-fg border border-border'
      }`}
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────
// Tab Trabalho: completions do TOM de hoje + listas pessoais context='work'
// ─────────────────────────────────────────────────────────────────

function TrabalhoView({ onCreateClick }: { onCreateClick: () => void }) {
  const { collaborator } = useAuth();
  const collabId = collaborator?.id ?? null;

  const completions = useQuery({
    queryKey: ['op-checklist-completions-today', collabId],
    enabled: !!collabId,
    queryFn: async () => {
      if (!collabId) return [];
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('op_checklist_completions')
        .select(
          `*, op_checklists!inner ( id, name, dispatch_time, completion_threshold,
              op_checklist_items ( id, description, sort_order, is_active )
            ),
            op_checklist_item_completions ( id, item_id, is_checked, notes ),
            op_checklist_completion_extra_items ( id, description, is_checked, notes, sort_order )`
        )
        .eq('reference_date', today)
        .eq('collaborator_id', collabId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as OpChecklistCompletion[];
    },
    staleTime: 30_000,
  });

  const lists = useQuery({
    queryKey: ['personal-checklists', collabId, 'work'],
    enabled: !!collabId,
    // Fetch HOJE (overlay de completions por ciclo) — o estático lia is_done da tabela
    // enquanto o toggle de lista recorrente gravava em item_completions (caso Rose:
    // clique "não funcionava" porque display ≠ write). Mesma fonte da aba Pessoal.
    queryFn: () => fetchPersonalChecklistsHoje(collabId!, 'work'),
    staleTime: 30_000,
  });

  if (completions.isLoading || lists.isLoading) {
    return <LoadingState rows={2} />;
  }

  if (completions.error || lists.error) {
    const err = (completions.error || lists.error) as Error;
    return (
      <ErrorState
        title="Não consegui carregar"
        description={String(err?.message || err)}
        onRetry={() => {
          completions.refetch();
          lists.refetch();
        }}
      />
    );
  }

  const todayCompletions = completions.data || [];
  const workLists = lists.data || [];
  const isEmpty = todayCompletions.length === 0 && workLists.length === 0;

  return (
    <div className="space-y-md">
      <div className="flex items-center justify-between">
        <h2 className="text-card-title">Trabalho</h2>
        <Button variant="primary" size="sm" onClick={onCreateClick}>
          + Criar lista
        </Button>
      </div>

      {isEmpty ? (
        <EmptyState
          title="Nada por aqui hoje"
          description="Quando o TOM disparar um checklist, ele aparece aqui. Ou crie uma lista de trabalho rápida com o botão acima."
        />
      ) : (
        <div className="space-y-sm">
          {todayCompletions.map((c) => (
            <ChecklistCard key={c.id} completion={c} />
          ))}
          {workLists.map((l: PersonalChecklist) => (
            <PersonalChecklistCard key={l.id} list={l} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Tab Pessoal: listas pessoais context='personal'
// ─────────────────────────────────────────────────────────────────

function PessoalView({ onCreateClick }: { onCreateClick: () => void }) {
  const { collaborator } = useAuth();
  const collabId = collaborator?.id ?? null;
  const qc = useQueryClient();

  const { data: lists = [], isLoading, error, refetch } = useQuery({
    queryKey: ['personal-checklists', collabId, 'personal'],
    enabled: !!collabId,
    queryFn: () => fetchPersonalChecklistsHoje(collabId!, 'personal'),
    staleTime: 30_000,
  });

  // Realtime: TOM marca item recorrente via WhatsApp → PWA atualiza ao vivo.
  useEffect(() => {
    if (!collabId) return;
    const ch = supabase
      .channel('personal-completions-desktop')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'personal_checklist_item_completions' },
        () => qc.invalidateQueries({ queryKey: ['personal-checklists'] }))
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'personal_checklist_completions' },
        () => qc.invalidateQueries({ queryKey: ['personal-checklists'] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [collabId]);

  if (isLoading) return <LoadingState rows={2} />;

  if (error) {
    return (
      <ErrorState
        title="Não consegui carregar suas listas"
        description="Pode ser conexão ou um problema no servidor."
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <div className="space-y-md">
      <div className="flex items-center justify-between">
        <h2 className="text-card-title">Listas pessoais</h2>
        <Button variant="primary" size="sm" onClick={onCreateClick}>
          + Criar lista
        </Button>
      </div>

      {lists.length === 0 ? (
        <EmptyState
          title="Nenhuma lista pessoal ainda"
          description="Crie sua primeira lista — mercado, viagem, remédios… O TOM vai te ajudar a lembrar."
        />
      ) : (
        <div className="space-y-sm">
          {lists.map((l) => (
            <PersonalChecklistCard key={l.id} list={l} />
          ))}
        </div>
      )}
    </div>
  );
}
