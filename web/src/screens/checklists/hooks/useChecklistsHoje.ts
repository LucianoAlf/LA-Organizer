// Sprint 23 — useChecklistsHoje (work + personal de hoje)

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

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

  // Sprint 23 — subscribe a mudanças em realtime (TOM marca via WhatsApp → PWA atualiza)
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
        { event: '*', schema: 'public', table: 'personal_checklist_item_completions' },
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
    queryKey: ['checklists-hoje'],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) throw new Error('Não autenticado');

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
        .eq('collaborator_id', user.id);

      if (e1) throw e1;

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

      // 2. Personal: listas do user + completions de hoje
      const { data: personalLists, error: e2 } = await supabase
        .from('personal_checklists')
        .select(
          `
          id, name, type, recurrence_type, archived_at, user_id,
          personal_checklist_items ( id, description, sort_order, is_active ),
          personal_checklist_completions ( id, completed_at, started_at, reference_date,
            personal_checklist_item_completions ( id, item_id, is_checked, notes )
          )
        `
        )
        .eq('user_id', user.id)
        .is('archived_at', null);

      if (e2) throw e2;

      const personal: PersonalChecklistHoje[] = (personalLists || []).map((l: any) => {
        const todayComp = (l.personal_checklist_completions || []).find(
          (c: any) => c.reference_date === today
        );
        const itemCompletions = todayComp?.personal_checklist_item_completions || [];
        const items: ChecklistItem[] = (l.personal_checklist_items || [])
          .filter((it: any) => it.is_active)
          .sort((a: any, b: any) => a.sort_order - b.sort_order)
          .map((it: any) => {
            const ic = itemCompletions.find((x: any) => x.item_id === it.id);
            return {
              id: it.id,
              description: it.description,
              sort_order: it.sort_order,
              is_checked: !!ic?.is_checked,
              notes: ic?.notes ?? null,
              item_completion_id: ic?.id ?? null,
            };
          });
        return {
          scope: 'personal' as const,
          completion_id: todayComp?.id ?? null,
          checklist_id: l.id,
          name: l.name,
          type: l.type || 'general',
          recurrence_type: l.recurrence_type || 'once',
          items,
          completed_at: todayComp?.completed_at ?? null,
          reference_date: today,
        };
      });

      return { work, personal };
    },
    staleTime: 30_000,
  });
}
