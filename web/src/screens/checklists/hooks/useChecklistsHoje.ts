// Sprint 23 — useChecklistsHoje (work + personal de hoje)
// Schema mapping:
//  - personal_checklists.owner_collab_id (não user_id)
//  - personal_checklists.list_type (não type)
//  - personal_checklists.is_active (true = visível; archived → is_active=false)
//  - personal_checklist_items.is_done (não is_checked) + sem filtro is_active
//  - Pra esta sprint, listas pessoais usam o modelo simples (is_done direto no item).
//    Recorrência (personal_checklist_completions) entra em sprint futura quando
//    todo o fluxo Hoje/reset diário for adaptado.

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';

export interface ChecklistItem {
  id: string;
  description: string;
  sort_order: number;
  is_checked: boolean;
  notes: string | null;
  item_completion_id: string | null;
}

export interface WorkChecklistHoje {
  scope: 'work';
  completion_id: string;
  checklist_id: string;
  name: string;
  dispatch_time: string | null;
  threshold: number;
  items: ChecklistItem[];
  extras: Array<{
    id: string;
    description: string;
    is_checked: boolean;
    notes: string | null;
  }>;
  completed_at: string | null;
  dispatched_at: string | null;
  reference_date: string;
}

export interface PersonalChecklistHoje {
  scope: 'personal';
  completion_id: string | null;
  checklist_id: string;
  name: string;
  type: string;
  recurrence_type: 'once' | 'daily' | 'weekly' | 'monthly';
  items: ChecklistItem[];
  extras?: never;
  completed_at: string | null;
  dispatched_at?: null;
  dispatch_time?: null;
  reference_date: string;
}

export type ChecklistHoje = WorkChecklistHoje | PersonalChecklistHoje;

export function useChecklistsHoje() {
  const qc = useQueryClient();
  const { collaborator } = useAuth();
  const collabId = collaborator?.id ?? null;

  // Sprint 23 — realtime: TOM marca via WhatsApp → PWA atualiza instantâneo
  useEffect(() => {
    const ch = supabase
      .channel('checklists-hoje-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'op_checklist_item_completions' },
        () => {
          qc.invalidateQueries({ queryKey: ['checklists-hoje'] });
          qc.invalidateQueries({ queryKey: ['checklists-kpi'] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'op_checklist_completions' },
        () => {
          qc.invalidateQueries({ queryKey: ['checklists-hoje'] });
          qc.invalidateQueries({ queryKey: ['checklists-kpi'] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'personal_checklist_items' },
        () => {
          qc.invalidateQueries({ queryKey: ['checklists-hoje'] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'checklist_attachments' },
        () => {
          qc.invalidateQueries({ queryKey: ['checklist-attachments'] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  return useQuery<{ work: WorkChecklistHoje[]; personal: PersonalChecklistHoje[] }>({
    queryKey: ['checklists-hoje', collabId],
    enabled: !!collabId,
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      if (!collabId) throw new Error('Sem colaborador no contexto');

      // 1. Work: completions de hoje com itens + extras
      const { data: workComps, error: e1 } = await supabase
        .from('op_checklist_completions')
        .select(
          `
          id, checklist_id, reference_date, completed_at, dispatched_at,
          op_checklists!inner ( id, name, dispatch_time, completion_threshold,
            op_checklist_items ( id, description, sort_order, is_active )
          ),
          op_checklist_item_completions ( id, item_id, is_checked, notes ),
          op_checklist_completion_extra_items ( id, description, is_checked, notes, sort_order )
        `
        )
        .eq('reference_date', today)
        .eq('collaborator_id', collabId);

      if (e1) {
        console.error('[useChecklistsHoje] work query error:', e1);
        throw e1;
      }

      const work: WorkChecklistHoje[] = (workComps || []).map((c: any) => {
        const tpl = c.op_checklists;
        const items: ChecklistItem[] = (tpl.op_checklist_items || [])
          .filter((it: any) => it.is_active)
          .sort((a: any, b: any) => a.sort_order - b.sort_order)
          .map((it: any) => {
            const ic = (c.op_checklist_item_completions || []).find(
              (x: any) => x.item_id === it.id
            );
            return {
              id: it.id,
              description: it.description,
              sort_order: it.sort_order,
              is_checked: !!ic?.is_checked,
              notes: ic?.notes ?? null,
              item_completion_id: ic?.id ?? null,
            };
          });
        const extras = (c.op_checklist_completion_extra_items || [])
          .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map((ex: any) => ({
            id: ex.id,
            description: ex.description,
            is_checked: !!ex.is_checked,
            notes: ex.notes ?? null,
          }));
        return {
          scope: 'work' as const,
          completion_id: c.id,
          checklist_id: tpl.id,
          name: tpl.name,
          dispatch_time: tpl.dispatch_time,
          threshold: tpl.completion_threshold,
          items,
          extras,
          completed_at: c.completed_at,
          dispatched_at: c.dispatched_at,
          reference_date: c.reference_date,
        };
      });

      // 2. Personal: usa schema antigo (is_done direto no item — sem completions por dia).
      // Recorrência fica reservada pra próxima sprint quando o fluxo de reset diário entrar.
      const { data: personalLists, error: e2 } = await supabase
        .from('personal_checklists')
        .select(
          `
          id, name, list_type, recurrence_type, is_active, owner_collab_id,
          personal_checklist_items ( id, description, sort_order, is_done, note )
        `
        )
        .eq('owner_collab_id', collabId)
        .eq('is_active', true);

      if (e2) {
        console.error('[useChecklistsHoje] personal query error:', e2);
        throw e2;
      }

      const personal: PersonalChecklistHoje[] = (personalLists || []).map((l: any) => {
        const items: ChecklistItem[] = (l.personal_checklist_items || [])
          .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map((it: any) => ({
            id: it.id,
            description: it.description,
            sort_order: it.sort_order ?? 0,
            is_checked: !!it.is_done,
            notes: it.note ?? null,
            item_completion_id: it.id, // pra listas pessoais usamos o próprio item id
          }));
        const allDone = items.length > 0 && items.every((i) => i.is_checked);
        return {
          scope: 'personal' as const,
          completion_id: l.id, // usa o próprio checklist id como completion (modelo simples)
          checklist_id: l.id,
          name: l.name,
          type: l.list_type || 'general',
          recurrence_type: l.recurrence_type || 'once',
          items,
          completed_at: allDone ? new Date().toISOString() : null,
          reference_date: today,
        };
      });

      return { work, personal };
    },
    staleTime: 30_000,
    retry: 1,
  });
}
