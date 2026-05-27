// Sprint 23 — CRUD de templates de checklist (op_checklists + op_checklist_items)

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

export interface OpChecklist {
  id: string;
  name: string;
  function_role: string | null;
  checklist_type: string | null;
  shift: string | null;
  unit: string | null;
  is_active: boolean;
  completion_threshold: number;
  dispatch_time: string | null;
  days_of_week: number[] | null;
  responsible_id: string | null;
  leader_id: string | null;
}

export interface OpChecklistItem {
  id: string;
  checklist_id: string;
  description: string;
  sort_order: number;
  is_active: boolean;
}

export function useTemplates() {
  const qc = useQueryClient();

  const list = useQuery<OpChecklist[]>({
    queryKey: ['templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('op_checklists')
        .select('*')
        .order('name');
      if (error) throw error;
      return (data || []) as OpChecklist[];
    },
  });

  const create = useMutation({
    mutationFn: async (payload: Partial<OpChecklist>) => {
      const { data: userData } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('op_checklists')
        .insert({
          ...payload,
          created_by: userData.user?.id,
          is_active: false,
          completion_threshold: payload.completion_threshold ?? 100,
        })
        .select('*')
        .single();
      if (error) throw error;
      return data as OpChecklist;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });

  const update = useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<OpChecklist>;
    }) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('op_checklists')
        .update({
          ...patch,
          updated_by: userData.user?.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });

  const toggleActive = useMutation({
    mutationFn: async ({
      id,
      isActive,
    }: {
      id: string;
      isActive: boolean;
    }) => {
      const { error } = await supabase
        .from('op_checklists')
        .update({ is_active: isActive })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });

  return { list, create, update, toggleActive };
}

export function useTemplateItems(templateId: string | null) {
  const qc = useQueryClient();
  const queryKey = ['template-items', templateId];

  const list = useQuery<OpChecklistItem[]>({
    queryKey,
    queryFn: async () => {
      if (!templateId) return [];
      const { data, error } = await supabase
        .from('op_checklist_items')
        .select('*')
        .eq('checklist_id', templateId)
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return (data || []) as OpChecklistItem[];
    },
    enabled: !!templateId,
  });

  const addItem = useMutation({
    mutationFn: async (description: string) => {
      if (!templateId) throw new Error('Sem templateId');
      const { data: userData } = await supabase.auth.getUser();
      const current = list.data || [];
      const sort_order = current.length
        ? Math.max(...current.map((i) => i.sort_order)) + 1
        : 1;
      const { error } = await supabase.from('op_checklist_items').insert({
        checklist_id: templateId,
        description,
        sort_order,
        is_active: true,
        updated_by: userData.user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const updateItem = useMutation({
    mutationFn: async ({
      id,
      description,
    }: {
      id: string;
      description: string;
    }) => {
      const { error } = await supabase
        .from('op_checklist_items')
        .update({ description })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('op_checklist_items')
        .update({ is_active: false })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  return { list, addItem, updateItem, deleteItem };
}
